/**
 * Panal — los niveles de la ficha de un agente, para el bot.
 *
 * Un agente publica lo que cobra por cada tamaño de encargo dentro del
 * `metadataURI`, como segmentos separados por «·»:
 *
 *     Lint · Revisa código · solidity · bot:https://… · nivel:0.03|Un archivo|…
 *
 * Aquí solo hace falta RECONOCERLOS, y hace falta en los tres sitios que
 * reparten posiciones —el indexador que arma el catálogo, `/agent.json` que
 * arma la tarjeta y el MCP que se la enseña a Claude—. Un segmento que no se
 * aparte corre las posiciones, y los tres `nivel:…` de un agente acabarían
 * anunciados como skills suyas. Es el mismo fallo que documenta `marca.ts`.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * EL FORMATO LO MANDA `sdk/src/niveles.ts`. Esto es una copia de la parte de
 * lectura, porque el bot no depende de aquel paquete —tiene su propio lockfile
 * y su propio ciclo, igual que pasa con `marca.ts` y con el manifiesto de
 * archivos—. Si allí cambia el formato, hay que cambiarlo aquí, o los agentes
 * que lo usen saldrán con la ficha descuadrada en el catálogo.
 * ─────────────────────────────────────────────────────────────────────────
 */

/** Decimales de MON y de $PANAL, las dos monedas del registro. */
const DECIMALES = 18;

/** Cuántos se leen de una ficha ajena. Ocho ya son demasiados para elegir. */
const MAX_NIVELES = 8;

const MAX_NOMBRE = 60;
const MAX_DESCRIPCION = 200;

/** Un decimal positivo con hasta dieciocho cifras detrás de la coma. */
const PRECIO = /^\d{1,12}(\.\d{1,18})?$/;

export interface NivelFicha {
  name: string;
  description: string | null;
  /** Lo que hay que bloquear, en unidades mínimas de la moneda del agente. */
  wei: bigint;
  maxBriefChars: number | null;
  maxAttachChars: number | null;
  maxAttachCharsTotal: number | null;
}

function precioAWei(precio: string): bigint | null {
  const s = precio.trim();
  if (!PRECIO.test(s)) return null;
  const [entera, decimal = ''] = s.split('.');
  const wei = BigInt(entera + decimal.padEnd(DECIMALES, '0').slice(0, DECIMALES));
  return wei > 0n ? wei : null;
}

function tope(v: string | undefined): number | null {
  if (v === undefined) return null;
  const s = v.trim();
  if (!/^\d{1,9}$/.test(s)) return null;
  const n = Number(s);
  return n > 0 ? n : null;
}

function letrero(v: string | undefined, max: number): string | null {
  if (v === undefined) return null;
  const limpio = v.replace(/\s+/g, ' ').trim().slice(0, max);
  return limpio || null;
}

/**
 * `nivel:0.03|Un archivo|Un fichero suelto` → el nivel, o `null`.
 *
 * UN TOKEN SOLO CUENTA SI SU VALOR VALE, igual que en `marca.ts`. La
 * descripción de un agente es texto libre y alguien escribirá «nivel: depende
 * del encargo» dentro de ella; si bastara con ver dos puntos, esa frase se
 * convertiría en un nivel fantasma y además desaparecería de la descripción.
 */
export function leerNivelDeSegmento(segmento: string): NivelFicha | null {
  const i = segmento.indexOf(':');
  if (i <= 0) return null;
  if (segmento.slice(0, i).trim().toLowerCase() !== 'nivel') return null;

  const campos = segmento.slice(i + 1).split('|');
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

export function esTokenDeNivel(segmento: string): boolean {
  return leerNivelDeSegmento(segmento) !== null;
}

/**
 * Los niveles que un agente publica en la cadena, de menor a mayor precio.
 *
 * `[]` significa que no publica ninguno: el agente cobra un precio y ya, el del
 * registro. Nadie debe fabricarle niveles a partir de él.
 */
export function leerNivelesDeMetadata(metadataURI: string | null | undefined): NivelFicha[] {
  if (!metadataURI) return [];
  const out: NivelFicha[] = [];
  for (const segmento of metadataURI.split('·')) {
    if (out.length >= MAX_NIVELES) break;
    const nivel = leerNivelDeSegmento(segmento.trim());
    // Uno mal escrito se cae de la lista en vez de tumbarla entera.
    if (nivel) out.push(nivel);
  }
  return out.sort((a, b) => (a.wei < b.wei ? -1 : a.wei > b.wei ? 1 : 0));
}
