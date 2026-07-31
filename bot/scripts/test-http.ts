/**
 * Test LOCAL del endpoint de resultados (bot/src/http.ts) — NO producción.
 *
 * Levanta el servidor con una task SIMULADA (fetchTask inyectado, sin RPC) y
 * demuestra:
 *   1. 200 para el CLIENTE correcto (firma EIP-191 de "Panal resultado #<id>")
 *      con resultHash recomputado = keccak256(toBytes(resultText)).
 *   2. 403 {"error":"not client"} para otra wallet.
 *   3. 404 si no hay resultado guardado para la task.
 *   4. 404 genérico para cualquier otra ruta.
 *   5. CORS: refleja https://panal.lat, NO refleja un origen ajeno.
 *   6. 429 al superar el rate limit (30 req/min por IP).
 *
 * Uso:  npx tsx scripts/test-http.ts   (exit 0 si todo pasa)
 */

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Address, Hex } from 'viem';
import { keccak256, toBytes } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { createResultServer, resultSignMessage } from '../src/http.js';
import { Store } from '../src/store.js';
import { NATIVE_CURRENCY, TaskStatus, type Task } from '../src/chain.js';

// Cuentas de prueba bien conocidas (Anvil/Hardhat) — solo para este test.
const client = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');
const intruder = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d');

const TASK_ID = 7n;
const RESULT_TEXT = '# Resumen ejecutivo\n\n12 puntos clave, 3 riesgos y próximos pasos.\n';

function fakeTask(clientAddr: Address): Task {
  return {
    client: clientAddr,
    worker: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
    amount: 1_500_000_000_000_000_000n,
    taskHash: ('0x' + '11'.repeat(32)) as Hex,
    resultHash: keccak256(toBytes(RESULT_TEXT)),
    deadline: 1_900_000_000n,
    createdAt: 1_899_000_000n,
    status: TaskStatus.Delivered,
    currency: NATIVE_CURRENCY,
  };
}

async function main(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'panal-http-test-'));
  const store = new Store(dir);
  store.saveResult(TASK_ID, RESULT_TEXT);

  const server = createResultServer({
    store,
    fetchTask: async () => fakeTask(client.address),
    allowLocalhostOrigin: true,
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('sin puerto');
  const base = `http://127.0.0.1:${addr.port}`;

  let failures = 0;
  const check = (name: string, ok: boolean, detail: string) => {
    console.log(`${ok ? '✅' : '❌'} ${name}: ${detail}`);
    if (!ok) failures++;
  };

  const get = (taskId: bigint, address: Address, signature: Hex, origin?: string) =>
    fetch(`${base}/result/${taskId}?address=${address}&signature=${signature}`, {
      headers: origin ? { origin } : undefined,
    });

  // 1. Cliente correcto → 200 + hash verificable.
  const sig1 = await client.signMessage({ message: resultSignMessage(TASK_ID) });
  const r1 = await get(TASK_ID, client.address, sig1, 'https://panal.lat');
  const b1 = (await r1.json()) as { taskId?: string; resultText?: string; resultHash?: Hex };
  check(
    '200 cliente',
    r1.status === 200 &&
      b1.taskId === TASK_ID.toString() &&
      b1.resultText === RESULT_TEXT &&
      b1.resultHash === keccak256(toBytes(RESULT_TEXT)),
    `status=${r1.status} resultHash=${b1.resultHash}`,
  );
  check(
    'CORS panal.lat',
    r1.headers.get('access-control-allow-origin') === 'https://panal.lat',
    `acao=${r1.headers.get('access-control-allow-origin')}`,
  );

  // 2. Otra wallet firma bien el mensaje, pero no es el cliente → 403.
  const sig2 = await intruder.signMessage({ message: resultSignMessage(TASK_ID) });
  const r2 = await get(TASK_ID, intruder.address, sig2);
  const b2 = (await r2.json()) as { error?: string };
  check('403 intruso', r2.status === 403 && b2.error === 'not client', `status=${r2.status} body=${JSON.stringify(b2)}`);

  // 2b. Firma del cliente pero address suplantada → 403.
  const r2b = await get(TASK_ID, intruder.address, sig1);
  check('403 firma/address no coinciden', r2b.status === 403, `status=${r2b.status}`);

  // 3. Cliente correcto pero sin resultado guardado → 404.
  const sig3 = await client.signMessage({ message: resultSignMessage(8n) });
  const r3 = await get(8n, client.address, sig3);
  check('404 sin resultado', r3.status === 404, `status=${r3.status}`);

  // 4. Ruta desconocida → 404 genérico.
  const r4 = await fetch(`${base}/otra-cosa`);
  const r4b = await fetch(`${base}/`);
  check('404 ruta desconocida', r4.status === 404 && r4b.status === 404, `status=${r4.status},${r4b.status}`);

  // 5. Origen ajeno NO recibe CORS.
  const sig5 = await client.signMessage({ message: resultSignMessage(TASK_ID) });
  const r5 = await get(TASK_ID, client.address, sig5, 'https://evil.example.com');
  check('CORS origen ajeno denegado', r5.headers.get('access-control-allow-origin') === null, 'sin ACAO');

  // 6. Rate limit: 30 req/min por IP → la petición que excede devuelve 429.
  let got429 = false;
  let attempts = 0;
  for (let i = 0; i < 40 && !got429; i++) {
    attempts++;
    const r = await fetch(`${base}/nope`);
    if (r.status === 429) got429 = true;
  }
  check('429 rate limit', got429 && attempts <= 30, `429 tras ${attempts} peticiones extra`);

  server.close();
  if (failures > 0) {
    console.error(`\n❌ ${failures} comprobaciones fallaron`);
    process.exit(1);
  }
  console.log('\n✅ Todas las comprobaciones pasaron');
}

main().catch((err) => {
  console.error('❌ Error en el test:', err);
  process.exit(1);
});
