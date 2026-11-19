/**
 * Los enlaces que abren la wallet del teléfono.
 *
 *     npx tsx scripts/test-deeplinks.ts
 *
 * Un enlace mal formado no falla al pulsarlo: abre la wallet igual, con una
 * sesión incompleta, y revienta MÁS TARDE al aprobar. Ahí parece un fallo de
 * la wallet y no del enlace, que es la peor clase de error para diagnosticar.
 *
 * Lo que se comprueba es que la URI viaje ENTERA y escapada: lleva `?`, `&` y
 * `=` dentro, y sin escapar el sistema operativo se queda con el primer tramo.
 */
import { VUELTA, WALLETS_MOVIL, enlaceAppPanal, enlaceWallet } from '../src/lib/deepLinks.js';
import { PIDE_FIRMA, enlaceDeVuelta } from '../src/lib/vueltaWallet.js';

let fallos = 0;
const check = (nombre: string, ok: boolean, detalle = ''): void => {
  console.log(`${ok ? '✅' : '❌'} ${nombre}${ok ? '' : ` — ${detalle}`}`);
  if (!ok) fallos++;
};

// Una URI real de WalletConnect v2: los tres caracteres peligrosos están todos.
const URI =
  'wc:8a5b1c2d3e4f5061728394a5b6c7d8e9f0a1b2c3d4e5f60718293a4b5c6d7e8f@2?relay-protocol=irn&symKey=1f2e3d4c5b6a79887766554433221100ffeeddccbbaa99887766554433221100';

console.log('\n── La URI viaja entera ──\n');

for (const w of WALLETS_MOVIL) {
  const enlace = enlaceWallet(w.id, URI);
  const query = enlace.slice(enlace.indexOf('?uri=') + 5);

  check(`${w.nombre}: la URI se recupera intacta`, decodeURIComponent(query) === URI, decodeURIComponent(query));
  check(
    `${w.nombre}: no quedan & ni = sin escapar en la query`,
    !query.includes('&') && !query.includes('='),
    query,
  );
  check(`${w.nombre}: es un enlace universal https`, enlace.startsWith('https://'), enlace);
}

console.log('\n── A dónde apunta cada uno ──\n');

check(
  'MetaMask va a metamask.app.link',
  new URL(enlaceWallet('metamask', URI)).hostname === 'metamask.app.link',
);
check(
  'Trust va a link.trustwallet.com',
  new URL(enlaceWallet('trust', URI)).hostname === 'link.trustwallet.com',
);

// Los esquemas propios (`metamask://`) dejan al usuario mirando un error del
// navegador si la app no está. El universal abre la web de la wallet.
check(
  'ninguno usa un esquema propio',
  WALLETS_MOVIL.every((w) => !enlaceWallet(w.id, URI).includes('://') || enlaceWallet(w.id, URI).startsWith('https://')),
);

console.log('\n── Casos raros ──\n');

check('una URI vacía no rompe la construcción', enlaceWallet('metamask', '') === 'https://metamask.app.link/wc?uri=');
check(
  'los caracteres de una URI se escapan y no se pierden',
  decodeURIComponent(enlaceWallet('trust', 'wc:a@2?x=1&y=2').split('?uri=')[1]!) === 'wc:a@2?x=1&y=2',
);

console.log('\n── La app de Panal ──\n');

{
  const enlace = enlaceAppPanal(URI);
  const uriParte = enlace.slice('intent://wc?uri='.length, enlace.indexOf('#Intent;'));
  check('es un intent de Chrome para Android', enlace.startsWith('intent://wc?uri=') && enlace.endsWith(';end'), enlace);
  check('la URI se recupera intacta', decodeURIComponent(uriParte) === URI, decodeURIComponent(uriParte));
  check('no quedan & ni = sin escapar en la URI', !uriParte.includes('&') && !uriParte.includes('='), uriParte);
  check('abre el esquema panal del APK directo', enlace.includes('#Intent;scheme=panal;package=lat.panal.app;'), enlace);
  const vuelta = /S\.browser_fallback_url=([^;]+);/.exec(enlace)?.[1];
  check(
    'sin la app instalada, lleva a la página para descargarla',
    vuelta !== undefined && decodeURIComponent(vuelta) === 'https://panal.lat/app',
    String(vuelta),
  );
  check(
    'no está en la lista de wallets de fuera (la app se ofrecería a sí misma)',
    !WALLETS_MOVIL.some((w) => (w.id as string) === 'panal'),
  );
}

console.log('\n── Volver a la wallet para firmar ──\n');

check('cada wallet tiene su esquema para volver', Object.values(VUELTA).every((v) => /^[a-z]+:\/\/$/.test(v)));
check('la de Panal vuelve por panal://', VUELTA.panal === 'panal://');
check(
  'lo que manda la wallet al conectar gana a lo que se tocó',
  enlaceDeVuelta({ native: 'metamask://' }, VUELTA.trust) === 'metamask://',
);
check('sin nada de la wallet, vale lo que se tocó', enlaceDeVuelta(undefined, VUELTA.panal) === 'panal://');
check('sin nada de nada, no hay enlace', enlaceDeVuelta(undefined, null) === null);
check('firmar y cambiar de red llevan a la wallet', PIDE_FIRMA.has('eth_signTypedData_v4') && PIDE_FIRMA.has('eth_sendTransaction'));
check('una lectura no saca a nadie de la página', !PIDE_FIRMA.has('eth_chainId') && !PIDE_FIRMA.has('eth_call'));

console.log(
  fallos === 0
    ? '\n✅ Los enlaces llevan la sesión entera hasta la wallet\n'
    : `\n❌ ${fallos} comprobación(es) fallidas\n`,
);
process.exit(fallos === 0 ? 0 : 1);
