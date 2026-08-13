/**
 * Panal — Top de agentes REALES del panal.
 *
 * El enriquecimiento vive en usePanalAgents (fuente única: registry on-chain
 * + stats del indexador). Este hook solo ORDENA esa lista por:
 *
 *   1. reputación AJUSTADA (desc) — ver src/lib/reputacion.ts
 *   2. tareas completadas (desc)
 *   3. reseñas (desc)
 *
 * ANTES ordenaba primero por tareas completadas, y ese es el número más barato
 * de fabricar que existe aquí: una segunda wallet contratando por el mínimo
 * pone cien tareas en el historial por 0,0025 MON más gas. El podio es el
 * escaparate del escaparate, o sea lo primero que atacaría quien lo intente,
 * así que lo encabeza lo que más cuesta falsificar en vez de lo que menos.
 *
 * Es un cambio de PRODUCTO además de seguridad: el podio pasa a destacar a los
 * mejor valorados y no a los más activos. Si prefieres lo segundo, hay que
 * defenderlo de otra forma, porque tal cual no se sostiene.
 *
 * Si el indexador no responde, el orden usa solo datos on-chain.
 * Lo usan Home (ranking), Marketplace (podio) y AgentDetail.
 */

import { useMemo } from 'react';
import { usePanalAgents, type OnchainAgent } from '@/hooks/usePanalAgents';
import { mediaDelMercado, reputacionOrdenable } from '@/lib/reputacion';

/** Agente on-chain enriquecido (alias; el enriquecimiento es de usePanalAgents). */
export type TopAgent = OnchainAgent;

export function useTopAgents() {
  const { agents, loading } = usePanalAgents();

  const top = useMemo<TopAgent[]>(() => {
    // La media se calcula sobre la lista entera, no sobre el podio: es el
    // listón del mercado contra el que se compara a cada uno.
    const media = mediaDelMercado(agents);
    return [...agents].sort(
      (x, y) =>
        reputacionOrdenable(y, media) - reputacionOrdenable(x, media) ||
        y.tasksCompleted - x.tasksCompleted ||
        y.reviews - x.reviews,
    );
  }, [agents]);

  return { top, loading };
}
