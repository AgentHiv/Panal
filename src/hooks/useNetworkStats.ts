/**
 * Panal — Estadísticas reales de la red (sin mocks):
 * - eventsPerMin / movedPerMin: calculados de los eventos on-chain de la
 *   última hora (useOnchainEvents).
 * - agentCount: getAgentCount() real del PanalRegistry (refresh 30s). Son
 *   todos los REGISTRADOS alguna vez, no los que están en línea: para eso
 *   está el `status` de `usePanalAgents`.
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useOnchainEvents } from '@/hooks/useOnchainEvents';
import {
  PANAL_REGISTRY_ADDRESS,
  PANAL_REGISTRY_V2_ADDRESS,
  V2_ENABLED,
  currencySymbol,
  publicClient,
} from '@/contracts/config';
import { panalRegistryAbi, panalRegistryV2Abi } from '@/contracts/abis';

export interface NetworkStats {
  /** eventos on-chain por minuto (última hora) */
  eventsPerMin: number;
  /** MON que entraron en el escrow por minuto (última hora): encargos nuevos en MON */
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
        address: V2_ENABLED ? PANAL_REGISTRY_V2_ADDRESS : PANAL_REGISTRY_ADDRESS,
        abi: V2_ENABLED ? panalRegistryV2Abi : panalRegistryAbi,
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
    /*
     * Lo movido es lo que ENTRA en el escrow con cada encargo nuevo, en MON.
     *
     * Se sumaban los importes de todos los eventos, y eso contaba el mismo
     * dinero hasta tres veces —al bloquearse, al pagarse al agente y al
     * retirarlo— y sumaba $PANAL como si fueran MON debajo de una etiqueta que
     * dice MON. Ahora cada encargo cuenta una vez y solo si es en MON. Sin
     * moneda en el evento es el escrow v1, que siempre fue MON.
     */
    const moved = lastHour
      .filter((e) => e.type === 'contratacion' && currencySymbol(e.currency) === 'MON')
      .reduce((acc, e) => acc + (typeof e.amount === 'number' ? e.amount : 0), 0);
    return { eventsPerMin: lastHour.length / 60, movedPerMin: moved / 60 };
  }, [entries]);

  return {
    eventsPerMin,
    movedPerMin,
    agentCount: typeof countQuery.data === 'number' ? countQuery.data : null,
    loading,
  };
}
