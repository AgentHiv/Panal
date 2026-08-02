/**
 * Panal — Tipos del modelo de agente + formatters de presentación.
 * YA NO hay catálogo mock: los agentes son siempre reales on-chain
 * (PanalRegistry vía src/hooks/usePanalAgents.ts, stats del indexador vía
 * src/lib/indexer.ts). Este archivo solo conserva la interfaz `Agent`,
 * las etiquetas de categoría/estado y los formatters es-ES.
 */

export type AgentCategory =
  | 'datos'
  | 'texto'
  | 'codigo'
  | 'vision'
  | 'legal'
  | 'defi'
  | 'creativo'
  | 'humanos';

export type AgentType = 'ia' | 'humano';
export type AgentStatus = 'en-linea' | 'ocupado' | 'desconectado';

export interface AgentService {
  name: string;
  price: number; // MON
  description: string;
}

export interface Agent {
  id: string; // slug usado en /agente/:id (agentes on-chain: `onchain-<address>`)
  name: string;
  category: AgentCategory;
  type: AgentType;
  tagline: string;
  description: string;
  pricePerTask: number; // en la unidad de `currency` (MON por defecto)
  /** v2: moneda de cobro (address del token $PANAL). Ausente/undefined = MON. */
  currency?: string;
  rating: number; // 0–5
  reviews: number;
  tasksCompleted: number;
  avgResponse: string; // "12s" · "2h"
  avgResponseSec: number;
  successRate: number; // %
  status: AgentStatus;
  verified: boolean;
  acceptsSubcontracting: boolean;
  wallet: string;
  walletShort: string;
  skills: string[];
  totalEarned: number; // MON
  memberSince: string; // "nov 2025"
  volume24h: number; // MON — tamaño de nodo en el enjambre
  trend7d: number[]; // sparkline 7 días
  services?: AgentService[];
}

/** Claves i18n por categoría — traducir con t(CATEGORY_LABELS[cat]) */
export const CATEGORY_LABELS: Record<AgentCategory, string> = {
  datos: 'categories.datos',
  texto: 'categories.texto',
  codigo: 'categories.codigo',
  vision: 'categories.vision',
  legal: 'categories.legal',
  defi: 'categories.defi',
  creativo: 'categories.creativo',
  humanos: 'categories.humanos',
};

/** Claves i18n por estado — traducir con t(STATUS_LABELS[status]) */
export const STATUS_LABELS: Record<AgentStatus, string> = {
  'en-linea': 'status.enLinea',
  ocupado: 'status.ocupado',
  desconectado: 'status.desconectado',
};

/* ---------- Formatters es-ES (design.md §8) ---------- */

const nfES = new Intl.NumberFormat('es-ES');

/** 12847 → "12.847" */
export function formatInt(n: number): string {
  return nfES.format(Math.round(n));
}

/** Rating: 4.9 → "4,9" (coma decimal en texto corrido) */
export function formatRating(r: number): string {
  return r.toFixed(1).replace('.', ',');
}

/** Precio cripto en MON: convención de punto decimal (0.015) */
export function formatMon(amount: number, decimals = 3): string {
  const s = amount.toFixed(decimals);
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
}

/** "0.15 MON/tarea" */
export function formatPricePerTask(amount: number): string {
  return `${formatMon(amount)} MON/tarea`;
}
