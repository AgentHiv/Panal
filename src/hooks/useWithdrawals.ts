/**
 * Panal — Retiros REALES del usuario (eventos Withdrawal de PanalEscrow).
 *
 * El RPC público limita eth_getLogs a rangos cortos (~100 bloques), así que
 * la ventana se auto-detecta: empieza en 5.000 bloques y se reduce a la
 * mitad cuando el RPC rechaza el rango (mismo patrón que useOnchainEvents).
 * Se barren como máximo 40 ventanas hacia atrás y se devuelven los 12
 * retiros más recientes con su timestamp (getBlock solo de los bloques
 * presentes, en lotes de 5).
 */

import { useQuery } from '@tanstack/react-query';
import { parseAbiItem } from 'viem';
import type { Address } from 'viem';
import { PANAL_ESCROW_ADDRESS, PANAL_ESCROW_V2_ADDRESS, V2_ENABLED, activeChain, publicClient } from '@/contracts/config';
import { useWallet } from '@/hooks/useWallet';

const WITHDRAWAL_EVENT = parseAbiItem('event Withdrawal(address indexed to, uint256 amount)');
const WITHDRAWAL_EVENT_V2 = parseAbiItem(
  'event Withdrawal(address indexed to, address indexed token, uint256 amount)',
);

const MAX_WINDOWS = 40;
const MAX_RESULTS = 12;

export interface WithdrawalItem {
  txHash: string;
  blockNumber: bigint;
  /** timestamp del bloque (s); 0 si no se pudo resolver */
  timestamp: number;
  amountWei: bigint;
}

interface RawLog {
  blockNumber: bigint;
  transactionHash: string;
  args: { amount?: bigint };
}

let maxRange = 5_000n;

function parseRangeLimit(err: unknown): bigint | null {
  const anyErr = err as { cause?: { message?: string }; message?: string };
  const msg = String(anyErr?.cause?.message ?? anyErr?.message ?? err);
  const m =
    msg.match(/limited to a ([\d,]+) range/i) ??
    msg.match(/(?:max(?:imum)?|limit(?:ed)?)[^\d]*([\d,]+)\s*blocks?/i);
  return m ? BigInt(m[1].replace(/,/g, '')) : null;
}

async function fetchWithdrawals(me: Address): Promise<WithdrawalItem[]> {
  const head = await publicClient.getBlockNumber();
  const logs: RawLog[] = [];
  let to = head;

  for (let w = 0; w < MAX_WINDOWS && to >= 0n; w++) {
    const from = to >= maxRange ? to - maxRange + 1n : 0n;
    let chunk: RawLog[];
    try {
      chunk = (await publicClient.getLogs({
        address: V2_ENABLED ? PANAL_ESCROW_V2_ADDRESS : PANAL_ESCROW_ADDRESS,
        event: V2_ENABLED ? WITHDRAWAL_EVENT_V2 : WITHDRAWAL_EVENT,
        args: { to: me },
        fromBlock: from,
        toBlock: to,
      })) as unknown as RawLog[];
    } catch (err) {
      const limit = parseRangeLimit(err);
      if (limit !== null && limit >= 1n && limit < maxRange) {
        maxRange = limit;
        continue; // misma ventana con el nuevo límite
      }
      if (limit === null && maxRange > 4n) {
        maxRange /= 2n;
        continue;
      }
      break; // RPC saturado: devolvemos lo acumulado
    }
    logs.push(...chunk);
    if (from === 0n || logs.length >= MAX_RESULTS) break;
    to = from - 1n;
  }

  const recent = logs
    .sort((a, b) => (a.blockNumber > b.blockNumber ? -1 : 1))
    .slice(0, MAX_RESULTS);

  // Timestamps solo de los bloques presentes (lotes de 5).
  const unique = [...new Set(recent.map((l) => l.blockNumber.toString()))];
  const ts = new Map<string, number>();
  for (let i = 0; i < unique.length; i += 5) {
    const batch = unique.slice(i, i + 5);
    const blocks = await Promise.all(
      batch.map((n) => publicClient.getBlock({ blockNumber: BigInt(n) }).catch(() => null)),
    );
    blocks.forEach((b, j) => {
      if (b) ts.set(batch[j], Number(b.timestamp));
    });
  }

  return recent.map((l) => ({
    txHash: l.transactionHash,
    blockNumber: l.blockNumber,
    timestamp: ts.get(l.blockNumber.toString()) ?? 0,
    amountWei: l.args.amount ?? 0n,
  }));
}

export interface MyWithdrawals {
  withdrawals: WithdrawalItem[];
  loading: boolean;
  error: Error | null;
  refetch: () => void;
}

export function useWithdrawals(): MyWithdrawals {
  const { address, connected } = useWallet();
  const addr = (connected && address ? address : null) as Address | null;

  const query = useQuery({
    queryKey: ['my-withdrawals', activeChain.id, addr],
    enabled: !!addr,
    queryFn: () => fetchWithdrawals(addr as Address),
    staleTime: 30_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    retry: 1,
  });

  return {
    withdrawals: query.data ?? [],
    loading: !!addr && query.isLoading,
    error: query.isError ? (query.error as Error) : null,
    refetch: () => void query.refetch(),
  };
}
