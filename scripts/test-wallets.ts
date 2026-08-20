/**
 * Qué wallets se ofrecen al pulsar "Conectar".
 *
 *     npx tsx scripts/test-wallets.ts
 *
 * Es una lista, y a la vez es la puerta de entrada. Una entrada de más y el
 * usuario pulsa un botón que lanza ConnectorNotFoundError; una de menos y no
 * puede entrar. El caso que motivó estas pruebas es el móvil: hasta ahora
 * quien abría panal.lat en el Chrome de un teléfono no tenía NINGUNA opción
 * válida, y el código lo trataba como "no tienes wallet" cuando en realidad
 * tenía la app instalada al lado.
 */
import { elegirWallets, GENERIC_INJECTED_ID, WALLETCONNECT_ID } from '../src/lib/wallets.js';

let fallos = 0;
const check = (nombre: string, ok: boolean, detalle = ''): void => {
  console.log(`${ok ? '✅' : '❌'} ${nombre}${ok ? '' : ` — ${detalle}`}`);
  if (!ok) fallos++;
};

const generico = { id: GENERIC_INJECTED_ID, name: 'Injected' };
const wc = { id: WALLETCONNECT_ID, name: 'WalletConnect' };
const metamask = { id: 'io.metamask', name: 'MetaMask', icon: 'data:image/svg+xml,x' };
const trustDescubierta = { id: 'com.trustwallet.app', name: 'Trust Wallet', icon: 'data:image/svg+xml,y' };
const trustDirigida = { id: 'trustWallet', name: 'Trust Wallet' };

const ids = (cs: { id: string }[]): string => cs.map((c) => c.id).join(',');

console.log('\n── Escritorio con extensión ──\n');

check(
  'una wallet detectada se ofrece sola',
  ids(elegirWallets([generico, metamask], true)) === 'io.metamask',
  ids(elegirWallets([generico, metamask], true)),
);

check(
  'el injected genérico NO se ofrece si hay una con nombre',
  !ids(elegirWallets([generico, metamask], true)).includes(GENERIC_INJECTED_ID),
);

check(
  'Trust por dos vías se ofrece UNA vez, la que trae icono',
  ids(elegirWallets([generico, trustDirigida, trustDescubierta], true)) === 'com.trustwallet.app',
  ids(elegirWallets([generico, trustDirigida, trustDescubierta], true)),
);

check(
  'sin ninguna con nombre, el genérico vale',
  ids(elegirWallets([generico], true)) === GENERIC_INJECTED_ID,
  ids(elegirWallets([generico], true)),
);

console.log('\n── El navegador de un móvil ──\n');

// Aquí no hay nada inyectado. Es el caso que estaba roto.
check(
  'el genérico NO se ofrece si no hay nada inyectado detrás',
  elegirWallets([generico], false).length === 0,
  ids(elegirWallets([generico], false)),
);

check(
  'con WalletConnect SÍ hay por dónde entrar',
  ids(elegirWallets([generico, wc], false)) === WALLETCONNECT_ID,
  ids(elegirWallets([generico, wc], false)),
);

check(
  'y sin WalletConnect no hay ninguna: se explica cómo instalar una',
  elegirWallets([generico], false).length === 0,
);

console.log('\n── Los dos caminos a la vez ──\n');

const ambos = elegirWallets([generico, metamask, wc], true);
check('se ofrecen las dos', ambos.length === 2, ids(ambos));
check(
  'y la instalada va PRIMERO: quien la tiene aquí no debe buscarla bajo un QR',
  ids(ambos) === `io.metamask,${WALLETCONNECT_ID}`,
  ids(ambos),
);

check(
  'WalletConnect nunca se deduplica contra una inyectada',
  elegirWallets([wc, { id: 'x', name: 'WalletConnect' }], true).length === 2,
);

console.log(
  fallos === 0
    ? '\n✅ La puerta se abre donde debe y no ofrece botones que no funcionan\n'
    : `\n❌ ${fallos} comprobación(es) fallidas\n`,
);
process.exit(fallos === 0 ? 0 : 1);
