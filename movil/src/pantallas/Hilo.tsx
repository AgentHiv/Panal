import { useCallback, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useWalletClient } from 'wagmi';
import { useWallet } from '@/hooks/useWallet';
import { useMyTasks } from '@/hooks/useMyTasks';
import { anadirMensaje, leerHilo, nuevoId } from '@/lib/historial';
import { cotizar, enviarMensaje, motivoLegible } from '@/lib/chat';
import { encargosDelCliente, fusionarHilo, claveDeEntrada, ESTADO } from '@/lib/conversaciones';
import type { Entrada } from '@/lib/conversaciones';
import { currencySymbol, activeChain } from '@/contracts/config';
import { getTaskBrief } from '@/lib/taskBriefs';
import type { X402Accept } from '@panal/sdk';
import { useAgente } from '~/lib/agente';
import Hexagono from '~/componentes/Hexagono';
import HojaFirmar from '~/componentes/HojaFirmar';
import HojaEncargar from '~/componentes/HojaEncargar';
import HojaRevisar from '~/componentes/HojaRevisar';
import { dinero } from '~/lib/formato';

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
  const [borrador, setBorrador] = useState('');
  const [hoja, setHoja] = useState<Abierta>(null);
  const [cotizacion, setCotizacion] = useState<X402Accept | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
    setEnviando(true);
    try {
      const q = await cotizar(datos.cobro, borrador.trim(), address as `0x${string}`);
      setCotizacion(q);
      setHoja('firmar');
    } catch (err) {
      setError(motivoLegible(err));
    } finally {
      setEnviando(false);
    }
  }, [address, borrador, connect, connected, datos]);

  const confirmarFirma = useCallback(async () => {
    if (!datos?.cobro || !walletClient || !address || !cotizacion) return;
    setEnviando(true);
    setError(null);
    const texto = borrador.trim();
    try {
      const res = await enviarMensaje({
        cobro: datos.cobro,
        mensaje: texto,
        wallet: walletClient,
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
        cuando: Date.now(),
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
      setBorrador('');
      setHoja(null);
      setCotizacion(null);
    } catch (err) {
      setError(motivoLegible(err));
      setHoja(null);
    } finally {
      setEnviando(false);
    }
  }, [address, agente, borrador, cotizacion, datos, walletClient]);

  const enRevision = encargos.find((e) => e.id === encargoRevisando) ?? null;

  return (
    <div className="relative flex min-h-0 grow flex-col">
      <header className="con-barra-arriba flex shrink-0 items-center gap-3 border-b border-line bg-noche px-4 pb-3 pt-4">
        <button
          type="button"
          onClick={() => navegar('/chats')}
          aria-label="Volver"
          className="pulsable flex h-11 w-8 items-center"
        >
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#C8C3DC"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M15 5l-7 7 7 7" />
          </svg>
        </button>
        <Link to={`/agente/${agente}`} className="pulsable flex min-w-0 grow items-center gap-3">
          <Hexagono semilla={agente} inicial={(datos?.nombre ?? 'A').slice(0, 1)} tamano={34} />
          <div className="min-w-0">
            <p className="truncate text-[15px] font-semibold">{datos?.nombre ?? '…'}</p>
            <p className="font-mono text-[11.5px] text-ink-3">
              {datos?.cobro
                ? `${dinero(datos.cobro.amount, 1)} ${datos.cobro.simbolo} por mensaje`
                : 'solo acepta encargos'}
            </p>
          </div>
        </Link>
        <button
          type="button"
          onClick={() => (connected ? setHoja('encargar') : connect())}
          className="pulsable h-[34px] shrink-0 rounded-full border border-honey px-3.5 text-[12px] font-semibold text-honey"
        >
          Encargar
        </button>
      </header>

      <div className="flex min-h-0 grow flex-col gap-3 overflow-y-auto px-3.5 py-4">
        {entradas.length === 0 && (
          <p className="mt-8 text-center text-[13.5px] leading-relaxed text-ink-3">
            Todavía no habéis hablado. Lo que escribas aquí se paga por mensaje y te responde al
            momento.
          </p>
        )}
        {entradas.map((e) => (
          <EntradaHilo
            key={claveDeEntrada(e)}
            entrada={e}
            onRevisar={() => setEncargoRevisando(e.clase === 'encargo' ? e.encargo.id : null)}
          />
        ))}
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
            placeholder={datos?.cobro ? 'Escribe tu mensaje…' : 'Este agente no cobra por mensaje'}
            disabled={!datos?.cobro || enviando}
            className="seleccionable h-11 grow rounded-full border border-line bg-sand px-4 text-[14px] text-ink outline-none placeholder:text-ink-3 disabled:opacity-60"
          />
          <button
            type="button"
            onClick={abrirFirma}
            disabled={!datos?.cobro || !borrador.trim() || enviando}
            aria-label="Enviar"
            className="pulsable flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-monad shadow-monad disabled:opacity-40"
          >
            <svg
              width="19"
              height="19"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#fff"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M4 12h15" />
              <path d="M13 6l6 6-6 6" />
            </svg>
          </button>
        </div>
        <p className="mt-2 pl-1.5 text-[11.5px] text-ink-3">
          {datos?.cobro
            ? `${dinero(datos.cobro.amount, 1)} ${datos.cobro.simbolo} por mensaje · una firma, sin gas`
            : 'Sin cobro por mensaje publicado'}
        </p>
      </div>

      <HojaFirmar
        abierta={hoja === 'firmar'}
        cobro={datos?.cobro ?? null}
        cotizacion={cotizacion}
        enviando={enviando}
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

function EntradaHilo({
  entrada,
  onRevisar,
}: {
  entrada: Entrada;
  onRevisar: () => void;
}): React.ReactElement {
  if (entrada.clase === 'mensaje') {
    const mio = entrada.mensaje.de === 'yo';
    return (
      <div
        className={`seleccionable max-w-[82%] rounded-2xl border px-3.5 py-2.5 ${
          mio
            ? 'self-end rounded-br-[5px] border-[#4A3E75] bg-[#2A2340]'
            : 'self-start rounded-bl-[5px] border-line bg-cream'
        }`}
      >
        <p className="whitespace-pre-wrap text-[14px] leading-[1.5]">{entrada.mensaje.texto}</p>
      </div>
    );
  }

  const e = entrada.encargo;
  const estados: Record<number, { texto: string; color: string; fondo: string; accion: boolean }> = {
    [ESTADO.Abierto]: {
      texto: 'Pago bloqueado · el agente trabaja',
      color: 'text-honey',
      fondo: '',
      accion: false,
    },
    [ESTADO.Entregado]: {
      texto: 'Entregado · revísalo',
      color: 'text-olive',
      fondo: 'bg-sand',
      accion: true,
    },
    [ESTADO.Completado]: {
      texto: 'Completado',
      color: 'text-ink-3',
      fondo: '',
      accion: false,
    },
    [ESTADO.Disputado]: {
      texto: 'En disputa · el pago está congelado',
      color: 'text-terra',
      fondo: 'bg-terra/10',
      accion: false,
    },
    [ESTADO.Cancelado]: {
      texto: 'Cancelado · el pago volvió',
      color: 'text-ink-3',
      fondo: '',
      accion: false,
    },
  };
  const st = estados[e.estado] ?? estados[ESTADO.Abierto];

  return (
    <article className="self-stretch overflow-hidden rounded-2xl border border-honey bg-cream">
      <div className="flex items-center gap-2 bg-honey-soft px-3.5 py-2.5">
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#E29A2E"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden
        >
          <rect x="4" y="10" width="16" height="10" rx="2" />
          <path d="M8 10V7a4 4 0 0 1 8 0v3" />
        </svg>
        <span className="text-[12px] font-semibold uppercase tracking-[0.04em] text-honey">
          Encargo · pago bloqueado
        </span>
      </div>
      <div className="px-3.5 py-3">
        <p className="seleccionable text-[14px] font-medium leading-[1.5]">
          {e.brief ?? `Encargo #${e.id}`}
        </p>
        <div className="mt-3 flex gap-5">
          <div>
            <p className="text-[10.5px] uppercase tracking-[0.08em] text-ink-3">Precio</p>
            <p className="mt-0.5 font-mono text-[15px]">
              {dinero(e.importe, 0)} {e.simbolo}
            </p>
          </div>
          <div>
            <p className="text-[10.5px] uppercase tracking-[0.08em] text-ink-3">Nº</p>
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
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={st.color}
              aria-hidden
            >
              <path d="M9.5 5l7 7-7 7" />
            </svg>
          )}
        </button>
      </div>
    </article>
  );
}
