/**
 * La app como wallet de panal.lat (`src/lib/puente.ts`).
 *
 * Lo que se comprueba es lo que decide qué se conecta y qué se firma, sin
 * relé ni teléfono: que el enlace `panal://` traiga la sesión entera, que
 * solo se conecte panal.lat, que la sesión aprobada sea Monad y esta cuenta,
 * y que cada petición de la web se lea bien y pase por la MISMA política que
 * las firmas de la propia app. Esa última parte va con un llavero de verdad:
 * lo armado al aceptar tiene que dejar firmar justo eso, y nada sin armar.
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

const { encodeFunctionData, stringToHex, verifyMessage, verifyTypedData, getAddress } = await import('viem');
const ll = await import('../src/lib/llavero.ts');
const ses = await import('../src/lib/sesion.ts');
const { PROVEEDOR } = await import('../src/lib/conector.ts');
const politica = await import('../src/lib/signingPolicy.ts');
const pu = await import('../src/lib/puente.ts');
const { panalEscrowV2Abi, panalTokenAbi } = await import('@/contracts/abis');
const cfg = await import('@/contracts/config');

let bien = 0;
let mal = 0;
const dice = (que, cond) => {
  if (cond) { bien++; console.log('  ✅', que); }
  else { mal++; console.log('  ❌', que); }
};
const lanza = (f) => {
  try { f(); return false; } catch { return true; }
};

const URI = 'wc:8a5b1c2d3e4f5061728394a5b6c7d8e9f0a1b2c3d4e5f60718293a4b5c6d7e8f@2?relay-protocol=irn&symKey=1f2e3d4c5b6a79887766554433221100ffeeddccbbaa99887766554433221100&expiryTimestamp=1795000000';

console.log('\nel enlace panal://');
dice('trae la sesión entera', pu.uriDeEnlace(`panal://wc?uri=${encodeURIComponent(URI)}`) === URI);
dice('también con la barra antes de ?', pu.uriDeEnlace(`panal://wc/?uri=${encodeURIComponent(URI)}`) === URI);
dice('panal:// a secas no trae nada que emparejar', pu.uriDeEnlace('panal://') === null);
dice('ni el de volver a firmar', pu.uriDeEnlace('panal:///wc?requestId=1&sessionTopic=abc') === null);
dice('otro esquema no vale', pu.uriDeEnlace(`metamask://wc?uri=${encodeURIComponent(URI)}`) === null);
dice('una uri que no es de WalletConnect v2 no vale', pu.uriDeEnlace(`panal://wc?uri=${encodeURIComponent('wc:abc@1?x=1')}`) === null);
dice('sin escapar se corta y no vale', pu.uriDeEnlace(`panal://wc?uri=${URI}`) === null);

console.log('\nsolo panal.lat');
let o = pu.origenAceptado({ origin: 'https://panal.lat', validation: 'VALID' }, 'https://panal.lat');
dice('panal.lat comprobada se conecta', o.ok && o.comprobado);
o = pu.origenAceptado({ origin: 'https://panal.lat', validation: 'UNKNOWN' }, 'https://panal.lat');
dice('sin verificación también, pero avisando', o.ok && !o.comprobado);
o = pu.origenAceptado(undefined, 'https://panal.lat/app');
dice('vale cualquier página de panal.lat', o.ok);
o = pu.origenAceptado({ origin: 'https://evil.example', validation: 'INVALID' }, 'https://panal.lat');
dice('una web que se hace pasar por panal.lat, no', !o.ok && o.motivo === 'falsa');
o = pu.origenAceptado({ origin: 'https://panal.lat', validation: 'VALID', isScam: true }, 'https://panal.lat');
dice('una marcada como estafa, no', !o.ok && o.motivo === 'estafa');
o = pu.origenAceptado({ origin: 'https://app.uniswap.org', validation: 'VALID' }, 'https://app.uniswap.org');
dice('otra web de verdad, tampoco', !o.ok && o.motivo === 'otraWeb');
dice('panal.lat.otra.com no es panal.lat', !pu.origenAceptado(undefined, 'https://panal.lat.otra.com').ok);
dice('sin https no es panal.lat', !pu.origenAceptado(undefined, 'http://panal.lat').ok);
dice('sin origen, nada', !pu.origenAceptado(undefined, undefined).ok);

console.log('\nla sesión que se aprueba');
const dir = '0x1111111111111111111111111111111111111111';
const deWagmi = {
  requiredNamespaces: {},
  optionalNamespaces: {
    eip155: {
      chains: [pu.CADENA],
      methods: ['eth_sendTransaction', 'personal_sign', 'eth_signTypedData_v4', 'wallet_switchEthereumChain', 'wallet_sendCalls'],
      events: ['chainChanged', 'accountsChanged'],
    },
  },
};
const esp = pu.espaciosAprobados(deWagmi, dir);
dice('Monad y solo Monad', esp.eip155.chains.length === 1 && esp.eip155.chains[0] === 'eip155:143');
dice('con esta cuenta', esp.eip155.accounts[0] === `eip155:143:${getAddress(dir)}`);
dice('y los métodos que la app sabe contestar', esp.eip155.methods.includes('eth_signTypedData_v4') && !esp.eip155.methods.includes('wallet_sendCalls'));
dice('si la web exige otra red, no se aprueba', lanza(() => pu.espaciosAprobados({ requiredNamespaces: { eip155: { chains: ['eip155:1'] } } }, dir)));
dice('ni otra familia de cadenas', lanza(() => pu.espaciosAprobados({ requiredNamespaces: { solana: { chains: ['solana:x'] } } }, dir)));
dice('ni un método que no se contesta', lanza(() => pu.espaciosAprobados({ requiredNamespaces: { eip155: { chains: [pu.CADENA], methods: ['eth_sign'] } } }, dir)));

console.log('\ncon un llavero de verdad');
const llave = await ll.crearLlavero('123456');
const { wallet } = await ll.crearWallet(llave, 'La del móvil');
await ses.abrirSesion(llave, wallet);
const yo = getAddress(ses.cuentaViva().address);
const otro = '0x2222222222222222222222222222222222222222';
const agente = '0x3333333333333333333333333333333333333333';

console.log('\nlo que se lee de cada petición');
dice('cambiar a Monad se contesta sin preguntar', pu.describir('wallet_switchEthereumChain', [{ chainId: '0x8f' }], yo).tipo === 'red');
dice('cambiar a otra red, no', pu.describir('wallet_switchEthereumChain', [{ chainId: '0x1' }], yo).tipo === 'bloqueada');

const brief = stringToHex('Panal brief #12');
let d = pu.describir('personal_sign', [brief, yo], yo);
dice('un mensaje de Panal se enseña con su texto', d.tipo === 'mensaje' && d.texto === 'Panal brief #12');
dice('firmado como otro, no', pu.describir('personal_sign', [brief, otro], yo).tipo === 'bloqueada');
dice('un mensaje cualquiera, no', pu.describir('personal_sign', [stringToHex('Sign in to evil.example'), yo], yo).tipo === 'bloqueada');

const ahora = Date.now();
const permit = (owner, spender, value, deadline, tipo = 'Permit') => ({
  domain: { name: 'Panal', version: '1', chainId: 143, verifyingContract: cfg.PANAL_TOKEN_ADDRESS },
  types: {
    Permit: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'nonce', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
    ],
  },
  primaryType: tipo,
  message: { owner, spender, value: String(value), nonce: '0', deadline: String(deadline) },
});
const plazo = Math.floor(ahora / 1000) + 300;
d = pu.describir('eth_signTypedData_v4', [yo, JSON.stringify(permit(yo, agente, 500000000000000000n, plazo))], yo);
dice('un permit de x402 se lee: a quién y cuánto', d.tipo === 'permit' && d.a === getAddress(agente) && d.importe === 500000000000000000n);
dice('y cuánto le queda', d.tipo === 'permit' && d.caduca > 240_000 && d.caduca <= 300_000);
dice('un permit a nombre de otro, no', pu.describir('eth_signTypedData_v4', [yo, JSON.stringify(permit(otro, agente, 1n, plazo))], yo).tipo === 'bloqueada');
dice('otros datos tipados, no', pu.describir('eth_signTypedData_v4', [yo, JSON.stringify(permit(yo, agente, 1n, plazo, 'Order'))], yo).tipo === 'bloqueada');

const crear = encodeFunctionData({
  abi: panalEscrowV2Abi,
  functionName: 'createTask',
  args: [agente, `0x${'ab'.repeat(32)}`, 1800000000n, cfg.PANAL_TOKEN_ADDRESS, 10n ** 18n],
});
d = pu.describir('eth_sendTransaction', [{ from: yo, to: cfg.PANAL_ESCROW_V2_ADDRESS, data: crear }], yo);
dice('contratar se lee: agente, importe y moneda', d.tipo === 'encargo' && d.agente === getAddress(agente) && d.importe === 10n ** 18n);
const aprobar = encodeFunctionData({ abi: panalTokenAbi, functionName: 'approve', args: [cfg.PANAL_ESCROW_V2_ADDRESS, 10n ** 18n] });
d = pu.describir('eth_sendTransaction', [{ from: yo, to: cfg.PANAL_TOKEN_ADDRESS, data: aprobar }], yo);
dice('aprobar $PANAL al escrow se lee', d.tipo === 'aprobar' && d.para === 'escrow');
const aOtro = encodeFunctionData({ abi: panalTokenAbi, functionName: 'approve', args: [otro, 10n ** 18n] });
dice('aprobar $PANAL a cualquiera, no', pu.describir('eth_sendTransaction', [{ from: yo, to: cfg.PANAL_TOKEN_ADDRESS, data: aOtro }], yo).tipo === 'bloqueada');
const transferir = encodeFunctionData({ abi: panalTokenAbi, functionName: 'transfer', args: [otro, 10n ** 18n] });
dice('mandar $PANAL a otro, no', pu.describir('eth_sendTransaction', [{ from: yo, to: cfg.PANAL_TOKEN_ADDRESS, data: transferir }], yo).tipo === 'bloqueada');
dice('una llamada a un contrato que no es de Panal, no', pu.describir('eth_sendTransaction', [{ from: yo, to: otro, data: '0x095ea7b3' }], yo).tipo === 'bloqueada');
d = pu.describir('eth_sendTransaction', [{ from: yo, to: agente, value: '0x6f05b59d3b20000' }], yo);
dice('MON a secas se lee como pago de un mensaje', d.tipo === 'pagoMon' && d.importe === 500000000000000000n);
dice('mandado desde otra cuenta, no', pu.describir('eth_sendTransaction', [{ from: otro, to: agente, value: '0x1' }], yo).tipo === 'bloqueada');
dice('crear un contrato, no', pu.describir('eth_sendTransaction', [{ from: yo, data: '0x6080' }], yo).tipo === 'bloqueada');
dice('un método que no se contesta, no', pu.describir('eth_sign', [yo, '0x00'], yo).tipo === 'bloqueada');

console.log('\nfirmar: solo lo que se aceptó');
let fallo = false;
const tipado = permit(yo, agente, 500000000000000000n, plazo);
try {
  await PROVEEDOR.request({ method: 'eth_signTypedData_v4', params: [yo, JSON.stringify(tipado)] });
} catch { fallo = true; }
dice('sin aceptar en la hoja, el permit no se firma', fallo);

pu.armar(pu.describir('eth_signTypedData_v4', [yo, JSON.stringify(tipado)], yo));
const firma = await PROVEEDOR.request({ method: 'eth_signTypedData_v4', params: [yo, JSON.stringify(tipado)] });
dice(
  'aceptado, se firma y la firma es de esta cuenta',
  await verifyTypedData({ address: yo, ...tipado, message: { ...tipado.message, value: BigInt(tipado.message.value), nonce: 0n, deadline: BigInt(plazo) }, signature: firma }),
);
fallo = false;
try {
  await PROVEEDOR.request({ method: 'eth_signTypedData_v4', params: [yo, JSON.stringify(tipado)] });
} catch { fallo = true; }
dice('y vale para una sola firma', fallo);

const deMensaje = await PROVEEDOR.request({ method: 'personal_sign', params: [brief, yo] });
dice('un mensaje de Panal se firma sin armar nada', await verifyMessage({ address: yo, message: 'Panal brief #12', signature: deMensaje }));

dice('contratar sin aceptar, no pasa la política', lanza(() => politica.revisarTransaccion({ to: cfg.PANAL_ESCROW_V2_ADDRESS, data: crear, value: 0n })));
pu.armar(pu.describir('eth_sendTransaction', [{ from: yo, to: cfg.PANAL_ESCROW_V2_ADDRESS, data: crear }], yo));
dice('aceptado, pasa', !lanza(() => politica.revisarTransaccion({ to: cfg.PANAL_ESCROW_V2_ADDRESS, data: crear, value: 0n })));

pu.armar(pu.describir('eth_sendTransaction', [{ from: yo, to: agente, value: '0x6f05b59d3b20000' }], yo));
dice('el MON aceptado pasa por el importe exacto', !lanza(() => politica.revisarTransaccion({ to: agente, value: 500000000000000000n })));
pu.armar(pu.describir('eth_sendTransaction', [{ from: yo, to: agente, value: '0x6f05b59d3b20000' }], yo));
dice('y por uno más alto, no', lanza(() => politica.revisarTransaccion({ to: agente, value: 500000000000000001n })));

politica.olvidarPermisos();
ses.cerrarSesion();

console.log(`\n${bien} bien · ${mal} mal`);
process.exit(mal === 0 ? 0 : 1);
