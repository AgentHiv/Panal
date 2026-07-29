/**
 * Panal — Top tareas por monto (escrow ACTIVO: v2 tras la migración).
 * Escanea las últimas ~100 tareas on-chain (chunks suaves por el rate limit
 * del RPC público) y devuelve las 5 de mayor valor para la tabla "Big moves"
 * de /en-vivo. Sin mocks: si no hay tareas, devuelve lista vacía.
 */

import { useQuery } from '@tanstack/react-query';
import {
  PANAL_ESCROW_ADDRESS,
  PANAL_ESCROW_V2_ADDRESS,
  V2_ENABLED,
  publicClient,
} from '@/contracts/config';
import { panalEscrowAbi, panalEscrowV2Abi } from '@/contracts/abis';

const ESCROW = V2_ENABLED ? PANAL_ESCROW_V2_ADDRESS : PANAL_ESCROW_ADDRESS;
const ESCROW_ABI = V2_ENABLED ? panalEscrowV2Abi : panalEscrowAbi;

const SCAN_LAST = 100; // últimas N tareas como máximo
const CHUNK = 5;
const CHUNK_SLEEP_MS = 300;

export interface TopTask {
  id: bigint;
  client: string;
  worker: string;
  amountWei: bigint;
  taskHash: string;
  createdAt: bigint;
  /** v2: moneda (address(0) = MON) */
  currency?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface RawTask {
  client: string;
  worker: string;
  amount: bigint;
  taskHash: string;
  createdAt: bigint;
  currency?: string;
}

async function fetchTopTasks(limit: number): Promise<TopTask[]> {
  const count = (await publicClient.readContract({
    address: ESCROW,
    abi: ESCROW_ABI,
    functionName: 'getTaskCount',
  })) as bigint;

  if (count === 0n) return [];

  const start = count > BigInt(SCAN_LAST) ? count - BigInt(SCAN_LAST) : 0n;
  const ids: bigint[] = [];
  for (let i = start; i < count; i += 1n) ids.push(i);

  const tasks: TopTask[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = await Promise.all(
      ids.slice(i, i + CHUNK).map(async (id) => {
        try {
          const t = (await publicClient.readContract({
            address: ESCROW,
            abi: ESCROW_ABI,
            functionName: 'tasks',
            args: [id],
          })) as RawTask;
          return {
            id,
            client: t.client,
            worker: t.worker,
            amountWei: t.amount,
            taskHash: t.taskHash,
            createdAt: t.createdAt,
            currency: t.currency,
          } satisfies TopTask;
        } catch {
          return null;
        }
      }),
    );
    for (const t of chunk) if (t) tasks.push(t);
    if (i + CHUNK < ids.length) await sleep(CHUNK_SLEEP_MS);
  }

  return tasks.sort((a, b) => (b.amountWei > a.amountWei ? 1 : -1)).slice(0, limit);
}

export function useTopTasks(limit = 5) {
  return useQuery({
    queryKey: ['top-tasks', ESCROW, limit],
    queryFn: () => fetchTopTasks(limit),
    refetchInterval: 30_000,
    staleTime: 15_000,
    retry: 2,
  });
}
