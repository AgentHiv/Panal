/**
 * Panal — Eventos REALES on-chain para el feed en vivo.
 *
 * Fuente única de actividad para /en-vivo, el mini-feed del Home y el ticker
 * del hero: registros, contrataciones, entregas, pagos, disputas y retiradas
 * de PanalRegistry y PanalEscrow.
 *
 * SALEN DEL INDEXADOR (api.panal.lat/index/events), no del RPC. Antes cada
 * navegador los reconstruía preguntando al nodo público de Monad: getLogs en
 * ventanas de 100 bloques, una búsqueda binaria de bloque por cada agente y
 * cada tarea, y la fecha de cada bloque. Eran unas 20 peticiones por segundo
 * por visitante; el nodo contestaba 429 a un tercio, la carga inicial no
 * acababa nunca y la página se quedaba en «Conectando con la red…». Medido el
 * 6-nov-2026 en panal.lat/en-vivo: 1.753 peticiones en 90 s, 592 con 429 y
 * ningún evento en pantalla. El indexador ya tiene todos los eventos, con la
 * fecha de su bloque, y va unos segundos por detrás de la cadena: basta una
 * petición cada pocos segundos.
 *
 * Quién es cada dirección sale del catálogo del indexador: un programa del
 * mercado es «agente», una persona (`tipo:persona` en su ficha) es «persona»,
 * y una wallet sin ficha —quien contrata— es «humano».
 *
 * Devuelve `{ entries, loading, error, total, fetchedAt, refetch }`. Si el
 * indexador no responde se siguen enseñando los últimos eventos que se
 * tenían; si no había ninguno, `error` != null y la UI ofrece reintentar.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatEther } from 'viem';
import { leerTipo } from '@panal/sdk';
import i18n from '@/i18n';
import { currencySymbol } from '@/contracts/config';
import { formatMon } from '@/data/agents';
import { truncateHash } from '@/data/events';
import type { LiveEvent, PartyKind } from '@/data/events';
import { fetchCatalogo, fetchEventosRecientes, type IndexedEvent } from '@/lib/indexer';

const MAX_EVENTS = 30;
/**
 * Eventos por petición: más de los que se enseñan, porque el indexador guarda
 * también los del tablón y los cambios de ficha, que aquí no salen.
 */
const PEDIDOS = 150;
/**
 * El indexador lee la cadena cada 15 s (INDEX_POLL_INTERVAL_MS): preguntarle
 * más a menudo no trae nada nuevo. Y admite 60 peticiones por minuto y por IP,
 * que en una red móvil comparten muchas personas: con 10 s son 6 por visitante.
 * Lo nuevo tarda, como mucho, unos 25 s en verse.
 */
const POLL_MS = 10_000;
/** Cada cuánto se vuelve a mirar quién es quién, por las altas nuevas. */
const QUIENES_MS = 5 * 60_000;
const QUERY_KEY = ['onchain-events'] as const;

/* ---------- Quién es quién ---------- */

interface Quienes {
  programas: Set<string>;
  personas: Set<string>;
  /** Date.now() de la lectura; 0 si no se pudo leer y hay que reintentar. */
  en: number;
}

let quienes: Quienes | null = null;

/** Los programas y las personas del mercado, por dirección en minúsculas. */
async function quienesSon(): Promise<Quienes> {
  if (quienes && quienes.en > 0 && Date.now() - quienes.en < QUIENES_MS) return quienes;
  const catalogo = await fetchCatalogo();
  if (!catalogo) return quienes ?? { programas: new Set(), personas: new Set(), en: 0 };
  const programas = new Set<string>();
  const personas = new Set<string>();
  for (const a of catalogo) {
    (leerTipo(a.metadataURI ?? '') === 'persona' ? personas : programas).add(a.address.toLowerCase());
  }
  quienes = { programas, personas, en: Date.now() };
  return quienes;
}

/* ---------- Mapeo evento del indexador → LiveEvent ---------- */

const t = (key: string, opts?: Record<string, unknown>) => i18n.t(key, opts);

/** Las cantidades llegan como texto (wei): no caben en un number. */
function monto(v: unknown): number | undefined {
  if (typeof v !== 'string' && typeof v !== 'number') return undefined;
  const s = String(v);
  if (!/^\d+$/.test(s)) return undefined;
  return Number(formatEther(BigInt(s)));
}

function relationFor(fromKind: PartyKind, toKind: PartyKind): string | undefined {
  if (toKind === 'agente') return fromKind === 'agente' ? 'agente↔agente' : 'humano→agente';
  if (toKind === 'persona') return fromKind === 'agente' ? 'agente→persona' : 'humano→persona';
  return undefined;
}

/** Lo que se sabe de cada tarea por su contratación: quién la hace y en qué moneda. */
interface DeLaTarea {
  trabajador?: string;
  moneda?: string;
}

