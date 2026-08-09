/**
 * Pruebas de x402 (`src/x402.ts`) — cobro por llamada.
 *
 *   npx tsx scripts/test-x402.ts     (o: pnpm test:x402)
 *
 * Toca Monad mainnet, pero SOLO LECTURA: no mueve un céntimo. Lo hace porque la
 * comprobación más importante de todas solo tiene sentido contra el token real.
 *
 * LA COMPROBACIÓN QUE IMPORTA: que el dominio EIP-712 que construimos produzca
 * exactamente el mismo DOMAIN_SEPARATOR que el $PANAL desplegado. Si no
 * coincidiera, las firmas verificarían perfectamente en local y REVERTIRÍAN al
 * llegar al contrato — un fallo que solo aparece en producción y con dinero de
 * por medio. Aquí se detecta gratis.
 */

import {
  createPublicClient,
  hashDomain,
  hashTypedData,
  http,
  parseEther,
  type Address,
  type Hex,
} from 'viem';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { monad } from '../src/chain.js';
import {
  buildQuote,
  enqueueByPayer,
  parsePaymentHeader,
  permitNonce,
  permitTypedData,
  readPermitDomain,
  SCHEME,
  splitSignature,
  verifyAndSettle,
  type PermitDomain,
} from '../src/x402.js';

const RPC_URL = process.env.RPC_URL?.trim() || 'https://rpc.monad.xyz';
const PANAL_TOKEN = '0x2e2e44e7fa6178822d4397299f719e89d1a67777' as Address;

let failures = 0;

function check(label: string, condition: boolean, detail = ''): void {
  if (condition) console.log(`✅ ${label}${detail ? `: ${detail}` : ''}`);
  else {
    failures += 1;
    console.error(`❌ ${label}${detail ? `: ${detail}` : ''}`);
  }
}

const publicClient = createPublicClient({ chain: monad, transport: http(RPC_URL) });
const clients = { publicClient } as never;

