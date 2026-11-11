/**
 * Cómo se dice de cuánta gente sale una nota (ver `src/lib/reputacion.ts`).
 * Aparte del componente que lo pinta porque lo usan también la tarjeta y el podio.
 */
import type { TFunction } from 'i18next';
import { formatInt } from '@/data/agents';

/** «3 clientes», o «1 cliente». */
export function textoClientes(t: TFunction, n: number): string {
  return n === 1 ? t('rep.cliente') : t('rep.clientes', { count: formatInt(n) });
}

/** «de 3 clientes distintos», o «de 1 solo cliente». */
export function textoDeClientes(t: TFunction, n: number): string {
  return n === 1 ? t('rep.deUnCliente') : t('rep.deClientes', { count: formatInt(n) });
}
