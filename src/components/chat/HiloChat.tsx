/**
 * Panal — el hilo de conversación con un agente.
 *
 * Cada mensaje se paga por x402: se pide precio (gratis), se firma un permiso
 * y el agente cobra y responde en la misma llamada. Ni gas, ni esperar
 * bloques, ni aprobar nada.
 *
 * Tres cosas de esta pantalla no son decorativas:
 *
 *   1. EL PRECIO SIEMPRE A LA VISTA. Un chat que cobra sin recordarlo se
 *      siente como una trampa. Va bajo el campo de escribir, siempre.
 *   2. LA COTIZACIÓN SE PIDE ANTES DE FIRMAR, no se usa la de la tarjeta. Un
 *      agente puede subir su precio entre que se cargó la ficha y que se
 *      escribe el mensaje, y lo que se enseña tiene que ser lo que se firma.
 *   3. SI FALLA, SE DICE SI SE COBRÓ. Es siempre la primera pregunta de quien
 *      ve un error, y callarla es lo que convierte un fallo en desconfianza.
 *
 * Con el mensaje pueden ir archivos (ver `lib/archivosDelChat.ts`). Se suben
 * al buzón ANTES de firmar el pago, y el agente los comprueba antes de cobrar:
 * si algo falla por el camino, no se ha pagado nada.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useWalletClient } from 'wagmi';
import { formatUnits } from 'viem';
import { Download, FileText, Loader2, Paperclip, Send, TriangleAlert, X } from 'lucide-react';
import { FileVerificationError, type HashedFile, type X402Accept } from '@panal/sdk';
import {
  cotizar,
  enviarMensaje,
  leerCobroPorLlamada,
  motivoLegible,
  type CobroPorLlamada,
} from '@/lib/chat';
import {
  MAX_ADJUNTOS,
  MAX_BYTES_ADJUNTO,
  bajarAdjunto,
  problemaConAdjuntos,
  subirAdjuntos,
  type Adjunto,
  type ProblemaConAdjuntos,
} from '@/lib/archivosDelChat';
import { formatBytes } from '@/lib/deliveredFiles';
import { guardarComoArchivo } from '@/lib/archivosTablon';
import { anadirMensaje, leerHilo, nuevoId, type Mensaje } from '@/lib/historial';
import { claveDeEntrada, encargosDelCliente, fusionarHilo } from '@/lib/conversaciones';
import { getTaskBrief } from '@/lib/taskBriefs';
import { useMyTasks } from '@/hooks/useMyTasks';
import { activeChain, currencySymbol } from '@/contracts/config';
import { useWallet } from '@/hooks/useWallet';
import { cn } from '@/lib/utils';
import FirmarMensajeDialog from '@/components/chat/FirmarMensajeDialog';
import TarjetaEncargo from '@/components/chat/TarjetaEncargo';
import { keccak256, type Address } from 'viem';

export interface HiloChatProps {
  /** Dirección on-chain del agente. Es la mitad de la clave del hilo. */
  agente: string;
  nombre: string;
  /** Su endpoint publicado en el registro. Sin esto no hay con quién hablar. */
  botUrl: string | null;
  /**
   * Abrir el diálogo de contratación.
   *
   * Existe porque hay agentes que NO cobran por mensaje: sólo aceptan encargos
   * del escrow. Con ésos esta pantalla decía "no cobra por mensaje" y ahí se
   * acababa —un callejón sin salida en la única pantalla donde alguien ya
   * había decidido tratar con ese agente—. Los dos modelos son del mismo hilo,
   * así que la otra vía tiene que estar aquí.
   */
  onEncargar?: () => void;
}

