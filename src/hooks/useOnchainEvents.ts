/**
 * Panal — Eventos REALES on-chain para el feed en vivo.
 *
 * Fuente única de actividad para /en-vivo, el mini-feed del Home y el ticker
 * del hero. Lee logs de PanalRegistry (AgentRegistered) y PanalEscrow
 * (TaskCreated, TaskClaimed, TaskDelivered, TaskCompleted, TaskDisputed,
 * Withdrawal) con `publicClient.getLogs`:
 *
 * - Carga inicial: ventanas hacia atrás (máx. 50) hasta reunir los 30
 *   eventos más recientes. El RPC público de Monad limita eth_getLogs a
 *   rangos de 100 bloques, así que el tamaño de ventana se auto-detecta
 *   (`maxLogRange`) y la carga se trocea en llamadas secuenciales; si el
 *   registry y el escrow están a 0 (getAgentCount/getTaskCount), se omite
 *   el barrido: no existen eventos.
 * - Polling cada 12 s pidiendo solo logs desde `lastSeenBlock + 1` (tope de
 *   10 ventanas por poll) y prependiendo al feed (rate limit ~15 req/s).
 * - Los timestamps se obtienen con `getBlock` solo para los bloques
 *   presentes en los logs (concurrencia 5 + caché en módulo).
 *
 * Devuelve `{ entries, loading, error, total, refetch }`. Cuando el RPC no
 * responde, `error` != null y la UI muestra el estado de error con reintento.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatEther, parseAbiItem } from 'viem';
import type { Address } from 'viem';
import i18n from '@/i18n';
import {
  PANAL_ESCROW_ADDRESS,
  PANAL_ESCROW_V2_ADDRESS,
  PANAL_REGISTRY_ADDRESS,
  PANAL_REGISTRY_V2_ADDRESS,
  V2_ENABLED,
  currencySymbol,
  publicClient,
} from '@/contracts/config';
import { panalEscrowAbi, panalEscrowV2Abi, panalRegistryAbi, panalRegistryV2Abi } from '@/contracts/abis';
import { formatMon } from '@/data/agents';
import { truncateHash } from '@/data/events';
import type { LiveEvent, PartyKind } from '@/data/events';

const MAX_EVENTS = 30;
/** ventanas de backfill hacia atrás (tamaño = maxLogRange auto-detectado) */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Búsqueda binaria del primer bloque con timestamp >= tsSec (≈26 getBlock). */
async function blockAtTime(tsSec: number): Promise<bigint> {
  let lo = 0n;
  let hi = await publicClient.getBlockNumber();
  while (hi - lo > 1n) {
    const mid = (lo + hi) / 2n;
    const b = await publicClient.getBlock({ blockNumber: mid });
    if (Number(b.timestamp) >= tsSec) hi = mid;
    else lo = mid;
  }
  return hi;
}
/** tope de ventanas por poll incremental (pestaña suspendida mucho tiempo) */
const INCREMENTAL_MAX_WINDOWS = 10;
const POLL_MS = 12_000;
const QUERY_KEY = ['onchain-events'] as const;

const REGISTRY_EVENTS_V1 = [
  parseAbiItem(
    'event AgentRegistered(address indexed agent, address indexed owner, uint256 pricePerTask)',
  ),
];
const REGISTRY_EVENTS_V2 = [
  parseAbiItem(
    'event AgentRegistered(address indexed agent, address indexed owner, uint256 pricePerTask, address currency)',
  ),
];

