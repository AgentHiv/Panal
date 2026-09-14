/**
 * La retirada automática del escrow.
 *
 *   npx tsx test/retirada.test.ts
 *
 * HERMÉTICO: la cadena y la wallet son dobles, con las cifras medidas en
 * mainnet el 2026-09-14 — retirar MON 55.157 de gas, $PANAL 103.511, a 122 gwei
 * de precio máximo— y los saldos que de verdad tenían los agentes de Panal.
 *
 * Lo que se protege:
 *   1. Que retire lo que compensa y NO lo que el gas se comería.
 *   2. Que no toque la wallet con un encargo en marcha.
 *   3. Que sin MON para la reserva avise en vez de mandar una transacción
 *      condenada (y cacheada por el nodo).
 *   4. Que un revert no cuente como retirado, y que nada lance.
 */

import { parseEther, type Address, type Hex } from 'viem';
import { gasConMargen, opcionesDelEntorno, repasarRetirada, RETIRADA_POR_DEFECTO, TOPE_GAS } from '../template/src/retirada.js';

let fallos = 0;
const check = (nombre: string, ok: boolean, detalle = ''): void => {
  console.log(`${ok ? '✅' : '❌'} ${nombre}${ok ? '' : ` — ${detalle}`}`);
  if (!ok) fallos++;
};

const MON = '0x0000000000000000000000000000000000000000' as Address;
const PANAL = '0x2e2e44e7fa6178822d4397299f719e89d1a67777' as Address;
const YO = '0x1558cF6aed695F3F8AafE488058EfE28d216E69C' as Address;
const MAX_FEE = 122_000_000_000n;

function montar(o: {
  mon?: bigint;
  panal?: bigint;
  saldo?: bigint;
  recibo?: 'success' | 'reverted';
  ocupado?: boolean;
  lecturaFalla?: boolean;
  /** Lo que devuelve la estimación para MON. Hoy el nodo devolvió 10,7 M. */
  gasMon?: bigint;
}) {
  const envios: string[] = [];
  const gases: bigint[] = [];
  const pausas: number[] = [];
  const panal = {
    addresses: { escrow: '0xe138A9A492CFe27A13f8b7A6D312DA831791bCe9', panalToken: PANAL },
    getPendingWithdrawal: async (_yo: Address, moneda: Address) => {
      if (o.lecturaFalla) throw new Error('RPC caído\ncon más líneas');
      return moneda === MON ? (o.mon ?? 0n) : (o.panal ?? 0n);
    },
    publicClient: {
      chain: { id: 143 },
      estimateContractGas: async (a: { args: [Address] }) => (a.args[0] === MON ? (o.gasMon ?? 55_157n) : 103_511n),
      estimateFeesPerGas: async () => ({ maxFeePerGas: MAX_FEE, maxPriorityFeePerGas: 2_000_000_000n }),
      getBalance: async () => o.saldo ?? parseEther('1.3'),
      waitForTransactionReceipt: async () => ({ status: o.recibo ?? 'success' }),
    },
    walletClient: {
      account: { address: YO },
      writeContract: async (a: { args: [Address]; gas?: bigint }) => {
        envios.push(a.args[0] === MON ? 'MON' : '$PANAL');
        gases.push(a.gas ?? -1n);
        return '0xabc' as Hex;
      },
    },
  };
  const correr = () =>
    repasarRetirada({
      panal: panal as never,
      yo: YO,
      opciones: RETIRADA_POR_DEFECTO,
      ocupado: () => o.ocupado ?? false,
      esperar: async (ms) => {
        pausas.push(ms);
      },
      log: () => {},
    });
  return { envios, pausas, gases, correr };
}

console.log('\nel gas va fijado a mano (lo que costó 1,096 MON)');
{
  check('el margen es un 10 %, redondeando hacia arriba', gasConMargen(55_157n) === 60_673n && gasConMargen(103_511n) === 113_863n);
  const { gases, correr } = montar({ mon: parseEther('1.092'), panal: parseEther('1950') });
  await correr();
  check('retirar MON se firma con gas explícito', gases[0] === 60_673n, gases.map(String).join());
  check('  y retirar $PANAL también', gases[1] === 113_863n, gases.map(String).join());
}
{
  const { envios, correr } = montar({ mon: parseEther('1.092'), gasMon: 10_745_320n });
  const hecho = await correr();
  check('una estimación de 10,7 M no se firma', envios.length === 0, envios.join());
  check('  y dice que pasa del tope', hecho.some((l) => l.includes(String(TOPE_GAS))), hecho.join(' | '));
}

