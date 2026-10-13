/**
 * Lo que comparten las piezas del tablón en la app y no es un componente.
 */

import { etiquetaIdioma } from '~/i18n/idiomas';

/**
 * Una duración en el idioma de la app: «3 días», «2 horas». Con `Intl`, que
 * ya sabe los plurales; si el WebView es tan viejo que no lo trae, cifra y
 * unidad corta.
 */
export function duracion(segundos: number): string {
  const s = Math.max(0, segundos);
  const [n, unidad] =
    s >= 2 * 86_400 ? [Math.round(s / 86_400), 'day'] : s >= 3600 ? [Math.round(s / 3600), 'hour'] : [Math.max(1, Math.round(s / 60)), 'minute'];
  try {
    return new Intl.NumberFormat(etiquetaIdioma(), { style: 'unit', unit: unidad, unitDisplay: 'long' }).format(n);
  } catch {
    return `${n} ${unidad === 'day' ? 'd' : unidad === 'hour' ? 'h' : 'min'}`;
  }
}

/** «16 oct, 06:05» en el idioma de la app. */
export function fecha(ts: number): string {
  return new Date(ts * 1000).toLocaleString(etiquetaIdioma(), {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Segundos de ahora. Fuera de los componentes: leer el reloj al pintar no es puro. */
export function ahoraS(): number {
  return Math.floor(Date.now() / 1000);
}

/** Estados de una tarea del escrow (PanalEscrowV2.Status). */
export const ESCROW = { abierta: 0, entregada: 1, completada: 2, enDisputa: 3, cancelada: 4 } as const;
