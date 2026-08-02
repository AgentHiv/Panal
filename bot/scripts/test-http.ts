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
 *   6. POST /brief: 200 con firma del cliente (brief guardado en el store),
 *      403 intruso / firma-address cruzadas, 400 brief inválido y 409 si la
 *      tarea está Completed/Cancelled.
 *   7. GET /agent.json: 200 con el descriptor inyectado.
 *   8. 429 al superar el rate limit (30 req/min por IP).
 *
 * Uso:  npx tsx scripts/test-http.ts   (exit 0 si todo pasa)
 */

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Address, Hex } from 'viem';
import { keccak256, toBytes } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { briefSignMessage, createResultServer, resultSignMessage, MAX_BRIEF_CHARS, type AgentJson } from '../src/http.js';
import { Store } from '../src/store.js';
import { NATIVE_CURRENCY, TaskStatus, type Task } from '../src/chain.js';

// Cuentas de prueba bien conocidas (Anvil/Hardhat) — solo para este test.
const client = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');
const intruder = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d');

const TASK_ID = 7n;
const CLOSED_TASK_ID = 9n; // simulada como Completed: no acepta brief
const RESULT_TEXT = '# Resumen ejecutivo\n\n12 puntos clave, 3 riesgos y próximos pasos.\n';
const BRIEF_TEXT = 'Resume el whitepaper de Monad en 10 bullets, en español.';

function fakeTask(clientAddr: Address, status: TaskStatus = TaskStatus.Delivered): Task {
  return {
    client: clientAddr,
    worker: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
    amount: 1_500_000_000_000_000_000n,
    taskHash: ('0x' + '11'.repeat(32)) as Hex,
    resultHash: keccak256(toBytes(RESULT_TEXT)),
    deadline: 1_900_000_000n,
    createdAt: 1_899_000_000n,
    status,
    currency: NATIVE_CURRENCY,
  };
}

const FAKE_AGENT_JSON: AgentJson = {
  name: 'LexPanal',
  description: 'Resume documentos legales EN⇄ES',
  agentAddress: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
  chainId: 143,
  contracts: {
    escrow: '0xe138A9A492CFe27A13f8b7A6D312DA831791bCe9',
    registry: '0x89a812BFb1c35fc814ef25a3E6Ca75068B16Ac51',
    token: '0x2e2e44e7fa6178822d4397299f719e89d1a67777',
  },
  skills: ['summaries', 'legal'],
  price: { amountWei: '1500000000000000000', currency: NATIVE_CURRENCY, symbol: 'MON' },
  active: true,
  endpoints: {
    base: 'https://bot.example.com',
    postBrief: { method: 'POST', path: '/brief/:taskId', signMessage: 'x', body: 'x' },
    getResult: { method: 'GET', path: '/result/:taskId?address&signature', signMessage: 'x' },
    indexer: 'https://api.panal.lat',
  },
  howToHire: ['1. …', '2. …'],
};

async function main(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'panal-http-test-'));
  const store = new Store(dir);
  store.saveResult(TASK_ID, RESULT_TEXT);

  const server = createResultServer({
    store,
    // CLOSED_TASK_ID simula una tarea Completed (no acepta brief).
    fetchTask: async (taskId) =>
      fakeTask(client.address, taskId === CLOSED_TASK_ID ? TaskStatus.Completed : TaskStatus.Delivered),
    fetchAgentJson: async () => FAKE_AGENT_JSON,
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

  // ---- POST /brief/:taskId ---------------------------------------------------
  const postBrief = (taskId: bigint, payload: unknown) =>
    fetch(`${base}/brief/${taskId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: typeof payload === 'string' ? payload : JSON.stringify(payload),
    });

  // 6. Cliente correcto → 200 y el brief queda guardado en el store.
  const briefSig = await client.signMessage({ message: briefSignMessage(TASK_ID) });
  const r6 = await postBrief(TASK_ID, { brief: BRIEF_TEXT, address: client.address, signature: briefSig });
  const b6 = (await r6.json()) as { ok?: boolean };
  check(
    '200 POST brief cliente',
    r6.status === 200 && b6.ok === true && store.getBrief(TASK_ID) === BRIEF_TEXT,
    `status=${r6.status} briefGuardado=${store.getBrief(TASK_ID) !== undefined}`,
  );

  // 7. Intruso firma bien el mensaje, pero no es el cliente → 403.
  const intruderSig = await intruder.signMessage({ message: briefSignMessage(TASK_ID) });
  const r7 = await postBrief(TASK_ID, { brief: BRIEF_TEXT, address: intruder.address, signature: intruderSig });
  const b7 = (await r7.json()) as { error?: string };
  check('403 POST brief intruso', r7.status === 403 && b7.error === 'not client', `status=${r7.status}`);

  // 7b. Firma del cliente pero address suplantada → 403.
  const r7b = await postBrief(TASK_ID, { brief: BRIEF_TEXT, address: intruder.address, signature: briefSig });
  check('403 POST brief firma/address no coinciden', r7b.status === 403, `status=${r7b.status}`);

  // 8. Brief inválido → 400 (vacío, demasiado largo, address/fe firma malas, JSON roto).
  const r8a = await postBrief(TASK_ID, { brief: '   ', address: client.address, signature: briefSig });
  const r8b = await postBrief(TASK_ID, {
    brief: 'x'.repeat(MAX_BRIEF_CHARS + 1),
    address: client.address,
    signature: briefSig,
  });
  const r8c = await postBrief(TASK_ID, { brief: BRIEF_TEXT, address: '0x123', signature: briefSig });
  const r8d = await postBrief(TASK_ID, '{"brief": roto');
  check(
    '400 POST brief inválido',
    r8a.status === 400 && r8b.status === 400 && r8c.status === 400 && r8d.status === 400,
    `status=${r8a.status},${r8b.status},${r8c.status},${r8d.status}`,
  );

  // 9. Tarea Completed → 409 task closed.
  const closedSig = await client.signMessage({ message: briefSignMessage(CLOSED_TASK_ID) });
  const r9 = await postBrief(CLOSED_TASK_ID, { brief: BRIEF_TEXT, address: client.address, signature: closedSig });
  const b9 = (await r9.json()) as { error?: string };
  check('409 POST brief tarea cerrada', r9.status === 409 && b9.error === 'task closed', `status=${r9.status}`);

  // 10. GET /agent.json → 200 con el descriptor inyectado.
  const r10 = await fetch(`${base}/agent.json`);
  const b10 = (await r10.json()) as { name?: string; agentAddress?: string };
  check(
    '200 GET /agent.json',
    r10.status === 200 && b10.name === FAKE_AGENT_JSON.name && b10.agentAddress === FAKE_AGENT_JSON.agentAddress,
    `status=${r10.status} name=${b10.name}`,
  );

  // 11. Rate limit: 30 req/min por IP → la petición que excede devuelve 429.
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
