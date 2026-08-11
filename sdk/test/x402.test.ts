/**
 * Pruebas del cliente x402 del SDK — la mitad que permite que un agente PAGUE
 * a otro sin humano de por medio.
 *
 *   npx tsx test/x402.test.ts
 *
 * Cotiza contra el endpoint REAL de mainnet, que es gratis y no compromete a
 * nada: el 402 es una cotización. NO firma ni paga: la wallet de prueba se
 * genera al vuelo y no tiene fondos, así que ni podría.
 *
 * Lo que de verdad se comprueba son las negativas. Este cliente firma
 * autorizaciones para que otro se lleve saldo: cada comprobación que falle en
 * silencio es dinero de alguien.
 */

import { createWalletClient, http, parseEther } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import {
  X402Error,
  assertPublicUrl,
  createPanalClient,
  isPrivateIp,
  monad,
  payAndAsk,
  quoteAsk,
  X402_SCHEME,
  type X402Accept,
} from '../src/index.js';

let failures = 0;

function check(label: string, ok: boolean, detail = ''): void {
  if (ok) console.log(`✅ ${label}${detail ? `: ${detail}` : ''}`);
  else {
    failures += 1;
    console.error(`❌ ${label}${detail ? `: ${detail}` : ''}`);
  }
}

async function rejects(label: string, fn: () => Promise<unknown>, fragment: string): Promise<void> {
  try {
    await fn();
    check(label, false, 'NO fue rechazado, y debía serlo');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    check(label, msg.toLowerCase().includes(fragment.toLowerCase()), msg.split('\n')[0]!);
  }
}

/** El endpoint x402 vivo del agente de Panal en mainnet. */
const ENDPOINT = 'https://bot.panal.lat/x402/ask';

const account = privateKeyToAccount(generatePrivateKey());
const wallet = createWalletClient({ account, chain: monad, transport: http() });

/** Cotización de mentira, para probar las negativas sin depender de la red. */
function fakeQuote(over: Partial<X402Accept> = {}): X402Accept {
  return {
    scheme: X402_SCHEME,
    chainId: 143,
    asset: '0x2E2e44E7FA6178822D4397299F719e89d1a67777',
    amount: parseEther('0.002').toString(),
    payTo: '0x8a672775121DeB778E19158425b34eE4F85F8539',
    deadline: Math.floor(Date.now() / 1000) + 600,
    payerNonce: '0',
    domain: {
      name: 'PANAL',
      version: '1',
      chainId: 143,
      verifyingContract: '0x2E2e44E7FA6178822D4397299F719e89d1a67777',
    },
    ...over,
  };
}

const base = { maxSpend: parseEther('1'), chainId: 143 } as const;

