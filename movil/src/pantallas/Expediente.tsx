import { useCallback, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useSignMessage } from 'wagmi';
import { useWallet } from '@/hooks/useWallet';
import { useMyTasks } from '@/hooks/useMyTasks';
import { currencySymbol } from '@/contracts/config';
import { ESTADO } from '@/lib/conversaciones';
import { buildResultUrl, cabecerasFirma, expiraEn, resultSignMessage } from '@/lib/botEndpoint';
import {
  FileVerificationError,
  downloadDeliveredFile,
  formatBytes,
} from '@/lib/deliveredFiles';
import type { DeliveredFile } from '@/lib/deliveredFiles';
import { useAgente } from '~/lib/agente';
import { armar, guardarEntrega } from '@/lib/expedientes';
import type { Expediente as Expe } from '@/lib/expedientes';
import { aHtml, guardarArchivo, guardarCopia, nombreDe } from '~/lib/copia';
import { monto } from '~/lib/formato';
import Icono from '~/componentes/Icono';
import { etiquetaIdioma, useTextos } from '~/i18n/idiomas';
import type { Textos } from '~/i18n/idiomas';

/**
 * Un encargo, entero.
 *
 * Arriba lo que la cadena guarda —que es poco y no se puede cambiar—, abajo lo
 * que solo está en este teléfono. La separación es el fondo del asunto: la
 * cadena prueba QUE encargaste algo, cuándo, por cuánto y que te entregaron; tu
 * copia prueba QUÉ. Un hash sin el texto no dice qué había dentro.
 *
 * Por eso «Traer la entrega» existe: hasta ahora la app enseñaba el estado del
 * encargo pero no guardaba ni una línea de lo entregado, así que el hash de la
 * cadena no tenía contra qué compararse. Se pide con la misma firma EIP-191 que
 * ya protege `/result`, se comprueba el keccak256 contra lo que ancló la
 * cadena, y solo entonces se guarda.
 */
/** El color no cambia de idioma; el rótulo sale de `T` por su clave. */
const ESTADOS: Record<number, { clave: keyof Textos['expediente']; color: string }> = {
  [ESTADO.Abierto]: { clave: 'abierto', color: '#B7A8FC' },
  [ESTADO.Entregado]: { clave: 'entregado', color: '#E29A2E' },
  [ESTADO.Completado]: { clave: 'completado', color: '#92A268' },
  [ESTADO.Disputado]: { clave: 'disputado', color: '#C9653B' },
  [ESTADO.Cancelado]: { clave: 'cancelado', color: '#948DAE' },
};

type EstadoBajada = 'bajando' | 'ok' | 'nocuadra' | 'fallo';
type Credencial = { firma: string; expira: number };

