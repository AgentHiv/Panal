/**
 * Firmar con la wallet del teléfono, por el mismo camino que la app.
 *
 * Esto es lo que quita la incomodidad de salir a otra aplicación por cada
 * mensaje, y es también lo más fácil de romper sin enterarse: la firma sale
 * bien pero no la reconoce nadie. Por eso aquí no se comprueba «que firme»,
 * sino que la dirección se RECUPERA de la firma — que es lo que hará el
 * agente al otro lado.
 *
 * Se monta el mismo `WalletClient` que monta wagmi: `custom(proveedor)` y la
 * cuenta como dirección, no como objeto. Esa distinción importa: por ahí la
 * firma viaja como JSON-RPC (`eth_signTypedData_v4` con el tipado convertido
 * a texto), que es donde se pierden los bigint si algo está mal.
 */
import { webcrypto } from 'node:crypto';

globalThis.__VITE_ENV__ = { VITE_CHAIN: 'mainnet' };

const disco = new Map();
globalThis.localStorage = {
  getItem: (k) => (disco.has(k) ? disco.get(k) : null),
  setItem: (k, v) => disco.set(k, String(v)),
  removeItem: (k) => disco.delete(k),
};
if (!globalThis.crypto.randomUUID) globalThis.crypto.randomUUID = webcrypto.randomUUID.bind(webcrypto);
globalThis.btoa = (s) => Buffer.from(s, 'binary').toString('base64');
globalThis.atob = (s) => Buffer.from(s, 'base64').toString('binary');

const { createWalletClient, custom, verifyMessage, verifyTypedData } = await import('viem');
const ll = await import('../src/lib/llavero.ts');
const ses = await import('../src/lib/sesion.ts');
const { PROVEEDOR } = await import('../src/lib/conector.ts');
const { activeChain } = await import('@/contracts/config');

let bien = 0;
let mal = 0;
const dice = (que, cond) => {
  if (cond) { bien++; console.log('  ✅', que); }
  else { mal++; console.log('  ❌', que); }
};

console.log('\ncon el llavero cerrado');
dice('no hay cuentas', (await PROVEEDOR.request({ method: 'eth_accounts' })).length === 0);
let rechazo = false;
try {
  await PROVEEDOR.request({ method: 'personal_sign', params: ['0x68656c6c6f', '0x0'] });
} catch { rechazo = true; }
dice('y firmar se rechaza en vez de firmar con nada', rechazo);

console.log('\nabrir el llavero');
const llave = await ll.crearLlavero('123456');
const { wallet } = await ll.crearWallet(llave, 'La del móvil');
await ses.abrirSesion(llave, wallet);
dice('la sesión queda abierta', ses.cuentaViva() !== null);
dice('con la wallet elegida', ses.walletViva().id === wallet.id);
dice('y se recuerda cuál para la próxima', ses.idRecordado() === wallet.id);

console.log('\nlo que contesta el proveedor');
const cuentas = await PROVEEDOR.request({ method: 'eth_accounts' });
dice('la dirección de esa wallet', cuentas[0] === wallet.direccion);
dice('la red es Monad', BigInt(await PROVEEDOR.request({ method: 'eth_chainId' })) === BigInt(activeChain.id));

console.log('\ncambiar de red');
dice(
  'a la que ya estamos, no hace nada',
  (await PROVEEDOR.request({
    method: 'wallet_switchEthereumChain',
    params: [{ chainId: `0x${activeChain.id.toString(16)}` }],
  })) === null,
);
let otraRed = false;
try {
  await PROVEEDOR.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x1' }] });
} catch { otraRed = true; }
dice('a otra, falla: Panal solo vive en una', otraRed);

/* ── el mismo cliente que monta wagmi ─────────────────────────────────────── */

const cliente = createWalletClient({
  account: wallet.direccion,
  chain: activeChain,
  transport: custom(PROVEEDOR),
});

console.log('\nfirmar un mensaje (traerse una entrega)');
const mensaje = 'panal:result:42:1780000000';
const firma = await cliente.signMessage({ message: mensaje });
dice('sale una firma de 65 bytes', /^0x[0-9a-f]{130}$/i.test(firma));
dice(
  'y la dirección se recupera de ella',
  await verifyMessage({ address: wallet.direccion, message: mensaje, signature: firma }),
);
dice(
  'con otro mensaje NO se recupera',
  !(await verifyMessage({ address: wallet.direccion, message: 'otra cosa', signature: firma })),
);

console.log('\nfirmar el permit de x402 (pagar un mensaje)');
const permit = {
  domain: {
    name: 'PANAL',
    version: '1',
    chainId: activeChain.id,
    verifyingContract: '0x2e2e44e7fa6178822d4397299f719e89d1a67777',
  },
  types: {
    Permit: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'nonce', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
    ],
  },
  primaryType: 'Permit',
  message: {
    owner: wallet.direccion,
    spender: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    // El caso que rompe todo si el JSON no sobrevive el viaje: un uint256 que
    // no cabe en un Number.
    value: 1234567890123456789n,
    nonce: 0n,
    deadline: 1780000000n,
  },
};
const firmaPermit = await cliente.signTypedData(permit);
dice('sale una firma', /^0x[0-9a-f]{130}$/i.test(firmaPermit));
dice(
  'el agente la va a poder verificar',
  await verifyTypedData({ ...permit, address: wallet.direccion, signature: firmaPermit }),
);
dice(
  'y cambiando un solo wei del importe, ya no',
  !(await verifyTypedData({
    ...permit,
    message: { ...permit.message, value: 1234567890123456790n },
    address: wallet.direccion,
    signature: firmaPermit,
  })),
);

console.log('\ncerrar la sesión');
ses.cerrarSesion();
dice('se va la cuenta', ses.cuentaViva() === null);
dice('el proveedor deja de tener cuentas', (await PROVEEDOR.request({ method: 'eth_accounts' })).length === 0);
let trasCerrar = false;
try { await cliente.signMessage({ message: 'hola' }); } catch { trasCerrar = true; }
dice('y ya no firma nada', trasCerrar);
dice('pero la wallet sigue en el llavero', ll.listar().length === 1);

console.log(`\n${bien} bien · ${mal} mal\n`);
process.exit(mal === 0 ? 0 : 1);