async function main(): Promise<void> {
  console.log('── 1. La cotización es gratis (endpoint real de mainnet) ──');

  const accept = await quoteAsk(ENDPOINT, 'hola', { payer: account.address });
  check('un agente vivo cotiza sin cobrar nada', accept.amount !== undefined, `${accept.amount} de ${accept.assetSymbol}`);
  check('el esquema es el que sabemos pagar', accept.scheme === X402_SCHEME, accept.scheme);
  check('viene el dominio EIP-712 para firmar', accept.domain?.name === 'PANAL', JSON.stringify(accept.domain?.name));
  check('el dominio es el del propio token', accept.domain.verifyingContract.toLowerCase() === accept.asset.toLowerCase());
  check('la cotización no ha caducado', accept.deadline > Math.floor(Date.now() / 1000));
  // Sin el nonce habría que leerlo de la cadena: pedirlo con la dirección lo ahorra.
  check('nos devuelve nuestro nonce por decir quiénes somos', accept.payerNonce !== undefined, accept.payerNonce);

  console.log('\n── 2. Nada se firma si algo no cuadra ──');

  await rejects(
    'un precio por encima del tope',
    () => payAndAsk(wallet, account, ENDPOINT, 'x', { ...base, maxSpend: 1n, quote: fakeQuote() }),
    'tope',
  );
  await rejects(
    'una cotización de otra cadena',
    () => payAndAsk(wallet, account, ENDPOINT, 'x', { ...base, quote: fakeQuote({ chainId: 1 }) }),
    'cadena',
  );
  // El caso peligroso de verdad: endpoint secuestrado que cobra a nombre de otro.
  await rejects(
    'un cobrador distinto del agente elegido',
    () =>
      payAndAsk(wallet, account, ENDPOINT, 'x', {
        ...base,
        expectedPayee: '0x1111111111111111111111111111111111111111',
        quote: fakeQuote(),
      }),
    'esperabas',
  );
  await rejects(
    'un token distinto del esperado',
    () =>
      payAndAsk(wallet, account, ENDPOINT, 'x', {
        ...base,
        asset: '0x2222222222222222222222222222222222222222',
        quote: fakeQuote(),
      }),
    'pagar en',
  );
  // Un dominio que apunte a otro contrato haría que la firma valga para algo distinto.
  await rejects(
    'un dominio de firma que no es el del token',
    () =>
      payAndAsk(wallet, account, ENDPOINT, 'x', {
        ...base,
        quote: fakeQuote({
          domain: { name: 'X', version: '1', chainId: 143, verifyingContract: '0x3333333333333333333333333333333333333333' },
        }),
      }),
    'dominio',
  );
  await rejects(
    'una cotización a punto de caducar',
    () => payAndAsk(wallet, account, ENDPOINT, 'x', { ...base, quote: fakeQuote({ deadline: Math.floor(Date.now() / 1000) + 5 }) }),
    'caduca',
  );
  await rejects(
    'un importe de cero',
    () => payAndAsk(wallet, account, ENDPOINT, 'x', { ...base, quote: fakeQuote({ amount: '0' }) }),
    'cero',
  );

  console.log('\n── 3. URLs ajenas: vienen del metadata on-chain ──');

  await rejects('el servicio de metadatos de la nube', () => assertPublicUrl('https://169.254.169.254/x'), 'interna');
  await rejects('una IP privada', () => assertPublicUrl('https://10.0.0.5/x'), 'interna');
  await rejects('localhost por nombre', () => assertPublicUrl('https://localhost/x'), 'local');
  await rejects('http en claro (la firma viaja en la petición)', () => assertPublicUrl('http://203.0.113.7/x'), 'https');
  await rejects('credenciales embebidas', () => assertPublicUrl('https://u:p@203.0.113.7/x'), 'credenciales');
  check('una IP pública pasa', (await assertPublicUrl('https://203.0.113.7/x')).hostname === '203.0.113.7');
  check('el endpoint real de Panal pasa', (await assertPublicUrl(ENDPOINT)).hostname === 'bot.panal.lat');
  check('CGNAT se considera privada', isPrivateIp('100.64.0.1'));
  check('IPv4 mapeada en IPv6 también', isPrivateIp('::ffff:10.0.0.1'));
  check('una pública no se marca como privada', !isPrivateIp('8.8.8.8'));

  console.log('\n── 4. ask(): descubrir, cotizar y elegir ──');

  const panal = createPanalClient({ account });
  await rejects(
    'una skill que no tiene nadie se explica',
    () => panal.ask('zzz-skill-que-no-existe', 'hola', { maxSpend: parseEther('1') }),
    'ningún agente',
  );
  // El tope se aplica ANTES de pagar: con un presupuesto ridículo no hay trato.
  await rejects(
    'con presupuesto insuficiente no se paga a nadie',
    () => panal.ask('legal', 'hola', { maxSpend: 1n }),
    'presupuesto',
  );
  // Un agente no debe poder llamarse a sí mismo: sería pagarse solo y gastar gas.
  const agentes = await panal.searchAgents('legal');
  if (agentes.length) {
    const yo = createPanalClient({ account: privateKeyToAccount(generatePrivateKey()) });
    check('searchAgents encuentra candidatos con endpoint', agentes.some((a) => a.metadata.botUrl), `${agentes.length} con la skill`);
    check('el propio cliente queda excluido de sus candidatos', yo.account!.address !== agentes[0]!.address);
  }

  console.log('');
  if (failures === 0) console.log('✅ El cliente x402 cotiza contra mainnet y rechaza todo lo que no cuadra');
  else {
    console.error(`❌ ${failures} comprobación(es) fallaron`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(`❌ error inesperado: ${err instanceof Error ? err.message : err}`);
  if (err instanceof X402Error) console.error(`   (X402Error status=${err.status})`);
  process.exitCode = 1;
});
