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
const politica = await import('../src/lib/signingPolicy.ts');
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
const mensaje = 'Panal resultado #42 · 1780000000';
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
    deadline: BigInt(Math.floor(Date.now() / 1000) + 300),
  },
};
// Lo que arma la hoja del chat antes de firmar: a quién y cuánto.
politica.permitirPago({ spender: permit.message.spender, value: permit.message.value, token: permit.domain.verifyingContract });
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

/* ── lo que NO firma ──────────────────────────────────────────────────────── */

/** Pide algo al proveedor y dice si lo paró la política, antes de la clave. */
const parado = async (method, params) => {
  try {
    await PROVEEDOR.request({ method, params });
    return false;
  } catch (e) {
    return e instanceof politica.FirmaBloqueada;
  }
};
const hex = (texto) => `0x${Buffer.from(texto, 'utf8').toString('hex')}`;
const { PANAL_ESCROW_V2_ADDRESS: ESCROW, PANAL_REGISTRY_V2_ADDRESS: REGISTRO, PANAL_TOKEN_ADDRESS: TOKEN } = await import(
  '@/contracts/config'
);
const AGENTE = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const DESCONOCIDO = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const { encodeFunctionData, parseAbi } = await import('viem');
const { panalEscrowV2Abi, panalTokenAbi, panalRegistryV2Abi } = await import('@/contracts/abis');

console.log('\nmensajes: solo los de Panal');
dice('«Panal brief #7» se firma', !(await parado('personal_sign', [hex('Panal brief #7'), wallet.direccion])));
dice('un mensaje cualquiera, no', await parado('personal_sign', [hex('Sign in to claim your airdrop'), wallet.direccion]));
dice('ni uno que solo empieza como los de Panal', await parado('personal_sign', [hex('Panal brief #7 y algo más'), wallet.direccion]));

console.log('\npermits: solo el que armó la hoja');
const permitDe = (cambios = {}, dominio = {}) =>
  JSON.stringify(
    { ...permit, domain: { ...permit.domain, ...dominio }, message: { ...permit.message, ...cambios } },
    (_, v) => (typeof v === 'bigint' ? v.toString() : v),
  );
dice('sin hoja que lo arme, no', await parado('eth_signTypedData_v4', [wallet.direccion, permitDe()]));
politica.permitirPago({ spender: AGENTE, value: 50n, token: TOKEN });
dice('por más de lo confirmado, no', await parado('eth_signTypedData_v4', [wallet.direccion, permitDe({ value: '51' })]));
politica.permitirPago({ spender: AGENTE, value: 50n, token: TOKEN });
dice('a otro beneficiario, no', await parado('eth_signTypedData_v4', [wallet.direccion, permitDe({ value: '50', spender: DESCONOCIDO })]));
politica.permitirPago({ spender: AGENTE, value: 50n, token: TOKEN });
dice(
  'de otro token, no',
  await parado('eth_signTypedData_v4', [wallet.direccion, permitDe({ value: '50' }, { verifyingContract: DESCONOCIDO })]),
);
politica.permitirPago({ spender: AGENTE, value: 50n, token: TOKEN });
dice(
  'que valga un día entero, no',
  await parado('eth_signTypedData_v4', [wallet.direccion, permitDe({ value: '50', deadline: String(Math.floor(Date.now() / 1000) + 86_400) })]),
);
politica.permitirPago({ spender: AGENTE, value: 50n, token: TOKEN });
dice('el confirmado, sí', !(await parado('eth_signTypedData_v4', [wallet.direccion, permitDe({ value: '50' })])));
dice('y una sola vez', await parado('eth_signTypedData_v4', [wallet.direccion, permitDe({ value: '50' })]));
politica.permitirPago({ spender: AGENTE, value: 50n, token: TOKEN }, Date.now() - politica.VIDA_PERMISO_MS - 1);
dice('lo armado caduca', await parado('eth_signTypedData_v4', [wallet.direccion, permitDe({ value: '50' })]));
// Las monedas estables de la lista: el mismo permit, otro token.
const USDC = '0x754704Bc059F8C67012fEd69BC8A327a5aafb603';
const enUsdc = { verifyingContract: USDC, name: 'USDC', version: '2' };
politica.permitirPago({ spender: AGENTE, value: 50_000n, token: USDC });
dice('en USDC, si la hoja lo enseñó en USDC, sí', !(await parado('eth_signTypedData_v4', [wallet.direccion, permitDe({ value: '50000' }, enUsdc)])));
politica.permitirPago({ spender: AGENTE, value: 50n, token: USDC });
dice(
  'la hoja enseñó USDC y se pide firmar en $PANAL, no',
  await parado('eth_signTypedData_v4', [wallet.direccion, permitDe({ value: '50' })]),
);
politica.permitirPago({ spender: AGENTE, value: 50n, token: TOKEN });
dice(
  'la hoja enseñó $PANAL y se pide firmar en USDC, no',
  await parado('eth_signTypedData_v4', [wallet.direccion, permitDe({ value: '50' }, enUsdc)]),
);
politica.permitirPago({ spender: AGENTE, value: 50n, token: TOKEN });
dice(
  'y un tipado que no es un permit, no',
  await parado('eth_signTypedData_v4', [
    wallet.direccion,
    JSON.stringify({ domain: { name: 'Seaport', chainId: activeChain.id }, types: { Order: [{ name: 'offerer', type: 'address' }] }, primaryType: 'Order', message: { offerer: wallet.direccion } }),
  ]),
);
politica.olvidarPermisos();

