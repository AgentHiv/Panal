/**
 * Panal — Cliente del indexador HTTP público del bot (bot/src/indexer-http.ts).
 *
 * El indexador mantiene un índice append-only de TODOS los eventos on-chain
 * (PanalRegistry + PanalEscrow) y expone stats agregadas por agente y
 * globales. Es la fuente de verdad para reseñas, actividad y rankings: los
 * datos que muestra son siempre eventos reales de Monad mainnet.
 *
 * Degradación graceful: si el indexador no responde (caída, CORS, timeout,
 * rate limit), `fetchJson` devuelve null y la UI muestra estados vacíos o
 * cae a los datos on-chain directos (RPC vía publicClient). En ningún caso
 * se inventan datos.
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

export const INDEXER_URL: string = import.meta.env.VITE_INDEXER_URL ?? 'https://api.panal.lat';

/* ---------- Tipos (réplica exacta de bot/src/indexer-store.ts) ---------- */

/** Evento indexado (args serializados: bigint -> string decimal). */
export interface IndexedEvent {
  /** `${txHash}-${logIndex}` — clave de dedup. */
  id: string;
  contract: 'registry' | 'escrow';
  event: string;
  blockNumber: number;
  logIndex: number;
  txHash: string;
  /** Timestamp del bloque (segundos epoch). */
  ts: number;
  args: Record<string, string | number | boolean>;
}

/** Stats agregadas por agente. */
export interface AgentStats {
  /** address del agente en lowercase. */
  address: string;
  /** Tareas asignadas (TaskCreated con worker = agente). */
  tasks: number;
  /** Tareas completadas (TaskCompleted). */
  completed: number;
  /** Rating medio (TaskCompleted + DisputeResolved). null si no tiene. */
  avgRating: number | null;
  ratingCount: number;
  /** Volumen cobrado por moneda, en wei (string): 'MON' | '$PANAL'. */
  volume: Record<string, string>;
  firstSeenTs: number;
  lastSeenTs: number;
}

export interface DayStats {
  /** YYYY-MM-DD (UTC). */
  date: string;
  events: number;
  /** MON movido ese día (wei, string). */
  monMoved: string;
  /** $PANAL movido ese día (wei, string). */
  panalMoved: string;
  activeAgents: number;
}

export interface IndexStats {
  updatedAt: string;
  lastBlock: number;
  totalEvents: number;
  byType: Record<string, number>;
  totals: { events: number; agents: number; tasks: number; completed: number };
  daily30: DayStats[];
  daily7: DayStats[];
}

interface EventsResponse {
  events: IndexedEvent[];
  count: number;
  next: string | null;
}

interface AgentsResponse {
  agents: AgentStats[];
  count: number;
}

/* ---------- fetch con timeout; null ante cualquier fallo ---------- */

async function fetchJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${INDEXER_URL}${path}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/* ---------- Hooks react-query ---------- */

/** Stats globales del índice (refresh 30 s). null si el indexador no responde. */
export function useIndexStats() {
  const query = useQuery({
    queryKey: ['indexer', 'stats'],
    queryFn: () => fetchJson<IndexStats>('/index/stats'),
    refetchInterval: 30_000,
    staleTime: 15_000,
    retry: 1,
  });
  return { stats: query.data ?? null, loading: query.isLoading };
}

/**
 * Agentes con stats agregadas (refresh 60 s). Devuelve la lista y un mapa
 * por address lowercase para cruzar con los agentes del registry on-chain.
 */
export function useIndexAgents() {
  const query = useQuery({
    queryKey: ['indexer', 'agents'],
    queryFn: () => fetchJson<AgentsResponse>('/index/agents'),
    refetchInterval: 60_000,
    staleTime: 30_000,
    retry: 1,
  });
  const agents = useMemo(() => query.data?.agents ?? [], [query.data]);
  const byAddress = useMemo(() => {
    const map = new Map<string, AgentStats>();
    for (const a of agents) map.set(a.address.toLowerCase(), a);
    return map;
  }, [agents]);
  return { agents, byAddress, loading: query.isLoading };
}

/**
 * Eventos del indexador que involucran a un agente (args.worker / args.agent
 * / args.to === address). Refresh 30 s; desactivado sin address.
 */
export function useIndexAgentEvents(address: string | undefined, limit = 200) {
  const query = useQuery({
    queryKey: ['indexer', 'events', address?.toLowerCase(), limit],
    queryFn: async () => {
      const addr = address?.toLowerCase();
      if (!addr) return [] as IndexedEvent[];
      const res = await fetchJson<EventsResponse>(`/index/events?limit=${limit}`);
      if (!res) return [] as IndexedEvent[];
      return res.events.filter((ev) => {
        const a = ev.args;
        return (
          String(a['worker'] ?? '').toLowerCase() === addr ||
          String(a['agent'] ?? '').toLowerCase() === addr ||
          String(a['to'] ?? '').toLowerCase() === addr
        );
      });
    },
    enabled: !!address,
    refetchInterval: 30_000,
    staleTime: 15_000,
    retry: 1,
  });
  return { events: query.data ?? [], loading: query.isLoading && !!address };
}
