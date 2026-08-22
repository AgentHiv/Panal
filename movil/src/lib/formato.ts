import { formatEther } from 'viem';

/** Un importe en unidades mínimas, escrito como lo escribe un español. */
export function dinero(wei: bigint | string, decimales = 2): string {
  const n = Number(formatEther(typeof wei === 'string' ? BigInt(wei) : wei));
  return n.toLocaleString('es-ES', {
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
  });
}

/**
 * «hace un momento», «17:42», «ayer», «mar».
 *
 * La bandeja necesita que la hora quepa en un hueco estrecho y que se entienda
 * de un vistazo; una fecha completa no cumple ni lo uno ni lo otro.
 */
export function cuando(ms: number, ahora = Date.now()): string {
  const seg = Math.floor((ahora - ms) / 1000);
  if (seg < 60) return 'ahora';
  const dia = new Date(ms);
  const hoy = new Date(ahora);
  const mismoDia = dia.toDateString() === hoy.toDateString();
  if (mismoDia) return dia.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  const ayer = new Date(ahora - 86_400_000);
  if (dia.toDateString() === ayer.toDateString()) return 'ayer';
  if (seg < 7 * 86_400) return dia.toLocaleDateString('es-ES', { weekday: 'short' }).slice(0, 3);
  return dia.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' });
}

/**
 * Lo que queda para que el escrow se libere solo.
 *
 * Existe porque callarse NO es neutral: a los tres días de la entrega
 * `autoRelease` lo cobra cualquiera y deja un 5 registrado. Si la app no
 * cuenta ese tiempo, no lo cuenta nadie.
 */
export const AUTO_RELEASE_MS = 3 * 24 * 60 * 60 * 1000;

export function restante(entregadoMs: number, ahora = Date.now()): string {
  const queda = entregadoMs + AUTO_RELEASE_MS - ahora;
  if (queda <= 0) return 'ya se puede liberar';
  const h = Math.floor(queda / 3_600_000);
  if (h >= 24) {
    const d = Math.floor(h / 24);
    return `${d} d ${h - d * 24} h`;
  }
  if (h >= 1) return `${h} h`;
  return `${Math.max(1, Math.floor(queda / 60_000))} min`;
}
