/**
 * Pruebas de la mitad servidor de x402.
 *
 *   npx tsx test/x402-server.test.ts
 *
 * HERMÉTICO: no toca la red ni la cadena. Firma permits de verdad con claves
 * generadas aquí y verifica que el servidor los acepta o los rechaza.
 *
 * Todo lo que se comprueba aquí protege dinero. Un fallo en cualquiera de estas
 * piezas significa o cobrar de menos, o servir sin cobrar, o —lo peor— cobrar
 * dos veces al mismo cliente por una sola respuesta.
 */

import { parseEther, verifyTypedData, type Address, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import {
  X402_SERVER_SCHEME,
  X402_VERSION,
  buildQuote,
  enqueueByPayer,
  parsePaymentHeader,
  permitTypedData,
  resourceId,
  splitSignature,
  type PermitDomain,
} from '../src/index.js';

let failures = 0;

function check(label: string, ok: boolean, detail = ''): void {
  if (ok) console.log(`✅ ${label}${detail ? `: ${detail}` : ''}`);
  else {
    failures += 1;
    console.error(`❌ ${label}${detail ? `: ${detail}` : ''}`);
  }
}

const TOKEN = '0x2e2e44e7fa6178822d4397299f719e89d1a67777' as Address;
const AGENTE = '0x1558cF6aed695F3F8AafE488058EfE28d216E69C' as Address;
const DOMINIO: PermitDomain = { name: 'PANAL', version: '1', chainId: 143, verifyingContract: TOKEN };

const cliente = privateKeyToAccount(generatePrivateKey());

/** Codifica una cabecera X-Payment como la mandaría un cliente. */
function cabecera(p: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(p), 'utf8').toString('base64');
}

console.log('── 1. El presupuesto que viaja en el 402 ──');

const quote = buildQuote({
  asset: TOKEN,
  assetSymbol: '$PANAL',
  amount: parseEther('0.002'),
  payTo: AGENTE,
  resource: '/x402/ask',
  description: 'Una consulta.',
  domain: DOMINIO,
  nowS: 1_000_000,
});
const accept = quote.accepts[0]!;

check('declara la versión del protocolo', quote.x402Version === X402_VERSION);
check('ofrece exactamente una forma de pago', quote.accepts.length === 1);
check('el esquema es el del permit', accept.scheme === X402_SERVER_SCHEME, accept.scheme);
check('la cadena es Monad mainnet', accept.chainId === 143, String(accept.chainId));
// El importe viaja como cadena a propósito: JSON.stringify no sabe de BigInt y
// un número de JS pierde precisión a partir de 2^53, que en wei es calderilla.
check('el importe va como cadena decimal', accept.amount === '2000000000000000', accept.amount);
check('caduca en 5 minutos', accept.deadline === 1_000_000 + 300, String(accept.deadline));
check('lleva el dominio con el que firmar', accept.domain.verifyingContract === TOKEN);
check('quien cobra es el agente', accept.payTo === AGENTE);
check('el nonce del pagador es opcional', accept.payerNonce === undefined);
check(
  'si el cliente se identifica, se le da su nonce',
  buildQuote({ ...{ asset: TOKEN, assetSymbol: '$PANAL', amount: 1n, payTo: AGENTE, resource: '/x', description: 'd', domain: DOMINIO }, payerNonce: 7n }).accepts[0]!.payerNonce === '7',
);

console.log('\n── 2. La cabecera X-Payment: la escribe un desconocido ──');

const bueno = {
  scheme: X402_SERVER_SCHEME,
  payer: cliente.address,
  value: '2000000000000000',
  deadline: '1999999999',
  signature: `0x${'ab'.repeat(65)}`,
};
const ok = parsePaymentHeader(cabecera(bueno));
check('una cabecera bien formada se acepta', ok.ok === true);
if (ok.ok) {
  check('el importe se lee como bigint', ok.payment.value === 2_000_000_000_000_000n);
  check('la dirección se normaliza a checksum', ok.payment.payer === cliente.address);
}

// Ninguna de estas debe lanzar: una cabecera hostil se rechaza, no tumba el
// agente. Buffer.from(…,'base64') no falla con basura, se la traga, así que la
// validación tiene que ser explícita.
const malas: Array<[string, string]> = [
  ['no es base64', parsePaymentHeader('¡¡¡ esto no es base64 !!!').ok ? '' : 'base64'],
  ['no es JSON', parsePaymentHeader(Buffer.from('hola', 'utf8').toString('base64')).ok ? '' : 'JSON'],
  ['otro esquema', parsePaymentHeader(cabecera({ ...bueno, scheme: 'tarjeta' })).ok ? '' : 'esquema'],
  ['payer no es dirección', parsePaymentHeader(cabecera({ ...bueno, payer: 'pepe' })).ok ? '' : 'payer'],
  ['firma corta', parsePaymentHeader(cabecera({ ...bueno, signature: '0xabcd' })).ok ? '' : 'firma'],
  ['value no numérico', parsePaymentHeader(cabecera({ ...bueno, value: 'gratis' })).ok ? '' : 'value'],
  ['value cero', parsePaymentHeader(cabecera({ ...bueno, value: '0' })).ok ? '' : 'cero'],
  ['value negativo', parsePaymentHeader(cabecera({ ...bueno, value: '-1' })).ok ? '' : 'negativo'],
];
for (const [nombre, motivo] of malas) check(`  se rechaza: ${nombre}`, motivo !== '', motivo);

