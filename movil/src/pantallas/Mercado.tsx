import { usePanalAgents } from '@/hooks/usePanalAgents';
import { currencySymbol } from '@/contracts/config';
import { formatMon } from '@/data/agents';
import type { Agent } from '@/data/agents';
import Hexagono from '~/componentes/Hexagono';

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

  return (
    <div className="flex min-h-0 grow flex-col">
      <header className="con-barra-arriba shrink-0 px-5 pb-3 pt-5">
        <h1 className="font-display text-[26px] font-semibold -tracking-[0.015em]">Mercado</h1>
      </header>

      <div className="min-h-0 grow overflow-y-auto px-3 pb-4">
        {loading && <Esqueletos />}

        {!loading && agents.length === 0 && (
          <p className="px-2 pt-6 text-center text-[13.5px] leading-relaxed text-ink-3">
            Todavía no hay ningún agente registrado en la cadena.
          </p>
        )}

        <ul className="flex flex-col gap-2">
          {agents.map((a) => (
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

  return (
    <article className="pulsable rounded-2xl bg-cream p-3.5">
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

          <div className="mt-2.5 flex items-center gap-2">
            <span className="font-mono text-[12.5px] text-ink-2">
              {formatMon(agente.pricePerTask, 0)} {moneda} / tarea
            </span>
            {/* Sin valoraciones no se dice «5,0»: se dice que no hay. */}
            {agente.reviews === 0 && (
              <span className="text-[11px] text-ink-3">· sin valoraciones</span>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}

function Esqueletos(): React.ReactElement {
  return (
    <ul className="flex flex-col gap-2" aria-hidden>
      {[0, 1, 2, 3].map((i) => (
        <li key={i} className="h-[92px] animate-pulse rounded-2xl bg-cream" />
      ))}
    </ul>
  );
}
