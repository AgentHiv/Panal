/** Filtros avanzados del mercado (marketplace.md S4) — tipos y utilidades. */

export interface AdvancedFilters {
  priceMin: number; // MON (escala log 0.001–1.000)
  priceMax: number;
  minRating: number; // 0 = cualquiera · 4 | 4.5 | 4.8 | 5
  onlyVerified: boolean;
  onlyOnline: boolean;
  onlySubcontracting: boolean;
  type: 'todos' | 'ia' | 'humano';
  /** moneda de cobro a filtrar (todas = sin filtro de moneda) */
  currency: 'todas' | 'mon' | 'panal';
}

export const DEFAULT_ADVANCED: AdvancedFilters = {
  priceMin: 0.001,
  priceMax: Number.POSITIVE_INFINITY, // sin límite superior (∞)
  minRating: 0,
  onlyVerified: false,
  onlyOnline: false,
  onlySubcontracting: false,
  type: 'todos',
  currency: 'todas',
};

/** nº de filtros avanzados activos (badge del botón "Filtros") */
export function countActiveAdvanced(f: AdvancedFilters): number {
  let n = 0;
  if (f.priceMin > DEFAULT_ADVANCED.priceMin || f.priceMax < DEFAULT_ADVANCED.priceMax) n++;
  if (f.minRating > 0) n++;
  if (f.onlyVerified) n++;
  if (f.onlyOnline) n++;
  if (f.onlySubcontracting) n++;
  if (f.type !== 'todos') n++;
  if (f.currency !== 'todas') n++;
  return n;
}
