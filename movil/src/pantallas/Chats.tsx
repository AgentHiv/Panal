import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useWallet } from '@/hooks/useWallet';
import { useMyTasks } from '@/hooks/useMyTasks';
import { listarHilos } from '@/lib/historial';
import { encargosDelCliente, fusionarBandeja, ESTADO } from '@/lib/conversaciones';
import type { ResumenConversacion } from '@/lib/conversaciones';
import { currencySymbol } from '@/contracts/config';
import { getTaskBrief } from '@/lib/taskBriefs';
import Hexagono from '~/componentes/Hexagono';
import Arranque from '~/pantallas/Arranque';
import { cuando as formatoCuando } from '~/lib/formato';

/**
 * La bandeja. Es la pantalla de inicio de la app, como en cualquier
 * mensajería.
 *
 * Mezcla lo que hablaste (local, x402) con lo que encargaste (la cadena,
 * escrow) en UNA lista por agente. Son los dos modelos del protocolo y para
 * quien los usa es la misma conversación; separarlos en dos pantallas fue el
 * error que ya se corrigió en la web.
 *
 * El trabajo de fusionar no está aquí: es `fusionarBandeja`, compartido con la
 * web y probado en Node.
 */
export default function Chats(): React.ReactElement {
  const { address, connected } = useWallet();
  const { tasks } = useMyTasks();

  const conversaciones = useMemo<ResumenConversacion[]>(() => {
    if (!address) return [];
    const encargos = encargosDelCliente(tasks, currencySymbol, getTaskBrief);
    return fusionarBandeja(listarHilos(address), encargos);
  }, [address, tasks]);

  if (!connected || conversaciones.length === 0) return <Arranque />;

  return (
    <div className="flex min-h-0 grow flex-col">
      <header className="con-barra-arriba flex shrink-0 items-center justify-between px-5 pb-3 pt-5">
        <h1 className="font-display text-[26px] font-semibold -tracking-[0.015em]">Chats</h1>
        <Link
          to="/mercado"
          aria-label="Buscar un agente"
          className="pulsable flex h-11 w-11 items-center justify-center rounded-full bg-monad shadow-monad"
        >
          <svg
            width="19"
            height="19"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#fff"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
        </Link>
      </header>

      <ul className="min-h-0 grow overflow-y-auto px-3 pb-3">
        {conversaciones.map((c) => (
          <li key={c.agente}>
            <Fila conversacion={c} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function Fila({ conversacion }: { conversacion: ResumenConversacion }): React.ReactElement {
  const { adelanto, agente, abiertos } = conversacion;

  const texto =
    adelanto.clase === 'mensaje'
      ? `${adelanto.mensaje.de === 'yo' ? 'Tú: ' : ''}${adelanto.mensaje.texto}`
      : (adelanto.encargo.brief ?? `Encargo #${adelanto.encargo.id}`);

  // Un encargo entregado pide algo de ti; uno abierto solo espera.
  const chip =
    adelanto.clase === 'encargo' && adelanto.encargo.estado === ESTADO.Entregado
      ? { texto: 'Entregado · te queda aprobar', color: 'text-olive', borde: 'border-olive/35' }
      : abiertos > 0
        ? { texto: 'Encargo en marcha', color: 'text-honey', borde: 'border-honey/35' }
        : null;

  return (
    <Link to={`/chat/${agente}`} className="pulsable flex gap-3 rounded-[14px] p-2.5">
      <Hexagono semilla={agente} inicial={agente.slice(2, 3)} tamano={42} />
      <div className="min-w-0 grow">
        <div className="flex items-baseline justify-between gap-2">
          <p className="truncate text-[15px] font-semibold">{`${agente.slice(0, 6)}…${agente.slice(-4)}`}</p>
          <span className="shrink-0 font-mono text-[11px] text-ink-3">
            {formatoCuando(conversacion.cuando)}
          </span>
        </div>
        <p className="mt-0.5 truncate text-[13px] leading-[1.45] text-ink-2">{texto}</p>
        {chip && (
          <span
            className={`mt-1.5 inline-block rounded-full border px-2 py-0.5 text-[10.5px] font-semibold ${chip.color} ${chip.borde}`}
          >
            {chip.texto}
          </span>
        )}
      </div>
    </Link>
  );
}
