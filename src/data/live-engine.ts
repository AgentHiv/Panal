/**
 * Punto de entrada del motor del feed en vivo (en-vivo.md).
 * Re-exporta el modelo y el generador de events.ts para estabilidad de imports.
 */
export type { LiveEvent, LiveEventType, PartyKind } from './events';
export {
  generateLiveEvent,
  randomTxHash,
  truncateHash,
  timeAgoEs,
  MINI_FEED_SEED,
} from './events';
