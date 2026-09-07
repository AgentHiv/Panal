import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useWallet } from '@/hooks/useWallet';
import { useMyTasks } from '@/hooks/useMyTasks';
import { usePanalAgents } from '@/hooks/usePanalAgents';
import { listarHilos } from '@/lib/historial';
import { encargosDelCliente, fusionarBandeja, ESTADO } from '@/lib/conversaciones';
import type { ResumenConversacion } from '@/lib/conversaciones';
import { currencySymbol } from '@/contracts/config';
import { getTaskBrief } from '@/lib/taskBriefs';
import Hexagono from '~/componentes/Hexagono';
import Icono from '~/componentes/Icono';
import Arranque from '~/pantallas/Arranque';
import { cuando as formatoCuando } from '~/lib/formato';
import Menu from '~/componentes/Menu';
import { useTextos } from '~/i18n/idiomas';
import type { Textos } from '~/i18n/idiomas';

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
  const T = useTextos();
  const { tasks } = useMyTasks();

  /**
   * Dirección → nombre, para poner en la bandeja a quién le hablas.
   *
   * Sale del MISMO `usePanalAgents` que el mercado, y eso importa: es una sola
   * petición al catálogo del indexador, compartida por react-query entre las
   * dos pantallas. Una lectura por fila habría sido una llamada al RPC por cada
   * conversación, y en la pantalla de inicio de la app.
   *
   * Un agente que no esté en el catálogo —recién dado de alta, o dado de baja—
   * se queda con su dirección acortada, que es lo que había antes. Es una
   * bandeja: preferible una fila con la dirección que una fila vacía.
   */
  const { agents } = usePanalAgents();
  const nombres = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of agents) m.set(a.workerAddress.toLowerCase(), a.name);
    return m;
  }, [agents]);

  const conversaciones = useMemo<ResumenConversacion[]>(() => {
    if (!address) return [];
    const encargos = encargosDelCliente(tasks, currencySymbol, getTaskBrief);
    return fusionarBandeja(listarHilos(address), encargos);
  }, [address, tasks]);

  if (!connected || conversaciones.length === 0) return <Arranque />;

  return (
    <div className="flex min-h-0 grow flex-col">
      <header className="flex shrink-0 items-center justify-between px-5 pb-3 pt-5">
        <h1 className="font-display text-[26px] font-semibold -tracking-[0.015em]">
          {T.chats.titulo}
        </h1>
        <div className="flex items-center gap-2">
        <Menu />
        <Link
          to="/mercado"
          aria-label={T.chats.buscarAgente}
          className="pulsable flex h-11 w-11 items-center justify-center rounded-full bg-monad shadow-monad"
        >
          <Icono nombre="mas" tamano={19} color="#fff" grosor={2.2} />
        </Link>
        </div>
      </header>

      <ul className="min-h-0 grow overflow-y-auto px-3 pb-3">
        {conversaciones.map((c) => (
          <li key={c.agente}>
            <Fila conversacion={c} nombre={nombres.get(c.agente.toLowerCase()) ?? null} T={T} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function Fila({
  conversacion,
  nombre,
  T,
}: {
  conversacion: ResumenConversacion;
  /** El del catálogo, o `null` si ese agente no está: entonces, la dirección. */
  nombre: string | null;
  T: Textos;
}): React.ReactElement {
  const { adelanto, agente, abiertos } = conversacion;
  const comoSeLlama = nombre ?? `${agente.slice(0, 6)}…${agente.slice(-4)}`;

  const texto =
    adelanto.clase === 'mensaje'
      ? `${adelanto.mensaje.de === 'yo' ? T.chats.tu : ''}${adelanto.mensaje.texto}`
      : (adelanto.encargo.brief ?? T.chats.encargoNumero(String(adelanto.encargo.id)));

  // Un encargo entregado pide algo de ti; uno abierto solo espera.
  const chip =
    adelanto.clase === 'encargo' && adelanto.encargo.estado === ESTADO.Entregado
      ? { texto: T.chats.entregado, color: 'text-olive', borde: 'border-olive/35' }
      : abiertos > 0
        ? { texto: T.chats.enMarcha, color: 'text-honey', borde: 'border-honey/35' }
        : null;

  return (
    <Link to={`/chat/${agente}`} className="pulsable flex gap-3 rounded-[14px] p-2.5">
      {/* La semilla sigue siendo la DIRECCIÓN y no el nombre: es lo que fija el
          color del hexágono, y atarlo al nombre haría que un agente cambiara de
          color al renombrarse, o que dos con el mismo nombre salieran iguales. */}
      <Hexagono semilla={agente} inicial={comoSeLlama.slice(0, 1)} tamano={42} />
      <div className="min-w-0 grow">
        <div className="flex items-baseline justify-between gap-2">
          <p className="truncate text-[15px] font-semibold">{comoSeLlama}</p>
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
