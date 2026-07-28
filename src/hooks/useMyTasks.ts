/**
 * Panal — Mis tareas REALES on-chain (PanalEscrow).
 *
 * Lee `getTaskCount()` y luego el getter público `tasks(i)` para cada id,
 * en lotes de 5 con pausa de 300 ms entre lotes (el RPC público limita a
 * ~15 req/s). Filtra las tareas donde la wallet conectada es client o
 * worker y añade `deliveredAt(i)` solo para las mías en estado Delivered
 * (necesario para saber si `autoRelease` ya está disponible).
 *
 * Límite: si existen más de 200 tareas on-chain solo se leen las 200 más
 * recientes (las antiguas ya están Completed/Cancelled y no cambian; así
 * acotamos el número de eth_call por refetch). Documentado aquí a propósito.
 *
 * Nombres de agente: el mapeo worker→nombre se hace en los componentes a
 * partir de `usePanalAgents` (si no hay agente registrado con esa address,
 * se muestra la address truncada).
 */

import { useQuery } from '@tanstack/react-query';
import type { Address, Hex } from 'viem';
import {
  NATIVE_CURRENCY,
  PANAL_ESCROW_ADDRESS,
  PANAL_ESCROW_V2_ADDRESS,
  V2_ENABLED,
  activeChain,
  publicClient,
} from '@/contracts/config';
import { panalEscrowAbi, panalEscrowV2Abi } from '@/contracts/abis';
import { useWallet } from '@/hooks/useWallet';

/** Escrow y ABI activos (v2 dual-moneda cuando V2_ENABLED). */
export const ACTIVE_ESCROW_ADDRESS = V2_ENABLED ? PANAL_ESCROW_V2_ADDRESS : PANAL_ESCROW_ADDRESS;
export const ACTIVE_ESCROW_ABI = V2_ENABLED ? panalEscrowV2Abi : panalEscrowAbi;

/** Status del enum on-chain. */
export const TASK_STATUS = {
  Open: 0,
  Delivered: 1,
  Completed: 2,
  Disputed: 3,
  Cancelled: 4,
} as const;

export interface RealTask {
  id: bigint;
  client: Address;
  worker: Address;
  amountWei: bigint;
  taskHash: Hex;
  resultHash: Hex;
  deadline: bigint;
  createdAt: bigint;
  status: number;
  /** moneda de la tarea: address(0) = MON (v1 siempre), PANAL_TOKEN = $PANAL (solo v2) */
  currency: Address;
  /** timestamp de entrega (solo si status === Delivered) */
  deliveredAt?: bigint;
  role: 'client' | 'worker';
}

const CHUNK = 5;
const CHUNK_SLEEP_MS = 300;
/** Máximo de tareas leídas (las más recientes) — ver docstring del módulo. */
const MAX_TASKS_SCAN = 200;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface RawTaskTuple {
  client: Address;
  worker: Address;
  amount: bigint;
  taskHash: Hex;
  resultHash: Hex;
  deadline: bigint;
  createdAt: bigint;
  status: number;
  /** solo escrow v2 (ausente en v1) */
  currency?: Address;
}

async function fetchMyTasks(me: Address): Promise<RealTask[]> {
  const count = (await publicClient.readContract({
    address: ACTIVE_ESCROW_ADDRESS,
    abi: ACTIVE_ESCROW_ABI,
    functionName: 'getTaskCount',
  })) as bigint;

  const total = Number(count);
  if (total === 0) return [];

  // Solo las últimas MAX_TASKS_SCAN tareas si el contador es enorme.
  const start = Math.max(0, total - MAX_TASKS_SCAN);
  const ids: bigint[] = [];
  for (let i = start; i < total; i++) ids.push(BigInt(i));

  const meLc = me.toLowerCase();
  const mine: RealTask[] = [];

  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const rows = await Promise.all(
      chunk.map(
        (id) =>
          publicClient.readContract({
            address: ACTIVE_ESCROW_ADDRESS,
            abi: ACTIVE_ESCROW_ABI,
            functionName: 'tasks',
            args: [id],
          }) as Promise<RawTaskTuple>,
      ),
    );
    rows.forEach((row, j) => {
      const isClient = row.client.toLowerCase() === meLc;
      const isWorker = row.worker.toLowerCase() === meLc;
      if (!isClient && !isWorker) return;
      mine.push({
        id: chunk[j],
        client: row.client,
        worker: row.worker,
        amountWei: row.amount,
        taskHash: row.taskHash,
        resultHash: row.resultHash,
        deadline: row.deadline,
        createdAt: row.createdAt,
        status: Number(row.status),
        currency: row.currency ?? NATIVE_CURRENCY,
        role: isClient ? 'client' : 'worker',
      });
    });
    if (i + CHUNK < ids.length) await sleep(CHUNK_SLEEP_MS);
  }

  // deliveredAt solo para las mías en Delivered (pocas en la práctica).
  const delivered = mine.filter((tk) => tk.status === TASK_STATUS.Delivered);
  for (let i = 0; i < delivered.length; i += CHUNK) {
    const chunk = delivered.slice(i, i + CHUNK);
    const ts = await Promise.all(
      chunk.map(
        (tk) =>
          publicClient
            .readContract({
              address: ACTIVE_ESCROW_ADDRESS,
              abi: ACTIVE_ESCROW_ABI,
              functionName: 'deliveredAt',
              args: [tk.id],
            })
            .catch(() => 0n) as Promise<bigint>,
      ),
    );
    chunk.forEach((tk, j) => {
      tk.deliveredAt = ts[j];
    });
    if (i + CHUNK < delivered.length) await sleep(CHUNK_SLEEP_MS);
  }

  // Más recientes primero.
  return mine.sort((a, b) => (a.id > b.id ? -1 : a.id < b.id ? 1 : 0));
}

export interface MyTasks {
  tasks: RealTask[];
  loading: boolean;
  error: Error | null;
  refetch: () => void;
}

export function useMyTasks(): MyTasks {
  const { address, connected } = useWallet();
  const addr = (connected && address ? address : null) as Address | null;

  const query = useQuery({
    queryKey: ['my-tasks', activeChain.id, V2_ENABLED, addr],
    enabled: !!addr,
    queryFn: () => fetchMyTasks(addr as Address),
    staleTime: 10_000,
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
    retry: 1,
  });

  return {
    tasks: query.data ?? [],
    loading: !!addr && query.isLoading,
    error: query.isError ? (query.error as Error) : null,
    refetch: () => void query.refetch(),
  };
}
