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
import { AlertTriangle, BadgeCheck, FileDown, Loader2, Lock, RefreshCw, ShieldX } from 'lucide-react';
import { keccak256, toBytes, type Address } from 'viem';
import { descifrarTexto, esTextoCifrado } from '@panal/sdk';
import { abrirArchivo, miClave } from '@/lib/cifrado';
import { useSignMessage } from 'wagmi';
import {
  PANAL_REGISTRY_ADDRESS,
  PANAL_REGISTRY_V2_ADDRESS,
  V2_ENABLED,
  publicClient,
} from '@/contracts/config';
import { panalRegistryAbi, panalRegistryV2Abi } from '@/contracts/abis';
import { buildResultUrl, cabecerasFirma, esBuzon, expiraEn, extractBotUrl, resultSignMessage, urlDeBuzon } from '@/lib/botEndpoint';
import { useWallet } from '@/hooks/useWallet';
import type { RealTask } from '@/hooks/useMyTasks';
import { cn } from '@/lib/utils';
import { guardarEntrega, leerEntrega, textoDeEntrega } from '@/lib/expedientes';
import SubcontratosDeLaEntrega from '@/components/dashboard/SubcontratosDeLaEntrega';
import AvisoEjecutable from '@/components/AvisoEjecutable';
import { guardarComoArchivo } from '@/lib/archivosTablon';
import {
  FileVerificationError,
  downloadDeliveredFile,
  enLaCopiaDelBuzon,
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
    // Cifrada y sin abrir en este navegador, la copia no sirve para leerla.
    if (esTextoCifrado(g.texto) && g.claro === undefined) return null;
    return keccak256(toBytes(g.texto)).toLowerCase() === task.resultHash.toLowerCase() ? g : null;
  });

  const [phase, setPhase] = useState<Phase>(copia ? 'done' : 'loadingAgent');
  const [botUrl, setBotUrl] = useState<string | null>(null);
  const [resultText, setResultText] = useState(copia ? textoDeEntrega(copia) : '');
  const [verified, setVerified] = useState<boolean | null>(copia ? true : null);
  const [reloadTick, setReloadTick] = useState(0);
  /** Archivos que anuncia la entrega, leídos del manifiesto del texto. */
  const [files, setFiles] = useState<DeliveredFile[]>(() =>
    copia ? parseFilesManifest(textoDeEntrega(copia)) : [],
  );
  /**
   * La firma se guarda porque la MISMA abre el texto y todos los archivos. Sin
   * esto habría que pedirle al usuario una firma por cada PDF que se baje.
   */
  const [signature, setSignature] = useState<{ firma: string; expira: number } | null>(null);
  /** Si lo que se ve salió del navegador y no del agente, ahora mismo. */
  const [deCopia, setDeCopia] = useState(copia !== null);
  /**
   * La entrega se leyó de la copia que el agente dejó en el buzón de Panal,
   * porque él no contestó. Se dice en pantalla, y los archivos se piden ahí.
   */
  const [deLaCopiaDelBuzon, setDeLaCopiaDelBuzon] = useState(false);
  /** Si la entrega venía cifrada: sus archivos también, y hay que abrirlos. */
  const [cifrada, setCifrada] = useState(() => copia?.claro !== undefined);
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
    if (!address) return;
    try {
      setPhase('signing');
      // La firma caduca, y la caducidad va dentro de lo firmado. Se guarda con
      // ella porque el agente la necesita para reconstruir el mensaje, y porque
      // la MISMA firma abre luego cada archivo de la entrega.
      const { firma, expira } = await conFirma();
      setPhase('fetching');
      const cabeceras = cabecerasFirma(address, firma, expira);
      // Primero el agente, que es donde vive la entrega. Si no contesta —o ya
      // no publica dónde—, la copia que dejó en el buzón de Panal: la misma
      // firma la abre, y su hash se comprueba igual que el de aquí.
      const delAgente = botUrl
        ? await fetch(buildResultUrl(botUrl, task.id), { headers: cabeceras }).catch(() => null)
        : null;
      if (delAgente?.status === 403) {
        setPhase('forbidden');
        return;
      }
      let res = delAgente?.ok ? delAgente : null;
      let usoLaCopia = false;
      if (!res && !(botUrl && esBuzon(botUrl))) {
        const copiaDelBuzon = await fetch(buildResultUrl(urlDeBuzon(task.worker), task.id), { headers: cabeceras }).catch(
          () => null,
        );
        if (copiaDelBuzon?.ok) {
          res = copiaDelBuzon;
          usoLaCopia = true;
        }
      }
      if (!res) {
        setPhase('fetchError');
        return;
      }
      setDeLaCopiaDelBuzon(usoLaCopia);
      const body = (await res.json()) as ResultPayload;
      const text = typeof body.resultText === 'string' ? body.resultText : '';
      // Verificación local contra el hash anclado on-chain (tupla tasks()). Si
      // va cifrada, el hash es el del sobre: lo que se comprueba es que el
      // buzón no ha cambiado ni un byte, y luego se abre con la clave propia.
      const cuadra = keccak256(toBytes(text)).toLowerCase() === task.resultHash.toLowerCase();
      setVerified(cuadra);
      const esCifrada = esTextoCifrado(text);
      setCifrada(esCifrada);
      const legible = esCifrada
        ? descifrarTexto(
            text,
            address as Address,
            (await miClave(address as Address, (mensaje) => signMessageAsync({ message: mensaje }))).secreta,
          )
        : text;
      setResultText(legible);
      // Y se guarda para la próxima vez. `guardarEntrega` vuelve a comprobar el
      // hash y solo guarda si cuadra: una entrega que no cuadre con la cadena
      // no se archiva como si fuera lo que se pagó.
      guardarEntrega(task.id.toString(), text, task.resultHash, esCifrada ? legible : undefined);
      setDeCopia(false);
      // Los archivos van anunciados DENTRO del texto, así que su hash queda
      // cubierto por el mismo resultHash que se acaba de comprobar arriba.
      setFiles(parseFilesManifest(legible));
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
    if (!address) return;
    setDescargas((d) => ({ ...d, [file.name]: 'bajando' }));
    try {
      // Aquí puede pedirse la firma por primera vez: leyendo una copia guardada
      // no ha hecho falta ninguna hasta ahora.
      const credencial = await conFirma();
      const delBuzon = () =>
        downloadDeliveredFile(enLaCopiaDelBuzon(file, task.id), urlDeBuzon(task.worker), address, credencial);
      let bajado: Blob;
      if (!botUrl || deLaCopiaDelBuzon) {
        bajado = await delBuzon();
      } else {
        try {
          bajado = await downloadDeliveredFile(file, botUrl, address, credencial);
        } catch (err) {
          // Unos bytes que no cuadran no se van a buscar a otra parte: eso es
          // motivo de disputa, no de reintento. Un agente que no contesta, sí.
          const roto = err instanceof FileVerificationError && /hash|size/.test(err.message);
          if (roto || esBuzon(botUrl)) throw err;
          bajado = await delBuzon();
        }
      }
      // Los bytes ya están comprobados contra el hash de la entrega; si van
      // cifrados, se abren aquí, en el navegador.
      const blob = cifrada
        ? new Blob(
            [
              abrirArchivo(
                new Uint8Array(await bajado.arrayBuffer()),
                address as Address,
                await miClave(address as Address, (mensaje) => signMessageAsync({ message: mensaje })),
              ) as BlobPart,
            ],
            { type: file.mime || 'application/octet-stream' },
          )
        : bajado;
      // Se revisa antes de guardarlo; si quien lo baja dice que no, el botón
      // vuelve a estar como antes.
      const guardado = await guardarComoArchivo(file.name, new Uint8Array(await blob.arrayBuffer()), file.mime);
      setDescargas((d) => {
        const resto = { ...d };
        if (guardado) resto[file.name] = 'ok';
        else delete resto[file.name];
        return resto;
      });
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
          {/* Sin servidor publicado puede quedar la copia del buzón. */}
          <button
            type="button"
            onClick={() => void signAndFetch()}
            className="inline-flex items-center gap-1.5 rounded-full border border-line px-4 py-2 text-[0.8125rem] font-medium text-ink-2 transition-colors hover:border-honey hover:text-honey-deep"
          >
            {t('tasks.resultTryBackup')}
          </button>
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
          {/* Los bloques (archivos, subcontrataciones) se quitan de la vista: son
              para la máquina, y lo que dicen se enseña aparte, más abajo. */}
          <div className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-xl border border-line bg-cream p-4 font-mono text-[0.8125rem] leading-relaxed text-ink">
            {stripFilesManifest(resultText)}
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
                      <AvisoEjecutable nombre={file.name} mime={file.mime} className="mt-1" />
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
          <SubcontratosDeLaEntrega texto={resultText} />
          <div
            className={cn(
              'inline-flex items-center gap-1.5 self-start rounded-full px-3 py-1 text-[0.75rem] font-semibold',
              verified ? 'bg-olive/15 text-olive' : 'bg-terra/15 text-terra',
            )}
          >
            {verified ? <BadgeCheck size={13} /> : <ShieldX size={13} />}
            {verified ? t('tasks.resultVerified') : t('tasks.resultMismatch')}
          </div>
          {cifrada && (
            <p className="inline-flex items-center gap-1.5 self-start text-[0.75rem] text-olive">
              <Lock size={12} aria-hidden />
              {t('tasks.cifrado.entrega')}
            </p>
          )}

          {/* De dónde salió esto. Importa decirlo: una copia de este navegador
              se lee aunque el agente haya apagado su bot, y por eso mismo puede
              no ser lo último si el agente volvió a entregar. El botón vuelve a
              pedírsela a él —solo si publica endpoint, claro—. */}
          {deLaCopiaDelBuzon && (
            <p className="text-[0.75rem] leading-snug text-ink-3">{t('tasks.resultFromBackup')}</p>
          )}

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
