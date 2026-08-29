/**
 * Panal — los niveles de un agente dentro del `metadataURI` on-chain.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * POR QUÉ AQUÍ Y NO SOLO EN LA FICHA
 *
 * Los niveles nacieron en la ficha que sirve el bot (`tiers`, ver
 * `agent-card.ts`), y allí siguen: es donde un agente declara los topes de
 * caracteres que su modelo puede masticar. Pero vivir SOLO ahí tiene dos
 * consecuencias que se notan:
 *
 *   - Para cambiar un precio hay que tocar el código del agente y reiniciarlo.
 *     Quien no programa no puede tocar lo que cobra.
 *   - Si el bot está caído, sus niveles no existen. El escaparate enseña un
 *     precio suelto de un agente que en realidad vende tres cosas distintas.
 *
 * En el `metadataURI` los escribe el registro, los guarda la cadena y los lee
 * cualquiera sin preguntarle a nadie. El precio —que es lo único que hay que
 * bloquear de verdad— deja de depender de que un servidor conteste.
 *
 * EL FORMATO
 *
 *     nivel:<precio>|<nombre>|<descripción>|<brief>|<adjunto>|<adjuntos>
 *
 * Un segmento por nivel, entre los demás de la ficha:
 *
 *     Lint · Revisa código · solidity · bot:https://… · nivel:0.03|Un archivo|…
 *
 * El precio va en unidades enteras («0.03»), no en wei. En wei son diecisiete
 * dígitos por nivel y esta cadena se escribe en la cadena de bloques: lo que
 * ocupa se paga. Los tres topes son opcionales y los vacíos del final no se
 * escriben, así que un nivel sin topes son tres campos y punto.
 *
 * POR QUÉ SE VALIDA TAN DURO
 *
 * La regla la fija `marca.ts` y es la misma: UN TOKEN SOLO CUENTA SI SU VALOR
 * VALE. La descripción de un agente es texto libre y alguien va a escribir
 * «nivel: depende del encargo» dentro de ella; si bastara con ver dos puntos,
 * esa frase se convertiría en un nivel fantasma y además desaparecería de la
 * descripción. Exigiendo un número decimal, una barra y un nombre no vacío, la
 * frase se queda donde estaba.
 * ───────────────────────────────────────────────────────────────────────────
 */

import type { Nivel } from './agent-card.js';

/**
 * Decimales de las dos monedas del registro: MON nativo y $PANAL.
 *
 * Está fijo a propósito. `PanalRegistryV2` solo admite esas dos y las dos
 * tienen dieciocho, así que el precio de un nivel se puede escribir en
 * unidades enteras sin arrastrar de qué moneda se trata. El día que el
 * registro admita un token con otros decimales, esto se rompe de la única
 * forma aceptable: aquí, en un sitio, y no repartido por seis lectores.
 */
const DECIMALES = 18;

/** Cuántos niveles se leen de una ficha ajena. El mismo tope que `leerNiveles`. */
const MAX_NIVELES = 8;

/**
 * Cuántos ofrece el formulario.
 *
 * Tres es lo que la gente entiende de un vistazo —pequeño, mediano, grande— y
 * lo que ya publican los agentes que los usan. El LECTOR admite hasta ocho
 * porque una ficha la escribe cualquiera y recortar lo que ya está escrito
 * sería tirar un nivel que su dueño creía publicado.
 */
export const NIVELES_EDITABLES = 3;

/** Tope de cada texto. Los mismos que aplica `leerNiveles` a la ficha del bot. */
const MAX_NOMBRE = 60;
const MAX_DESCRIPCION = 200;

/** Un decimal positivo con hasta dieciocho cifras detrás de la coma. */
const PRECIO = /^\d{1,12}(\.\d{1,18})?$/;

/**
 * `'0.03'` → `30000000000000000n`.
 *
 * A mano y no con `parseUnits` porque este módulo no importa viem: lo lee el
 * bot de cada agente, que depende de viem a propósito solo en su cliente. La
 * cuenta es rellenar de ceros a la derecha, que es exactamente lo que hace
 * `parseUnits` sin coma flotante por medio.
 */
