import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useWalletClient } from 'wagmi';
import { useWallet } from '@/hooks/useWallet';
import { useMyTasks } from '@/hooks/useMyTasks';
import { anadirMensaje, leerHilo, nuevoId } from '@/lib/historial';
import { cotizar, enviarMensaje } from '@/lib/chat';
import { X402Error } from '@panal/sdk';
import { encargosDelCliente, fusionarHilo, claveDeEntrada, ESTADO } from '@/lib/conversaciones';
import type { Entrada } from '@/lib/conversaciones';
import { currencySymbol, activeChain } from '@/contracts/config';
import { getTaskBrief } from '@/lib/taskBriefs';
import type { X402Accept } from '@panal/sdk';
import { useAgente } from '~/lib/agente';
import { avisandoAlFirmar } from '~/lib/firma';
import Hexagono from '~/componentes/Hexagono';
import Icono from '~/componentes/Icono';
import HojaFirmar from '~/componentes/HojaFirmar';
import HojaEncargar from '~/componentes/HojaEncargar';
import HojaRevisar from '~/componentes/HojaRevisar';
import { monto } from '~/lib/formato';
import { etiquetaIdioma, useTextos } from '~/i18n/idiomas';
import type { Textos } from '~/i18n/idiomas';

type Abierta = null | 'firmar' | 'encargar' | 'revisar';

/**
 * La conversación con un agente: los dos modelos del protocolo en un hilo.
 *
 * Los mensajes (x402) y los encargos (escrow) se cuentan juntos porque para
 * quien los usa son lo mismo —le pedí algo a alguien— y lo que cambia es qué
 * garantías tiene cada uno. Fusionarlos NO se hace aquí: es `fusionarHilo`,
 * compartido con la web.
 */
