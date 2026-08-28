/**
 * Panal — "Ver resultado": el CLIENTE descarga el resultado entregado.
 *
 * Flujo privado y verificable (sin gas):
 *   1. Lee getAgent(task.worker) del registry activo (v2 si V2_ENABLED) y
 *      extrae la URL del bot del metadataURI (token "bot:<url>", ver
 *      src/lib/botEndpoint.ts). Si no hay, avisa (tasks.resultNoEndpoint).
 *   2. Firma con la wallet (EIP-191, useSignMessage) el mensaje exacto
 *      "Panal resultado #<taskId>" — prueba de que es el cliente, sin gas.
 *   3. fetch al endpoint del bot → {resultText, resultHash}; muestra el texto
 *      en una caja scrollable y compara keccak256(toBytes(resultText)) con
 *      task.resultHash (leído de la tupla on-chain): badge verde si coincide,
 *      rojo si no.
 *   Errores: 403 → tasks.resultForbidden; fetch fallido → tasks.resultFetchError
 *   con botón reintentar.
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, BadgeCheck, FileDown, Loader2, RefreshCw, ShieldX } from 'lucide-react';
import { keccak256, toBytes } from 'viem';
import { useSignMessage } from 'wagmi';
import {
  PANAL_REGISTRY_ADDRESS,
  PANAL_REGISTRY_V2_ADDRESS,
  V2_ENABLED,
  publicClient,
} from '@/contracts/config';
import { panalRegistryAbi, panalRegistryV2Abi } from '@/contracts/abis';
import { buildResultUrl, cabecerasFirma, expiraEn, extractBotUrl, resultSignMessage } from '@/lib/botEndpoint';
import { useWallet } from '@/hooks/useWallet';
import type { RealTask } from '@/hooks/useMyTasks';
import { cn } from '@/lib/utils';
import { guardarEntrega, leerEntrega } from '@/lib/expedientes';
import {
  FileVerificationError,
  downloadDeliveredFile,
  formatBytes,
  parseFilesManifest,
  stripFilesManifest,
  type DeliveredFile,
} from '@/lib/deliveredFiles';

type Phase = 'loadingAgent' | 'noEndpoint' | 'ready' | 'signing' | 'fetching' | 'done' | 'forbidden' | 'fetchError';

interface ResultPayload {
  taskId?: string;
  resultText?: string;
  resultHash?: string;
}

export default function ResultDialog({ task }: { task: RealTask }) {
  const { t, i18n } = useTranslation();
  const { address } = useWallet();
  const { signMessageAsync } = useSignMessage();

  /**
   * La copia de ESTE navegador, si la hay.
   *
   * Se lee en el inicializador y no en un efecto a propósito: así el texto ya
   * está en el primer render y no hay un parpadeo de «firma para ver» delante
   * de algo que ya se tiene. Y se vuelve a comprobar contra la cadena aquí, sin
   * fiarse de que se comprobara al guardarla: el `resultHash` de esta tarea es
   * el que manda, y una copia que no cuadre con él no vale como copia de nada.
   */
  const [copia] = useState(() => {
    const g = leerEntrega(task.id.toString());
    if (!g) return null;
    return keccak256(toBytes(g.texto)).toLowerCase() === task.resultHash.toLowerCase() ? g : null;
  });

  const [phase, setPhase] = useState<Phase>(copia ? 'done' : 'loadingAgent');
  const [botUrl, setBotUrl] = useState<string | null>(null);
  const [resultText, setResultText] = useState(copia?.texto ?? '');
  const [verified, setVerified] = useState<boolean | null>(copia ? true : null);
  const [reloadTick, setReloadTick] = useState(0);
  /** Archivos que anuncia la entrega, leídos del manifiesto del texto. */
  const [files, setFiles] = useState<DeliveredFile[]>(() =>
    copia ? parseFilesManifest(copia.texto) : [],
  );
  /**
   * La firma se guarda porque la MISMA abre el texto y todos los archivos. Sin
   * esto habría que pedirle al usuario una firma por cada PDF que se baje.
   */
  const [signature, setSignature] = useState<{ firma: string; expira: number } | null>(null);
  /** Si lo que se ve salió del navegador y no del agente, ahora mismo. */
  const [deCopia, setDeCopia] = useState(copia !== null);
  /** Estado de cada descarga, por nombre de archivo. */
  const [descargas, setDescargas] = useState<Record<string, 'bajando' | 'ok' | 'mismatch' | 'error'>>({});

  // 1. Registry activo → metadataURI del agente → URL del bot.
  useEffect(() => {
    let cancelled = false;
    // Volver a 'cargando' cuando cambia la tarea es el arranque de la
    // secuencia, no un estado derivado: lo que viene detrás es asíncrono y
    // tarda. Quitarlo dejaría el resultado de la tarea anterior en pantalla
    // mientras se lee la nueva.
    //
    // Con una copia delante NO se toca la fase: la URL del bot se sigue
    // buscando —hace falta para bajar los archivos— pero por detrás, sin
    // quitar de la pantalla el texto que ya se está leyendo.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!copia) setPhase('loadingAgent');
    (async () => {
      try {
        const agent = (await publicClient.readContract({
          address: V2_ENABLED ? PANAL_REGISTRY_V2_ADDRESS : PANAL_REGISTRY_ADDRESS,
          abi: V2_ENABLED ? panalRegistryV2Abi : panalRegistryAbi,
          functionName: 'getAgent',
          args: [task.worker],
        })) as { metadataURI?: string };
        if (cancelled) return;
        const url = extractBotUrl(agent.metadataURI);
        setBotUrl(url);
        if (!copia) setPhase(url ? 'ready' : 'noEndpoint');
      } catch {
        if (!cancelled && !copia) setPhase('fetchError');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [task.worker, reloadTick, copia]);

  /**
   * La firma, pidiéndola solo si hace falta.
   *
   * La MISMA abre el texto y todos los archivos, así que se reutiliza mientras
   * le quede vida. Esto existe porque con una copia guardada el texto se ve sin
   * firmar nada, pero los archivos siguen viviendo en el agente: al pulsar
   * «descargar» hay que pedirla ahí, y antes no había dónde.
   */
  const conFirma = async (): Promise<{ firma: string; expira: number }> => {
    // Un margen de 10 s: una firma que caduca por el camino la rechaza el bot.
    // El reloj se lee dentro de `expiraEn` y no aquí, que este cuerpo vive en
    // el render y `Date.now()` suelto ahí no es puro.
    if (signature && signature.expira > expiraEn(10)) return signature;
    const expira = expiraEn();
    const firma = await signMessageAsync({ message: resultSignMessage(task.id, expira) });
    const nueva = { firma, expira };
    setSignature(nueva);
    return nueva;
  };

  // 2+3. Firmar y descargar.
  const signAndFetch = async () => {
    if (!botUrl || !address) return;
    try {
      setPhase('signing');
      // La firma caduca, y la caducidad va dentro de lo firmado. Se guarda con
      // ella porque el agente la necesita para reconstruir el mensaje, y porque
      // la MISMA firma abre luego cada archivo de la entrega.
      const { firma, expira } = await conFirma();
      setPhase('fetching');
      const res = await fetch(buildResultUrl(botUrl, task.id), {
        headers: cabecerasFirma(address, firma, expira),
      });
      if (res.status === 403) {
        setPhase('forbidden');
        return;
      }
      if (!res.ok) {
        setPhase('fetchError');
        return;
      }
      const body = (await res.json()) as ResultPayload;
      const text = typeof body.resultText === 'string' ? body.resultText : '';
      setResultText(text);
      // Verificación local contra el hash anclado on-chain (tupla tasks()).
      const cuadra = keccak256(toBytes(text)).toLowerCase() === task.resultHash.toLowerCase();
      setVerified(cuadra);
      // Y se guarda para la próxima vez. `guardarEntrega` vuelve a comprobar el
      // hash y solo guarda si cuadra: una entrega que no cuadre con la cadena
      // no se archiva como si fuera lo que se pagó.
      guardarEntrega(task.id.toString(), text, task.resultHash);
      setDeCopia(false);
      // Los archivos van anunciados DENTRO del texto, así que su hash queda
      // cubierto por el mismo resultHash que se acaba de comprobar arriba.
      setFiles(parseFilesManifest(text));
      setPhase('done');
    } catch (err) {
      // El usuario rechazó la firma: volvemos al estado listo sin error ruidoso.
      const msg = err instanceof Error ? err.message : String(err);
      setPhase(/reject|denied|user/i.test(msg) ? 'ready' : 'fetchError');
    }
  };

  /**
   * Baja un archivo, comprueba sus bytes y solo entonces lo guarda.
   *
   * Si el hash no cuadra NO se descarga: se avisa. Es el único momento en que
   * todo esto sirve de algo — significa que el archivo servido no es el que se
   * entregó, y el cliente tiene con qué abrir una disputa.
   */
  const bajarArchivo = async (file: DeliveredFile) => {
    if (!botUrl || !address) return;
    setDescargas((d) => ({ ...d, [file.name]: 'bajando' }));
    try {
      // Aquí puede pedirse la firma por primera vez: leyendo una copia guardada
      // no ha hecho falta ninguna hasta ahora.
      const blob = await downloadDeliveredFile(file, botUrl, address, await conFirma());
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href;
      a.download = file.name;
      a.click();
      // Sin revocar, el blob se queda en memoria hasta que se recarga la
      // pestaña; con un vídeo de 20 MB eso se nota.
      URL.revokeObjectURL(href);
      setDescargas((d) => ({ ...d, [file.name]: 'ok' }));
    } catch (err) {
      const roto = err instanceof FileVerificationError && /hash|size/.test(err.message);
      setDescargas((d) => ({ ...d, [file.name]: roto ? 'mismatch' : 'error' }));
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {phase === 'loadingAgent' && (
        <div className="flex items-center justify-center gap-2 py-10 text-ink-3">
          <Loader2 size={18} className="animate-spin" /> {t('tasks.resultLoadingAgent')}
        </div>
      )}

      {phase === 'noEndpoint' && (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-line bg-cream px-4 py-8 text-center">
          <AlertTriangle size={24} className="text-honey-deep" />
          <p className="max-w-sm text-[0.875rem] text-ink-2">{t('tasks.resultNoEndpoint')}</p>
        </div>
      )}

      {(phase === 'ready' || phase === 'signing') && (
        <button
          type="button"
          onClick={signAndFetch}
          disabled={phase === 'signing'}
          className="btn-monad inline-flex items-center justify-center gap-2 rounded-full px-4 py-2.5 text-[0.875rem] font-semibold disabled:opacity-50"
        >
          {phase === 'signing' && <Loader2 size={15} className="animate-spin" />}
          {phase === 'signing' ? t('tasks.resultSigning') : t('tasks.resultSign')}
        </button>
      )}

      {phase === 'fetching' && (
        <div className="flex items-center justify-center gap-2 py-10 text-ink-3">
          <Loader2 size={18} className="animate-spin" /> {t('tasks.resultLoading')}
        </div>
      )}

      {phase === 'forbidden' && (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-terra/40 bg-terra/10 px-4 py-8 text-center">
          <ShieldX size={24} className="text-terra" />
          <p className="max-w-sm text-[0.875rem] text-ink-2">{t('tasks.resultForbidden')}</p>
        </div>
      )}

      {phase === 'fetchError' && (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-terra/40 bg-terra/10 px-4 py-8 text-center">
          <AlertTriangle size={24} className="text-terra" />
          <p className="max-w-sm text-[0.875rem] text-ink-2">{t('tasks.resultFetchError')}</p>
          <button
            type="button"
            onClick={botUrl ? signAndFetch : () => setReloadTick((n) => n + 1)}
            className="inline-flex items-center gap-1.5 rounded-full border border-line px-4 py-2 text-[0.8125rem] font-medium text-ink-2 transition-colors hover:border-honey hover:text-honey-deep"
          >
            <RefreshCw size={13} /> {t('tasks.retry')}
          </button>
        </div>
      )}

      {phase === 'done' && (
        <>
          {/* El manifiesto se quita de la vista: es para la máquina, y en
              pantalla solo es ruido debajo del trabajo que se pagó. */}
          <div className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-xl border border-line bg-cream p-4 font-mono text-[0.8125rem] leading-relaxed text-ink">
            {files.length > 0 ? stripFilesManifest(resultText) : resultText}
          </div>

          {files.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="text-[0.75rem] font-semibold uppercase tracking-[0.12em] text-ink-3">
                {t('tasks.filesTitle', { count: files.length })}
              </p>
              {files.map((file) => {
                const estado = descargas[file.name];
                return (
                  <div
                    key={file.name}
                    className="flex items-center gap-3 rounded-xl border border-line bg-paper px-3 py-2.5"
                  >
                    <FileDown size={16} className="shrink-0 text-honey-deep" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[0.875rem] font-medium text-ink">{file.name}</p>
                      <p className="font-mono text-[11px] text-ink-3">
                        {formatBytes(file.size)}
                        {file.mime ? ` · ${file.mime}` : ''}
                      </p>
                      {estado === 'mismatch' && (
                        <p className="mt-1 text-[0.75rem] font-medium text-terra">{t('tasks.fileMismatch')}</p>
                      )}
                      {estado === 'error' && (
                        <p className="mt-1 text-[0.75rem] text-terra">{t('tasks.fileError')}</p>
                      )}
                      {estado === 'ok' && (
                        <p className="mt-1 inline-flex items-center gap-1 text-[0.75rem] font-medium text-olive">
                          <BadgeCheck size={12} /> {t('tasks.fileVerified')}
                        </p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => void bajarArchivo(file)}
                      disabled={estado === 'bajando'}
                      className="shrink-0 rounded-full border border-line px-3 py-1.5 text-[0.8125rem] font-medium text-ink-2 transition-colors hover:border-honey hover:text-honey-deep disabled:opacity-50"
                    >
                      {estado === 'bajando' ? (
                        <Loader2 size={13} className="animate-spin" />
                      ) : (
                        t('tasks.fileDownload')
                      )}
                    </button>
                  </div>
                );
              })}
              <p className="text-[0.75rem] leading-snug text-ink-3">{t('tasks.filesNote')}</p>
            </div>
          )}
          <div
            className={cn(
              'inline-flex items-center gap-1.5 self-start rounded-full px-3 py-1 text-[0.75rem] font-semibold',
              verified ? 'bg-olive/15 text-olive' : 'bg-terra/15 text-terra',
            )}
          >
            {verified ? <BadgeCheck size={13} /> : <ShieldX size={13} />}
            {verified ? t('tasks.resultVerified') : t('tasks.resultMismatch')}
          </div>

          {/* De dónde salió esto. Importa decirlo: una copia de este navegador
              se lee aunque el agente haya apagado su bot, y por eso mismo puede
              no ser lo último si el agente volvió a entregar. El botón vuelve a
              pedírsela a él —solo si publica endpoint, claro—. */}
          {deCopia && copia && (
            <p className="text-[0.75rem] leading-snug text-ink-3">
              {t('tasks.resultFromCopy', {
                fecha: new Date(copia.guardada).toLocaleDateString(i18n.language, {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                }),
              })}{' '}
              {botUrl && (
                <button
                  type="button"
                  onClick={() => void signAndFetch()}
                  className="font-medium text-honey-deep underline underline-offset-2 hover:text-honey"
                >
                  {t('tasks.resultRefetch')}
                </button>
              )}
            </p>
          )}
        </>
      )}
    </div>
  );
}