export function precioAWei(precio: string): bigint | null {
  const s = precio.trim();
  if (!PRECIO.test(s)) return null;
  const [entera, decimal = ''] = s.split('.');
  const wei = BigInt(entera + decimal.padEnd(DECIMALES, '0').slice(0, DECIMALES));
  return wei > 0n ? wei : null;
}

/**
 * `30000000000000000n` → `'0.03'`.
 *
 * Sin ceros de relleno al final: `'0.030000000000000000'` es el mismo número
 * y ocupa quince caracteres más en la cadena de bloques.
 */
export function weiAPrecio(wei: bigint): string {
  const s = wei.toString().padStart(DECIMALES + 1, '0');
  const entera = s.slice(0, -DECIMALES);
  const decimal = s.slice(-DECIMALES).replace(/0+$/, '');
  return decimal ? `${entera}.${decimal}` : entera;
}

/** Un entero positivo, o `null`. Misma regla que los topes de la ficha. */
function tope(v: string | undefined): number | null {
  if (v === undefined) return null;
  const s = v.trim();
  if (!/^\d{1,9}$/.test(s)) return null;
  const n = Number(s);
  return n > 0 ? n : null;
}

/** Texto de un desconocido: espacios colapsados y recortado, porque va a un escaparate. */
function letrero(v: string | undefined, max: number): string | null {
  if (v === undefined) return null;
  const limpio = v.replace(/\s+/g, ' ').trim().slice(0, max);
  return limpio || null;
}

/**
 * `nivel:0.03|Un archivo|Un fichero suelto` → el nivel, o `null` si no lo es.
 *
 * Devolver `null` es lo normal: por aquí pasan TODOS los segmentos de la
 * ficha, incluida la descripción libre del agente.
 */
export function leerNivelDeSegmento(segmento: string): Nivel | null {
  const i = segmento.indexOf(':');
  if (i <= 0) return null;
  if (segmento.slice(0, i).trim().toLowerCase() !== 'nivel') return null;

  const campos = segmento.slice(i + 1).split('|');
  // Sin nombre no hay nivel: el cliente elige por el nombre, y un botón vacío
  // con un precio al lado no es una oferta, es un acertijo.
  if (campos.length < 2) return null;

  const wei = precioAWei(campos[0] ?? '');
  if (wei === null) return null;
  const name = letrero(campos[1], MAX_NOMBRE);
  if (!name) return null;

  return {
    name,
    description: letrero(campos[2], MAX_DESCRIPCION),
    wei,
    maxBriefChars: tope(campos[3]),
    maxAttachChars: tope(campos[4]),
    maxAttachCharsTotal: tope(campos[5]),
  };
}

/** true si este segmento es un nivel. Para que los lectores de ficha lo aparten. */
export function esTokenDeNivel(segmento: string): boolean {
  return leerNivelDeSegmento(segmento) !== null;
}

/**
 * Los niveles que un agente publica en la cadena, de menor a mayor precio.
 *
 * `[]` significa que no publica ninguno, y eso hay que tratarlo como se
 * trataba antes de que esto existiera: el agente tiene UN precio, el del
 * registro. Nadie debe fabricarle niveles a partir de él.
 */
export function leerNivelesDeMetadata(metadataURI: string | null | undefined): Nivel[] {
  if (!metadataURI) return [];
  const out: Nivel[] = [];
  for (const segmento of metadataURI.split('·')) {
    if (out.length >= MAX_NIVELES) break;
    const nivel = leerNivelDeSegmento(segmento.trim());
    // Un nivel mal escrito se cae de la lista en vez de tumbarla entera: un
    // campo roto no puede dejar sin comprar los niveles buenos de al lado.
    if (nivel) out.push(nivel);
  }
  // De menor a mayor, que es como se enseñan y lo que `nivelPara` necesita
  // para quedarse con el último que entra en lo pagado.
  return out.sort((a, b) => (a.wei < b.wei ? -1 : a.wei > b.wei ? 1 : 0));
}