console.log('\ntransacciones: solo a los contratos de Panal');
const tx = (to, data, value) => [{ from: wallet.direccion, to, data, ...(value === undefined ? {} : { value: `0x${value.toString(16)}` }) }];
dice('MON suelto a una dirección, no', await parado('eth_sendTransaction', tx(DESCONOCIDO, undefined, 10n ** 18n)));
dice('crear un contrato, no', await parado('eth_sendTransaction', [{ from: wallet.direccion, data: '0x6080' }]));
dice(
  'un transfer de $PANAL, no (enviar va por su pantalla)',
  await parado('eth_sendTransaction', tx(TOKEN, encodeFunctionData({ abi: panalTokenAbi, functionName: 'transfer', args: [DESCONOCIDO, 10n ** 21n] }))),
);
dice(
  'un approve de $PANAL a otro que no es el escrow, no',
  await parado('eth_sendTransaction', tx(TOKEN, encodeFunctionData({ abi: panalTokenAbi, functionName: 'approve', args: [DESCONOCIDO, 10n ** 21n] }))),
);
dice(
  'una función que el escrow no tiene, no',
  await parado('eth_sendTransaction', tx(ESCROW, encodeFunctionData({ abi: parseAbi(['function sweep(address)']), functionName: 'sweep', args: [DESCONOCIDO] }))),
);
const crear = (worker, monto, moneda = TOKEN) =>
  encodeFunctionData({ abi: panalEscrowV2Abi, functionName: 'createTask', args: [worker, `0x${'ab'.repeat(32)}`, 1900000000n, moneda, monto] });
dice('un createTask que ninguna hoja confirmó, no', await parado('eth_sendTransaction', tx(ESCROW, crear(DESCONOCIDO, 10n ** 21n))));
politica.permitirEncargo({ worker: AGENTE, amount: 1000n, currency: TOKEN });
dice('un createTask a otro agente que el confirmado, no', await parado('eth_sendTransaction', tx(ESCROW, crear(DESCONOCIDO, 1000n))));

