/**
 * Panal — los encargos de ejemplo de un agente.
 *
 * Un token más de los que viven en el `metadataURI` on-chain, junto a `bot:`,
 * los de marca, los de nivel y el de tipo:
 *
 *     Lint · Revisa código · solidity · bot:https://… · ejemplo:Revisa este contrato ERC-20
 *
 * POR QUÉ EXISTE
 *
 * Al contratar, debajo de la caja del encargo salían cuatro ejemplos fijos
 * («Audita este contrato», «Resume este PDF»…) para CUALQUIER agente: a uno de
 * traducción le proponían auditar un contrato. Se quitaron. Lo que los
 * sustituye son los del propio agente, escritos por quien sabe qué hace.
 *
 * POR QUÉ EN LA CADENA Y NO SOLO EN LA FICHA DEL BOT
 *
 * Por lo mismo que los niveles (ver `niveles.ts`): así los escribe también
 * quien no programa —una persona que trabaja desde el buzón no tiene servidor
 * donde ponerlos—, se editan desde el panel o desde la app, y siguen ahí con
 * el bot caído. La ficha del bot los repite traducidos (`examples`), porque la
 * cadena guarda una sola versión y la traducción solo puede vivir allí.
 *
 * POR QUÉ LA CLAVE SE RECONOCE TAN ESTRICTA
 *
 * Un ejemplo es texto libre, así que no hay valor que validar como el precio
 * de un nivel. Lo que separa un token de una frase es la forma de la clave:
 * `ejemplo:` en minúsculas y pegada al texto, que es como la escribe
 * `componerEjemplo`. Una descripción que diga «Ejemplo: traduzco tu web» —con
 * mayúscula, o con espacio tras los dos puntos— se queda como descripción. Si
 * bastara con ver la palabra, esa frase desaparecería de la ficha de su dueño
 * y saldría como un botón.
 *
 * LO QUE UN EJEMPLO NO ES
 *
 * No es un encargo ya escrito que se pague tal cual. Al pulsarlo se copia en
 * la caja para que el cliente lo complete con lo suyo —el contrato, el texto,
 * los datos—, y lo que se ancla en la cadena es lo que el cliente envía.
 */

/** Cuántos ofrece el formulario, y cuántos se leen. Más no caben bajo la caja. */
export const EJEMPLOS_EDITABLES = 3;

/** Tope de cada ejemplo, en caracteres. Una frase, no un encargo. */
export const MAX_EJEMPLO = 140;

/** La clave tal y como se escribe. Ver arriba por qué se compara exacta. */
const CLAVE = 'ejemplo:';

/** Espacios colapsados y recortado: va a un botón de un escaparate. */
function limpiar(texto: string): string {
  return texto.replace(/\s+/g, ' ').trim();
}

/**
 * `ejemplo:Revisa este contrato` → `'Revisa este contrato'`, o `null` si el
 * segmento no es un ejemplo.
 *
 * Devolver `null` es lo normal: por aquí pasan TODOS los segmentos de la
 * ficha, incluida la descripción libre del agente.
 */
export function leerEjemploDeSegmento(segmento: string): string | null {
  const s = segmento.trim();
  if (!s.startsWith(CLAVE)) return null;
  const resto = s.slice(CLAVE.length);
  // Con espacio tras los dos puntos es prosa, no un token: ver arriba.
  if (!resto || /^\s/.test(resto)) return null;
  const texto = limpiar(resto).slice(0, MAX_EJEMPLO);
  return texto || null;
}

/** true si este segmento es un ejemplo. Para que los lectores de ficha lo aparten. */
export function esTokenDeEjemplo(segmento: string): boolean {
  return leerEjemploDeSegmento(segmento) !== null;
}

/**
 * Los ejemplos que un agente publica en la cadena, en el orden en que los
 * escribió. `[]` es lo normal.
 *
 * Los repetidos se quedan en uno: dos botones iguales no son dos ideas.
 */
export function leerEjemplosDeMetadata(metadataURI: string | null | undefined): string[] {
  if (!metadataURI) return [];
  const out: string[] = [];
  for (const segmento of metadataURI.split('·')) {
    if (out.length >= EJEMPLOS_EDITABLES) break;
    const ejemplo = leerEjemploDeSegmento(segmento);
    if (ejemplo && !out.includes(ejemplo)) out.push(ejemplo);
  }
  return out;
}

/**
 * Qué le pasa a lo que alguien escribe, para poder decírselo.
 *
 * `null` es que está bien o que está vacío. Un «·» partiría la ficha en dos y
 * el trozo de después saldría como una skill; demasiado largo se recortaría
 * sin avisar. En los dos casos se firmaría algo distinto de lo que su dueño
 * ve, así que se canta antes.
 */
export function falloDeEjemplo(texto: string): 'separador' | 'largo' | null {
  const t = limpiar(texto);
  if (!t) return null;
  if (t.includes('·')) return 'separador';
  if (t.length > MAX_EJEMPLO) return 'largo';
  return null;
}

/**
 * El texto → su segmento, o `null` si no se puede escribir tal cual.
 *
 * `null` en vez de arreglarlo: quien llama tiene que enseñar el error, no
 * firmar una ficha que su dueño no reconoce. Vacío también es `null`, y eso
 * es lo normal: el formulario enseña tres y casi nadie rellena las tres.
 */
export function componerEjemplo(texto: string): string | null {
  const t = limpiar(texto);
  if (!t || falloDeEjemplo(t) !== null) return null;
  return `${CLAVE}${t}`;
}

/**
 * Los ejemplos de la ficha que sirve el agente (`examples`), ya saneados.
 *
 * Esa ficha la escribe un servidor ajeno: se aceptan solo cadenas, se limpian
 * y se recortan, y se leen como mucho los mismos que caben en la cadena.
 */
export function leerEjemplos(card: unknown): string[] {
  const lista = (card as { examples?: unknown } | null)?.examples;
  if (!Array.isArray(lista)) return [];
  const out: string[] = [];
  for (const e of lista) {
    if (out.length >= EJEMPLOS_EDITABLES) break;
    if (typeof e !== 'string') continue;
    const t = limpiar(e).slice(0, MAX_EJEMPLO);
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

/**
 * Los de la cadena, con el texto —traducido— de la ficha cuando cuadra.
 *
 * La cadena guarda una sola versión, en el idioma de su dueño. La ficha que
 * sirve el agente los repite traducidos al idioma pedido, en el mismo orden.
 * Se usan los de la ficha solo si son LOS MISMOS en número: si no cuadran, la
 * ficha está desfasada respecto a la cadena (el agente la relee cada pocos
 * minutos) y se enseñan los de la cadena, que son los vigentes.
 *
 * Sin nada en la cadena valen los de la ficha: un ejemplo no mueve dinero, y
 * un agente puede declararlos solo en su código.
 */
export function conEjemplosDeLaFicha(enCadena: string[], deLaFicha: string[]): string[] {
  if (enCadena.length === 0) return deLaFicha;
  return deLaFicha.length === enCadena.length ? deLaFicha : enCadena;
}
