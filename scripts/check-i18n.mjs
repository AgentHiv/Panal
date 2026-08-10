#!/usr/bin/env node
/**
 * Panal — paridad de traducciones.
 *
 *   node scripts/check-i18n.mjs        (o: npm run check:i18n)
 *
 * Falla si algún idioma se ha quedado atrás respecto a la referencia. Sin
 * dependencias: solo lee los JSON, así que en CI corre sin `npm install`.
 *
 * La referencia es `es.json` porque es el `fallbackLng` (src/i18n/index.ts):
 * una clave que falte ahí no la puede resolver nadie.
 *
 * Por qué existe: los 24 strings del panel de arbitraje vivieron en `es` y `en`
 * durante toda su vida. No fallaba nada —i18next cae al español en silencio—,
 * así que un juez con la web en árabe veía el panel entero en español y no
 * había forma de enterarse salvo mirándolo. Esto lo convierte en un error de CI.
 *
 * Qué comprueba, por cada idioma distinto de la referencia:
 *   1. Mismo conjunto de claves hoja (ni de menos ni de más).
 *   2. Mismos placeholders {{...}} en cada cadena. Traducir un placeholder no
 *      rompe el build: rompe la interpolación en tiempo de render, que es peor.
 *   3. Ninguna cadena vacía donde la referencia tiene texto. (Una vacía en TODOS
 *      los idiomas es deliberada y se acepta.)
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';

const DIR = 'src/i18n/locales';
const REFERENCE = 'es';

/** Aplana el árbol a { 'a.b.c': 'texto' }. */
function flatten(node, prefix = '', out = {}) {
  for (const [key, value] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) flatten(value, path, out);
    else out[path] = value;
  }
  return out;
}

/** Los {{nombres}} que i18next sustituye en render, como conjunto ordenado. */
function placeholders(text) {
  if (typeof text !== 'string') return '';
  return [...text.matchAll(/\{\{\s*(\w+)/g)].map((m) => m[1]).sort().join(',');
}

const langs = readdirSync(DIR)
  .filter((f) => f.endsWith('.json'))
  .map((f) => basename(f, '.json'))
  .sort();

if (!langs.includes(REFERENCE)) {
  console.error(`✖ falta la referencia ${DIR}/${REFERENCE}.json`);
  process.exit(1);
}

const flat = Object.fromEntries(
  langs.map((lang) => [lang, flatten(JSON.parse(readFileSync(join(DIR, `${lang}.json`), 'utf8')))]),
);

const ref = flat[REFERENCE];
const refKeys = Object.keys(ref);

// Vacía en todos = intencionada. Vacía en unos sí y otros no = traducción perdida.
const blankEverywhere = new Set(
  refKeys.filter((k) => langs.every((l) => typeof flat[l][k] === 'string' && flat[l][k].trim() === '')),
);

let failed = 0;

for (const lang of langs) {
  if (lang === REFERENCE) continue;
  const cur = flat[lang];
  const problems = [];

  const missing = refKeys.filter((k) => !(k in cur));
  const extra = Object.keys(cur).filter((k) => !(k in ref));
  if (missing.length) problems.push(`faltan ${missing.length}: ${missing.slice(0, 6).join(', ')}${missing.length > 6 ? ' …' : ''}`);
  if (extra.length) problems.push(`sobran ${extra.length}: ${extra.slice(0, 6).join(', ')}${extra.length > 6 ? ' …' : ''}`);

  for (const key of refKeys) {
    if (!(key in cur)) continue;
    const expected = placeholders(ref[key]);
    const got = placeholders(cur[key]);
    if (expected !== got) {
      problems.push(`${key}: placeholders {{${got || '—'}}} en vez de {{${expected || '—'}}}`);
    }
    if (!blankEverywhere.has(key) && typeof cur[key] === 'string' && cur[key].trim() === '') {
      problems.push(`${key}: cadena vacía (la referencia tiene texto)`);
    }
  }

  if (problems.length) {
    failed += 1;
    console.error(`✖ ${lang}`);
    for (const p of problems) console.error(`    ${p}`);
  } else {
    console.log(`✓ ${lang}  ${refKeys.length} claves`);
  }
}

console.log('');
if (failed) {
  console.error(`✖ ${failed} idioma(s) desalineado(s) con ${REFERENCE}.json`);
  process.exit(1);
}
console.log(`✓ los ${langs.length} idiomas cuadran con ${REFERENCE}.json (${refKeys.length} claves)`);
