/**
 * Lo que comparten las secciones de la página de cik y no es un componente:
 * colores por clase, formatos de MON y de porcentajes, y la validación de lo
 * que se pega. Aparte de los componentes porque el refresco en caliente de Vite
 * solo funciona en archivos que exportan componentes y nada más.
 */

import { formatEther, isAddress, isHex, type Address, type Hex } from 'viem';
import { CLASES } from '@/lib/cik';

/** Pastilla de cada clase: verde ok, terracota lo malicioso, miel lo dudoso. */
export const TONO_CLASE: Record<(typeof CLASES)[number], string> = {
  ok: 'border-olive/40 bg-olive/10 text-olive',
  drainer: 'border-terra/40 bg-terra/10 text-terra',
  honeypot: 'border-terra/40 bg-terra/10 text-terra',
  sospechoso: 'border-honey/50 bg-honey-soft text-honey-deep',
};

/** «8», «0.01», «2.75»: MON con cuatro decimales como mucho y sin ceros de cola. */
export function mon(wei: bigint, decimales = 4): string {
  const n = Number(formatEther(wei));
  return n.toLocaleString('en-US', { maximumFractionDigits: decimales, useGrouping: false });
}

/** Puntos básicos a porcentaje legible: 10000 → «100 %», 9950 → «99.5 %». */
export function porcentaje(bps: bigint | number): string {
  const n = Number(bps) / 100;
  return `${n.toLocaleString('en-US', { maximumFractionDigits: 2 })} %`;
}

/** Lo que se pega en el campo: una dirección, sin espacios ni comillas alrededor. */
export function direccionPegada(texto: string): Address | null {
  const t = texto.trim().replace(/^["'`]|["'`]$/g, '');
  return isAddress(t, { strict: false }) ? (t as Address) : null;
}

/** Bytecode pegado: hexadecimal con 0x, par de cifras, sin espacios ni saltos. */
export function codigoPegado(texto: string): Hex | null {
  const t = texto.replace(/\s+/g, '').toLowerCase();
  if (!t.startsWith('0x') || t.length < 4 || t.length % 2 !== 0 || !isHex(t)) return null;
  return t as Hex;
}

/** Ejemplos para probar con un clic: el token de Panal, una estable, el MON envuelto y un honeypot. */
export const EJEMPLOS: { nombre: string; direccion: Address }[] = [
  { nombre: '$PANAL', direccion: '0x2e2e44e7fa6178822d4397299f719e89d1a67777' },
  { nombre: 'USDC', direccion: '0x754704Bc059F8C67012fEd69BC8A327a5aafb603' },
  { nombre: 'WMON', direccion: '0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A' },
  { nombre: 'MONAD PRINTER', direccion: '0x947979029e1fb1FC5E133adC65B7881605B60B01' },
];
