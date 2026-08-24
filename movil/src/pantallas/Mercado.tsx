import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { usePanalAgents } from '@/hooks/usePanalAgents';
import { currencySymbol } from '@/contracts/config';
import type { Agent } from '@/data/agents';
import Hexagono from '~/componentes/Hexagono';
import Icono from '~/componentes/Icono';
import { precio } from '~/lib/formato';
import Menu from '~/componentes/Menu';

/**
 * El mercado, con los agentes de verdad de la cadena.
 *
 * Esta pantalla existe sobre todo para demostrar la costura: `usePanalAgents`
 * es el MISMO hook que usa la web, sin tocar una línea, y aquí se pinta de otra
 * manera. Lo compartido es de dónde salen los datos; la interfaz no.
 *
 * Lo que NO se enseña, a propósito: el «% de éxito». No se mide en ninguna
 * parte —se asigna 100 fijo en usePanalAgents— así que todos los agentes
 * saldrían con sobresaliente y el número no significa nada.
 */
export default function Mercado(): React.ReactElement {
  const { agents, loading } = usePanalAgents();
  const [busca, setBusca] = useState('');

  const lista = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return agents;
    return agents.filter(
      (a) => a.name.toLowerCase().includes(q) || (a.tagline ?? '').toLowerCase().includes(q),
    );
  }, [agents, busca]);

  return (
    <div className="flex min-h-0 grow flex-col">
      <header className="flex shrink-0 items-center justify-between px-5 pb-3 pt-5">
        <h1 className="font-display text-[26px] font-semibold -tracking-[0.015em]">Mercado</h1>
        <Menu />
      </header>

      {/* Buscar no es un adorno: la lista se lee de la cadena y crece sola.
          Desplazarse por veinte tarjetas para encontrar una es lo que hace que
          una pantalla parezca un volcado en vez de una app. */}
      <div className="shrink-0 px-3 pb-2">
        <div className="flex items-center gap-2 rounded-full border border-line bg-cream px-3.5">
          <Icono nombre="buscar" tamano={16} color="#948DAE" />
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar un agente"
            className="seleccionable h-11 min-w-0 grow bg-transparent text-[14px] text-ink outline-none placeholder:text-ink-3"
          />
          {busca && (
            <button type="button" onClick={() => setBusca('')} aria-label="Limpiar" className="pulsable">
              <Icono nombre="cerrar" tamano={16} color="#948DAE" />
            </button>
          )}
        </div>
      </div>

      <div className="min-h-0 grow overflow-y-auto px-3 pb-4">
        {loading && agents.length === 0 && <Esqueletos />}

        {!loading && agents.length === 0 && (
          <p className="px-2 pt-6 text-center text-[13.5px] leading-relaxed text-ink-3">
            Todavía no hay ningún agente registrado en la cadena.
          </p>
        )}

        {agents.length > 0 && lista.length === 0 && (
          <p className="px-2 pt-6 text-center text-[13.5px] leading-relaxed text-ink-3">
            Ninguno se llama así ni hace eso.
          </p>
        )}

        <ul className="flex flex-col gap-2">
          {lista.map((a) => (
            <li key={a.id}>
              <Tarjeta agente={a} />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Tarjeta({ agente }: { agente: Agent }): React.ReactElement {
  const moneda = currencySymbol(agente.currency);
  // Escribía «0 MON / tarea» para casi todos, y no porque no tuvieran precio:
  // `formatMon(x, 0)` redondea a cero cualquier cosa por debajo de 1 MON, que
  // es lo que cobra la mayoría. Decía «gratis» de un servicio de pago.
  const tarifa = precio(agente.pricePerTask);

  return (
    <Link to={`/agente/${agente.wallet}`} className="pulsable block rounded-2xl bg-cream p-3.5">
      <div className="flex items-start gap-3">
        <Hexagono semilla={agente.wallet} inicial={agente.name.slice(0, 1)} tamano={44} />

        <div className="min-w-0 grow">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="truncate text-[15px] font-semibold">{agente.name}</h2>
            {agente.reviews > 0 && (
              <span className="shrink-0 font-mono text-[12px] text-honey">
                {agente.rating.toFixed(1)} ★
              </span>
            )}
          </div>

          <p className="mt-1 line-clamp-2 text-[13px] leading-[1.45] text-ink-2">{agente.tagline}</p>

          <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className={`font-mono text-[12.5px] ${tarifa ? 'text-monad-mist' : 'text-ink-3'}`}>
              {tarifa ? `${tarifa} ${moneda} · encargo` : 'sin precio de encargo'}
            </span>
            {agente.tasksCompleted > 0 ? (
              <span className="text-[11px] text-ink-3">· {agente.tasksCompleted} tareas</span>
            ) : (
              <span className="text-[11px] text-ink-3">· sin valoraciones</span>
            )}
          </div>
        </div>

        <Icono nombre="atras" tamano={16} color="#4A4363" className="mt-3 shrink-0 rotate-180" />
      </div>
    </Link>
  );
}

function Esqueletos(): React.ReactElement {
  return (
    <ul className="flex flex-col gap-2" aria-hidden>
      {[0, 1, 2, 3, 4].map((i) => (
        <li key={i} className="h-[100px] animate-pulse rounded-2xl bg-cream" />
      ))}
    </ul>
  );
}
