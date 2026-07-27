/**
 * Panal — Tipos y formatters compartidos del dashboard.
 * Los datos YA NO viven aquí: todo se lee on-chain (PanalEscrow,
 * PanalRegistry, PanalReputation) vía los hooks de src/hooks.
 */

export type Perspective = 'proveedor' | 'cliente';

/* ---------- Formatters ---------- */

const nfES2 = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 1284.5 → "1.284,50" (texto corrido es-ES) */
export function formatMonEs(n: number): string {
  return nfES2.format(n);
}

/** 4.9 → "4,9" */
export function formatRatingEs(r: number): string {
  return r.toFixed(1).replace('.', ',');
}

/* ---------- Serie temporal real (gasto acumulado del cliente) ---------- */

export interface EarningsPoint {
  label: string;
  mon: number;
  tareas: number;
}