const ESCROW_EVENTS_V1 = [
  parseAbiItem(
    'event TaskCreated(uint256 indexed taskId, address indexed client, address indexed worker, uint256 amount)',
  ),
  parseAbiItem('event TaskClaimed(uint256 indexed taskId, address indexed worker)'),
  parseAbiItem('event TaskDelivered(uint256 indexed taskId, bytes32 indexed resultHash)'),
  parseAbiItem(
    'event TaskCompleted(uint256 indexed taskId, address indexed worker, uint256 workerPaid, uint256 fee, uint8 rating)',
  ),
  parseAbiItem('event TaskDisputed(uint256 indexed taskId, address indexed openedBy)'),
  parseAbiItem('event Withdrawal(address indexed to, uint256 amount)'),
];
const ESCROW_EVENTS_V2 = [
  parseAbiItem(
    'event TaskCreated(uint256 indexed taskId, address indexed client, address indexed worker, uint256 amount, address currency)',
  ),
  parseAbiItem('event TaskClaimed(uint256 indexed taskId, address indexed worker)'),
  parseAbiItem('event TaskDelivered(uint256 indexed taskId, bytes32 resultHash)'),
  parseAbiItem(
    'event TaskCompleted(uint256 indexed taskId, address indexed worker, uint256 workerPaid, uint256 fee, uint8 rating)',
  ),
  parseAbiItem('event TaskDisputed(uint256 indexed taskId, address indexed openedBy)'),
  parseAbiItem('event Withdrawal(address indexed to, address indexed token, uint256 amount)'),
];

/** Contratos y eventos ACTIVOS: v2 tras la migración, v1 antes. */
const REGISTRY_ADDRESS = V2_ENABLED ? PANAL_REGISTRY_V2_ADDRESS : PANAL_REGISTRY_ADDRESS;
const ESCROW_ADDRESS = V2_ENABLED ? PANAL_ESCROW_V2_ADDRESS : PANAL_ESCROW_ADDRESS;
const REGISTRY_ABI = V2_ENABLED ? panalRegistryV2Abi : panalRegistryAbi;
const REGISTRY_EVENTS = V2_ENABLED ? REGISTRY_EVENTS_V2 : REGISTRY_EVENTS_V1;
const ESCROW_ABI = V2_ENABLED ? panalEscrowV2Abi : panalEscrowAbi;
const ESCROW_EVENTS = V2_ENABLED ? ESCROW_EVENTS_V2 : ESCROW_EVENTS_V1;

/** Log decodificado por viem cuando se pasan `events` al getLogs. */
interface DecodedLog {
  eventName?: string;
  args?: Record<string, unknown>;
  blockNumber: bigint;
  logIndex: number;
  transactionHash: string;
}

/* ---------- Estado compartido (una sola red activa por build) ---------- */

const state: {
  lastSeenBlock?: bigint;
  agents?: Set<string>;
  agentsFetched?: boolean;
  /** rango máximo de eth_getLogs que acepta el RPC (se auto-detecta) */
  maxLogRange: bigint;
} = { maxLogRange: 50_000n };

/** timestamps (segundos) por bloque, cacheados entre polls */
const blockTsCache = new Map<string, number>();

/* ---------- Lecturas RPC ---------- */

/** Extrae el límite de rango de eth_getLogs del mensaje de error del RPC. */
function parseRangeLimit(err: unknown): bigint | null {
  const anyErr = err as { cause?: { message?: string }; message?: string };
  const msg = String(anyErr?.cause?.message ?? anyErr?.message ?? err);
  const m =
    msg.match(/limited to a ([\d,]+) range/i) ??
    msg.match(/(?:max(?:imum)?|limit(?:ed)?)[^\d]*([\d,]+)\s*blocks?/i);
  return m ? BigInt(m[1].replace(/,/g, '')) : null;
}

/**
 * getLogs troceado según `state.maxLogRange` (auto-detectado: el RPC público
 * de Monad limita a 100 bloques). Secuencial para no violar el rate limit.
 */
async function getLogsChunked(
  address: Address,
  events: typeof REGISTRY_EVENTS | typeof ESCROW_EVENTS,
  fromBlock: bigint,
  toBlock: bigint,
): Promise<DecodedLog[]> {
  const out: DecodedLog[] = [];
  let f = fromBlock;
  while (f <= toBlock) {
    let t = f + state.maxLogRange - 1n;
    if (t > toBlock) t = toBlock;
    try {
      const logs = await publicClient.getLogs({ address, events, fromBlock: f, toBlock: t });
      out.push(...(logs as unknown as DecodedLog[]));
      f = t + 1n;
    } catch (err) {
      const limit = parseRangeLimit(err);
      if (limit !== null && limit >= 1n && limit < state.maxLogRange) {
        state.maxLogRange = limit; // reintenta el mismo tramo con el nuevo límite
      } else if (limit === null && state.maxLogRange > 4n) {
        state.maxLogRange /= 2n;
      } else {
        throw err;
      }
    }
  }
  return out;
}

