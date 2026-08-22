/**
 * Las wallets que ofrece el APK.
 *
 *     npx tsx scripts/test-movil-wallets.ts
 *
 * La app añade dos wallets a las que ya nombra la web, y las suyas se
 * construyen aquí en vez de en `@/lib/deepLinks` porque esa lista la pinta
 * también el diálogo del sitio y el sitio no se toca. Añadidas aparte, se
 * quedaban fuera de `test-deeplinks.ts`: esto las mete dentro.
 *
 * Lo que se comprueba es lo mismo que allí, y por lo mismo: un enlace mal
 * formado no falla al pulsarlo. Abre la wallet igual, con una sesión
 * incompleta, y revienta más tarde al aprobar — donde parece un fallo de la
 * wallet y no del enlace.
 */
import { WALLETS } from '../movil/src/lib/wallets.js';

let fallos = 0;
const check = (nombre: string, ok: boolean, detalle = ''): void => {
  console.log(`${ok ? '✅' : '❌'} ${nombre}${ok ? '' : ` — ${detalle}`}`);
  if (!ok) fallos++;
};

const URI =
  'wc:8a5b1c2d3e4f5061728394a5b6c7d8e9f0a1b2c3d4e5f60718293a4b5c6d7e8f@2?relay-protocol=irn&symKey=1f2e3d4c5b6a79887766554433221100ffeeddccbbaa99887766554433221100';

console.log('\n── La URI viaja entera hasta cada wallet ──\n');

for (const w of WALLETS) {
  const enlace = w.enlace(URI);
  const query = enlace.slice(enlace.indexOf('?uri=') + 5);

  check(`${w.nombre}: la URI se recupera intacta`, decodeURIComponent(query) === URI, query);
  check(
    `${w.nombre}: no quedan & ni = sin escapar`,
    !query.includes('&') && !query.includes('='),
    query,
  );
  // Nunca un esquema propio: si la app no está instalada, Android lanza
  // ActivityNotFoundException, Capacitor se la traga sin avisar
  // (Bridge.java:415) y el botón se queda mudo — el fallo que veníamos a
  // arreglar. Un https siempre acaba en algún sitio.
  check(`${w.nombre}: es un enlace universal https`, enlace.startsWith('https://'), enlace);
}

console.log('\n── La lista ──\n');

check('están las dos de la web y las dos de la app', WALLETS.length === 4, String(WALLETS.length));
check(
  'los ids no se repiten',
  new Set(WALLETS.map((w) => w.id)).size === WALLETS.length,
  WALLETS.map((w) => w.id).join(', '),
);
check(
  'todas tienen sigla y color para el hexágono',
  WALLETS.every((w) => w.sigla.length > 0 && /^#[0-9A-Fa-f]{6}$/.test(w.color)),
);
for (const [id, host] of [
  ['metamask', 'metamask.app.link'],
  ['trust', 'link.trustwallet.com'],
  ['rainbow', 'rnbwapp.com'],
  ['zerion', 'wallet.zerion.io'],
] as const) {
  const w = WALLETS.find((x) => x.id === id);
  check(`${id} apunta a ${host}`, !!w && new URL(w.enlace(URI)).hostname === host);
}

console.log('\n── Casos raros ──\n');

check(
  'una URI vacía no revienta la construcción',
  WALLETS.every((w) => typeof w.enlace('') === 'string'),
);

console.log(fallos === 0 ? '\n✅ todo bien\n' : `\n❌ ${fallos} fallos\n`);
process.exit(fallos === 0 ? 0 : 1);
