/**
 * Panal — Eventos del feed en vivo (en-vivo.md, home.md S1/S5).
 * Tipos + helpers de presentación. Los eventos del feed, el mini-feed y el
 * ticker son REALES on-chain (src/hooks/useOnchainEvents.ts, leídos del indexador).
 */

export type LiveEventType = 'contratacion' | 'pago' | 'registro' | 'entrega' | 'disputa';
/**
 * Quién hay detrás de una dirección:
 *   - agente   un programa registrado en el mercado;
 *   - persona  una persona registrada (`tipo:persona` en su ficha);
 *   - humano   una wallet sin ficha: casi siempre, quien contrata.
 */
export type PartyKind = 'agente' | 'persona' | 'humano';

/** La clave de i18n del distintivo de cada relación (ver `relation`). */
export const RELATION_KEYS: Record<string, string> = {
  'agente↔agente': 'live.relation.agentAgent',
  'humano→agente': 'live.relation.humanAgent',
  'humano→persona': 'live.relation.humanPerson',
  'agente→persona': 'live.relation.agentPerson',
};

export interface LiveEvent {
  id: string;
  type: LiveEventType;
  from: string;
  fromKind: PartyKind;
  /** La dirección entera de `from`: con la recortada no se sabe quién es. */
  fromAddress?: string;
  to?: string;
  toKind?: PartyKind;
  toAddress?: string;
  task?: string;
  amount?: number; // en la unidad de `currency`
  /** v2: moneda del monto (token address). undefined = MON nativo */
  currency?: string;
  txHash: string;
  /** segundos desde que ocurrió (los timers lo incrementan en vivo) */
  secondsAgo: number;
  /** badge de relación, p. ej. "agente↔agente" (claves en RELATION_KEYS) */
  relation?: string;
}

export interface TickerItem {
  hash: string;
  actor: string;
  target: string;
  task: string;
  amount: string; // "0.010 MON"
  time: string; // "hace 12 s"
}

/* ---------- Hashes ---------- */

/** "0x3f9a…c21e" */
export function truncateHash(hash: string): string {
  if (hash.length <= 12) return hash;
  return `${hash.slice(0, 6)}…${hash.slice(-4)}`;
}

type TFn = (key: string, opts?: Record<string, unknown>) => string;

/** "hace 4s" / "hace 2 min" / "hace 1 h" (localizado vía i18n) */
export function timeAgo(seconds: number, t: TFn): string {
  if (seconds < 5) return t('common.timeAgo.now');
  if (seconds < 60) return t('common.timeAgo.seconds', { count: Math.floor(seconds) });
  const m = Math.floor(seconds / 60);
  if (m < 60) return t('common.timeAgo.minutes', { count: m });
  const h = Math.floor(m / 60);
  return t('common.timeAgo.hours', { count: h });
}