/** Set de agentes registrados (getAgents(0, 50)), cacheado en módulo. */
async function fetchAgentSet(): Promise<Set<string>> {
  try {
    const addresses = (await publicClient.readContract({
      address: REGISTRY_ADDRESS,
      abi: REGISTRY_ABI,
      functionName: 'getAgents',
      args: [0n, 50n],
    })) as Address[];
    return new Set(addresses.map((a) => a.toLowerCase()));
  } catch {
    return new Set();
  }
}

/** Contadores on-chain: si ambos son 0 no existe ningún evento que barrer. */
async function fetchCounters(): Promise<{ agents: bigint; tasks: bigint }> {
  const [agents, tasks] = await Promise.all([
    publicClient
      .readContract({
        address: REGISTRY_ADDRESS,
        abi: REGISTRY_ABI,
        functionName: 'getAgentCount',
      })
      .catch(() => null),
    publicClient
      .readContract({
        address: ESCROW_ADDRESS,
        abi: V2_ENABLED ? panalEscrowV2Abi : panalEscrowAbi,
        functionName: 'getTaskCount',
      })
      .catch(() => null),
  ]);
  // Ante error de lectura devolvemos 1n para no saltarnos el backfill.
  return { agents: agents ?? 1n, tasks: tasks ?? 1n };
}

/** Timestamps de los bloques presentes en los logs (concurrencia 5, con caché). */
async function fetchBlockTimestamps(blockNumbers: bigint[]): Promise<void> {
  const missing = [...new Set(blockNumbers.map((b) => b.toString()))].filter(
    (k) => !blockTsCache.has(k),
  );
  for (let i = 0; i < missing.length; i += 5) {
    const batch = missing.slice(i, i + 5);
    const blocks = await Promise.all(
      batch.map((k) => publicClient.getBlock({ blockNumber: BigInt(k) }).catch(() => null)),
    );
    blocks.forEach((block, j) => {
      if (block) blockTsCache.set(batch[j], Number(block.timestamp));
    });
  }
}

/* ---------- Mapeo log → LiveEvent ---------- */

const t = (key: string, opts?: Record<string, unknown>) => i18n.t(key, opts);

function relationFor(fromKind: PartyKind, toKind: PartyKind): string | undefined {
  if (fromKind === 'agente' && toKind === 'agente') return 'agente↔agente';
  if (fromKind === 'humano' && toKind === 'agente') return 'humano→agente';
  return undefined;
}

