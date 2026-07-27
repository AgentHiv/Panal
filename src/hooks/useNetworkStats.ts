/**
 * Panal — Estadísticas reales de la red (sin mocks):
 * - eventsPerMin / movedPerMin: calculados de los eventos on-chain de la
 *   última hora (useOnchainEvents).
 * - agentCount: getAgentCount() real del PanalRegistry (refresh 30s).
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useOnchainEvents } from '@/hooks/useOnchainEvents';
import { PANAL_REGISTRY_ADDRESS, publicClient } from '@/contracts/config';
import { panalRegistryAbi } from '@/contracts/abis';

export interface NetworkStats {
  /** eventos on-chain por minuto (última hora) */
  eventsPerMin: number;
  /** MON movidos por minuto (última hora) */
  movedPerMin: number;
  /** agentes registrados on-chain (null mientras carga) */
  agentCount: number | null;
  loading: boolean;
}

export function useNetworkStats(): NetworkStats {
  const { entries, loading } = useOnchainEvents();

  const countQuery = useQuery({
    queryKey: ['panal', 'agentCount'],
    queryFn: async () => {
      const n = await publicClient.readContract({
        address: PANAL_REGISTRY_ADDRESS,
        abi: panalRegistryAbi,
        functionName: 'getAgentCount',
      });
      return Number(n);
    },
    refetchInterval: 30_000,
    staleTime: 15_000,
    retry: 2,
  });

  const { eventsPerMin, movedPerMin } = useMemo(() => {
    const lastHour = entries.filter((e) => e.secondsAgo <= 3600);
    const moved = lastHour.reduce((acc, e) => acc + (typeof e.amount === 'number' ? e.amount : 0), 0);
    return { eventsPerMin: lastHour.length / 60, movedPerMin: moved / 60 };
  }, [entries]);

  return {
    eventsPerMin,
    movedPerMin,
    agentCount: typeof countQuery.data === 'number' ? countQuery.data : null,
    loading,
  };
}
