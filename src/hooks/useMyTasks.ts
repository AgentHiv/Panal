/**
 * Panal — Mis tareas REALES on-chain (PanalEscrow).
 *
 * CUÁLES son tuyas lo dice el indexador; QUÉ dicen, la cadena.
 *
 * Antes se resolvían las dos preguntas escaneando el escrow: leer las 200
 * últimas tareas y quedarse con las que te nombran. Con 200 tareas en total
 * funcionaba, y a partir de ahí quien contrató ayer DEJABA DE VER LA SUYA — no
 * podía aprobarla, ni disputarla, ni descargar su resultado, y a las 72 h el
 * pago se liberaba solo sin que se hubiera enterado.
 *
 * Ahora el indexador devuelve la lista de ids que te nombran, completa y sin
 * ventana, y de la cadena se leen SOLO esos. Se pasa de 200 lecturas fijas a
 * tantas como tareas tengas.
 *
 * Los datos siguen saliendo de la cadena y no del indexador, y no es por
 * desconfianza: sus eventos no traen `deadline`, `taskHash` ni `deliveredAt`,
 * que es justo lo que hace falta para saber si puedes cancelar, si el texto
 * que recibes es el que encargaste y cuándo se libera el pago solo.
 *
 * Y dos cosas que hay que respetar:
 *
 *   - El indexador va 15 s por detrás. Una tarea recién creada todavía no está
 *     en su lista, así que se le suma SIEMPRE una ventana corta del final del
 *     escrow. Sin eso, contratas y tu tarea no aparece.
 *   - Si el indexador no responde, se vuelve al escaneo de antes. Peor, pero
 *     nunca un panel en blanco: es la pantalla donde la gente va a cobrar.
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
import { fetchTaskIdsOf } from '@/lib/indexer';

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
/** Tope del escaneo de respaldo, cuando el indexador no responde. */
const MAX_TASKS_SCAN = 200;

/**
 * Cuántas tareas del final del escrow se miran SIEMPRE, además de las que
 * diga el indexador.
 *
 * Cubre su retraso: sondea cada 15 s, así que una tarea recién creada aún no
 * está en su lista. 25 son varios minutos de mercado incluso con actividad
 * alta, y cuestan 25 lecturas.
 */
const VENTANA_RECIENTE = 25;

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

  // Los ids que me nombran, según el indexador. null = no respondió, o va
  // tan atrasado que su lista estaría incompleta.
  const cabeza = await publicClient.getBlockNumber().catch(() => undefined);
  const delIndice = await fetchTaskIdsOf(me, cabeza);

  const aLeer = new Set<string>();
  if (delIndice !== null) {
    for (const id of delIndice) aLeer.add(id.toString());
    // Su lista va 15 s por detrás, así que se le suma el final del escrow: sin
    // esto, contratas y tu tarea recién creada no aparece en el panel.
    for (let i = Math.max(0, total - VENTANA_RECIENTE); i < total; i++) aLeer.add(String(i));
  } else {
    // Sin indexador se vuelve al escaneo de antes. Peor —solo ve las últimas
    // MAX_TASKS_SCAN— pero es mejor que dejar en blanco la pantalla donde la
    // gente aprueba y cobra.
    for (let i = Math.max(0, total - MAX_TASKS_SCAN); i < total; i++) aLeer.add(String(i));
  }

  const ids = [...aLeer]
    .map((x) => BigInt(x))
    // Un id que ya no existe en el escrow (indexador de otra red, o adelantado)
    // haría reventar la lectura del lote entero.
    .filter((id) => id < count)
    .sort((a, b) => (a > b ? 1 : a < b ? -1 : 0));

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
