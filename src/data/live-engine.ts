/**
 * Punto de entrada del feed en vivo (en-vivo.md).
 * Re-exporta el modelo y helpers de events.ts para estabilidad de imports.
 * Los eventos son reales on-chain: ver src/hooks/useOnchainEvents.ts.
 */
export type { LiveEvent, LiveEventType, PartyKind } from './events';
export { truncateHash, timeAgo } from './events';
