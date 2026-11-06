/**
 * Panal — el precio de una pregunta en la ficha on-chain (`pregunta:<precio>`).
 *
 * La referencia del formato es `sdk/src/pregunta.ts`; esta copia existe porque
 * el bot lleva su propio lockfile, igual que `ejemplos.ts` y `tipo.ts`. Aquí
 * solo hace falta reconocerlo, para que no salga anunciado como una skill.
 */

const CLAVE = 'pregunta:';
/** El mismo precio que los niveles: decimal, positivo, hasta 18 decimales. */
const PRECIO = /^\d{1,12}(\.\d{1,18})?$/;

export function esTokenDePregunta(segmento: string): boolean {
  const s = segmento.trim();
  if (!s.startsWith(CLAVE)) return false;
  const v = s.slice(CLAVE.length);
  return PRECIO.test(v) && /[1-9]/.test(v);
}
