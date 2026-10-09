/**
 * La lista de monedas de x402, contra la cadena.
 *
 *     npx tsx test/currencies.test.ts
 *
 * El nombre y los decimales que se enseñan salen de esta lista, nunca de la
 * cotización del agente. Si la lista se equivocara —unos decimales mal
 * copiados—, todas las capas enseñarían el precio mal a la vez, y nadie lo
 * notaría hasta firmar. Por eso se compara con lo que dice cada token en
 * mainnet: símbolo, decimales y que tenga `permit`.
 */

import { createPublicClient, http, parseAbi } from 'viem';
import {
  formatX402Amount,
  monad,
  networkOfChain,
  parseX402Amount,
  x402Currencies,
  x402Currency,
  x402CurrencyByName,
} from '../src/index.js';

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (ok) console.log(`✅ ${label}${detail ? `: ${detail}` : ''}`);
  else {
    failures += 1;
    console.error(`❌ ${label}${detail ? `: ${detail}` : ''}`);
  }
}

const abi = parseAbi([
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function DOMAIN_SEPARATOR() view returns (bytes32)',
  'function nonces(address) view returns (uint256)',
]);

async function main(): Promise<void> {
  console.log('── 1. Cada moneda de la lista, tal y como es en mainnet ──');
  const client = createPublicClient({ chain: monad, transport: http() });
  for (const c of x402Currencies('mainnet')) {
    const [symbol, decimals] = await Promise.all([
      client.readContract({ address: c.address, abi, functionName: 'symbol' }),
      client.readContract({ address: c.address, abi, functionName: 'decimals' }),
    ]);
    check(`${c.symbol}: decimales iguales a los de la cadena`, decimals === c.decimals, `${decimals}`);
    check(`${c.symbol}: es el token que dice ser`, c.symbol.replace(/^\$/, '').toUpperCase() === symbol.toUpperCase(), symbol);
    const permit = await client
      .readContract({ address: c.address, abi, functionName: 'nonces', args: [c.address] })
      .then(() => true, () => false);
    check(`${c.symbol}: tiene permit (EIP-2612)`, permit);
  }

  console.log('\n── 2. Buscar por dirección y por nombre ──');
  const usdc = x402CurrencyByName('usdc')!;
  check('USDC por nombre', usdc?.decimals === 6, usdc?.address);
  check('$PANAL con y sin el $', x402CurrencyByName('PANAL')?.symbol === '$PANAL' && x402CurrencyByName('$panal')?.symbol === '$PANAL');
  check('por dirección, en minúsculas', x402Currency(usdc.address.toLowerCase())?.symbol === 'USDC');
  check('un token cualquiera no está', x402Currency('0x4444444444444444444444444444444444444444') === null);
  check('MON no es de x402 (todavía)', x402CurrencyByName('MON') === null);
  check('en testnet no hay monedas', x402Currencies('testnet').length === 0);
  check('143 es mainnet y 10143 testnet', networkOfChain(143) === 'mainnet' && networkOfChain(10143) === 'testnet' && networkOfChain(1) === null);

  console.log('\n── 3. Los decimales de cada una ──');
  check('0,05 USDC son 50.000 unidades', parseX402Amount('0.05', usdc) === 50_000n);
  check('y se vuelven a leer igual', formatX402Amount(50_000n, usdc) === '0.05');
  const gho = x402CurrencyByName('GHO')!;
  check('0,05 GHO son 5·10¹⁶ unidades', parseX402Amount('0.05', gho) === 50_000_000_000_000_000n);
  // El caso del agujero, visto desde aquí: el mismo número crudo vale 10¹² veces más en USDC.
  check('mil millones de unidades: 1.000 USDC', formatX402Amount(1_000_000_000n, usdc) === '1000');

  console.log('');
  if (failures === 0) console.log('✅ La lista de monedas coincide con la cadena');
  else {
    console.error(`❌ ${failures} comprobación(es) fallaron`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(`❌ error inesperado: ${err instanceof Error ? err.message : err}`);
  process.exitCode = 1;
});
