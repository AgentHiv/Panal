/**
 * Panal — los encargos de ejemplo de la ficha de un agente, para el bot.
 *
 * Un agente puede proponer hasta tres encargos de ejemplo dentro de su
 * `metadataURI`, como segmentos separados por «·»:
 *
 *     Lint · Revisa código · solidity · bot:https://… · ejemplo:Revisa este contrato ERC-20
 *
 * Aquí hace falta RECONOCERLOS en los mismos sitios que los niveles —el
 * indexador que arma el catálogo, `/agent.json` y el buzón que arman la ficha,
 * y el MCP que se la enseña a Claude—, porque un segmento que no se aparte
 * corre las posiciones y el ejemplo acabaría anunciado como skill.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * EL FORMATO LO MANDA `sdk/src/ejemplos.ts`. Esto es una copia de la parte de
 * lectura, porque el bot no depende de aquel paquete —igual que `niveles.ts`,
 * `tipo.ts` y `marca.ts`—. Si allí cambia el formato, hay que cambiarlo aquí.
 * `scripts/test-ejemplos.ts` comprueba que los dos lean lo mismo.
 * ─────────────────────────────────────────────────────────────────────────
 */

/** Cuántos se leen. Los mismos que caben en el formulario. */
const MAX_EJEMPLOS = 3;

/** Tope de cada uno, en caracteres. */
const MAX_EJEMPLO = 140;

/** La clave exacta: en minúsculas y pegada al texto. Ver el SDK por qué. */
const CLAVE = 'ejemplo:';

/** `ejemplo:Revisa esto` → `'Revisa esto'`, o `null` si no es un ejemplo. */
export function leerEjemploDeSegmento(segmento: string): string | null {
  const s = segmento.trim();
  if (!s.startsWith(CLAVE)) return null;
  const resto = s.slice(CLAVE.length);
  if (!resto || /^\s/.test(resto)) return null;
  const texto = resto.replace(/\s+/g, ' ').trim().slice(0, MAX_EJEMPLO);
  return texto || null;
}

export function esTokenDeEjemplo(segmento: string): boolean {
  return leerEjemploDeSegmento(segmento) !== null;
}

/** Los ejemplos de la ficha on-chain, en orden y sin repetidos. `[]` es lo normal. */
export function leerEjemplosDeMetadata(metadataURI: string | null | undefined): string[] {
  if (!metadataURI) return [];
  const out: string[] = [];
  for (const segmento of metadataURI.split('·')) {
    if (out.length >= MAX_EJEMPLOS) break;
    const ejemplo = leerEjemploDeSegmento(segmento);
    if (ejemplo && !out.includes(ejemplo)) out.push(ejemplo);
  }
  return out;
}