async function main(): Promise<void> {
  console.log('── 1. Dominio EIP-712 contra el $PANAL real de mainnet ──');

  const domain: PermitDomain = await readPermitDomain(clients, PANAL_TOKEN);
  check('se lee el dominio del token', domain.name === 'PANAL' && domain.version === '1', JSON.stringify(domain));
  check('chainId del dominio es Monad mainnet', domain.chainId === 143, String(domain.chainId));

  const onChainSeparator = (await publicClient.readContract({
    address: PANAL_TOKEN,
    abi: [
      {
        type: 'function',
        name: 'DOMAIN_SEPARATOR',
        stateMutability: 'view',
        inputs: [],
        outputs: [{ name: '', type: 'bytes32' }],
      },
    ] as const,
    functionName: 'DOMAIN_SEPARATOR',
  })) as Hex;
  const computed = hashDomain({
    domain,
    types: {
      EIP712Domain: [
        { name: 'name', type: 'string' },
        { name: 'version', type: 'string' },
        { name: 'chainId', type: 'uint256' },
        { name: 'verifyingContract', type: 'address' },
      ],
    },
  });
  check(
    'nuestro DOMAIN_SEPARATOR coincide con el del contrato',
    computed.toLowerCase() === onChainSeparator.toLowerCase(),
    `${computed.slice(0, 20)}… vs ${onChainSeparator.slice(0, 20)}…`,
  );

  console.log('\n── 2. Firma del permit: ida y vuelta ──');

  const payerAccount = privateKeyToAccount(generatePrivateKey());
  const payee = '0x17b59Ac5B740De1549F6F92D47599Eaaf99F9302' as Address;
  const value = parseEther('0.002');
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);

  const nonce = await permitNonce(clients, PANAL_TOKEN, payerAccount.address);
  check('se lee el nonce del pagador en cadena', nonce === 0n, `nonce=${nonce}`);

  const typed = permitTypedData(domain, {
    owner: payerAccount.address,
    spender: payee,
    value,
    nonce,
    deadline,
  });
  const signature = await payerAccount.signTypedData(typed);
  check('la firma tiene 65 bytes', signature.length === 132, `${(signature.length - 2) / 2} bytes`);

  const { v, r, s } = splitSignature(signature);
  check('v queda normalizada a 27/28', v === 27 || v === 28, String(v));
  check('r y s son bytes32', r.length === 66 && s.length === 66);

  // Que el hash tipado cambie con cada campo es lo que impide reutilizar una
  // firma para otro cobro: otro importe, otro destinatario u otro nonce dan
  // otro digest y la verificación falla.
  const baseHash = hashTypedData(typed);
  const otherValue = hashTypedData(
    permitTypedData(domain, { owner: payerAccount.address, spender: payee, value: value + 1n, nonce, deadline }),
  );
  const otherNonce = hashTypedData(
    permitTypedData(domain, { owner: payerAccount.address, spender: payee, value, nonce: nonce + 1n, deadline }),
  );
  const otherSpender = hashTypedData(
    permitTypedData(domain, {
      owner: payerAccount.address,
      spender: '0x000000000000000000000000000000000000dEaD',
      value,
      nonce,
      deadline,
    }),
  );
  check('cambiar el importe cambia el digest', baseHash !== otherValue);
  check('cambiar el nonce cambia el digest (no hay repetición)', baseHash !== otherNonce);
  check('cambiar el cobrador cambia el digest', baseHash !== otherSpender);

  console.log('\n── 3. Cabecera X-Payment ──');

  const encode = (o: unknown): string => Buffer.from(JSON.stringify(o)).toString('base64');
  const good = encode({ scheme: SCHEME, payer: payerAccount.address, value: value.toString(), deadline: deadline.toString(), signature });
  const parsed = parsePaymentHeader(good);
  check('se descodifica una cabecera válida', parsed.ok, parsed.ok ? '' : parsed.error);
  if (parsed.ok) {
    check('conserva importe y pagador', parsed.payment.value === value && parsed.payment.payer === payerAccount.address);
  }

  const cases: [string, string, string][] = [
    ['base64 inválido', '!!!no-es-base64!!!', 'base64'],
    ['JSON inválido', Buffer.from('no soy json').toString('base64'), 'JSON'],
    ['esquema desconocido', encode({ ...JSON.parse(Buffer.from(good, 'base64').toString()), scheme: 'tarjeta' }), 'esquema'],
    ['pagador inválido', encode({ scheme: SCHEME, payer: 'pepe', value: '1', deadline: '1', signature }), 'payer'],
    ['firma corta', encode({ scheme: SCHEME, payer: payerAccount.address, value: '1', deadline: '1', signature: '0xabcd' }), 'firma'],
    ['importe cero', encode({ scheme: SCHEME, payer: payerAccount.address, value: '0', deadline: '1', signature }), 'mayor que cero'],
  ];
  for (const [label, header, fragment] of cases) {
    const res = parsePaymentHeader(header);
    check(`rechaza ${label}`, !res.ok && res.error.includes(fragment), res.ok ? 'lo aceptó' : res.error);
  }

  console.log('\n── 4. Presupuesto del 402 ──');

  const quote = buildQuote({
    asset: PANAL_TOKEN,
    assetSymbol: '$PANAL',
    amount: value,
    payTo: payee,
    resource: '/x402/ask',
    description: 'Una pregunta al agente',
    domain,
    payerNonce: nonce,
  });
  check('versión y esquema correctos', quote.x402Version === 1 && quote.accepts[0]!.scheme === SCHEME);
  check('lleva el dominio para que el cliente no tenga que leerlo', quote.accepts[0]!.domain.name === 'PANAL');
  check('lleva chainId de Monad', quote.accepts[0]!.chainId === 143);
  check('el presupuesto caduca en el futuro', quote.accepts[0]!.deadline > Math.floor(Date.now() / 1000));
  check('incluye el nonce del pagador cuando se conoce', quote.accepts[0]!.payerNonce === nonce.toString());

  console.log('\n── 5. Guardas del cobro (sin gastar nada) ──');

  const deps = { clients, cfg: {} as never, token: PANAL_TOKEN, domain, payee };

  const underpaid = await verifyAndSettle(deps, { scheme: SCHEME, payer: payerAccount.address, value, deadline, signature }, value * 2n);
  check('pagar de menos se rechaza con 402', !underpaid.ok && underpaid.status === 402, underpaid.ok ? '' : underpaid.error);

  const expired = await verifyAndSettle(
    deps,
    { scheme: SCHEME, payer: payerAccount.address, value, deadline: BigInt(Math.floor(Date.now() / 1000) - 10), signature },
    value,
  );
  check('una autorización caducada se rechaza', !expired.ok && expired.status === 402, expired.ok ? '' : expired.error);

  // Sin wallet no se puede cobrar, y sin cobrar no se sirve: nunca se regala.
  const noWallet = await verifyAndSettle(deps, { scheme: SCHEME, payer: payerAccount.address, value, deadline, signature }, value);
  check('sin wallet del agente no se cobra ni se sirve', !noWallet.ok && noWallet.status === 503, noWallet.ok ? '' : noWallet.error);

  console.log('\n── 6. Cola por pagador (la trampa del nonce secuencial) ──');

  // Dos pagos en paralelo del MISMO pagador firmarían el mismo nonce y uno
  // revertiría. La cola los pone en fila; los pagadores distintos no se estorban.
  const order: string[] = [];
  const slow = (tag: string, ms: number) => async () => {
    order.push(`${tag}:inicio`);
    await new Promise((r) => setTimeout(r, ms));
    order.push(`${tag}:fin`);
    return tag;
  };
  const payerA = payerAccount.address;
  await Promise.all([enqueueByPayer(payerA, slow('a1', 60)), enqueueByPayer(payerA, slow('a2', 10))]);
  check(
    'dos pagos del mismo pagador NO se solapan',
    order.join(',') === 'a1:inicio,a1:fin,a2:inicio,a2:fin',
    order.join(','),
  );

  const order2: string[] = [];
  const tag = (t: string, ms: number) => async () => {
    await new Promise((r) => setTimeout(r, ms));
    order2.push(t);
  };
  const payerB = privateKeyToAccount(generatePrivateKey()).address;
  await Promise.all([enqueueByPayer(payerA, tag('lento', 50)), enqueueByPayer(payerB, tag('rapido', 5))]);
  check('pagadores distintos sí van en paralelo', order2[0] === 'rapido', order2.join(','));

  // Un fallo no debe atascar la cola de ese pagador para siempre.
  await enqueueByPayer(payerA, async () => {
    throw new Error('fallo simulado');
  }).catch(() => undefined);
  const after = await enqueueByPayer(payerA, async () => 'sigue viva');
  check('un cobro fallido no bloquea los siguientes', after === 'sigue viva');

  console.log('');
  if (failures === 0) console.log('✅ Todas las comprobaciones x402 pasaron');
  else {
    console.error(`❌ ${failures} comprobación(es) fallaron`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(`❌ error inesperado: ${err instanceof Error ? err.message : err}`);
  process.exitCode = 1;
});
