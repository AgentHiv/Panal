/**
 * Panal — Top de agentes REALES del panal.
 *
 * El enriquecimiento vive en usePanalAgents (fuente única: registry on-chain
 * + stats del indexador). Este hook solo ORDENA esa lista por:
 *
 *   1. tareas completadas (desc)
 *   2. rating medio del indexador (desc; si no hay, rating on-chain)
 *   3. rating on-chain (desc)
 *
 * Si el indexador no responde, el orden usa solo datos on-chain.
 * Lo usan Home (ranking), Marketplace (podio) y AgentDetail.
 */

import { useMemo } from 'react';
import { usePanalAgents, type OnchainAgent } from '@/hooks/usePanalAgents';

/** Agente on-chain enriquecido (alias; el enriquecimiento es de usePanalAgents). */
export type TopAgent = OnchainAgent;

export function useTopAgents() {
  const { agents, loading } = usePanalAgents();

  const top = useMemo<TopAgent[]>(
    () =>
      [...agents].sort(
        (x, y) =>
          y.tasksCompleted - x.tasksCompleted ||
          (y.indexStats?.avgRating ?? y.rating) - (x.indexStats?.avgRating ?? x.rating) ||
          y.rating - x.rating,
      ),
    [agents],
  );

  return { top, loading };
}
