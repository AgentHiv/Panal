/**
 * La vista previa de un agente: la imagen que enseñan X, Telegram, Discord o
 * WhatsApp cuando alguien pega el enlace de su ficha.
 *
 * Hasta noviembre de 2026 un enlace a `panal.lat/agente/…` salía como el de la
 * portada, o como nada: la web es una SPA y quien genera la vista previa no
 * ejecuta JavaScript. Ahora el Worker de panal.lat (`worker/`) pone el título,
 * la descripción y esta imagen en la página de cada agente, y la imagen se
 * dibuja aquí con lo que ya está en la cadena: nombre, a qué se dedica, precio,
 * nota y encargos completados.
 *
 * Se dibuja en el indexador porque es quien tiene el catálogo en memoria, y en
 * PNG porque ninguna de esas redes acepta SVG. resvg pasa el SVG a PNG con las
 * mismas tipografías de la web (Space Grotesk e Inter, OFL), que van en
 * `assets/fuentes/` para no depender de lo que tenga instalado la máquina.
 *
 * Cada imagen lleva una huella de lo que pinta. La URL la incluye (`?v=`), así
 * que cuando cambia el precio o la nota cambia la URL, y X o Telegram —que
 * guardan la imagen días— piden la nueva. La huella no decide qué se dibuja:
 * siempre se pinta lo de ahora, así que inventarse una no cuesta nada al
 * servidor.
 */

import { Resvg } from '@resvg/resvg-js';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { formatEther } from 'viem';
import type { AgenteDelCatalogo } from './indexer-store.js';

export const ANCHO = 1200;
export const ALTO = 630;

/** Súbela si cambia el dibujo: cambia todas las URL y las redes piden la nueva. */
const DIBUJO_V = 2;

const DIR_FUENTES = fileURLToPath(new URL('../assets/fuentes/', import.meta.url));
const FUENTES = {
  fontFiles: ['SpaceGrotesk-Bold.ttf', 'SpaceGrotesk-Medium.ttf', 'Inter-Regular.ttf', 'Inter-SemiBold.ttf'].map(
    (f) => DIR_FUENTES + f,
  ),
  loadSystemFonts: false,
  defaultFontFamily: 'Inter',
};

const COLOR = {
  fondo: '#0C0A12',
  panel: '#14111E',
  linea: '#342E4A',
  tinta: '#F2EFFA',
  tinta2: '#C8C3DC',
  tinta3: '#948DAE',
  miel: '#E29A2E',
  oliva: '#92A268',
  terra: '#C9653B',
  bruma: '#B7A8FC',
};

const X = 80;
const ANCHO_UTIL = ANCHO - 2 * X;

/** Lo que pinta la tarjeta, ya limpio. Es también lo que entra en la huella. */
export interface Tarjeta {
  direccion: string;
  nombre: string;
  /** Su nombre en PanalNames, si tiene. */
  alias: string | null;
  descripcion: string;
  /** «1 MON», «0.05 $PANAL». */
  precio: string;
  /**
   * La nota contando a cada cliente una vez (ver `AgentStats.clientRating`):
   * la media simple se infla con una segunda wallet; esta no.
   */
  nota: number | null;
  votos: number;
  /** Clientes distintos que le han pagado: lo que no se compra con una sola wallet. */
  clientes: number;
  completadas: number;
  verificado: boolean;
  activo: boolean;
}

/* ── El texto ─────────────────────────────────────────────────────────────── */

/**
 * Lo que las dos tipografías saben pintar: latín (con el vietnamita), signos y
 * monedas. Inter trae además griego y cirílico; Space Grotesk, no.
 *
 * Lo demás —emojis, CJK, árabe, devanagari— saldría como cajas vacías, así que
 * se quita. Para la descripción hay casi siempre una versión en inglés (el
 * indexador las pide a cada agente); el nombre que no se puede pintar se
 * sustituye por la dirección.
 */
const LATIN = '\\u0020-\\u007E\\u00A0-\\u024F\\u1E00-\\u1EFF\\u2010-\\u2027\\u2030-\\u205E\\u20A0-\\u20BF';
const GRIEGO_CIRILICO = '\\u0370-\\u03FF\\u0400-\\u04FF';
const FUERA_DE_SPACE = new RegExp(`[^${LATIN}]`, 'gu');
const FUERA_DE_INTER = new RegExp(`[^${LATIN}${GRIEGO_CIRILICO}]`, 'gu');
/** Lo mismo sin `g`, para preguntar: `test` con `g` recuerda dónde se quedó. */
const NO_ES_DE_SPACE = new RegExp(`[^${LATIN}]`, 'u');