export default function Hilo(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const agente = (id ?? '').toLowerCase();
  const navegar = useNavigate();
  const { address, connected, connect } = useWallet();
  const { tasks, refetch } = useMyTasks();
  const { data: datos } = useAgente(agente);
  const { data: walletClient } = useWalletClient();

  const [mensajes, setMensajes] = useState(() => (address ? leerHilo(address, agente) : []));

  /**
   * Releer el hilo cuando cambia de quién es.
   *
   * ESTO ARREGLA UN FALLO DE VERDAD. El estado de arriba se calcula UNA vez,
   * al montar, y al abrir la app la dirección todavía no está: wagmi está
   * reconectando, o el llavero espera el PIN. Así que se inicializaba vacío y
   * ahí se quedaba — abrías una conversación de meses y salía «todavía no
   * habéis hablado».
   *
   * Se ajusta EN EL RENDER y no en un efecto, que es lo que React recomienda
   * para esto: el efecto pintaría primero la lista vieja y la corregiría
   * después, un parpadeo que aquí se vería como un hilo vacío que se llena
   * solo. Así el primer pintado ya es el bueno.
   */
  const dueno = `${address ?? ''}|${agente}`;
  const [ultimoDueno, setUltimoDueno] = useState(dueno);
  if (ultimoDueno !== dueno) {
    setUltimoDueno(dueno);
    setMensajes(address ? leerHilo(address, agente) : []);
  }
  const [borrador, setBorrador] = useState('');
  const [hoja, setHoja] = useState<Abierta>(null);
  const [cotizacion, setCotizacion] = useState<X402Accept | null>(null);
  /**
   * Ocupado PIDIENDO PRECIO O FIRMANDO. Deja de estarlo en cuanto se firma.
   *
   * Antes esto se llamaba `enviando` y duraba hasta que contestaba el agente,
   * que es lo que dejaba la hoja de firmar puesta y bloqueada todo el rato.
   */
  const [ocupado, setOcupado] = useState(false);
  /**
   * El mensaje ya firmado y mandado, esperando respuesta.
   *
   * Vive AQUÍ y no en el historial a propósito. Lo que se guarda en disco es
   * lo que pasó de verdad —un mensaje y lo que costó—, y hasta que el agente
   * conteste no se sabe lo segundo. Guardarlo antes dejaría en el hilo un
   * mensaje sin precio, que no se distingue de uno gratis.
   */
  const [enVuelo, setEnVuelo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const T = useTextos();
  const [encargoRevisando, setEncargoRevisando] = useState<string | null>(null);

  const encargos = useMemo(
    () =>
      encargosDelCliente(
        tasks.filter((t) => t.worker.toLowerCase() === agente),
        currencySymbol,
        getTaskBrief,
      ),
    [tasks, agente],
  );

  const entradas = useMemo(() => fusionarHilo(mensajes, encargos), [mensajes, encargos]);

  /** Pide el precio ANTES de enseñar la hoja: se firma lo que se ve. */
  const abrirFirma = useCallback(async () => {
    if (!connected) return connect();
    if (!datos?.cobro || !address || !borrador.trim()) return;
    setError(null);
    setOcupado(true);
    try {
      const q = await cotizar(datos.cobro, borrador.trim(), address as `0x${string}`);
      setCotizacion(q);
      setHoja('firmar');
    } catch (err) {
      setError(motivo(err, T));
    } finally {
      setOcupado(false);
    }
  }, [address, borrador, connect, connected, datos, T]);

  const confirmarFirma = useCallback(async () => {
    if (!datos?.cobro || !walletClient || !address || !cotizacion) return;
    setOcupado(true);
    setError(null);
    const texto = borrador.trim();
    /** Cuándo salió. Lo pone el aviso de la firma; hasta entonces, ahora. */
    let mandado = Date.now();
    try {
      const res = await enviarMensaje({
        cobro: datos.cobro,
        mensaje: texto,
        // En cuanto la firma está hecha, la hoja sobra: lo que queda es esperar
        // al agente, y eso se espera EN EL HILO, viendo el mensaje mandado. La
        // hoja tapaba justo eso hasta que llegaba la respuesta.
        wallet: avisandoAlFirmar(walletClient, () => {
          setOcupado(false);
          setHoja(null);
          setCotizacion(null);
          setBorrador('');
          mandado = Date.now();
          setEnVuelo(texto);
        }),
        account: walletClient.account,
        // El tope es lo que dijo la cotización que se está enseñando: si el
        // agente sube el precio entre la firma y el cobro, el SDK no firma.
        topeMaximo: BigInt(cotizacion.amount),
        cotizacion,
        chainId: activeChain.id,
      });

      let lista = anadirMensaje(address, agente, {
        id: nuevoId(),
        de: 'yo',
        texto,
        // La de mandarlo, no la de que contesten. Con un agente que tarda un
        // minuto, las dos burbujas salían con la misma hora y la conversación
        // parecía instantánea.
        cuando: mandado,
        pagado: res.pagado.toString(),
        simbolo: datos.cobro.simbolo,
      });
      lista = anadirMensaje(address, agente, {
        id: nuevoId(),
        de: 'agente',
        texto: res.texto,
        cuando: Date.now(),
      });
      setMensajes(lista);
      setHoja(null);
      setCotizacion(null);
    } catch (err) {
      setError(motivo(err, T));
      setHoja(null);
      // El borrador vuelve al hueco si ya se había vaciado al firmar: sin esto,
      // un fallo después de la firma se lleva por delante lo que escribiste.
      setBorrador((b) => (b.trim() ? b : texto));
    } finally {
      setOcupado(false);
      setEnVuelo(null);
    }
  }, [address, agente, borrador, cotizacion, datos, walletClient, T]);

  const enRevision = encargos.find((e) => e.id === encargoRevisando) ?? null;

  /**
   * Bajar al final cuando entra algo nuevo.
   *
   * Sin esto, al mandar un mensaje la respuesta —lo que acabas de PAGAR— entra
   * por debajo del borde y la pantalla no se mueve: parece que no ha pasado
   * nada. Se hace con un ancla al final y no tocando `scrollTop`, que en un
   * WebView con la lista todavía creciendo se queda corto.
   */
  const finDelHilo = useRef<HTMLDivElement>(null);
  useEffect(() => {
    finDelHilo.current?.scrollIntoView({ block: 'end' });
    // `enVuelo` también: la burbuja que espera entra por debajo del borde igual
    // que lo hacía la respuesta, y sin esto habría que bajar a mano para ver
    // que el mensaje salió.
  }, [entradas.length, enVuelo]);

  return (
    <div className="relative flex min-h-0 grow flex-col">
      <header className="flex shrink-0 items-center gap-3 border-b border-line bg-noche px-4 pb-3 pt-4">
        <button
          type="button"
          onClick={() => navegar('/chats')}
          aria-label={T.hilo.volver}
          className="pulsable flex h-11 w-8 items-center"
        >
          <Icono nombre="atras" tamano={24} color="#C8C3DC" grosor={2} />
        </button>
        <Link to={`/agente/${agente}`} className="pulsable flex min-w-0 grow items-center gap-3">
          <Hexagono semilla={agente} inicial={(datos?.nombre ?? 'A').slice(0, 1)} tamano={34} />
          <div className="min-w-0">
            <p className="truncate text-[15px] font-semibold">{datos?.nombre ?? '…'}</p>
            {/* Igual que en el mercado: la cifra en mono, la explicación no.
                «solo acepta encargos» en monoespaciada parecía un dato. */}
            <p className="text-[11.5px] text-ink-3">
              {datos?.cobro ? (
                <>
                  <span className="font-mono text-ink-2">
                    {monto(datos.cobro.amount)} {datos.cobro.simbolo}
                  </span>{' '}
                  {T.hilo.porMensaje}
                </>
              ) : (
                T.hilo.soloEncargos
              )}
            </p>
          </div>
        </Link>
        <button
          type="button"
          onClick={() => (connected ? setHoja('encargar') : connect())}
          className="pulsable h-[34px] shrink-0 rounded-full border border-honey px-3.5 text-[12px] font-semibold text-honey"
        >
          {T.hilo.encargar}
        </button>
      </header>

      <div className="flex min-h-0 grow flex-col gap-3 overflow-y-auto px-3.5 py-4">
        {/* `enVuelo` cuenta: con el primer mensaje ya mandado y esperando
            respuesta, «todavía no habéis hablado» contradice a la burbuja que
            hay justo debajo. */}
        {entradas.length === 0 && enVuelo === null && (
          <p className="mt-8 text-center text-[13.5px] leading-relaxed text-ink-3">
            {T.hilo.sinHablar}
          </p>
        )}
        {entradas.map((e, i) => (
          <Fragment key={claveDeEntrada(e)}>
            {/* Un separador cuando cambia el día. En una herramienta de
                trabajo lo primero que se busca de un mensaje es CUÁNDO, y el
                hilo no lo decía en ninguna parte: cuarenta burbujas iguales
                sin una sola fecha. */}
            {cambiaElDia(entradas[i - 1], e) && <Dia cuando={e.cuando} />}
            <EntradaHilo
              entrada={e}
              onRevisar={() => setEncargoRevisando(e.clase === 'encargo' ? e.encargo.id : null)}
              T={T}
            />
          </Fragment>
        ))}
        {/* Lo que se ve mientras el agente trabaja. Antes esto no existía: la
            hoja de firmar tapaba el hilo hasta que llegaba la respuesta, así
            que el mensaje que acababas de pagar no aparecía por ningún lado. */}
        {enVuelo !== null && <Esperando texto={enVuelo} T={T} />}
        <div ref={finDelHilo} />
      </div>

      {error && (
        <p className="shrink-0 bg-terra/15 px-4 py-2.5 text-[12.5px] leading-snug text-terra">
          {error}
        </p>
      )}

      <div className="con-barra-abajo shrink-0 border-t border-line bg-noche px-3 pt-2.5">
        <div className="flex items-center gap-2.5">
          <input
            value={borrador}
            onChange={(ev) => setBorrador(ev.target.value)}
            placeholder={datos?.cobro ? T.hilo.escribeHueco : T.hilo.sinCobroHueco}
            disabled={!datos?.cobro || ocupado || enVuelo !== null}
            className="seleccionable h-11 grow rounded-full border border-line bg-sand px-4 text-[14px] text-ink outline-none placeholder:text-ink-3 disabled:opacity-60"
          />
          <button
            type="button"
            onClick={abrirFirma}
            disabled={!datos?.cobro || !borrador.trim() || ocupado || enVuelo !== null}
            aria-label={T.hilo.enviar}
            className="pulsable flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-monad shadow-monad disabled:opacity-40"
          >
            <Icono nombre="atras" tamano={19} color="#fff" grosor={2.2} className="rotate-180" />
          </button>
        </div>
        <p className="mt-2 pl-1.5 text-[11.5px] text-ink-3">
          {datos?.cobro
            ? T.hilo.piePrecio(monto(datos.cobro.amount), datos.cobro.simbolo)
            : T.hilo.sinCobroPie}
        </p>
      </div>

      <HojaFirmar
        abierta={hoja === 'firmar'}
        cobro={datos?.cobro ?? null}
        cotizacion={cotizacion}
        enviando={ocupado}
        onCerrar={() => setHoja(null)}
        onConfirmar={confirmarFirma}
      />

      {/* Se monta solo cuando toca: al cerrarse pierde su estado, que es como
          se evita que la siguiente vez aparezca con lo de la anterior. */}
      {hoja === 'encargar' && (
      <HojaEncargar
        abierta
        agente={agente}
        datos={datos ?? null}
        onCerrar={() => setHoja(null)}
        onHecho={() => {
          setHoja(null);
          refetch();
        }}
      />
      )}

      {enRevision && (
      <HojaRevisar
        encargo={enRevision}
        onCerrar={() => setEncargoRevisando(null)}
        onHecho={() => {
          setEncargoRevisando(null);
          refetch();
        }}
      />
      )}
    </div>
  );
}

/**
 * El mensaje firmado y mandado, y el agente trabajando.
 *
 * La burbuja es la misma que la de un mensaje propio, con una diferencia
 * deliberada: donde va la hora pone «Enviado». Una hora es un hecho y esto
 * todavía no lo es del todo — si el agente falla, esta burbuja desaparece y el
 * texto vuelve al hueco de escribir.
 */
function Esperando({ texto, T }: { texto: string; T: Textos }): React.ReactElement {
  return (
    <>
      <div className="flex shrink-0 flex-col items-end gap-0.5">
        <div className="seleccionable max-w-[82%] shrink-0 self-end rounded-2xl rounded-br-[5px] border border-[#4A3E75] bg-[#2A2340] px-3.5 py-2.5 opacity-70">
          <p className="whitespace-pre-wrap text-[14px] leading-[1.5]">{texto}</p>
        </div>
        <span className="px-1 text-[10.5px] text-ink-3">{T.hilo.enviado}</span>
      </div>

      <div className="flex shrink-0 flex-col items-start gap-0.5">
        <div className="flex shrink-0 items-center gap-2 self-start rounded-2xl rounded-bl-[5px] border border-line bg-cream px-3.5 py-3">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="h-1.5 w-1.5 animate-pulse rounded-full bg-ink-3"
              style={{ animationDelay: `${i * 180}ms` }}
            />
          ))}
        </div>
        <span className="px-1 text-[10.5px] text-ink-3">{T.hilo.trabajando}</span>
      </div>
    </>
  );
}

