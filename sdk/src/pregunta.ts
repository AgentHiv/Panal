/**
 * Panal — el precio de una pregunta, en el `metadataURI` on-chain.
 *
 * Una persona puede cobrar por contestar una pregunta antes de que la
 * contraten. No es un chat abierto: es un encargo pequeño, pagado por
 * adelantado en el escrow como cualquier otro, con un plazo corto. Si contesta,
 * contesta como entrega; si no contesta a tiempo, el cliente cancela y el
 * escrow le devuelve todo. Así preguntar cuesta lo que la persona diga, nadie
 * escribe gratis a un desconocido, y quien paga no pierde nada si no le
 * contestan.
 *
 * EL FORMATO
 *
 *     pregunta:<precio>
 *
 * Un segmento más de la ficha, con el precio en unidades enteras de la moneda
 * del agente («0.5»), como los niveles. Solo cuenta si el valor es un precio
 * válido: «pregunta: ¿qué haces?» dentro de una descripción sigue siendo
 * descripción, no un precio.
 */

import { precioAWei, weiAPrecio } from './niveles.js';

const CLAVE = 'pregunta:';

/** El plazo de una pregunta: lo que tiene la persona para contestar antes de que se pueda cancelar. */
export const PLAZO_DE_PREGUNTA_HORAS = 24;
/** Lo que cabe en una pregunta. Para algo más largo está el encargo de verdad. */
export const MAX_PREGUNTA_CHARS = 1000;

/** El precio de un segmento `pregunta:…`, normalizado («0.50» → «0.5»), o null. */
export function leerPreguntaDeSegmento(segmento: string): string | null {
  const s = segmento.trim();
  if (!s.startsWith(CLAVE)) return null;
  const valor = s.slice(CLAVE.length);
  // Con espacio tras los dos puntos es prosa, no un token, como en los ejemplos.
  if (!valor || /^\s/.test(valor)) return null;
  const wei = precioAWei(valor);
  return wei === null ? null : weiAPrecio(wei);
}

export function esTokenDePregunta(segmento: string): boolean {
  return leerPreguntaDeSegmento(segmento) !== null;
}

/** El precio de una pregunta de esta ficha, o null si no contesta preguntas. */
export function leerPrecioDePregunta(metadataURI: string | null | undefined): string | null {
  if (!metadataURI) return null;
  for (const segmento of metadataURI.split('·')) {
    const precio = leerPreguntaDeSegmento(segmento);
    if (precio) return precio;
  }
  return null;
}

/** El segmento que se escribe en la ficha, o null si el precio no vale. */
export function componerPregunta(precio: string): string | null {
  const wei = precioAWei(precio);
  return wei === null ? null : `${CLAVE}${weiAPrecio(wei)}`;
}