function limpiar(texto: string, fuera: RegExp): string {
  return texto.normalize('NFC').replace(/\s+/g, ' ').replace(fuera, '').replace(/\s+/g, ' ').trim();
}

/** Cuánto sobrevive de un texto al quitarle lo que no se puede pintar. */
function seConserva(original: string, limpio: string): number {
  const n = original.replace(/\s/g, '').length;
  return n === 0 ? 1 : limpio.replace(/\s/g, '').length / n;
}

export function direccionCorta(direccion: string): string {
  return `${direccion.slice(0, 6)}…${direccion.slice(-4)}`;
}

/** 1 → «1», 0.05 → «0.05»; seis decimales como mucho y sin ceros de sobra. */
export function cantidad(wei: string): string {
  let n: bigint;
  try {
    n = BigInt(wei);
  } catch {
    return '?';
  }
  const [entera, decimales = ''] = formatEther(n).split('.');
  const corta = decimales.slice(0, 6).replace(/0+$/, '');
  // Menos de una millonésima: con todos sus ceros no cabría la moneda.
  if (entera === '0' && !corta && n > 0n) return '<0.000001';
  return corta ? `${entera}.${corta}` : entera!;
}

/** Con un decimal; la de por cliente si el índice la trae, y si no la media simple. */
function notaDe(st: AgenteDelCatalogo['stats']): number | null {
  if (!st || st.ratingCount === 0) return null;
  const nota = st.clientRating ?? st.avgRating;
  return nota === null || nota === undefined ? null : Math.round(nota * 10) / 10;
}

export function tarjetaDe(a: AgenteDelCatalogo): Tarjeta {
  const direccion = a.address.toLowerCase();

  // El nombre va en Space Grotesk; si trae griego o cirílico, en Inter.
  const nombreCrudo = a.name ?? '';
  let nombre = limpiar(nombreCrudo, FUERA_DE_INTER);
  if (seConserva(nombreCrudo, nombre) < 0.6) nombre = '';
  if (!nombre) nombre = direccionCorta(direccion);

  const descCruda = a.idiomas?.en?.trim() || a.description || '';
  let descripcion = limpiar(descCruda, FUERA_DE_INTER);
  if (seConserva(descCruda, descripcion) < 0.6) descripcion = '';

  const alias = a.nombre?.nombre ? limpiar(a.nombre.nombre, FUERA_DE_SPACE) || null : null;
  const st = a.stats;
  return {
    direccion,
    nombre,
    alias,
    descripcion,
    precio: `${cantidad(a.pricePerTask)} ${a.coin || 'MON'}`,
    nota: notaDe(st),
    votos: st?.ratingCount ?? 0,
    clientes: st?.clients ?? 0,
    completadas: st?.completed ?? 0,
    verificado: a.verificado === true,
    activo: a.active,
  };
}

export function huellaDe(t: Tarjeta): string {
  return createHash('sha256')
    .update(JSON.stringify([DIBUJO_V, t]))
    .digest('hex')
    .slice(0, 12);
}

/* ── El dibujo ────────────────────────────────────────────────────────────── */

type Familia = 'Space Grotesk' | 'Inter';
export type Medidor = (texto: string, familia: Familia, peso: number, px: number) => number;

const xml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

const medidas = new Map<string, number>();

/** El ancho de un texto con las tipografías de verdad: lo mide resvg. */
export const medirConResvg: Medidor = (texto, familia, peso, px) => {
  const clave = `${familia}|${peso}|${px}|${texto}`;
  const guardada = medidas.get(clave);
  if (guardada !== undefined) return guardada;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${ANCHO * 4}" height="${px * 2}"><text x="0" y="${px * 1.5}" font-family="${familia}" font-weight="${peso}" font-size="${px}">${xml(texto)}</text></svg>`;
  const caja = new Resvg(svg, { font: FUENTES }).getBBox();
  const ancho = caja ? caja.x + caja.width : 0;
  if (medidas.size > 5_000) medidas.clear();
  medidas.set(clave, ancho);
  return ancho;
};

/** Corta con «…» lo que no cabe en `max`. */
function recortar(texto: string, max: number, medir: (s: string) => number): string {
  if (medir(texto) <= max) return texto;
  let palabras = texto.split(' ');
  while (palabras.length > 1 && medir(`${palabras.join(' ')}…`) > max) palabras = palabras.slice(0, -1);
  let s = palabras.join(' ');
  // Una sola palabra larguísima: se corta por letras.
  while (s.length > 1 && medir(`${s}…`) > max) s = s.slice(0, -1);
  return `${s.replace(/[\s,.;:–—-]+$/, '')}…`;
}