export default function Expediente(): React.ReactElement {
  const { id } = useParams();
  const navegar = useNavigate();
  const { address } = useWallet();
  const { tasks, loading } = useMyTasks();
  const { signMessageAsync } = useSignMessage();

  const [trayendo, setTrayendo] = useState(false);
  const [fallo, setFallo] = useState<string | null>(null);
  /**
   * La firma se guarda porque la MISMA abre el texto y todos los archivos.
   * Sin esto, bajar tres adjuntos pediría tres firmas seguidas.
   */
  const [credencial, setCredencial] = useState<Credencial | null>(null);
  /** Cómo va cada descarga, por hash: el nombre puede repetirse, el hash no. */
  const [descargas, setDescargas] = useState<Record<string, EstadoBajada>>({});
  const [copiando, setCopiando] = useState(false);
  const T = useTextos();
  const [aviso, setAviso] = useState<string | null>(null);
  // Cambia al guardar la entrega, y con eso se rearma el expediente.
  const [version, setVersion] = useState(0);

  const tarea = tasks.find((t) => t.id.toString() === id);
  const { data: datosAgente } = useAgente(tarea?.worker);

  const e = useMemo<Expe | null>(() => {
    if (!tarea || !address) return null;
    return armar(tarea, currencySymbol(tarea.currency), address);
    // `version` entra a propósito: la entrega recién guardada está en
    // localStorage, y sin esto la pantalla seguiría diciendo que no la tienes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tarea, address, version]);

  /**
   * Una firma válida para hablar con el agente, reaprovechando la anterior.
   *
   * La misma firma abre el texto y todos los archivos, así que traer la entrega
   * y bajar sus tres adjuntos es UNA firma, no cuatro. Se renueva con un minuto
   * de margen: una que caduque a mitad de la descarga la rechazaría el agente
   * con un 403, y desde fuera eso parece un fallo suyo.
   */
  const pedirCredencial = useCallback(
    // En `useCallback` y no suelta: mira el reloj, y leerlo durante el render
    // da resultados que cambian solos. Aquí solo corre al tocar el archivo.
    async (idTarea: bigint): Promise<Credencial> => {
      const ahora = Math.floor(Date.now() / 1000);
      if (credencial && credencial.expira > ahora + 60) return credencial;
      const expira = expiraEn();
      const firma = await signMessageAsync({ message: resultSignMessage(idTarea, expira) });
      const nueva = { firma, expira };
      setCredencial(nueva);
      return nueva;
    },
    [credencial, signMessageAsync],
  );

  if (loading && !e) {
    return <Mensaje texto={T.expediente.leyendo} />;
  }
  if (!e) {
    return (
      <Mensaje
        texto={T.expediente.noAparece}
        onVolver={() => navegar('/archivo')}
      />
    );
  }

  const yaEntregado =
    e.cadena.estado === ESTADO.Entregado || e.cadena.estado === ESTADO.Completado;
  const estado = ESTADOS[e.cadena.estado];
  const rotulo = estado ? (T.expediente[estado.clave] as string) : '—';
  const color = estado?.color ?? '#948DAE';

  /**
   * Baja un archivo de la entrega, comprueba sus bytes y lo pasa al teléfono.
   *
   * Los adjuntos NO se guardan aquí: un PDF de 20 MB no cabe en localStorage y
   * echaría de él lo que sí importa, que es el texto. Se bajan del agente cada
   * vez. El hash contra el que se comprueban viajó DENTRO de la entrega, y esa
   * entrega ya cuadró con la cadena al guardarse, así que el archivo queda
   * anclado igual de firme que el texto.
   *
   * Si no cuadra NO se guarda. Es el único momento en que todo esto sirve de
   * algo: significa que lo servido no es lo que se entregó, y el cliente tiene
   * con qué abrir una disputa.
   */
  const bajarArchivo = async (archivo: DeliveredFile): Promise<void> => {
    const botUrl = datosAgente?.botUrl;
    if (!botUrl || !address || !tarea) {
      setFallo(T.expediente.sinEndpoint);
      return;
    }
    setDescargas((d) => ({ ...d, [archivo.hash]: 'bajando' }));
    setAviso(null);
    try {
      const cred = await pedirCredencial(tarea.id);
      const blob = await downloadDeliveredFile(archivo, botUrl, address, cred);
      const r = await guardarArchivo(archivo.name, blob);
      setDescargas((d) => ({ ...d, [archivo.hash]: r.ok ? 'ok' : 'fallo' }));
      if (!r.ok) setAviso(r.porque);
    } catch (err) {
      const roto = err instanceof FileVerificationError && /hash|size/.test(err.message);
      const msg = err instanceof Error ? err.message : String(err);
      // Rechazar la firma no es un fallo: el botón vuelve a su sitio callado.
      if (!roto && /reject|denied|user/i.test(msg)) {
        setDescargas((d) => {
          const resto = { ...d };
          delete resto[archivo.hash];
          return resto;
        });
        return;
      }
      setDescargas((d) => ({ ...d, [archivo.hash]: roto ? 'nocuadra' : 'fallo' }));
    }
  };

  /**
   * Trae la entrega del agente y la guarda si cuadra con la cadena.
   *
   * El endpoint sale del REGISTRO, nunca de algo que venga en la entrega: si la
   * URL viniera de ahí, una manipulada mandaría al cliente a otro servidor.
   */
  const alTraer = async (): Promise<void> => {
    // `useAgente` ya lo sacó del registro con `extractBotUrl`.
    const botUrl = datosAgente?.botUrl;
    if (!botUrl || !address || !tarea) {
      setFallo(T.expediente.sinEndpoint);
      return;
    }
    setTrayendo(true);
    setFallo(null);
    try {
      const { firma, expira } = await pedirCredencial(tarea.id);
      const res = await fetch(buildResultUrl(botUrl, tarea.id), {
        headers: cabecerasFirma(address, firma, expira),
      });
      if (!res.ok) {
        setFallo(
          res.status === 403
            ? T.expediente.firmaRechazada
            : `El agente respondió ${res.status}.`,
        );
        return;
      }
      const cuerpo = (await res.json()) as { resultText?: string };
      const texto = cuerpo.resultText ?? '';
      if (!texto) {
        setFallo(T.expediente.entregaVacia);
        return;
      }
      // Si el keccak256 no cuadra, esto NO es lo que se ancló en la cadena y no
      // se guarda: una copia que no cuadra es peor que no tener copia.
      if (!guardarEntrega(e.id, texto, e.cadena.resultHash)) {
        setFallo(T.expediente.noCuadraHash);
        return;
      }
      setVersion((v) => v + 1);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setFallo(/reject|denied|user/i.test(msg) ? null : T.expediente.noSePudoHablar);
    } finally {
      setTrayendo(false);
    }
  };

  const alCopiar = async (): Promise<void> => {
    setCopiando(true);
    setAviso(null);
    const r = await guardarCopia(nombreDe(e), aHtml(e));
    setCopiando(false);
    setAviso(r.ok ? T.archivo.copiaLista(r.donde) : T.archivo.copiaFallo(r.porque));
  };

  return (
    <div className="flex min-h-0 grow flex-col">
      <header className="flex shrink-0 items-center gap-3 border-b border-line px-4 py-3">
        <button
          type="button"
          onClick={() => navegar(-1)}
          className="pulsable tocable -ml-1 flex h-9 w-9 items-center justify-center"
          aria-label={T.expediente.volver}
        >
          <Icono nombre="atras" tamano={19} color="#F2EFFA" />
        </button>
        <div className="min-w-0 grow">
          <h1 className="font-display text-[19px] font-semibold -tracking-[0.015em]">
            {T.expediente.titulo(String(e.id))}
          </h1>
          <p className="truncate text-[11.5px] text-ink-3">
            {datosAgente?.nombre ?? corta(e.agente)} · {dia(e.cadena.creado)}
          </p>
        </div>
        <button
          type="button"
          onClick={alCopiar}
          disabled={copiando}
          className="pulsable tocable flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-line disabled:opacity-50"
          aria-label={T.expediente.guardarBoton}
        >
          <Icono nombre="bajar" tamano={15} color="#C8C3DC" grosor={1.9} />
        </button>
      </header>

      <div className="flex min-h-0 grow flex-col gap-3 overflow-y-auto px-5 py-4">
        <div
          className="flex shrink-0 items-center gap-2 rounded-[12px] border px-3.5 py-2.5"
          style={{ borderColor: `${color}55`, background: `${color}14` }}
        >
          <span className="h-2 w-2 rounded-full" style={{ background: color }} />
          <span className="text-[13px] font-semibold" style={{ color }}>
            {rotulo}
          </span>
          <span className="ml-auto font-mono text-[13px]" style={{ color }}>
            {monto(e.cadena.importe)} {e.cadena.simbolo}
          </span>
        </div>

        <Seccion titulo={T.expediente.enLaCadena} />
        <div className="shrink-0 divide-y divide-line overflow-hidden rounded-[14px] border border-line">
          <Fila k={T.expediente.cliente} v={corta(e.cliente)} />
          <Fila k={T.expediente.agente} v={corta(e.agente)} />
          <Fila k={T.expediente.creado} v={dia(e.cadena.creado)} />
          <Fila k={T.expediente.plazo} v={dia(e.cadena.plazo)} />
          <Fila
            k={T.expediente.filaEntregado}
            v={e.cadena.entregado ? dia(e.cadena.entregado) : '—'}
          />
          <Fila k={T.expediente.hashPedido} v={cortaHash(e.cadena.taskHash)} />
          <Fila k={T.expediente.hashEntrega} v={cortaHash(e.cadena.resultHash)} />
        </div>

        <Seccion titulo={T.expediente.enTuTelefono} />

        {/* Lo que pediste */}
        <div className="shrink-0 rounded-[14px] border border-line p-3.5">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-[13px] text-ink-2">{T.expediente.loQuePediste}</p>
            {e.local.brief && (
              <span
                className={`flex shrink-0 items-center gap-1 text-[11.5px] ${
                  e.local.briefCuadra ? 'text-olive' : 'text-terra'
                }`}
              >
                <Icono
                  nombre={e.local.briefCuadra ? 'check' : 'info'}
                  tamano={12}
                  color={e.local.briefCuadra ? '#92A268' : '#C9653B'}
                  grosor={2.4}
                />
                {e.local.briefCuadra ? T.expediente.cuadra : T.expediente.noCuadra}
              </span>
            )}
          </div>
          {e.local.brief ? (
            <>
              <p className="seleccionable mt-2 whitespace-pre-wrap text-[13.5px] leading-[1.55]">
                {e.local.brief}
              </p>
              <p className="mt-2.5 font-mono text-[11px] text-ink-3">
                keccak256 → {cortaHash(e.cadena.taskHash)}
              </p>
            </>
          ) : (
            <p className="mt-2 text-[12.5px] leading-[1.55] text-terra">
              {T.expediente.briefPerdido}
            </p>
          )}
        </div>

        {/* Lo que entregó */}
        <div className="shrink-0 rounded-[14px] border border-line p-3.5">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-[13px] text-ink-2">{T.expediente.loQueEntrego}</p>
            {e.local.entrega && (
              <span className="flex shrink-0 items-center gap-1 text-[11.5px] text-olive">
                <Icono nombre="check" tamano={12} color="#92A268" grosor={2.4} />
                {T.expediente.cuadra}
              </span>
            )}
          </div>

          {e.local.entrega ? (
            <>
              <p className="seleccionable mt-2 whitespace-pre-wrap text-[13.5px] leading-[1.55]">
                {e.local.entrega}
              </p>
              {e.local.adjuntos.map((a) => {
                const bajada = descargas[a.hash];
                return (
                  <button
                    key={a.hash}
                    type="button"
                    onClick={() => void bajarArchivo(a)}
                    disabled={bajada === 'bajando'}
                    aria-label={T.expediente.adjuntoBajar}
                    className="pulsable tocable mt-2.5 flex w-full items-center gap-2.5 rounded-[11px] border border-line bg-sand px-3 py-2.5 text-left disabled:opacity-60"
                  >
                    <Icono nombre="hoja" tamano={17} color="#B7A8FC" className="shrink-0" />
                    <div className="min-w-0 grow">
                      <p className="truncate text-[13px] font-medium">{a.name}</p>
                      <p className="mt-0.5 text-[11px] text-ink-3">
                        {T.expediente.adjuntoPie(formatBytes(a.size))}
                      </p>
                      {bajada && (
                        <p
                          className={`mt-0.5 text-[11px] ${
                            bajada === 'ok'
                              ? 'text-olive'
                              : bajada === 'bajando'
                                ? 'text-ink-3'
                                : 'text-terra'
                          }`}
                        >
                          {bajada === 'bajando'
                            ? T.expediente.adjuntoBajando
                            : bajada === 'ok'
                              ? T.expediente.adjuntoGuardado
                              : bajada === 'nocuadra'
                                ? T.expediente.adjuntoNoCuadra
                                : T.expediente.adjuntoFallo}
                        </p>
                      )}
                    </div>
                    <Icono
                      nombre={bajada === 'ok' ? 'check' : 'bajar'}
                      tamano={15}
                      color={bajada === 'ok' ? '#92A268' : '#948DAE'}
                      className="shrink-0"
                    />
                  </button>
                );
              })}
              <p className="mt-2.5 font-mono text-[11px] text-ink-3">
                keccak256 → {cortaHash(e.cadena.resultHash)}
              </p>
            </>
          ) : yaEntregado ? (
            <>
              <p className="mt-2 text-[12.5px] leading-[1.55] text-ink-2">
                {T.expediente.entregaNoLaTienes}
              </p>
              <button
                type="button"
                onClick={alTraer}
                disabled={trayendo}
                className="pulsable tocable mt-3 flex w-full items-center justify-center gap-2 rounded-full border border-line py-2.5 text-[13.5px] font-medium text-ink-2 disabled:opacity-50"
              >
                <Icono nombre="bajar" tamano={15} color="#948DAE" />
                {trayendo ? T.expediente.pidiendola : T.expediente.traerEntrega}
              </button>
              <p className="mt-2 text-[11.5px] leading-[1.5] text-ink-3">
                {T.expediente.firmarasPie}
              </p>
              {fallo && <p className="mt-2 text-[12px] text-terra">{fallo}</p>}
            </>
          ) : (
            <p className="mt-2 text-[12.5px] leading-[1.55] text-ink-3">
              {T.expediente.sinEntregar}
            </p>
          )}
        </div>

        {/* La conversación */}
        {e.local.hilo.length > 0 && (
          <Link
            to={`/chat/${e.agente}`}
            className="pulsable flex shrink-0 items-center gap-2.5 rounded-[14px] border border-line p-3.5"
          >
            <Icono nombre="chat" tamano={17} color="#948DAE" className="shrink-0" />
            <div className="min-w-0 grow">
              <p className="text-[13.5px] font-medium">{T.expediente.laConversacion}</p>
              <p className="mt-0.5 text-[11.5px] text-ink-3">
                {T.expediente.mensajes(e.local.hilo.length, rango(e.local.hilo, T))}
              </p>
            </div>
            <Icono nombre="atras" tamano={15} color="#948DAE" className="rotate-180" />
          </Link>
        )}

        <button
          type="button"
          onClick={alCopiar}
          disabled={copiando}
          className="pulsable tocable mt-1 shrink-0 rounded-full bg-monad py-3.5 text-[15px] font-semibold text-white shadow-monad disabled:opacity-60"
        >
          {copiando ? T.expediente.preparando : T.expediente.guardarBoton}
        </button>
        <p className="shrink-0 px-1 text-[11.5px] leading-[1.5] text-ink-3">
          {T.expediente.guardarPie}
        </p>
        {aviso && <p className="shrink-0 px-1 text-[12px] text-ink-2">{aviso}</p>}
      </div>
    </div>
  );
}

/* ── piezas ──────────────────────────────────────────────────────────────── */

function Seccion({ titulo }: { titulo: string }): React.ReactElement {
  return (
    <p className="mt-1 shrink-0 text-[11.5px] uppercase tracking-[0.06em] text-ink-3">{titulo}</p>
  );
}

function Fila({ k, v }: { k: string; v: string }): React.ReactElement {
  return (
    <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
      <span className="text-[12.5px] text-ink-3">{k}</span>
      <span className="shrink-0 font-mono text-[12px] text-ink-2">{v}</span>
    </div>
  );
}

function Mensaje({ texto, onVolver }: { texto: string; onVolver?: () => void }): React.ReactElement {
  return (
    <div className="flex min-h-0 grow flex-col items-center justify-center px-8 pb-12">
      <p className="max-w-[280px] text-pretty text-center text-[13.5px] leading-[1.55] text-ink-2">
        {texto}
      </p>
      {onVolver && (
        <button
          type="button"
          onClick={onVolver}
          className="pulsable tocable mt-5 rounded-full border border-line px-5 py-2.5 text-[13.5px] font-medium text-ink-2"
        >
          Ir a los expedientes
        </button>
      )}
    </div>
  );
}

const corta = (d: string): string => `${d.slice(0, 6)}…${d.slice(-4)}`;
const cortaHash = (h: string): string => (h.length > 14 ? `${h.slice(0, 8)}…${h.slice(-4)}` : h);

/**
 * La fecha en el idioma de la app, no siempre en español.
 *
 * `etiquetaIdioma()` da el `es-ES` / `zh-CN` que corresponde. Sin esto una app
 * en chino escribiría «24 ago 2026»: la fecha correcta en el idioma que no es.
 */
function dia(ms: number): string {
  return new Date(ms).toLocaleDateString(etiquetaIdioma(), {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function rango(hilo: { cuando: number }[], T: Textos): string {
  const d = (ms: number): string =>
    new Date(ms).toLocaleDateString(etiquetaIdioma(), { day: 'numeric', month: 'long' });
  const a = d(hilo[0]!.cuando);
  const b = d(hilo[hilo.length - 1]!.cuando);
  return a === b ? T.expediente.elDia(a) : T.expediente.delAl(a, b);
}
