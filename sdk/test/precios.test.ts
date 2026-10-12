/**
 * Pruebas de los precios en dólares.
 *
 *   npx tsx test/precios.test.ts
 *
 * Dos partes:
 *   1. HERMÉTICA: la cadena y las APIs se sustituyen por dobles. Protege el
 *      orden de las fuentes (Pyth, luego CoinGecko; curva, luego API), que un
 *      precio viejo no se enseñe y el formato de las cantidades pequeñas.
 *   2. CONTRA MAINNET, SOLO LECTURA: Pyth y la curva de nad.fun responden con
 *      las direcciones y el ABI de aquí. Las aserciones son estructurales —que
 *      haya precio y sea positivo—, nunca un valor: el precio se mueve.
 */

import { createPublicClient, http, parseEther } from 'viem';
import { monad } from 'viem/chains';
import {
  enDolares,
  esFresco,
  formatearDolares,
  leerPrecios,
  valorDeVenta,
  MERCADO_PANAL,
  PYTH_MONAD,
  type Precios,
} from '../src/precios.js';

let fallos = 0;
const check = (nombre: string, ok: boolean, detalle = ''): void => {
  console.log(`${ok ? '✅' : '❌'} ${nombre}${detalle ? ` — ${detalle}` : ''}`);
  if (!ok) fallos++;
};

const AHORA = 1_800_000_000;

/** Un lector de la cadena de mentira: Pyth y la curva responden lo que se diga. */
function lector(opts: { pyth?: { precio: bigint; expo: number; hace: number } | 'cae'; curva?: 'cae' }) {
  return {
    readContract: async (args: { address: string; functionName: string; args?: readonly unknown[] }) => {
      if (args.address === PYTH_MONAD) {
        if (!opts.pyth || opts.pyth === 'cae') throw new Error('pyth caído');
        return { price: opts.pyth.precio, conf: 0n, expo: opts.pyth.expo, publishTime: BigInt(AHORA - opts.pyth.hace) };
      }
      if (args.address === MERCADO_PANAL) {
        if (opts.curva === 'cae') throw new Error('curva caída');
        const [, cantidad, compra] = args.args as [string, bigint, boolean];
        // Mercado a 0,000242 MON por $PANAL, con un 2 % de comisión en cada sentido.
        if (compra) return (cantidad * 1_000_000n * 98n) / (242n * 100n);
        return (cantidad * 242n * 98n) / (1_000_000n * 100n);
      }
      throw new Error(`lectura inesperada: ${args.address}`);
    },
  } as never;
}

/** Un `fetch` de mentira que cuenta las llamadas. */
function fetchFalso(respuestas: Record<string, unknown>) {
  const llamadas: string[] = [];
  const f = (async (url: string) => {
    llamadas.push(url);
    const clave = Object.keys(respuestas).find((k) => url.includes(k));
    if (!clave) return new Response('no', { status: 503 });
    return new Response(JSON.stringify(respuestas[clave]), { status: 200 });
  }) as unknown as typeof fetch;
  return { f, llamadas };
}

console.log('\nlas fuentes, en orden');
{
  const { f, llamadas } = fetchFalso({});
  const p = await leerPrecios(lector({ pyth: { precio: 2490825n, expo: -8, hace: 20 } }), { fetch: f, ahora: AHORA });
  check('MON de Pyth', p.mon?.fuente === 'pyth' && Math.abs(p.mon.valor - 0.02490825) < 1e-12, JSON.stringify(p.mon));
  check('$PANAL de la curva', p.panalEnMon?.fuente === 'nadfun-curva', JSON.stringify(p.panalEnMon));
  check(
    'el punto medio quita la comisión: 0,000242 MON por $PANAL',
    Math.abs((p.panalEnMon?.valor ?? 0) - 0.000242) < 1e-9,
    String(p.panalEnMon?.valor),
  );
  check('$PANAL en dólares = los dos multiplicados', Math.abs((p.panal?.valor ?? 0) - 0.02490825 * 0.000242) < 1e-12);
  check('con Pyth fresco no se llama a ninguna API', llamadas.length === 0, llamadas.join(', '));
}
{
  const { f } = fetchFalso({ coingecko: { monad: { usd: 0.025, last_updated_at: AHORA - 30 } } });
  const p = await leerPrecios(lector({ pyth: { precio: 2490825n, expo: -8, hace: 3600 } }), { fetch: f, ahora: AHORA });
  check('Pyth viejo: CoinGecko, que es más reciente', p.mon?.fuente === 'coingecko' && p.mon.valor === 0.025);
}
{
  const { f } = fetchFalso({ coingecko: { monad: { usd: 0.025, last_updated_at: AHORA - 30 } } });
  const p = await leerPrecios(lector({ pyth: 'cae' }), { fetch: f, ahora: AHORA });
  check('Pyth caído: CoinGecko', p.mon?.fuente === 'coingecko');
}
{
  const { f } = fetchFalso({});
  const p = await leerPrecios(lector({ pyth: { precio: 2490825n, expo: -8, hace: 3600 } }), { fetch: f, ahora: AHORA });
  check('Pyth viejo y CoinGecko caído: se devuelve el viejo, con su fecha', p.mon?.fuente === 'pyth' && !esFresco(p.mon, AHORA));
}
{
  const { f } = fetchFalso({ 'nad.fun': { market_info: { price_native: '0.0002419825' } } });
  const p = await leerPrecios(lector({ pyth: { precio: 2490825n, expo: -8, hace: 20 }, curva: 'cae' }), {
    fetch: f,
    ahora: AHORA,
  });
  check('curva caída: la API de nad.fun', p.panalEnMon?.fuente === 'nadfun-api' && p.panalEnMon.valor === 0.0002419825);
}
{
  const { f } = fetchFalso({});
  const p = await leerPrecios(lector({ pyth: 'cae', curva: 'cae' }), { fetch: f, ahora: AHORA });
  check('todo caído: nulos, sin lanzar', p.mon === null && p.panalEnMon === null && p.panal === null);
}