/**
 * El nivel → su segmento, o `null` si no se puede escribir.
 *
 * `null` en vez de arreglarlo por su cuenta: un «·» dentro del nombre partiría
 * la ficha en dos y un «|» correría los campos, así que la salida silenciosa
 * sería un nivel que dice algo distinto de lo que su dueño escribió. Quien
 * llama tiene que enseñar el error, no firmar una ficha que no reconoce.
 */
export function componerNivel(nivel: {
  name: string;
  description?: string | null;
  precio: string;
  maxBriefChars?: number | null;
  maxAttachChars?: number | null;
  maxAttachCharsTotal?: number | null;
}): string | null {
  if (precioAWei(nivel.precio) === null) return null;

  const name = nivel.name.replace(/\s+/g, ' ').trim();
  const description = (nivel.description ?? '').replace(/\s+/g, ' ').trim();
  if (!name || name.length > MAX_NOMBRE) return null;
  if (description.length > MAX_DESCRIPCION) return null;
  if (/[·|]/.test(name) || /[·|]/.test(description)) return null;

  const campos = [
    nivel.precio.trim(),
    name,
    description,
    entero(nivel.maxBriefChars),
    entero(nivel.maxAttachChars),
    entero(nivel.maxAttachCharsTotal),
  ];
  // Los vacíos del FINAL se van; los de en medio no pueden irse o el siguiente
  // campo ocuparía el sitio del que falta.
  while (campos.length > 2 && campos[campos.length - 1] === '') campos.pop();
  return `nivel:${campos.join('|')}`;
}

function entero(v: number | null | undefined): string {
  return typeof v === 'number' && Number.isInteger(v) && v > 0 ? String(v) : '';
}

/**
 * Los niveles de la cadena, con el texto de la ficha del agente.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * POR QUÉ HACE FALTA JUNTARLOS, EN VEZ DE ELEGIR UNO
 *
 * Un nivel es dos cosas distintas con dueños distintos:
 *
 *   - El PRECIO y los topes. Es lo que se bloquea en el escrow, y tiene que
 *     salir de la cadena: son los únicos que siguen ahí con el bot caído, y los
 *     únicos que nadie puede cambiarte entre que miras y pagas.
 *
 *   - El NOMBRE y la descripción. Son una etiqueta, y la ficha del agente es el
 *     único sitio donde pueden estar TRADUCIDAS: `?lang=fr` devuelve la ficha
 *     en francés, la cadena guarda una sola versión y traducirla costaría una
 *     transacción por idioma.
 *
 * Quedarse solo con los de la cadena —que es lo que se hizo primero— deja el
 * escaparate entero en francés y los tres niveles de cada agente en español.
 * Quedarse solo con los de la ficha devuelve el problema de antes: un agente
 * caído se queda sin niveles y se le encarga el tamaño grande al precio del
 * pequeño.
 *
 * SE EMPAREJAN POR PRECIO, que es la identidad de un nivel: el agente arma su
 * ficha a partir de lo que tiene en la cadena, así que los importes coinciden
 * exactos. Lo que no empareje se queda con su texto de la cadena, que es la
 * respuesta correcta cuando la ficha dice otra cosa: enseñar el nombre de un
 * nivel junto a un precio que no es el suyo sería peor que no traducirlo.
 * ───────────────────────────────────────────────────────────────────────────
 */
export function conTextoDeLaFicha(enCadena: Nivel[], deLaFicha: Nivel[]): Nivel[] {
  if (enCadena.length === 0 || deLaFicha.length === 0) return enCadena;
  return enCadena.map((n) => {
    const igual = deLaFicha.find((f) => f.wei === n.wei);
    if (!igual) return n;
    return {
      ...n,
      // Solo se pisa lo que la ficha REALMENTE trae: un nivel con nombre no
      // puede perderlo porque la ficha venga a medias.
      name: igual.name ?? n.name,
      description: igual.description ?? n.description,
    };
  });
}