console.log('\nretira lo que compensa');
{
  const { envios, correr } = montar({ mon: parseEther('1.092') }); // Lint
  const hecho = await correr();
  check('1,092 MON se retiran (el gas es un 0,6 %)', envios.join() === 'MON', envios.join());
  check('  y lo dice', hecho.some((l) => l.includes('1.092 MON retirados')), hecho.join(' | '));
}
{
  const { envios, correr } = montar({ panal: parseEther('1072.5') }); // Spec
  await correr();
  check('1.072,5 $PANAL se retiran (pasan de 1000)', envios.join() === '$PANAL', envios.join());
}

console.log('\nNO retira lo que se come el gas');
{
  const { envios, correr } = montar({ mon: parseEther('0.10725') }); // Parse
  await correr();
  check('0,107 MON esperan (el gas sería un 6 %)', envios.length === 0, envios.join());
}
{
  const { envios, correr } = montar({ mon: parseEther('0.04875'), panal: parseEther('999') });
  await correr();
  check('0,049 MON y 999 $PANAL esperan los dos', envios.length === 0, envios.join());
}

console.log('\ndos retiradas seguidas, con pausa entre medias');
{
  const { envios, pausas, correr } = montar({ mon: parseEther('1.092'), panal: parseEther('1950') });
  await correr();
  check('retira las dos monedas', envios.join() === 'MON,$PANAL', envios.join());
  check('  esperando entre una y otra', pausas.join() === '20000', pausas.join());
}

console.log('\nno toca la wallet cuando no debe');
{
  const { envios, correr } = montar({ mon: parseEther('5'), ocupado: true });
  const hecho = await correr();
  check('con un encargo en marcha no hace nada', envios.length === 0 && hecho.length === 0);
}
{
  const { envios, correr } = montar({ mon: parseEther('5'), saldo: parseEther('0.001') });
  const hecho = await correr();
  check('sin MON para la reserva no envía', envios.length === 0, envios.join());
  check('  y avisa de que recargue', hecho.some((l) => l.includes('Recarga')), hecho.join(' | '));
}

console.log('\nlo que falla no cuenta ni lanza');
{
  const { correr } = montar({ mon: parseEther('5'), recibo: 'reverted' });
  const hecho = await correr();
  check('un revert no se da por retirado', hecho.some((l) => l.includes('revirtió')) && !hecho.some((l) => l.includes('retirados')), hecho.join(' | '));
}
{
  const { correr } = montar({ lecturaFalla: true });
  let lanzo = false;
  let hecho: string[] = [];
  try {
    hecho = await correr();
  } catch {
    lanzo = true;
  }
  check('un RPC caído no lanza', !lanzo && hecho.some((l) => l.includes('no se pudo retirar')), hecho.join(' | '));
}

console.log('\nlas opciones del .env');
{
  const avisos: string[] = [];
  const avisar = (m: string) => avisos.push(m);
  check('RETIRADA=off la apaga', opcionesDelEntorno({ RETIRADA: 'off' }, avisar) === null);
  const def = opcionesDelEntorno({}, avisar)!;
  check('sin nada, los de por defecto', def.minutos === 60 && def.maxGasPct === 2 && def.panalDesde === parseEther('1000'));
  const propias = opcionesDelEntorno({ RETIRADA_MINUTOS: '30', RETIRADA_MAX_GAS_PCT: '1', RETIRADA_PANAL_DESDE: '250' }, avisar)!;
  check('se pueden cambiar', propias.minutos === 30 && propias.maxGasPct === 1 && propias.panalDesde === parseEther('250'));
  const malas = opcionesDelEntorno({ RETIRADA_MINUTOS: '1', RETIRADA_MAX_GAS_PCT: 'mucho', RETIRADA_PANAL_DESDE: 'mil' }, avisar)!;
  check('una errata no apaga ni rompe: vuelve al defecto', malas.minutos === 60 && malas.maxGasPct === 2 && malas.panalDesde === parseEther('1000'));
  check('  y lo avisa', avisos.length === 3, avisos.join(' | '));
}

console.log(fallos === 0 ? '\n✅ retirada: todo bien' : `\n❌ retirada: ${fallos} fallo(s)`);
process.exit(fallos === 0 ? 0 : 1);