console.log('\nnunca un número viejo sin decirlo');
{
  const precios: Precios = {
    mon: { valor: 0.0249, actualizado: AHORA - 20, fuente: 'pyth' },
    panalEnMon: { valor: 0.000242, actualizado: AHORA, fuente: 'nadfun-curva' },
    panal: { valor: 0.0249 * 0.000242, actualizado: AHORA - 20, fuente: 'nadfun-curva' },
  };
  const tres = enDolares(parseEther('3'), 'MON', precios, AHORA);
  check('3 MON ≈ $0,075', !!tres && Math.abs(tres.usd - 0.0747) < 1e-9, String(tres?.usd));
  const cien = enDolares(parseEther('100000'), '$PANAL', precios, AHORA);
  check('100.000 $PANAL ≈ $0,60', !!cien && Math.abs(cien.usd - 0.602) < 0.001, String(cien?.usd));
  check('a los 5 minutos todavía se enseña', enDolares(1n, 'MON', precios, AHORA - 20 + 300) !== null);
  check('pasados 5 minutos, nada', enDolares(1n, 'MON', precios, AHORA - 20 + 301) === null);
  check('sin precios, nada', enDolares(1n, 'MON', null, AHORA) === null);
}

console.log('\nel formato');
for (const [usd, esperado] of [
  [0.0747, '$0.075'],
  [0.0006023, '$0.0006'],
  [0.000006, '$0.000006'],
  [0.59, '$0.59'],
  [1.5, '$1.50'],
  [1234.5, '$1,234.50'],
  [0, '$0'],
  [0.0000001, '< $0.000001'],
] as const) {
  check(`${usd} → ${esperado}`, formatearDolares(usd) === esperado, formatearDolares(usd));
}
check('en español, con coma', formatearDolares(1.5, 'es-ES').startsWith('1,50'), formatearDolares(1.5, 'es-ES'));

console.log('\ncontra Monad mainnet (solo lectura)');
{
  const cliente = createPublicClient({ chain: monad, transport: http('https://rpc.monad.xyz') });
  const p = await leerPrecios(cliente, { fetch: (async () => new Response('no', { status: 503 })) as never });
  check('Pyth responde con un precio de MON', p.mon?.fuente === 'pyth' && p.mon.valor > 0, JSON.stringify(p.mon));
  if (p.mon) console.log(`   MON = $${p.mon.valor} · publicado hace ${Math.floor(Date.now() / 1000) - p.mon.actualizado} s`);
  check(
    'la curva de nad.fun responde con un precio de $PANAL',
    p.panalEnMon?.fuente === 'nadfun-curva' && p.panalEnMon.valor > 0,
    JSON.stringify(p.panalEnMon),
  );
  const venta = await valorDeVenta(cliente, parseEther('100000'));
  check('el valor de venta sale por debajo del de mercado', venta !== null && p.panalEnMon !== null && Number(venta) / 1e18 < 100000 * p.panalEnMon.valor);
}

if (fallos) {
  console.error(`\n❌ ${fallos} fallo(s)`);
  process.exit(1);
}
console.log('\n✅ todo bien');
