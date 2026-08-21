/**
 * Hablar con un agente: la parte que se puede probar sin gastar dinero.
 *
 *     npx tsx scripts/test-chat.ts
 *
 * Cotizar es GRATIS y no compromete a nada — es la propiedad más útil de x402
 * y la que permite probar el camino entero salvo la firma. Así que esto sí
 * habla con un agente de verdad en mainnet, y no firma nada.
 *
 * Lo que se comprueba:
 *   · que se lee de la tarjeta si el agente cobra por llamada y cuánto,
 *   · que un agente sin x402 devuelve null en vez de un chat imposible de pagar,
 *   · y que la cotización que llega coincide con lo que anunciaba la tarjeta,
 *     que es de lo que dependen las comprobaciones previas a la firma.
 */
import { leerCobroPorLlamada, cotizar, motivoLegible } from '../src/lib/chat.js';
import { X402Error } from '@panal/sdk';

const AGENTE = 'https://lint.panal.lat';
/** Una dirección cualquiera: cotizar no compromete a quien pregunta. */
const PAGADOR = '0x69D084926e68af78cDa512eF1Bf2c3e7B4307CBf' as const;

let fallos = 0;
const check = (nombre: string, ok: boolean, detalle = ''): void => {
  console.log(`${ok ? '✅' : '❌'} ${nombre}${ok ? '' : ` — ${detalle}`}`);
  if (!ok) fallos++;
};

console.log('\n── La tarjeta del agente ──\n');

const cobro = await leerCobroPorLlamada(AGENTE);
if (!cobro) {
  console.log(`❌ ${AGENTE} no anuncia cobro por llamada; sin eso no hay nada que probar`);
  process.exit(1);
}
check('anuncia cobro por llamada', true, '');
check('con un importe positivo', cobro.amount > 0n, String(cobro.amount));
check('en un token concreto', /^0x[0-9a-fA-F]{40}$/.test(cobro.asset), cobro.asset);
check('y diciendo quién cobra', /^0x[0-9a-fA-F]{40}$/.test(cobro.payTo), cobro.payTo);
console.log(`   ${Number(cobro.amount) / 1e18} ${cobro.simbolo} por mensaje → ${cobro.endpoint}`);

console.log('\n── La cotización, que es gratis ──\n');

const q = await cotizar(cobro, '¿Qué es una reentrada?', PAGADOR);
check('el esquema es el que sabemos firmar', q.scheme === 'eip2612-permit', q.scheme);
check('la cadena es la activa', q.chainId === 143, String(q.chainId));

// Estas tres son de las que dependen las comprobaciones previas a la firma: si
// la cotización dijera otro cobrador u otro token que la tarjeta, `payAndAsk`
// se negaría a firmar. Que coincidan es lo que hace utilizable el camino.
check(
  'cobra a quien decía la tarjeta',
  q.payTo.toLowerCase() === cobro.payTo.toLowerCase(),
  `${q.payTo} vs ${cobro.payTo}`,
);
check(
  'en el token que decía la tarjeta',
  q.asset.toLowerCase() === cobro.asset.toLowerCase(),
  `${q.asset} vs ${cobro.asset}`,
);
check('por el importe que decía la tarjeta', BigInt(q.amount) === cobro.amount, `${q.amount} vs ${cobro.amount}`);

check('trae el nonce del pagador', q.payerNonce !== undefined, 'sin nonce no se puede firmar el permit');
check('y una caducidad con margen', q.deadline > Math.floor(Date.now() / 1000) + 30, String(q.deadline));
check(
  'el dominio de firma es el del propio token',
  q.domain.verifyingContract.toLowerCase() === q.asset.toLowerCase(),
  'si apuntara a otro contrato, la firma valdría para otra cosa',
);

console.log('\n── Lo que no se puede pagar, no se ofrece ──\n');

check('un endpoint que no existe devuelve null', (await leerCobroPorLlamada('https://no-existe.panal.lat')) === null);
check(
  'y un mensaje de error se traduce a algo legible',
  motivoLegible(new X402Error('La cotización caduca de inmediato: pide otra.')).length > 10,
);

console.log(
  fallos === 0
    ? '\n✅ Se puede preguntar el precio a un agente y firmar sabiendo exactamente qué se paga\n'
    : `\n❌ ${fallos} comprobación(es) fallidas\n`,
);
process.exit(fallos === 0 ? 0 : 1);