function EntradaHilo({
  entrada,
  onRevisar,
  T,
}: {
  entrada: Entrada;
  onRevisar: () => void;
  T: Textos;
}): React.ReactElement {
  if (entrada.clase === 'mensaje') {
    const mio = entrada.mensaje.de === 'yo';
    return (
      <div
        className={`flex shrink-0 flex-col gap-0.5 ${mio ? 'items-end' : 'items-start'}`}
      >
      <div
        className={`seleccionable max-w-[82%] shrink-0 rounded-2xl border px-3.5 py-2.5 ${
          mio
            ? 'self-end rounded-br-[5px] border-[#4A3E75] bg-[#2A2340]'
            : 'self-start rounded-bl-[5px] border-line bg-cream'
        }`}
      >
        <p className="whitespace-pre-wrap text-[14px] leading-[1.5]">{entrada.mensaje.texto}</p>
      </div>
        {/* La hora, fuera de la burbuja y en pequeño: se consulta, no se lee. */}
        <span className="px-1 font-mono text-[10.5px] text-ink-3">
          {hora(entrada.mensaje.cuando)}
        </span>
      </div>
    );
  }

  const e = entrada.encargo;
  const estados: Record<number, { texto: string; color: string; fondo: string; accion: boolean }> = {
    [ESTADO.Abierto]: {
      texto: T.hilo.abierto,
      color: 'text-honey',
      fondo: '',
      accion: false,
    },
    [ESTADO.Entregado]: {
      texto: T.hilo.entregado,
      color: 'text-olive',
      fondo: 'bg-sand',
      accion: true,
    },
    [ESTADO.Completado]: {
      texto: T.hilo.completado,
      color: 'text-ink-3',
      fondo: '',
      accion: false,
    },
    [ESTADO.Disputado]: {
      texto: T.hilo.disputado,
      color: 'text-terra',
      fondo: 'bg-terra/10',
      accion: false,
    },
    [ESTADO.Cancelado]: {
      texto: T.hilo.cancelado,
      color: 'text-ink-3',
      fondo: '',
      accion: false,
    },
  };
  const st = estados[e.estado] ?? estados[ESTADO.Abierto];

  return (
    /* `shrink-0` NO es de adorno, y este es el caso que lo demuestra.
       En una columna flex los hijos llevan `min-height: auto`, que los protege
       de encogerse por debajo de su contenido — pero esa protección SOLO vale
       mientras `overflow` sea `visible`. Esta tarjeta lleva `overflow-hidden`
       para redondear las esquinas, así que la pierde: medido, se quedaba en
       2 px de alto contra los 174 que ocupa de verdad. Por eso el historial de
       encargos salía como rayas y los mensajes no: los mensajes no llevan
       `overflow-hidden`. */
    <article className="shrink-0 self-stretch overflow-hidden rounded-2xl border border-honey bg-cream">
      <div className="flex items-center gap-2 bg-honey-soft px-3.5 py-2.5">
        <Icono nombre="candado" tamano={15} color="#E29A2E" grosor={2} />
        <span className="text-[12px] font-semibold uppercase tracking-[0.04em] text-honey">
          {T.hilo.cabeceraEncargo}
        </span>
      </div>
      <div className="px-3.5 py-3">
        <p className="seleccionable text-[14px] font-medium leading-[1.5]">
          {e.brief ?? T.hilo.encargoNumero(String(e.id))}
        </p>
        <div className="mt-3 flex gap-5">
          <div>
            <p className="text-[10.5px] uppercase tracking-[0.08em] text-ink-3">{T.hilo.precio}</p>
            <p className="mt-0.5 font-mono text-[15px]">
              {monto(e.importe)} {e.simbolo}
            </p>
          </div>
          <div>
            <p className="text-[10.5px] uppercase tracking-[0.08em] text-ink-3">{T.hilo.numero}</p>
            <p className="mt-0.5 font-mono text-[15px]">#{e.id}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={st.accion ? onRevisar : undefined}
          disabled={!st.accion}
          className={`pulsable mt-3 flex w-full items-center gap-2 rounded-[10px] px-3 py-2.5 ${st.fondo}`}
        >
          <span className={`grow text-left text-[12.5px] ${st.color}`}>{st.texto}</span>
          {st.accion && (
            <Icono nombre="atras" tamano={15} grosor={2.2} className={`rotate-180 ${st.color}`} />
          )}
        </button>
      </div>
    </article>
  );
}

