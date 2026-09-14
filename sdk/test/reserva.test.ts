/**
 * La reserva de gas de Monad, mirada antes de firmar el alta.
 *
 *   npx tsx test/reserva.test.ts
 *
 * HERMÉTICO: el RPC y la wallet son dobles, con las cifras medidas en mainnet
 * el 2026-09-14 — 263.870 de gas a 122 gwei, 0,03219214 MON de reserva.
 *
 * Lo que se protege:
 *   1. Con menos saldo que la reserva, el alta NO se envía y el error dice
 *      cuánto falta. Enviarla era llevarse un «insufficient balance» vestido de
 *      revert, y un reintento tras recargar repetía el rechazo en caché.
 *   2. Si la estimación falla, no se bloquea: que hable el error de verdad.
 *   3. Una transacción revertida no vuelve como éxito.
 */

import { privateKeyToAccount } from 'viem/accounts';
import type { Hex } from 'viem';
import { createPanalClient } from '../src/client.js';

let fallos = 0;
const check = (nombre: string, ok: boolean, detalle = ''): void => {
  console.log(`${ok ? '✅' : '❌'} ${nombre}${ok ? '' : ` — ${detalle}`}`);
  if (!ok) fallos++;
};

const cuenta = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d');
const GAS = 263_870n;
const MAX_FEE = 122_000_000_000n;
const RESERVA = GAS * MAX_FEE; // 0,03219214 MON
const alta = { metadata: { name: 'Prueba', description: 'Un agente de prueba', skills: ['prueba'] }, pricePerTask: 5n * 10n ** 16n };

function montar(opciones: { saldo: bigint; estimacionFalla?: boolean; recibo?: 'success' | 'reverted' }) {
  const panal = createPanalClient({ account: cuenta });
  const envios: string[] = [];
  const p = panal as unknown as { publicClient: Record<string, unknown>; walletClient: Record<string, unknown> };
  p.publicClient.estimateContractGas = async () => {
    if (opciones.estimacionFalla) throw new Error('RPC caído');
    return GAS;
  };
  p.publicClient.estimateFeesPerGas = async () => ({ maxFeePerGas: MAX_FEE, maxPriorityFeePerGas: 2_000_000_000n });
  p.publicClient.getBalance = async () => opciones.saldo;
  p.publicClient.waitForTransactionReceipt = async () => ({ status: opciones.recibo ?? 'success' });
  p.walletClient.writeContract = async (a: { functionName: string }) => {
    envios.push(a.functionName);
    return '0xabc' as Hex;
  };
  return { panal, envios };
}

const error = async (fn: () => Promise<unknown>): Promise<string> => {
  try {
    await fn();
    return '';
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
};

console.log('\ncon menos saldo que la reserva, no se envía');
{
  const { panal, envios } = montar({ saldo: 2n * 10n ** 16n }); // 0,02 MON
  const msg = await error(() => panal.registerAgent(alta));
  check('no se envía nada', envios.length === 0, envios.join());
  check('dice cuánto reserva', msg.includes('0.03219214 MON'), msg);
  check('y cuánto falta', msg.includes('faltan 0.01219214 MON'), msg);
}
{
  const { panal, envios } = montar({ saldo: RESERVA - 1n });
  await error(() => panal.registerAgent(alta));
  check('un wei por debajo tampoco se envía', envios.length === 0);
}

console.log('\ncon saldo suficiente, se envía');
{
  const { panal, envios } = montar({ saldo: RESERVA });
  const hash = await panal.registerAgent(alta);
  check('justo la reserva basta', envios.join() === 'registerAgent' && hash === '0xabc', envios.join());
}

console.log('\nsi no se puede estimar, no se bloquea');
{
  const { panal, envios } = montar({ saldo: 0n, estimacionFalla: true });
  await panal.registerAgent(alta);
  check('se envía igual y que hable el error de verdad', envios.join() === 'registerAgent', envios.join());
}

console.log('\nun revert no vuelve como éxito');
{
  const { panal } = montar({ saldo: 10n ** 18n, recibo: 'reverted' });
  const msg = await error(() => panal.registerAgent(alta));
  check('lanza con el hash', msg.includes('revirtió') && msg.includes('0xabc'), msg);
}

console.log(fallos === 0 ? '\n✅ reserva: todo bien' : `\n❌ reserva: ${fallos} fallo(s)`);
process.exit(fallos === 0 ? 0 : 1);