function mapLog(log: DecodedLog, agents: Set<string>, nowSec: number): LiveEvent | null {
  const args = log.args ?? {};
  const kindOf = (addr: unknown): PartyKind =>
    typeof addr === 'string' && agents.has(addr.toLowerCase()) ? 'agente' : 'humano';
  const short = (addr: unknown): string =>
    typeof addr === 'string' ? truncateHash(addr) : '';
  const secondsAgo = Math.max(0, nowSec - (blockTsCache.get(log.blockNumber.toString()) ?? nowSec));
  const base = {
    id: `${log.transactionHash}-${log.logIndex}`,
    txHash: log.transactionHash,
    secondsAgo,
  };
  const taskId = args.taskId !== undefined ? String(args.taskId) : undefined;

  switch (log.eventName) {
    case 'AgentRegistered': {
      const price = typeof args.pricePerTask === 'bigint' ? Number(formatEther(args.pricePerTask)) : 0;
      return {
        ...base,
        type: 'registro',
        from: short(args.agent),
        fromKind: 'agente',
        // El registry v2 emite la moneda en el propio evento; el v1 no la trae
        // y siempre fue MON, así que ausente equivale a nativo.
        task: t(currencySymbol(args.currency as string | undefined) === '$PANAL' ? 'live.pricePerTaskToken' : 'live.pricePerTask', {
          price: formatMon(price, 5),
        }),
      };
    }
    case 'TaskCreated': {
      const fromKind = kindOf(args.client);
      const toKind = kindOf(args.worker);
      return {
        ...base,
        type: 'contratacion',
        from: short(args.client),
        fromKind,
        to: short(args.worker),
        toKind,
        task: taskId ? t('live.taskNum', { id: taskId }) : undefined,
        amount: typeof args.amount === 'bigint' ? Number(formatEther(args.amount)) : undefined,
        currency: typeof args.currency === 'string' ? args.currency : undefined,
        relation: relationFor(fromKind, toKind),
      };
    }
    case 'TaskClaimed':
      return {
        ...base,
        type: 'contratacion',
        from: short(args.worker),
        fromKind: kindOf(args.worker),
        task: taskId ? t('live.taskClaimed', { id: taskId }) : undefined,
      };
    case 'TaskDelivered':
      return {
        ...base,
        type: 'entrega',
        from: taskId ? t('live.taskLabel', { id: taskId }) : short(args.resultHash),
        fromKind: 'agente',
      };
    case 'TaskCompleted':
      return {
        ...base,
        type: 'pago',
        from: short(args.worker),
        fromKind: kindOf(args.worker),
        to: short(args.worker),
        toKind: kindOf(args.worker),
        task: taskId ? t('live.taskCompleted', { id: taskId }) : undefined,
        amount: typeof args.workerPaid === 'bigint' ? Number(formatEther(args.workerPaid)) : undefined,
      };
    case 'TaskDisputed':
      return {
        ...base,
        type: 'disputa',
        from: short(args.openedBy),
        fromKind: kindOf(args.openedBy),
        to: taskId ? t('live.taskLabel', { id: taskId }) : undefined,
        task: taskId ? t('live.disputeTask', { id: taskId }) : t('live.disputeOpened'),
      };
    case 'Withdrawal': {
      return {
        ...base,
        type: 'pago',
        from: short(args.to),
        fromKind: kindOf(args.to),
        to: short(args.to),
        toKind: kindOf(args.to),
        task: t('live.withdrawal'),
        amount: typeof args.amount === 'bigint' ? Number(formatEther(args.amount)) : undefined,
        currency: typeof args.token === 'string' ? args.token : undefined,
      };
    }
    default:
      return null;
  }
}

/* ---------- Fetch (backfill + incremental) ---------- */

