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
import { WALLETS_MOVIL, enlaceWallet } from '../src/lib/deepLinks.js';

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

console.log(
  fallos === 0
    ? '\n✅ Los enlaces llevan la sesión entera hasta la wallet\n'
    : `\n❌ ${fallos} comprobación(es) fallidas\n`,
);
process.exit(fallos === 0 ? 0 : 1);