function mapEvent(ev: IndexedEvent, q: Quienes, tareas: Map<string, DeLaTarea>, nowSec: number): LiveEvent | null {
  const args = ev.args ?? {};
  const kindOf = (addr: unknown): PartyKind => {
    if (typeof addr !== 'string') return 'humano';
    const a = addr.toLowerCase();
    if (q.personas.has(a)) return 'persona';
    if (q.programas.has(a)) return 'agente';
    return 'humano';
  };
  const short = (addr: unknown): string => (typeof addr === 'string' ? truncateHash(addr) : '');
  // La dirección entera, además de la recortada: con `0x12…ab` no se puede
  // buscar quién es, y hace falta para enseñar el logo de cada agente.
  const completa = (addr: unknown): string | undefined => (typeof addr === 'string' ? addr : undefined);
  const base = {
    id: ev.id,
    txHash: ev.txHash,
    secondsAgo: Math.max(0, nowSec - ev.ts),
  };
  const taskId = args.taskId !== undefined ? String(args.taskId) : undefined;

  switch (ev.event) {
    case 'AgentRegistered':
      return {
        ...base,
        type: 'registro',
        from: short(args.agent),
        fromAddress: completa(args.agent),
        // Una persona que se da de alta sale como persona, no como agente.
        fromKind: kindOf(args.agent) === 'persona' ? 'persona' : 'agente',
        // El registry v2 emite la moneda en el propio evento; el v1 no la trae
        // y siempre fue MON, así que ausente equivale a nativo.
        task: t(currencySymbol(args.currency as string | undefined) === '$PANAL' ? 'live.pricePerTaskToken' : 'live.pricePerTask', {
          price: formatMon(monto(args.pricePerTask) ?? 0, 5),
        }),
      };
    case 'TaskCreated': {
      const fromKind = kindOf(args.client);
      const toKind = kindOf(args.worker);
      return {
        ...base,
        type: 'contratacion',
        from: short(args.client),
        fromAddress: completa(args.client),
        fromKind,
        to: short(args.worker),
        toAddress: completa(args.worker),
        toKind,
        task: taskId ? t('live.taskNum', { id: taskId }) : undefined,
        amount: monto(args.amount),
        currency: typeof args.currency === 'string' ? args.currency : undefined,
        relation: relationFor(fromKind, toKind),
      };
    }
    case 'TaskClaimed':
      return {
        ...base,
        type: 'contratacion',
        from: short(args.worker),
        fromAddress: completa(args.worker),
        fromKind: kindOf(args.worker),
        task: taskId ? t('live.taskClaimed', { id: taskId }) : undefined,
      };
    case 'TaskDelivered': {
      // El evento no dice quién entrega: se saca de la contratación de esa
      // tarea si está entre los eventos pedidos.
      const quien = taskId ? tareas.get(taskId)?.trabajador : undefined;
      return {
        ...base,
        type: 'entrega',
        from: taskId ? t('live.taskLabel', { id: taskId }) : short(args.resultHash),
        fromKind: quien ? kindOf(quien) : 'agente',
      };
    }
    case 'TaskCompleted':
      return {
        ...base,
        type: 'pago',
        from: short(args.worker),
        fromAddress: completa(args.worker),
        fromKind: kindOf(args.worker),
        to: short(args.worker),
        toAddress: completa(args.worker),
        toKind: kindOf(args.worker),
        task: taskId ? t('live.taskCompleted', { id: taskId }) : undefined,
        amount: monto(args.workerPaid),
        // El pago no dice la moneda; la dice la contratación. Sin ella salía
        // un pago en $PANAL como si fuera MON.
        currency: taskId ? tareas.get(taskId)?.moneda : undefined,
      };
    case 'TaskDisputed':
      return {
        ...base,
        type: 'disputa',
        from: short(args.openedBy),
        fromAddress: completa(args.openedBy),
        fromKind: kindOf(args.openedBy),
        to: taskId ? t('live.taskLabel', { id: taskId }) : undefined,
        task: taskId ? t('live.disputeTask', { id: taskId }) : t('live.disputeOpened'),
      };
    case 'Withdrawal':
      return {
        ...base,
        type: 'pago',
        from: short(args.to),
        fromAddress: completa(args.to),
        fromKind: kindOf(args.to),
        to: short(args.to),
        toAddress: completa(args.to),
        toKind: kindOf(args.to),
        task: t('live.withdrawal'),
        amount: monto(args.amount),
        currency: typeof args.token === 'string' ? args.token : undefined,
      };
    default:
      return null;
  }
}

/* ---------- Fetch ---------- */

async function fetchOnchainEvents(prev: LiveEvent[] | undefined): Promise<LiveEvent[]> {
  const [eventos, q] = await Promise.all([fetchEventosRecientes(PEDIDOS), quienesSon()]);
  if (eventos === null) {
    // Un fallo suelto del indexador no vacía el feed: se queda lo que había.
    if (prev && prev.length > 0) return prev;
    throw new Error('indexer unreachable');
  }

  // Del más nuevo al más viejo, que es como se pinta.
  const ordenados = [...eventos].sort((a, b) =>
    a.blockNumber === b.blockNumber ? b.logIndex - a.logIndex : b.blockNumber - a.blockNumber,
  );
  const tareas = new Map<string, DeLaTarea>();
  for (const ev of ordenados) {
    if (ev.event !== 'TaskCreated' && ev.event !== 'TaskClaimed') continue;
    const id = String(ev.args?.taskId);
    const tarea = tareas.get(id) ?? {};
    if (!tarea.trabajador && typeof ev.args?.worker === 'string') tarea.trabajador = ev.args.worker;
    if (!tarea.moneda && typeof ev.args?.currency === 'string') tarea.moneda = ev.args.currency;
    tareas.set(id, tarea);
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const fresh: LiveEvent[] = [];
  for (const ev of ordenados) {
    const live = mapEvent(ev, q, tareas, nowSec);
    if (live) fresh.push(live);
    if (fresh.length >= MAX_EVENTS) break;
  }
  return fresh;
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