async function fetchOnchainEvents(prev: LiveEvent[] | undefined): Promise<LiveEvent[]> {
  const head = await publicClient.getBlockNumber();

  if (!state.agentsFetched) {
    state.agents = await fetchAgentSet();
    state.agentsFetched = true;
  }
  const agents = state.agents ?? new Set<string>();

  let raw: DecodedLog[] = [];
  if (state.lastSeenBlock === undefined) {
    // Carga inicial QUIRÚRGICA: el RPC limita eth_getLogs a ~100 bloques,
    // así que barrer hacia atrás no alcanza eventos de horas/días atrás.
    // En su lugar usamos los timestamps on-chain (Agent.registeredAt,
    // Task.createdAt) + búsqueda binaria del bloque exacto, y pedimos logs
    // solo en una ventana pequeña alrededor de cada punto de actividad.
    const counters = await fetchCounters();
    if (counters.agents > 0n || counters.tasks > 0n) {
      const targets: number[] = [];
      if (counters.agents > 0n) {
        const addrList = [...(state.agents ?? new Set<string>())];
        for (let i = 0; i < addrList.length; i += 5) {
          const stamps = await Promise.all(
            addrList.slice(i, i + 5).map(async (a) => {
              try {
                const ag = (await publicClient.readContract({
                  address: REGISTRY_ADDRESS,
                  abi: REGISTRY_ABI,
                  functionName: 'getAgent',
                  args: [a as Address],
                })) as { registeredAt: bigint };
                return Number(ag.registeredAt);
              } catch {
                return null;
              }
            }),
          );
          for (const x of stamps) if (x) targets.push(x);
          if (i + 5 < addrList.length) await sleep(300);
        }
      }
      if (counters.tasks > 0n) {
        const n = counters.tasks > 25n ? 25n : counters.tasks;
        const ids: bigint[] = [];
        for (let i = counters.tasks - n; i < counters.tasks; i += 1n) ids.push(i);
        for (let i = 0; i < ids.length; i += 5) {
          const stamps = await Promise.all(
            ids.slice(i, i + 5).map(async (id) => {
              try {
                const tk = (await publicClient.readContract({
                  address: ESCROW_ADDRESS,
                  abi: ESCROW_ABI,
                  functionName: 'tasks',
                  args: [id],
                })) as { createdAt: bigint };
                return Number(tk.createdAt);
              } catch {
                return null;
              }
            }),
          );
          for (const x of stamps) if (x) targets.push(x);
          if (i + 5 < ids.length) await sleep(300);
        }
      }
      for (const ts of targets) {
        const b = await blockAtTime(ts);
        const from = b > 120n ? b - 120n : 0n;
        const [registryLogs, escrowLogs] = await Promise.all([
          getLogsChunked(REGISTRY_ADDRESS, REGISTRY_EVENTS, from, b + 120n),
          getLogsChunked(ESCROW_ADDRESS, ESCROW_EVENTS, from, b + 120n),
        ]);
        raw.push(...registryLogs, ...escrowLogs);
      }
    }
  } else if (head > state.lastSeenBlock) {
    // Incremental: solo lo nuevo; si el gap es enorme, solo las últimas ventanas.
    const maxGap = state.maxLogRange * BigInt(INCREMENTAL_MAX_WINDOWS);
    const from =
      head - state.lastSeenBlock > maxGap ? head - maxGap + 1n : state.lastSeenBlock + 1n;
    const [registryLogs, escrowLogs] = await Promise.all([
      getLogsChunked(REGISTRY_ADDRESS, REGISTRY_EVENTS, from, head),
      getLogsChunked(ESCROW_ADDRESS, ESCROW_EVENTS, from, head),
    ]);
    raw = [...registryLogs, ...escrowLogs];
  }
  state.lastSeenBlock = head;

  if (raw.length === 0) return prev ?? [];

  await fetchBlockTimestamps(raw.map((l) => l.blockNumber));

  const nowSec = Math.floor(Date.now() / 1000);
  const fresh = raw
    .sort((a, b) =>
      a.blockNumber === b.blockNumber
        ? b.logIndex - a.logIndex
        : a.blockNumber > b.blockNumber
          ? -1
          : 1,
    )
    .map((log) => mapLog(log, agents, nowSec))
    .filter((ev): ev is LiveEvent => ev !== null);

  // Prepend + dedupe por id (un log puede solaparse entre polls).
  const seen = new Set<string>();
  const merged: LiveEvent[] = [];
  for (const ev of [...fresh, ...(prev ?? [])]) {
    if (seen.has(ev.id)) continue;
    seen.add(ev.id);
    merged.push(ev);
    if (merged.length >= MAX_EVENTS) break;
  }
  return merged;
}

/* ---------- Hook ---------- */

export interface OnchainEvents {
  entries: LiveEvent[];
  loading: boolean;
  error: Error | null;
  /** eventos actualmente en el feed */
  total: number;
  /** Date.now() de la última respuesta exitosa (para envejecer secondsAgo) */
  fetchedAt: number;
  refetch: () => void;
}

export function useOnchainEvents(): OnchainEvents {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => fetchOnchainEvents(queryClient.getQueryData<LiveEvent[]>(QUERY_KEY)),
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  return {
    entries: query.data ?? [],
    loading: query.isLoading,
    error: query.isError ? (query.error as Error) : null,
    total: query.data?.length ?? 0,
    fetchedAt: query.dataUpdatedAt,
    refetch: () => void query.refetch(),
  };
}