console.log('\n── 3. Un permit firmado de verdad ──');

const nonce = 3n;
const valor = parseEther('0.002');
const deadline = 1_999_999_999n;
const datos = permitTypedData(DOMINIO, {
  owner: cliente.address,
  spender: AGENTE,
  value: valor,
  nonce,
  deadline,
});
const firma = await cliente.signTypedData(datos);

check(
  'el servidor acepta la firma del cliente',
  await verifyTypedData({ address: cliente.address, ...datos, signature: firma }),
);

// Cada uno de estos cambios es un ataque distinto: cobrar más, cobrar para otro,
// o reutilizar una firma ya gastada. Los tres tienen que fallar.
const manipulados: Array<[string, Parameters<typeof permitTypedData>[1]]> = [
  ['si le cambian el importe', { owner: cliente.address, spender: AGENTE, value: valor * 10n, nonce, deadline }],
  ['si le cambian a quién paga', { owner: cliente.address, spender: TOKEN, value: valor, nonce, deadline }],
  ['si se reutiliza con el nonce ya gastado', { owner: cliente.address, spender: AGENTE, value: valor, nonce: nonce + 1n, deadline }],
];
for (const [nombre, msg] of manipulados) {
  const valido = await verifyTypedData({
    address: cliente.address,
    ...permitTypedData(DOMINIO, msg),
    signature: firma,
  }).catch(() => false);
  check(`  la firma deja de valer ${nombre}`, valido === false);
}

const otro = privateKeyToAccount(generatePrivateKey());
check(
  '  una firma de otra wallet no cuela',
  (await verifyTypedData({ address: otro.address, ...datos, signature: firma }).catch(() => false)) === false,
);

console.log('\n── 4. La firma se parte para el contrato ──');

const { v, r, s } = splitSignature(firma);
check('v es 27 o 28', v === 27 || v === 28, String(v));
check('r y s son de 32 bytes', r.length === 66 && s.length === 66);
// Algunas wallets firman con v = 0/1 en vez de 27/28. Sin esta corrección, el
// `permit` revierte y el cobro falla con una firma que era perfectamente buena.
const cruda = (firma.slice(0, 130) + '00') as Hex;
check('una v de 0 se corrige a 27', splitSignature(cruda).v === 27);
check('una v de 1 se corrige a 28', splitSignature((firma.slice(0, 130) + '01') as Hex).v === 28);

console.log('\n── 5. La cola por pagador ──');

// Sin esto, dos llamadas simultáneas del MISMO cliente firman con el mismo
// nonce: una se consume y la otra revierte, después de haberle servido ya la
// respuesta. Es la trampa del esquema.
const orden: string[] = [];
const lento = async (etiqueta: string, ms: number): Promise<string> => {
  orden.push(`inicia ${etiqueta}`);
  await new Promise((r) => setTimeout(r, ms));
  orden.push(`acaba ${etiqueta}`);
  return etiqueta;
};

const mismo = cliente.address;
await Promise.all([
  enqueueByPayer(mismo, () => lento('A', 60)),
  enqueueByPayer(mismo, () => lento('B', 10)),
]);
check(
  'dos pagos del mismo pagador van en fila, no a la vez',
  orden.join(' → ') === 'inicia A → acaba A → inicia B → acaba B',
  orden.join(' → '),
);

const orden2: string[] = [];
const lento2 = async (etiqueta: string, ms: number): Promise<void> => {
  orden2.push(`inicia ${etiqueta}`);
  await new Promise((r) => setTimeout(r, ms));
  orden2.push(`acaba ${etiqueta}`);
};
await Promise.all([
  enqueueByPayer(otro.address, () => lento2('X', 40)),
  enqueueByPayer('0x00000000000000000000000000000000000000ff' as Address, () => lento2('Y', 5)),
]);
check(
  'pagadores distintos siguen en paralelo',
  orden2[0] === 'inicia X' && orden2[1] === 'inicia Y',
  orden2.join(' → '),
);

// Un fallo no puede dejar la cola atascada para siempre: el siguiente pago de
// ese cliente tiene que entrar igual.
await enqueueByPayer(mismo, () => Promise.reject(new Error('boom'))).catch(() => undefined);
check('un pago que falla no bloquea la cola', (await enqueueByPayer(mismo, async () => 'sigue')) === 'sigue');

console.log('\n── 6. El identificador del recurso ──');

const id1 = resourceId('POST', '/x402/ask', '{"prompt":"hola"}');
check('es estable para la misma petición', id1 === resourceId('POST', '/x402/ask', '{"prompt":"hola"}'));
check('cambia si cambia el cuerpo', id1 !== resourceId('POST', '/x402/ask', '{"prompt":"adiós"}'));
check('cambia si cambia la ruta', id1 !== resourceId('POST', '/otra', '{"prompt":"hola"}'));

console.log('');
if (failures === 0) console.log('✅ La mitad servidor de x402 cobra lo pactado y rechaza lo demás');
else {
  console.error(`❌ ${failures} comprobación(es) fallaron`);
  process.exitCode = 1;
}