/** Reparte un texto en líneas de `max` de ancho; la última, con «…» si sobra. */
export function partirEnLineas(texto: string, max: number, lineas: number, medir: (s: string) => number): string[] {
  const out: string[] = [];
  let resto = texto.split(' ').filter(Boolean);
  while (resto.length && out.length < lineas) {
    let n = 1;
    while (n < resto.length && medir(resto.slice(0, n + 1).join(' ')) <= max) n++;
    const linea = resto.slice(0, n).join(' ');
    resto = resto.slice(n);
    if (out.length === lineas - 1 && resto.length) {
      out.push(recortar(`${linea} ${resto.join(' ')}`, max, medir));
      resto = [];
    } else {
      out.push(medir(linea) > max ? recortar(linea, max, medir) : linea);
    }
  }
  return out;
}

function hexagono(cx: number, cy: number, r: number): string {
  const p: string[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i;
    p.push(`${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`);
  }
  return p.join(' ');
}

function estrella(cx: number, cy: number, r: number): string {
  const p: string[] = [];
  for (let i = 0; i < 10; i++) {
    const rr = i % 2 === 0 ? r : r * 0.45;
    const a = -Math.PI / 2 + (Math.PI / 5) * i;
    p.push(`${(cx + rr * Math.cos(a)).toFixed(2)},${(cy + rr * Math.sin(a)).toFixed(2)}`);
  }
  return p.join(' ');
}

