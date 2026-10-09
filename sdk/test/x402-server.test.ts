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

import { parseEther, verifyTypedData, type Address, type Hex, type PublicClient } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import {
  X402_NATIVE_SCHEME,
  X402_SERVER_SCHEME,
  X402_VERSION,
  buildNativeQuote,
  buildQuote,
  newQuoteSecret,
  parseX402Header,
  verifyNativePayment,
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

console.log('\n── 7. MON: cobrar una transferencia que manda el cliente ──');

{
  const secreto = newQuoteSecret();
  const recurso = resourceId('POST', '/x402/ask', '{"prompt":"hola"}');
  const precio = parseEther('2');
  const ahora = 2_000_000;
  const cotiza = () =>
    buildNativeQuote({ secret: secreto, price: precio, payTo: AGENTE, resource: recurso, description: 'x', payer: cliente.address, nowS: ahora }).accepts[0]!;
  const q = cotiza();
  const extra = BigInt(q.amount) - precio;
  check('el esquema es el de MON', q.scheme === X402_NATIVE_SCHEME, q.scheme);
  check('la moneda es la nativa', q.asset === '0x0000000000000000000000000000000000000000');
  check('pide el precio más unas pocas unidades al azar', extra >= 1n && extra <= 1_048_576n, extra.toString());
  check('lleva un código de pago de 32 bytes', /^0x[0-9a-f]{64}$/.test(q.paymentId), q.paymentId);
  // Dos cotizaciones casi nunca piden lo mismo: es lo que ata cada pago a la suya.
  const importes = new Set(Array.from({ length: 50 }, () => cotiza().amount));
  check('cincuenta cotizaciones, importes distintos', importes.size >= 49, `${importes.size} distintos`);

  const tx = ('0x' + 'ab'.repeat(32)) as Hex;
  const pago = { scheme: X402_NATIVE_SCHEME, payer: cliente.address, value: BigInt(q.amount), deadline: BigInt(q.deadline), paymentId: q.paymentId, txHash: tx };

  // Lo que diría la cadena. Por defecto, el pago de verdad.
  const cadena = (over: { from?: Address; to?: Address; value?: bigint; status?: string; ts?: number; falta?: boolean } = {}) =>
    ({
      getTransactionReceipt: async () => (over.falta ? null : { status: over.status ?? 'success', blockNumber: 7n }),
      getTransaction: async () => ({ from: over.from ?? cliente.address, to: over.to ?? AGENTE, value: over.value ?? BigInt(q.amount) }),
      getBlock: async () => ({ timestamp: BigInt(over.ts ?? ahora + 10) }),
    }) as unknown as PublicClient;
  const usados = () => new Set<string>();
  const comprobar = (pc: PublicClient, p = pago, extraDeps: { used?: Set<string>; secret?: Hex } = {}, resource = recurso) =>
    verifyNativePayment(
      { publicClient: pc, payee: AGENTE, secret: extraDeps.secret ?? secreto, used: extraDeps.used ?? usados(), nowS: ahora + 20, waitMs: 0 },
      p,
      { price: precio, resource },
    );

  const bien = await comprobar(cadena());
  check('el pago de verdad se acepta', bien.ok === true, bien.ok ? '' : bien.error);
  const memoria = usados();
  await comprobar(cadena(), pago, { used: memoria });
  const otraVez = await comprobar(cadena(), pago, { used: memoria });
  check('la misma transacción, una sola vez', !otraVez.ok && otraVez.status === 409, otraVez.ok ? '' : otraVez.error);

  const mal = async (nombre: string, r: ReturnType<typeof comprobar>, trozo: string) => {
    const x = await r;
    check(nombre, !x.ok && x.error.includes(trozo), x.ok ? 'SE ACEPTÓ' : x.error);
  };
  await mal('mandó menos de lo que pide la cotización', comprobar(cadena({ value: BigInt(q.amount) - 1n })), 'exactly');
  await mal('mandó más: tampoco es su cotización', comprobar(cadena({ value: BigInt(q.amount) + 1n })), 'exactly');
  await mal('la mandó otra wallet', comprobar(cadena({ from: '0x1111111111111111111111111111111111111111' })), 'someone else');
  await mal('la mandó a otra dirección', comprobar(cadena({ to: '0x2222222222222222222222222222222222222222' })), 'not sent to this agent');
  await mal('la transacción se revirtió', comprobar(cadena({ status: 'reverted' })), 'reverted');
  await mal('todavía no está en la cadena', comprobar(cadena({ falta: true })), 'not on chain');
  await mal('llegó después de caducar la cotización', comprobar(cadena({ ts: q.deadline + 5 })), 'after the quote expired');
  await mal('es anterior a la cotización', comprobar(cadena({ ts: ahora - 400 })), 'older than the quote');
  // EL ATAQUE: alguien ve la transferencia en la cadena y la presenta con una
  // cotización suya, o cambia el importe del pago para que cuadre.
  await mal('con el código de otra cotización', comprobar(cadena(), { ...pago, paymentId: cotiza().paymentId }), 'unknown or altered');
  await mal('cambiando el importe del pago', comprobar(cadena({ value: BigInt(q.amount) + 7n }), { ...pago, value: BigInt(q.amount) + 7n }), 'unknown or altered');
  await mal('presentada para otra pregunta', comprobar(cadena(), pago, {}, resourceId('POST', '/x402/ask', '{"prompt":"otra"}')), 'unknown or altered');
  await mal('con el secreto de otro agente', comprobar(cadena(), pago, { secret: newQuoteSecret() }), 'unknown or altered');
  await mal('por debajo del precio', comprobar(cadena(), { ...pago, value: 1n }), 'less than the price');

  console.log('');
  const cab = (p: Record<string, unknown>) => Buffer.from(JSON.stringify(p), 'utf8').toString('base64');
  const leida = parseX402Header(cab({ ...pago, value: pago.value.toString(), deadline: pago.deadline.toString() }));
  check('la cabecera de MON se lee', leida.ok && leida.payment.scheme === X402_NATIVE_SCHEME);
  const sinCodigo = parseX402Header(cab({ ...pago, value: '1', deadline: '1', paymentId: '0x12' }));
  check('sin un código de pago de verdad, no', !sinCodigo.ok);
  const permit = parseX402Header(cabecera({ scheme: X402_SERVER_SCHEME, payer: cliente.address, value: '1', deadline: '9', signature: '0x' + '11'.repeat(65) }));
  check('y la del permit se sigue leyendo igual', permit.ok && permit.payment.scheme === X402_SERVER_SCHEME);
}

console.log('');
if (failures === 0) console.log('✅ La mitad servidor de x402 cobra lo pactado y rechaza lo demás');
else {
  console.error(`❌ ${failures} comprobación(es) fallaron`);
  process.exitCode = 1;
}