/**
 * El error, dicho para quien acaba de intentar pagar.
 *
 * No se reutiliza `motivoLegible` de la capa compartida: allí los dos casos
 * conocidos están escritos en español y esa capa la comparte la web, que se
 * queda tal como está. Aquí se mira el error EN CRUDO —no su texto ya
 * traducido— y se elige la frase en el idioma de la app.
 *
 * Un `X402Error` sí sale tal cual: lo escribe el agente al otro lado, en el
 * idioma que use, y decir algo concreto vale más que decirlo traducido.
 */
function motivo(err: unknown, T: Textos): string {
  if (err instanceof X402Error) return err.message;
  const msg = err instanceof Error ? err.message : String(err);
  if (/user rejected|rechaz/i.test(msg)) return T.hilo.cancelaste;
  if (/fetch|network|failed to fetch/i.test(msg)) return T.hilo.sinRed;
  return msg;
}

/* ── el tiempo, que un hilo de trabajo necesita ──────────────────────────── */

/** «17:42», en el reloj del idioma puesto. */
function hora(ms: number): string {
  return new Date(ms).toLocaleTimeString(etiquetaIdioma(), { hour: '2-digit', minute: '2-digit' });
}

/** Si entre dos entradas ha cambiado el día. La primera siempre lo cambia. */
function cambiaElDia(previa: Entrada | undefined, actual: Entrada): boolean {
  if (!previa) return true;
  return new Date(previa.cuando).toDateString() !== new Date(actual.cuando).toDateString();
}

/**
 * La raya con la fecha.
 *
 * «Hoy» y «Ayer» con nombre porque es como lo dice la gente; de ahí para
 * atrás, la fecha entera. Sin el año si es de este: en un hilo de la semana
 * pasada el año no aporta y ocupa.
 */
function Dia({ cuando }: { cuando: number }): React.ReactElement {
  const T = useTextos();
  const d = new Date(cuando);
  const hoy = new Date();
  const ayer = new Date(hoy.getTime() - 86_400_000);

  const texto =
    d.toDateString() === hoy.toDateString()
      ? T.hilo.hoy
      : d.toDateString() === ayer.toDateString()
        ? T.hilo.ayer
        : d.toLocaleDateString(etiquetaIdioma(), {
            day: 'numeric',
            month: 'long',
            ...(d.getFullYear() === hoy.getFullYear() ? {} : { year: 'numeric' }),
          });

  return (
    <div className="my-1 flex shrink-0 items-center gap-3">
      <div className="h-px grow bg-line" />
      <span className="text-[11px] uppercase tracking-[0.06em] text-ink-3">{texto}</span>
      <div className="h-px grow bg-line" />
    </div>
  );
}