export function svgDe(t: Tarjeta, medir: Medidor = medirConResvg): string {
  const partes: string[] = [];
  const texto = (x: number, y: number, s: string, familia: Familia, peso: number, px: number, color: string, extra = ''): void => {
    partes.push(
      `<text x="${x}" y="${y}" font-family="${familia}" font-weight="${peso}" font-size="${px}" fill="${color}"${extra}>${xml(s)}</text>`,
    );
  };

  // El fondo, con el panal de la marca a la derecha, apenas visible.
  partes.push(`<rect width="${ANCHO}" height="${ALTO}" fill="${COLOR.fondo}"/>`);
  for (const [cx, cy, r] of [
    [1090, 70, 150],
    [1160, 330, 150],
    [960, 330, 75],
  ] as const) {
    partes.push(`<polygon points="${hexagono(cx, cy, r)}" fill="none" stroke="#1C1828" stroke-width="3"/>`);
  }

  // Arriba: el logo y «Panal».
  partes.push(
    `<g transform="translate(${X} 56) scale(0.875)"><polygon points="60,32 46,56.25 18,56.25 4,32 18,7.75 46,7.75" fill="none" stroke="${COLOR.tinta}" stroke-width="3.5" stroke-linejoin="round"/><polygon points="45,33.5 39.75,42.59 29.25,42.59 24,33.5 29.25,24.41 39.75,24.41" fill="${COLOR.miel}"/></g>`,
  );
  texto(X + 70, 97, 'Panal', 'Space Grotesk', 500, 32, COLOR.tinta);
  if (!t.activo) {
    const w = medir('Paused', 'Inter', 600, 22) + 36;
    partes.push(`<rect x="${ANCHO - X - w}" y="66" width="${w}" height="40" rx="20" fill="none" stroke="${COLOR.terra}" stroke-width="2"/>`);
    texto(ANCHO - X - w / 2, 93, 'Paused', 'Inter', 600, 22, COLOR.terra, ' text-anchor="middle"');
  } else {
    texto(ANCHO - X, 95, 'panal.lat', 'Inter', 400, 26, COLOR.tinta3, ' text-anchor="end"');
  }

  // El nombre: lo más grande que quepa, y si no cabe ni pequeño, con «…».
  const familiaNombre: Familia = NO_ES_DE_SPACE.test(t.nombre) ? 'Inter' : 'Space Grotesk';
  const sello = t.verificado ? 60 : 0;
  let px = 80;
  while (px > 56 && medir(t.nombre, familiaNombre, 700, px) > ANCHO_UTIL - sello) px -= 4;
  const nombre = recortar(t.nombre, ANCHO_UTIL - sello, (s) => medir(s, familiaNombre, 700, px));
  const yNombre = 232;
  texto(X, yNombre, nombre, familiaNombre, 700, px, COLOR.tinta);
  if (t.verificado) {
    const cx = X + medir(nombre, familiaNombre, 700, px) + 38;
    const cy = yNombre - px * 0.36;
    partes.push(
      `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="19" fill="${COLOR.oliva}"/><path d="M ${(cx - 8).toFixed(1)} ${cy.toFixed(1)} l 5.5 5.5 l 10 -11" fill="none" stroke="${COLOR.fondo}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`,
    );
  }

  // Debajo, su nombre en PanalNames y la dirección: el nombre de la ficha lo
  // escribe cada uno y no es único; esto sí. Si el nombre ya es la dirección,
  // no se repite.
  const corta = direccionCorta(t.direccion);
  const quien = [t.alias, t.nombre === corta ? null : corta].filter(Boolean).join('  ·  ');
  if (quien) texto(X, 282, quien, 'Inter', 400, 28, COLOR.bruma);

  // A qué se dedica, en tres líneas como mucho.
  const lineas = partirEnLineas(t.descripcion, ANCHO_UTIL, 3, (s) => medir(s, 'Inter', 400, 34));
  lineas.forEach((l, i) => texto(X, 350 + i * 46, l, 'Inter', 400, 34, COLOR.tinta2));

  // Abajo, las tres cifras: precio, nota y encargos completados.
  partes.push(`<line x1="${X}" y1="${ALTO - 140}" x2="${ANCHO - X}" y2="${ALTO - 140}" stroke="${COLOR.linea}" stroke-width="2"/>`);
  const yValor = ALTO - 76;
  const yEtiqueta = ALTO - 40;
  const columna = ANCHO_UTIL / 3;

  // Las cifras en Inter: el «1» de Space Grotesk, a este tamaño, parece otra cosa.
  let pxPrecio = 42;
  while (pxPrecio > 26 && medir(t.precio, 'Inter', 600, pxPrecio) > columna - 24) pxPrecio -= 2;
  texto(X, yValor, recortar(t.precio, columna - 24, (s) => medir(s, 'Inter', 600, pxPrecio)), 'Inter', 600, pxPrecio, COLOR.miel);
  texto(X, yEtiqueta, 'per task', 'Inter', 400, 22, COLOR.tinta3);

  const xNota = X + columna;
  if (t.nota !== null) {
    partes.push(`<polygon points="${estrella(xNota + 17, yValor - 15, 18)}" fill="${COLOR.miel}"/>`);
    texto(xNota + 44, yValor, t.nota.toFixed(1), 'Inter', 600, 42, COLOR.tinta);
    // Cuántos clientes distintos, no cuántas reseñas: veinte de la misma
    // wallet son una opinión, no veinte.
    const deQuien = t.clientes > 0 ? (t.clientes === 1 ? 'from 1 client' : `from ${t.clientes} clients`) : t.votos === 1 ? '1 rating' : `${t.votos} ratings`;
    texto(xNota, yEtiqueta, deQuien, 'Inter', 400, 22, COLOR.tinta3);
  } else {
    texto(xNota, yValor, 'New', 'Inter', 600, 42, COLOR.tinta);
    texto(xNota, yEtiqueta, 'no ratings yet', 'Inter', 400, 22, COLOR.tinta3);
  }

  const xHechas = X + 2 * columna;
  texto(xHechas, yValor, String(t.completadas), 'Inter', 600, 42, COLOR.tinta);
  texto(xHechas, yEtiqueta, t.completadas === 1 ? 'job completed' : 'jobs completed', 'Inter', 400, 22, COLOR.tinta3);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${ANCHO}" height="${ALTO}" viewBox="0 0 ${ANCHO} ${ALTO}">${partes.join('')}</svg>`;
}

export function dibujar(t: Tarjeta): Buffer {
  return new Resvg(svgDe(t), { font: FUENTES, fitTo: { mode: 'original' } }).render().asPng();
}

/** La huella de la imagen de un agente, sin dibujarla: es lo que va en su URL. */
export function huellaDeAgente(a: AgenteDelCatalogo): string {
  return huellaDe(tarjetaDe(a));
}

/* ── La caché ─────────────────────────────────────────────────────────────── */

/**
 * Las imágenes ya dibujadas, por agente. Cloudflare guarda las PNG en su borde,
 * así que aquí llega poco; esto cubre lo que se le escape. Una por agente y
 * con tope: cambiar la huella en la URL no llena nada.
 */
const MAX_EN_CACHE = 300;
const cache = new Map<string, { huella: string; png: Buffer }>();

export function vistaPrevia(a: AgenteDelCatalogo): { huella: string; png: Buffer } {
  const t = tarjetaDe(a);
  const huella = huellaDe(t);
  const guardada = cache.get(t.direccion);
  if (guardada && guardada.huella === huella) return guardada;
  const nueva = { huella, png: dibujar(t) };
  cache.delete(t.direccion);
  if (cache.size >= MAX_EN_CACHE) cache.delete(cache.keys().next().value as string);
  cache.set(t.direccion, nueva);
  return nueva;
}