export default function HiloChat({ agente, nombre, botUrl, onEncargar }: HiloChatProps) {
  const { t } = useTranslation();
  const { address, connected, connect } = useWallet();
  const { data: walletClient } = useWalletClient();
  const { tasks, refetch } = useMyTasks();

  /**
   * Lo que le has ENCARGADO a este agente, que también es la conversación.
   *
   * Sale del escrow y no del historial local: el encargo ya está en la
   * cadena, copiarlo aquí sólo serviría para que se quedara viejo. Por eso
   * aparece aunque contrataras desde otro navegador.
   */
  const encargos = useMemo(
    () =>
      encargosDelCliente(tasks, currencySymbol, getTaskBrief).filter(
        (e) => e.agente.toLowerCase() === agente.toLowerCase(),
      ),
    [tasks, agente],
  );
  /** Cada encargo con su tarea del escrow: la tarjeta la necesita para ver la entrega y aprobarla. */
  const tareaPorId = useMemo(() => new Map(tasks.map((tk) => [tk.id.toString(), tk])), [tasks]);

  /**
   * Todo lo que depende de CON QUIÉN se habla y COMO QUIÉN.
   *
   * Se reinicia comparando la clave en el render y no desde un efecto: hacerlo
   * en un efecto encadena un render de más y, sobre todo, deja un instante en
   * el que se enseña el hilo de la wallet ANTERIOR. En una app donde la wallet
   * es la identidad, ese instante es enseñarle a alguien una conversación que
   * no es suya.
   */
  const claveHilo = `${address ?? ''}|${agente}|${botUrl ?? ''}`;
  const [clavePrevia, setClavePrevia] = useState(claveHilo);
  const [mensajes, setMensajes] = useState<Mensaje[]>(() => (address ? leerHilo(address, agente) : []));
  /** `undefined` = todavía no se sabe · `null` = no cobra por llamada. */
  const [cobro, setCobro] = useState<CobroPorLlamada | null | undefined>(botUrl ? undefined : null);
  const [borrador, setBorrador] = useState('');
  const [cotizacion, setCotizacion] = useState<X402Accept | null>(null);
  const [pidiendo, setPidiendo] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [adjuntos, setAdjuntos] = useState<Adjunto[]>([]);
  /** Mientras se suben los archivos, antes de firmar el pago. */
  const [subiendo, setSubiendo] = useState(false);
  /** El hash del archivo que se está bajando, para el spinner de su botón. */
  const [bajando, setBajando] = useState<string | null>(null);
  const finRef = useRef<HTMLDivElement>(null);
  const elegirRef = useRef<HTMLInputElement>(null);

  if (clavePrevia !== claveHilo) {
    setClavePrevia(claveHilo);
    setMensajes(address ? leerHilo(address, agente) : []);
    setCobro(botUrl ? undefined : null);
    setCotizacion(null);
    setAdjuntos([]);
  }

  const entradas = useMemo(() => fusionarHilo(mensajes, encargos), [mensajes, encargos]);

  const estadoCobro = cobro === undefined ? 'leyendo' : cobro === null ? 'sin' : 'listo';

  // ¿Cobra por llamada este agente? Hay agentes que sólo aceptan encargos del
  // escrow: con esos no se puede chatear, y es mejor decirlo que ofrecer un
  // campo de texto que no va a poder enviarse.
  useEffect(() => {
    if (!botUrl) return;
    let vigente = true;
    void leerCobroPorLlamada(botUrl, agente as Address).then((c) => {
      if (vigente) setCobro(c);
    });
    return () => {
      vigente = false;
    };
  }, [botUrl, agente]);

  useEffect(() => {
    finRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [entradas.length, enviando]);

  const precio = cobro ? `${formatUnits(cobro.amount, cobro.decimales)} ${cobro.simbolo}` : '';

  const textoDelProblema = useCallback(
    (p: ProblemaConAdjuntos): string => {
      if (p.tipo === 'noAcepta') return t('chat.files.noAccept', { name: nombre });
      if (p.tipo === 'demasiados') return t('chat.files.tooMany', { max: p.max });
      return t('chat.files.tooBig', { name: p.nombre, mb: Math.floor(p.maxBytes / 1024 / 1024) });
    },
    [t, nombre],
  );

  /** Paso 1: pedir el precio de ESTE mensaje. Gratis, y no compromete a nada. */
  const pedirCotizacion = useCallback(async () => {
    if (!cobro || !address || !borrador.trim()) return;
    setPidiendo(true);
    try {
      const cot = await cotizar(cobro, borrador.trim(), address as `0x${string}`);
      // Si no acepta estos archivos, se dice aquí: sin subir nada ni pedir firmas.
      const problema = problemaConAdjuntos(cot, adjuntos);
      if (problema) toast.error(t('chat.files.cantSend'), { description: textoDelProblema(problema) });
      else setCotizacion(cot);
    } catch (err) {
      toast.error(t('chat.quoteFailed'), { description: motivoLegible(err) });
    } finally {
      setPidiendo(false);
    }
  }, [cobro, address, borrador, adjuntos, textoDelProblema, t]);

  /** Lo elegido se lee entero aquí: lo que pasa de los topes ni se añade. */
  const alElegir = async (lista: FileList | null) => {
    if (!lista?.length) return;
    const nuevos: Adjunto[] = [];
    for (const f of Array.from(lista)) {
      if (adjuntos.length + nuevos.length >= MAX_ADJUNTOS) {
        toast.error(t('chat.files.tooMany', { max: MAX_ADJUNTOS }));
        break;
      }
      if (f.size === 0) continue;
      if (f.size > MAX_BYTES_ADJUNTO) {
        toast.error(t('chat.files.tooBig', { name: f.name, mb: Math.floor(MAX_BYTES_ADJUNTO / 1024 / 1024) }));
        continue;
      }
      nuevos.push({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()), ...(f.type ? { mime: f.type } : {}) });
    }
    setAdjuntos((a) => [...a, ...nuevos]);
  };

  /** Un archivo que devolvió el agente: se baja del buzón, se comprueba y se guarda. */
  const bajar = async (archivo: HashedFile) => {
    if (!walletClient || !address) return;
    setBajando(archivo.hash);
    try {
      const bytes = await bajarAdjunto({
        yo: address as Address,
        archivo,
        firmar: (message) => walletClient.signMessage({ account: walletClient.account, message }),
      });
      guardarComoArchivo(archivo.name, bytes, archivo.mime);
    } catch (err) {
      toast.error(
        err instanceof FileVerificationError ? t('chat.files.notMatch') : t('chat.files.downloadFailed'),
        { description: motivoLegible(err) },
      );
    } finally {
      setBajando(null);
    }
  };

  /** Paso 2: firmar y enviar. Aquí es donde se cobra. */
  const confirmar = useCallback(async () => {
    if (!cobro || !cotizacion || !walletClient || !address) return;
    const texto = borrador.trim();
    const conArchivos = adjuntos;
    setCotizacion(null);
    setEnviando(true);

    // El mensaje propio se pinta y se guarda ANTES de la respuesta: si el
    // agente tarda o falla, lo que se escribió no se pierde de la pantalla.
    // De los archivos queda la lista, con el hash de lo que tú tenías.
    const mio: Mensaje = {
      id: nuevoId(),
      de: 'yo',
      texto,
      cuando: Date.now(),
      ...(conArchivos.length
        ? {
            archivos: conArchivos.map((a) => ({
              name: a.name,
              size: a.bytes.byteLength,
              hash: keccak256(a.bytes),
              ...(a.mime ? { mime: a.mime } : {}),
            })),
          }
        : {}),
    };
    setMensajes(anadirMensaje(address, agente, mio));
    setBorrador('');
    setAdjuntos([]);

    try {
      // Primero los archivos, al buzón: si esto falla, todavía no se ha
      // firmado el pago.
      let archivos: HashedFile[] = [];
      if (conArchivos.length) {
        setSubiendo(true);
        archivos = await subirAdjuntos({
          agente: agente as Address,
          yo: address as Address,
          adjuntos: conArchivos,
          firmar: (message) => walletClient.signMessage({ account: walletClient.account, message }),
        });
        setSubiendo(false);
      }
      const res = await enviarMensaje({
        cobro,
        mensaje: texto,
        wallet: walletClient,
        account: walletClient.account,
        // Lo que enseñó la hoja de firmar, como en la app. Con el precio de la
        // tarjeta, un agente que cobra en MON no se podía pagar nunca: su
        // cotización lleva unos wei de más para reconocer el pago, y el SDK
        // la rechazaba por pasarse del tope.
        topeMaximo: BigInt(cotizacion.amount),
        cotizacion,
        chainId: activeChain.id,
        archivos,
      });
      setMensajes(
        anadirMensaje(address, agente, {
          id: nuevoId(),
          de: 'agente',
          texto: res.texto,
          cuando: Date.now(),
          pagado: res.pagado.toString(),
          simbolo: cobro.simbolo,
          ...(res.archivos.length ? { archivos: res.archivos } : {}),
        }),
      );
    } catch (err) {
      toast.error(t('chat.sendFailed'), { description: motivoLegible(err) });
      // El borrador vuelve para que no haya que reescribirlo, y los archivos con él.
      setBorrador(texto);
      setAdjuntos(conArchivos);
    } finally {
      setSubiendo(false);
      setEnviando(false);
    }
  }, [cobro, cotizacion, walletClient, address, borrador, adjuntos, agente, t]);

  const puedeEnviar = estadoCobro === 'listo' && connected && borrador.trim().length > 0 && !enviando && !pidiendo;

  return (
    <div className="flex h-full flex-col">
      {/* Los mensajes */}
      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-5">
        {entradas.length === 0 && (
          <p className="mx-auto max-w-sm py-10 text-center text-[0.875rem] leading-relaxed text-ink-3">
            {t('chat.empty', { name: nombre })}
          </p>
        )}

        {/* Mensajes y encargos, en el orden en que pasaron. */}
        {entradas.map((e) =>
          e.clase === 'encargo' ? (
            <TarjetaEncargo
              key={claveDeEntrada(e)}
              encargo={e.encargo}
              botUrl={botUrl}
              tarea={tareaPorId.get(e.encargo.id)}
              onCambio={refetch}
            />
          ) : (
            <div
              key={claveDeEntrada(e)}
              className={cn(
                'max-w-[82%] rounded-2xl border px-3.5 py-2.5 text-[0.875rem] leading-relaxed',
                e.mensaje.de === 'yo'
                  ? 'ml-auto rounded-br-sm border-monad/40 bg-monad/15 text-ink'
                  : 'mr-auto rounded-bl-sm border-line bg-cream text-ink',
              )}
            >
              <p className="whitespace-pre-wrap break-words">{e.mensaje.texto}</p>
              {e.mensaje.archivos?.length ? (
                <ul className="mt-2 flex flex-col gap-1.5">
                  {e.mensaje.archivos.map((a) =>
                    // Los tuyos solo se enumeran: los tienes tú, y en el buzón
                    // van cifrados para el agente. Los del agente se bajan.
                    e.mensaje.de === 'agente' ? (
                      <li key={a.hash}>
                        <button
                          type="button"
                          onClick={() => void bajar(a)}
                          disabled={bajando !== null}
                          aria-label={t('chat.files.download', { name: a.name })}
                          className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-line bg-paper px-3 py-1 text-[0.75rem] text-ink-2 transition-colors hover:border-monad hover:text-monad disabled:opacity-50"
                        >
                          {bajando === a.hash ? (
                            <Loader2 size={12} className="animate-spin" aria-hidden />
                          ) : (
                            <Download size={12} aria-hidden />
                          )}
                          <span className="truncate">{a.name}</span>
                          <span className="shrink-0 text-ink-3">{formatBytes(a.size)}</span>
                        </button>
                      </li>
                    ) : (
                      <li key={a.hash} className="flex items-center gap-1.5 text-[0.75rem] text-ink-2">
                        <Paperclip size={12} className="shrink-0" aria-hidden />
                        <span className="truncate">{a.name}</span>
                        <span className="shrink-0 text-ink-3">{formatBytes(a.size)}</span>
                      </li>
                    ),
                  )}
                </ul>
              ) : null}
            </div>
          ),
        )}

        {enviando && (
          <div className="mr-auto flex max-w-[82%] items-center gap-2 rounded-2xl rounded-bl-sm border border-line bg-cream px-3.5 py-2.5 text-[0.8125rem] text-ink-3">
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
            {subiendo ? t('chat.files.uploading') : t('chat.working', { name: nombre })}
          </div>
        )}
        <div ref={finRef} />
      </div>

      {/* Escribir */}
      <div className="border-t border-line bg-coal-2 px-3 py-3">
        {estadoCobro === 'sin' ? (
          <div className="flex flex-col gap-3 px-1 py-2">
            <p className="flex items-start gap-2 text-[0.8125rem] leading-relaxed text-ink-3">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-honey" aria-hidden />
              {t('chat.noPerCall', { name: nombre })}
            </p>
            {onEncargar && (
              <button
                type="button"
                onClick={onEncargar}
                className="btn-monad inline-flex w-full py-3 text-[0.9375rem] font-semibold"
              >
                <FileText className="size-4" aria-hidden />
                {t('chat.commission')}
              </button>
            )}
          </div>
        ) : (
          <>
            {adjuntos.length > 0 && (
              <ul className="mb-2 flex flex-wrap gap-1.5 px-1">
                {adjuntos.map((a, i) => (
                  <li
                    key={`${a.name}-${i}`}
                    className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-line bg-sand py-1 pl-3 pr-1 text-[0.75rem] text-ink-2"
                  >
                    <Paperclip size={12} className="shrink-0" aria-hidden />
                    <span className="truncate">{a.name}</span>
                    <span className="shrink-0 text-ink-3">{formatBytes(a.bytes.byteLength)}</span>
                    <button
                      type="button"
                      onClick={() => setAdjuntos((l) => l.filter((_, j) => j !== i))}
                      disabled={enviando}
                      aria-label={t('chat.files.remove', { name: a.name })}
                      className="flex size-5 shrink-0 items-center justify-center rounded-full text-ink-3 transition-colors hover:text-ink"
                    >
                      <X size={12} aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex items-end gap-2">
              <input
                ref={elegirRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  void alElegir(e.target.files);
                  e.target.value = '';
                }}
              />
              <button
                type="button"
                onClick={() => elegirRef.current?.click()}
                disabled={estadoCobro !== 'listo' || enviando || adjuntos.length >= MAX_ADJUNTOS}
                aria-label={t('chat.files.attach')}
                title={t('chat.files.attach')}
                className="flex size-11 shrink-0 items-center justify-center rounded-full border border-line text-ink-2 transition-colors hover:border-honey hover:text-ink disabled:opacity-40"
              >
                <Paperclip className="size-4" aria-hidden />
              </button>
              <textarea
                value={borrador}
                onChange={(e) => setBorrador(e.target.value)}
                rows={1}
                placeholder={t('chat.placeholder')}
                disabled={estadoCobro === 'leyendo' || enviando}
                className="max-h-32 min-h-11 w-full flex-1 resize-none rounded-2xl border border-line bg-sand px-4 py-3 text-[0.875rem] text-ink placeholder:text-ink-3 focus:border-honey focus:outline-none disabled:opacity-50"
              />
              <button
                type="button"
                onClick={() => (connected ? void pedirCotizacion() : connect())}
                disabled={connected && !puedeEnviar}
                aria-label={t('chat.send')}
                className="btn-monad flex size-11 shrink-0 disabled:opacity-40"
              >
                {pidiendo || enviando ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <Send className="size-4" aria-hidden />
                )}
              </button>
            </div>

            {/* El precio, siempre. Y la limitación del historial, dicha una vez. */}
            <p className="mt-2 px-1 text-[0.6875rem] leading-snug text-ink-3">
              {estadoCobro === 'leyendo'
                ? t('chat.loadingPrice')
                : t('chat.perMessage', { price: precio })}
              {' · '}
              {t('chat.localHistory')}
            </p>

            {/* Y la otra vía, discreta: hablar es barato, encargar deja prueba. */}
            {onEncargar && (
              <button
                type="button"
                onClick={onEncargar}
                className="mt-1.5 px-1 text-[0.6875rem] font-medium text-honey transition-colors hover:text-honey-deep"
              >
                {t('chat.commission')}
              </button>
            )}
          </>
        )}
      </div>

      <FirmarMensajeDialog
        open={cotizacion !== null}
        onOpenChange={(abierto) => !abierto && setCotizacion(null)}
        cotizacion={cotizacion}
        nombre={nombre}
        archivos={adjuntos.length}
        onConfirmar={() => void confirmar()}
      />
    </div>
  );
}