// Lo que SÍ pasa se mira en la política directamente: por el proveedor saldría
// a la red, y aquí no hay nodo.
const pasa = (t) => {
  try {
    politica.revisarTransaccion(t);
    return true;
  } catch {
    return false;
  }
};
politica.permitirEncargo({ worker: AGENTE, amount: 1000n, currency: TOKEN });
dice('el createTask confirmado, sí', pasa({ to: ESCROW, data: crear(AGENTE, 1000n) }));
dice('y una sola vez', !pasa({ to: ESCROW, data: crear(AGENTE, 1000n) }));
politica.permitirEncargo({ worker: AGENTE, amount: 10n ** 16n, currency: '0x0000000000000000000000000000000000000000' });
dice(
  'en MON, si manda más MON del que encarga, no',
  !pasa({ to: ESCROW, data: crear(AGENTE, 10n ** 16n, '0x0000000000000000000000000000000000000000'), value: 10n ** 18n }),
);
politica.permitirEncargo({ worker: AGENTE, amount: 10n ** 16n, currency: '0x0000000000000000000000000000000000000000' });
dice(
  'en MON, con el importe justo, sí',
  pasa({ to: ESCROW, data: crear(AGENTE, 10n ** 16n, '0x0000000000000000000000000000000000000000'), value: 10n ** 16n }),
);
dice(
  'aprobar $PANAL al escrow, sí',
  pasa({ to: TOKEN, data: encodeFunctionData({ abi: panalTokenAbi, functionName: 'approve', args: [ESCROW, 1000n] }) }),
);
dice('retirar del escrow, sí', pasa({ to: ESCROW, data: encodeFunctionData({ abi: panalEscrowV2Abi, functionName: 'withdraw', args: [TOKEN] }) }));
dice(
  'aprobar y liberar un encargo, sí',
  pasa({ to: ESCROW, data: encodeFunctionData({ abi: panalEscrowV2Abi, functionName: 'approveAndRelease', args: [7n, 5] }) }),
);
dice(
  'pausar o activar el agente propio, sí',
  pasa({ to: REGISTRO, data: encodeFunctionData({ abi: panalRegistryV2Abi, functionName: 'setActive', args: [true] }) }),
);
dice(
  'mandar MON al registro, no',
  !pasa({ to: REGISTRO, data: encodeFunctionData({ abi: panalRegistryV2Abi, functionName: 'setActive', args: [true] }), value: 1n }),
);
// MON por mensaje: no se firma, se manda. La única transferencia suelta que
// sale, y solo la que armó la hoja.
const MON = '0x0000000000000000000000000000000000000000';
const IMPORTE_MON = 2_000_000_000_000_356_003n;
politica.permitirPago({ spender: AGENTE, value: IMPORTE_MON, token: MON });
dice('el pago en MON que enseñó la hoja, sí', pasa({ to: AGENTE, value: IMPORTE_MON }));
dice('y una sola vez', !pasa({ to: AGENTE, value: IMPORTE_MON }));
politica.permitirPago({ spender: AGENTE, value: IMPORTE_MON, token: MON });
dice('por una unidad más, no', !pasa({ to: AGENTE, value: IMPORTE_MON + 1n }));
politica.permitirPago({ spender: AGENTE, value: IMPORTE_MON, token: MON });
dice('a otro que el agente, no', !pasa({ to: DESCONOCIDO, value: IMPORTE_MON }));
politica.permitirPago({ spender: AGENTE, value: IMPORTE_MON, token: MON });
dice('con datos, no: es una transferencia, no una llamada', !pasa({ to: AGENTE, value: IMPORTE_MON, data: '0xa9059cbb' }));
politica.permitirPago({ spender: AGENTE, value: 50n, token: TOKEN });
dice('la hoja armó $PANAL y llega MON, no', !pasa({ to: AGENTE, value: 50n }));
politica.olvidarPermisos();

console.log('\nse cierra sola por inactividad');
dice('recién abierta, le queda todo', ses.leQueda() > ses.INACTIVIDAD_MS - 1000);
dice('y no caduca por mirarla', ses.caducar() === false);
dice(
  'un minuto antes del plazo sigue abierta',
  ses.caducar(Date.now() + ses.INACTIVIDAD_MS - 60_000) === false,
);
dice('sigue firmando', ses.cuentaViva() !== null);
// Se pasa el rato de golpe: es lo que hace un móvil olvidado encima de la mesa.
dice('pasado el plazo, se cierra', ses.caducar(Date.now() + ses.INACTIVIDAD_MS + 1) === true);
dice('y ya no hay cuenta', ses.cuentaViva() === null);
dice('cerrar dos veces no revienta', ses.caducar(Date.now() + 999_999_999) === false);

console.log('\nusar la app reinicia el reloj');
await ses.abrirSesion(llave, wallet);
// A punto de caducar…
ses.caducar(Date.now() + ses.INACTIVIDAD_MS - 1000);
dice('a un segundo del plazo sigue viva', ses.cuentaViva() !== null);
// …y `cuentaViva` acaba de tocarla, así que el reloj empezó de nuevo.
dice(
  'firmar cuenta como usarla: el reloj vuelve a empezar',
  ses.caducar(Date.now() + ses.INACTIVIDAD_MS - 500) === false,
);
ses.tocar();
dice('y tocar también', ses.leQueda() > ses.INACTIVIDAD_MS - 1000);

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
