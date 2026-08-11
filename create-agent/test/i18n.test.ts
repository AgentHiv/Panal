/**
 * Pruebas del catálogo de idiomas.
 *
 *   npx tsx test/i18n.test.ts
 *
 * HERMÉTICO: no toca la red ni el disco.
 *
 * Lo que se vigila aquí no es la calidad de la traducción —eso no lo puede
 * juzgar un test— sino que no falte nada y que no queden trozos sin traducir.
 * Una clave ausente sale por pantalla como `undefined`, y eso es peor que
 * estar en inglés: parece un fallo del programa.
 */

import { CATALOG, LANG_CODES, LANGS, fill, isLang, resolveLang, type Catalog } from '../src/i18n.js';

let failures = 0;

function check(label: string, ok: boolean, detail = ''): void {
  if (ok) console.log(`✅ ${label}${detail ? `: ${detail}` : ''}`);
  else {
    failures += 1;
    console.error(`❌ ${label}${detail ? `: ${detail}` : ''}`);
  }
}

/** Todas las claves de un catálogo, incluidas las anidadas de `env`. */
function claves(cat: Catalog): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(cat)) {
    if (typeof v === 'string') out.push(k);
    else for (const sub of Object.keys(v as object)) out.push(`${k}.${sub}`);
  }
  return out.sort();
}

function valor(cat: Catalog, ruta: string): string {
  const [a, b] = ruta.split('.');
  const raiz = (cat as unknown as Record<string, unknown>)[a!];
  return (b ? (raiz as Record<string, string>)[b] : raiz) as string;
}

console.log('── 1. Están los diez ──');

check('el catálogo tiene diez idiomas', LANG_CODES.length === 10, LANG_CODES.join(' '));
check('cada idioma tiene su entrada', LANG_CODES.every((l) => CATALOG[l] !== undefined));
check('cada idioma tiene su nombre nativo', LANGS.every((l) => l.label.trim().length > 0));

console.log('\n── 2. Ninguna clave se queda por el camino ──');

const referencia = claves(CATALOG.en);
check('el inglés tiene todas las claves esperadas', referencia.length >= 25, `${referencia.length} claves`);

for (const lang of LANG_CODES) {
  const suyas = claves(CATALOG[lang]);
  const faltan = referencia.filter((k) => !suyas.includes(k));
  const sobran = suyas.filter((k) => !referencia.includes(k));
  check(`${lang}: mismas claves que el inglés`, faltan.length === 0 && sobran.length === 0,
    faltan.length ? `faltan ${faltan.join(', ')}` : sobran.length ? `sobran ${sobran.join(', ')}` : `${suyas.length}`);
}

console.log('\n── 3. Nada vacío y nada sin traducir ──');

for (const lang of LANG_CODES) {
  const vacias = referencia.filter((k) => !String(valor(CATALOG[lang], k) ?? '').trim());
  check(`${lang}: ningún texto vacío`, vacias.length === 0, vacias.join(', '));
}

// Un texto idéntico al inglés en otro idioma casi siempre es una traducción
// olvidada. Se permiten los que de verdad no se traducen: comandos y rutas.
const IGUALES_LEGITIMAS = new Set(['s1Install']);
for (const lang of LANG_CODES.filter((l) => l !== 'en')) {
  const copiadas = referencia.filter(
    (k) => !IGUALES_LEGITIMAS.has(k) && valor(CATALOG[lang], k) === valor(CATALOG.en, k),
  );
  check(`${lang}: nada copiado tal cual del inglés`, copiadas.length === 0, copiadas.join(', '));
}

console.log('\n── 4. Los marcadores sobreviven a la traducción ──');

// Si una traducción se come el {name} o el {address}, el usuario ve una frase
// coherente a la que le falta justo el dato que necesitaba.
const CON_MARCADOR: Array<[string, string]> = [
  ['errBadName', '{name}'],
  ['errDirExists', '{name}'],
  ['created', '{name}'],
  ['walletNote', '{name}'],
  ['s1Install', '{name}'],
  ['s1Fund', '{address}'],
];
for (const lang of LANG_CODES) {
  const rotos = CON_MARCADOR.filter(([k, marca]) => !valor(CATALOG[lang], k).includes(marca));
  check(`${lang}: conserva los marcadores`, rotos.length === 0, rotos.map(([k]) => k).join(', '));
}

for (const lang of LANG_CODES) {
  const r = CATALOG[lang].readme;
  check(`${lang}: el README lleva nombre y wallet`, r.includes('{name}') && r.includes('{address}'));
}

console.log('\n── 5. Sustitución ──');

check('sustituye lo conocido', fill('hola {name}', { name: 'Lint' }) === 'hola Lint');
check('deja intacto lo que no sabe', fill('{name} y {otro}', { name: 'a' }) === 'a y {otro}');
check('sin variables no rompe', fill('sin marcas') === 'sin marcas');

console.log('\n── 6. De dónde sale el idioma ──');

check('manda la bandera', resolveLang('fr', {}) === 'fr');
check('una bandera inválida no se inventa nada', resolveLang('klingon', { PANAL_LANG: 'es' }) === null);
check('luego la variable de entorno', resolveLang(null, { PANAL_LANG: 'ru' }) === 'ru');
check('luego el locale del sistema', resolveLang(null, { LANG: 'pt_BR.UTF-8' }) === 'pt');
check('LC_ALL gana a LANG', resolveLang(null, { LC_ALL: 'zh_CN.UTF-8', LANG: 'fr_FR' }) === 'zh');
check('un locale desconocido no decide', resolveLang(null, { LANG: 'sw_KE.UTF-8' }) === null);
check('sin nada, nadie decide', resolveLang(null, {}) === null);
check('isLang acepta los diez', LANG_CODES.every((l) => isLang(l)));
check('isLang rechaza lo demás', !isLang('eo'));

console.log('');
if (failures === 0) console.log('✅ Los diez idiomas están completos y los marcadores intactos');
else {
  console.error(`❌ ${failures} comprobación(es) fallaron`);
  process.exitCode = 1;
}
