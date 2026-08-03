/**
 * Test E2E LOCAL del modo A2A / escuadras (bot/src/a2a.ts) — NO producción.
 *
 * Foundry/Anvil no está disponible en este entorno, así que el registry y el
 * escrow v2 se mockean en memoria tras la interfaz de viem (readContract /
 * simulateContract / writeContract), con la misma semántica de los contratos
 * v2 (contracts/src/v2): createTask asigna ids secuenciales, approveAndRelease
 * pasa a Completed, cancelTask exige Open + deadline vencido, etc.
 *
 * El LLM se mockea con un servidor HTTP local compatible con la API de OpenAI
 * (chat/completions), así se ejerce el camino real de llm.ts (fetch, retries).
 *
 * El resultado del hijo se sirve con el endpoint REAL de http.ts
 * (createResultServer) y se consume firmando EIP-191 con la wallet del bot:
 * se ejerce la verificación de firma + resultHash recomputado de verdad.
 *
 * Demuestra:
 *   1. Router needsSub=false → no subcontrata (flujo normal).
 *   2. Router con JSON inválido → no subcontrata.
 *   3. Selección del MÁS BARATO con match de skill case-insensitive,
 *      EXCLUYENDO la propia address (no autocontratación) y los inactivos.
 *   4. Límite A2A_MAX_SUB_WEI, presupuesto diario A2A_DAILY_BUDGET_WEI y
 *      chequeo de fondos: cada uno bloquea la subcontratación.
 *   5. Flujo feliz: hijo Delivered → resultado por endpoint (EIP-191) →
 *      rating 5 → approveAndRelease → integración → padre entregado.
 *   6. Rating < A2A_MIN_RATING → NO aprueba (auto-release 72 h) + aviso.
 *   7. Timeout del hijo → cancelTask + padre entregado sin esa parte.
 *   8. Pago en $PANAL: approve exacto + createTask value 0.
 *
 * Uso:  npx tsx scripts/test-a2a.ts   (exit 0 si todo pasa)
 */

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type Server } from 'node:http';
import { keccak256, toBytes, type Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { A2aManager, parseRouterDecision, pickCheapest, skillMatches } from '../src/a2a.js';
import { createResultServer } from '../src/http.js';
import { Store } from '../src/store.js';
import { NATIVE_CURRENCY, TaskStatus, type ChainClients, type RegistryAgent, type Task } from '../src/chain.js';
import type { BotConfig } from '../src/config.js';

// ---------------------------------------------------------------------------
// Cuentas y direcciones de prueba (claves públicas de Anvil — solo test local)
// ---------------------------------------------------------------------------

const bot = privateKeyToAccount('0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a');
const ESCROW = '0xe138A9A492CFe27A13f8b7A6D312DA831791bCe9' as Address;
const REGISTRY = '0x89a812BFb1c35fc814ef25a3E6Ca75068B16Ac51' as Address;
const PANAL = '0x2e2e44e7fa6178822d4397299f719e89d1a67777' as Address;

const AGENT_A = '0x00000000000000000000000000000000000000A1' as Address; // traducción, 2 MON
const AGENT_B = '0x00000000000000000000000000000000000000B2' as Address; // TRADUCCIÓN, 1 MON
const AGENT_C = '0x00000000000000000000000000000000000000C3' as Address; // sin la skill
const AGENT_INACTIVE = '0x00000000000000000000000000000000000000D4' as Address;
const AGENT_PANAL = '0x00000000000000000000000000000000000000E5' as Address; // cobra en $PANAL

// ---------------------------------------------------------------------------
// Mock del LLM: servidor HTTP compatible con OpenAI chat/completions
// ---------------------------------------------------------------------------

const llmScript = {
  router: '{"needsSub": false, "skill": null, "subBrief": null, "reason": "brief simple"}',
  rating: '{"rating": 5, "comment": "resultado excelente"}',
};

async function startMockLlm(): Promise<{ server: Server; port: number }> {
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const parsed = JSON.parse(body) as { messages: Array<{ role: string; content: string }> };
      const system = parsed.messages[0]?.content ?? '';
      const user = parsed.messages[parsed.messages.length - 1]?.content ?? '';
      let content: string;
      if (system.includes('ROUTER')) content = llmScript.router;
      else if (system.includes('EVALUADOR')) content = llmScript.rating;
      else content = `# Resultado final\n\n${user}`; // eco: evidencia de integración
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content } }] }));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('sin puerto LLM mock');
  return { server, port: addr.port };
}

// ---------------------------------------------------------------------------
// Mock de cadena: registry v2 + escrow v2 + ERC-20 en memoria (tras viem)
// ---------------------------------------------------------------------------

class MockChain {
  tasks: Task[] = [];
  agents = new Map<Address, RegistryAgent>();
  nativeBalance = 100n * 10n ** 18n;
  panalBalance = 0n;
  panalAllowance = 0n;
  writes: string[] = [];

  addAgent(address: Address, metadataURI: string, pricePerTask: bigint, currency: Address, active = true): void {
    this.agents.set(address, {
      owner: address,
      metadataURI,
      pricePerTask,
      active,
      registeredAt: 1_800_000_000n,
      currency,
    });
  }

  /** Crea una tarea padre (cliente externo → nuestro bot como worker). */
  addParentTask(currency: Address, deadline: bigint): bigint {
    const id = BigInt(this.tasks.length);
    this.tasks.push({
      client: '0x0000000000000000000000000000000000000C1E' as Address,
      worker: bot.address,
      amount: 10n ** 18n,
      taskHash: keccak256(toBytes('brief padre')),
      resultHash: ('0x' + '00'.repeat(32)) as `0x${string}`,
      deadline,
      createdAt: BigInt(Math.floor(Date.now() / 1000)),
      status: TaskStatus.Open,
      currency,
    });
    return id;
  }

  private readContract = async (call: {
    address: Address;
    functionName: string;
    args?: readonly unknown[];
  }): Promise<unknown> => {
    const { address, functionName, args = [] } = call;
    if (address.toLowerCase() === ESCROW.toLowerCase()) {
      if (functionName === 'getTaskCount') return BigInt(this.tasks.length);
      if (functionName === 'tasks') return this.tasks[Number(args[0])];
    }
    if (address.toLowerCase() === REGISTRY.toLowerCase()) {
      if (functionName === 'getAgentCount') return BigInt(this.agents.size);
      if (functionName === 'getAgents') {
        const all = [...this.agents.keys()];
        return all.slice(Number(args[0]), Number(args[0]) + Number(args[1]));
      }
      if (functionName === 'getAgent') return this.agents.get(args[0] as Address);
    }
    if (address.toLowerCase() === PANAL.toLowerCase()) {
      if (functionName === 'balanceOf') return this.panalBalance;
      if (functionName === 'allowance') return this.panalAllowance;
    }
    throw new Error(`readContract no mockeado: ${address}.${functionName}`);
  };

  private simulateContract = async (call: { functionName: string }): Promise<unknown> => {
    if (call.functionName === 'createTask') return { result: BigInt(this.tasks.length) };
    return { result: undefined };
  };

  private writeContract = async (call: {
    address: Address;
    functionName: string;
    args?: readonly unknown[];
    value?: bigint;
  }): Promise<`0x${string}`> => {
    const { functionName, args = [], value = 0n } = call;
    this.writes.push(`${functionName}(${args.map(String).join(',')})${value ? ` value=${value}` : ''}`);
    if (functionName === 'createTask') {
      const [worker, taskHash, deadline, currency, amount] = args as [Address, `0x${string}`, bigint, Address, bigint];
      if ((currency as string).toLowerCase() === NATIVE_CURRENCY.toLowerCase()) this.nativeBalance -= amount;
      this.tasks.push({
        client: bot.address,
        worker,
        amount,
        taskHash,
        resultHash: ('0x' + '00'.repeat(32)) as `0x${string}`,
        deadline,
        createdAt: BigInt(Math.floor(Date.now() / 1000)),
        status: TaskStatus.Open,
        currency,
      });
    } else if (functionName === 'approveAndRelease') {
      const task = this.tasks[Number(args[0])]!;
      if (task.status !== TaskStatus.Delivered) throw new Error('mock: approveAndRelease exige Delivered');
      task.status = TaskStatus.Completed;
    } else if (functionName === 'cancelTask') {
      const task = this.tasks[Number(args[0])]!;
      if (task.status !== TaskStatus.Open) throw new Error('mock: cancelTask exige Open');
      task.status = TaskStatus.Cancelled;
    } else if (functionName === 'approve') {
      this.panalAllowance = args[1] as bigint;
    } else if (functionName === 'deliverResult') {
      const task = this.tasks[Number(args[0])]!;
      task.resultHash = args[1] as `0x${string}`;
      task.status = TaskStatus.Delivered;
    }
    return ('0x' + 'ab'.repeat(32)) as `0x${string}`;
  };

  clients(): ChainClients {
    return {
      publicClient: {
        readContract: this.readContract,
        simulateContract: this.simulateContract,
        getBalance: async () => this.nativeBalance,
        waitForTransactionReceipt: async () => ({ status: 'success' }),
      } as unknown as ChainClients['publicClient'],
      walletClient: {
        account: bot,
        writeContract: this.writeContract,
      } as unknown as NonNullable<ChainClients['walletClient']>,
      botAddress: bot.address,
    };
  }
}

// ---------------------------------------------------------------------------
// Utilidades del test
// ---------------------------------------------------------------------------

let failures = 0;
function check(name: string, ok: boolean, detail: string): void {
  console.log(`${ok ? '✅' : '❌'} ${name}: ${detail}`);
  if (!ok) failures++;
}

const E18 = 10n ** 18n;

interface Harness {
  chain: MockChain;
  store: Store;
  telegram: string[];
  deliveredParents: Array<{ taskId: bigint; text: string }>;
  manager: A2aManager;
  setNow: (s: number) => void;
}

function makeHarness(chain: MockChain, llmPort: number, now: number): Harness {
  const dir = mkdtempSync(join(tmpdir(), 'panal-a2a-test-'));
  const store = new Store(dir);
  const telegram: string[] = [];
  const deliveredParents: Array<{ taskId: bigint; text: string }> = [];
  let currentNow = now;

  const cfg: BotConfig = {
    mode: 'worker',
    agentAddress: bot.address,
    llm: {
      baseUrl: `http://127.0.0.1:${llmPort}`,
      apiKey: 'test-key',
      model: 'mock-model',
      systemPrompt: 'Eres un agente autónomo de Panal.',
      timeoutMs: 10_000,
      maxRetries: 0,
    },
    rpcUrl: 'http://mock-rpc',
    escrowAddress: ESCROW,
    registryAddress: REGISTRY,
    panalTokenAddress: PANAL,
    dashboardUrl: 'https://panal.lat/dashboard',
    pollIntervalMs: 20_000,
    briefWaitMs: 0,
    maxInitialScan: 200,
    autoWithdraw: false,
    dryRun: false,
    storeDir: dir,
    httpPort: 0,
    indexHttpPort: 0,
    indexDir: join(dir, 'index'),
    indexPollIntervalMs: 15_000,
    indexSweepWindowsPerDay: 0,
    a2a: {
      enabled: true,
      maxSubWei: 5n * E18,
      dailyBudgetWei: 20n * E18,
      subTimeoutS: 7_200,
      minRating: 3,
    },
  };

  const manager = new A2aManager({
    cfg,
    clients: chain.clients(),
    store,
    telegram: { send: async (t) => void telegram.push(t) },
    parentBrief: () => 'Brief del cliente: informe de mercado con una sección traducida al portugués.',
    deliverParent: async (taskId, text) => {
      store.saveResult(taskId, text);
      deliveredParents.push({ taskId, text });
    },
    nowS: () => currentNow,
  });

  return { chain, store, telegram, deliveredParents, manager, setNow: (s) => (currentNow = s) };
}

function seedRegistry(chain: MockChain): void {
  // La PROPIA address con la skill y el precio más bajo: debe ser excluida.
  chain.addAgent(bot.address, 'MiPropioBot · generalista · traducción', 1n * 10n ** 16n, NATIVE_CURRENCY);
  // Inactivo con la skill: debe ser excluido.
  chain.addAgent(AGENT_INACTIVE, 'Dormido · apagado · traducción', 5n * 10n ** 17n, NATIVE_CURRENCY, false);
  // Candidatos activos con la skill (distinto precio y capitalización).
  chain.addAgent(AGENT_A, 'TraductorPro · traducciones · traducción, interpretación', 2n * E18, NATIVE_CURRENCY);
  chain.addAgent(AGENT_B, 'Polyglot · idiomas · TRADUCCIÓN, diseño · bot:http://sin-endpoint.invalid', 1n * E18, NATIVE_CURRENCY);
  // Sin la skill.
  chain.addAgent(AGENT_C, 'ArtistBot · ilustración · ilustración, arte', 5n * 10n ** 17n, NATIVE_CURRENCY);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const { server: llmServer, port: llmPort } = await startMockLlm();
  const NOW = 1_800_000_000;

  // ---- Unidades: parseo del router y matching -------------------------------
  check(
    'router JSON válido',
    (() => {
      const d = parseRouterDecision('texto previo\n{"needsSub": true, "skill": "traducción", "subBrief": "traduce X", "reason": "r"}');
      return d?.needsSub === true && d.skill === 'traducción' && d.subBrief === 'traduce X';
    })(),
    'extrae JSON aunque venga con texto alrededor',
  );
  check('router JSON inválido → null', parseRouterDecision('no json at all') === null && parseRouterDecision('{bad json}') === null, 'null');
  check(
    'skillMatches case-insensitive',
    skillMatches('Polyglot · idiomas · TRADUCCIÓN, diseño', 'traducción') && !skillMatches('ArtistBot · arte', 'traducción'),
    'OK',
  );
  {
    const chain = new MockChain();
    seedRegistry(chain);
    const candidates = [...chain.agents.entries()]
      .filter(([a]) => a.toLowerCase() !== bot.address.toLowerCase())
      .map(([address, agent]) => ({ address, agent }))
      .filter((c) => c.agent.active);
    const chosen = pickCheapest(candidates, 'traducción', NATIVE_CURRENCY);
    check('pickCheapest elige el más barato', chosen?.address === AGENT_B, `chosen=${chosen?.address} (1 MON < 2 MON)`);
    const chosenPanal = pickCheapest(
      [{ address: AGENT_B, agent: chain.agents.get(AGENT_B)! }],
      'traducción',
      PANAL,
    );
    check('pickCheapest cae a MON si nadie cobra en la moneda del padre', chosenPanal?.address === AGENT_B, 'fallback nativo');
  }

  // ---- 1. Router needsSub=false → no subcontrata ----------------------------
  {
    const chain = new MockChain();
    seedRegistry(chain);
    const h = makeHarness(chain, llmPort, NOW);
    const parentId = chain.addParentTask(NATIVE_CURRENCY, BigInt(NOW + 10_000));
    llmScript.router = '{"needsSub": false, "skill": null, "subBrief": null, "reason": "yo puedo solo"}';
    const parked = await h.manager.maybeSubcontract(parentId, chain.tasks[Number(parentId)]!, 'brief simple');
    check('needsSub=false → flujo normal', parked === false && chain.writes.length === 0, `parked=${parked}, writes=${chain.writes.length}`);
  }

  // ---- 2. Router JSON inválido → no subcontrata -----------------------------
  {
    const chain = new MockChain();
    seedRegistry(chain);
    const h = makeHarness(chain, llmPort, NOW);
    const parentId = chain.addParentTask(NATIVE_CURRENCY, BigInt(NOW + 10_000));
    llmScript.router = 'no sé, quizás habría que subcontratar…';
    const parked = await h.manager.maybeSubcontract(parentId, chain.tasks[Number(parentId)]!, 'brief');
    check('JSON inválido → flujo normal', parked === false && chain.writes.length === 0, `parked=${parked}`);
  }

  // ---- 3. Selección del más barato + NO autocontratación --------------------
  {
    const chain = new MockChain();
    seedRegistry(chain);
    const h = makeHarness(chain, llmPort, NOW);
    const parentId = chain.addParentTask(NATIVE_CURRENCY, BigInt(NOW + 10_000));
    llmScript.router = JSON.stringify({
      needsSub: true,
      skill: 'traducción',
      subBrief: 'Traduce al portugués la sección 2 del informe: "El mercado creció un 12%".',
      reason: 'sección en otro idioma',
    });
    const parked = await h.manager.maybeSubcontract(parentId, chain.tasks[Number(parentId)]!, 'brief padre');
    const childId = parentId + 1n;
    const rec = h.store.getSubTask(parentId);
    const createWrite = chain.writes.find((w) => w.startsWith('createTask'));
    check('subcontratación aparcada', parked === true && rec !== undefined, `parked=${parked}`);
    check(
      'NO autocontratación ni inactivos: elige AGENT_B (más barato)',
      rec?.childWorker === AGENT_B && createWrite !== undefined && createWrite.includes(AGENT_B) && createWrite.includes(`value=${1n * E18}`),
      `worker=${rec?.childWorker} write=${createWrite}`,
    );
    check(
      'brief hijo guardado en el sistema de briefs',
      h.store.getBrief(childId)?.includes('Traduce al portugués') === true,
      `briefs[${childId}] OK`,
    );
    check(
      'registro persistido correcto',
      rec?.parentTaskId === parentId.toString() &&
        rec.childTaskId === childId.toString() &&
        rec.state === 'open' &&
        rec.amount === (1n * E18).toString() &&
        rec.deadline === NOW + 7_200,
      JSON.stringify(rec),
    );
    check('presupuesto diario contabilizado', h.store.getA2aDailySpend(NOW) === 1n * E18, `spend=${h.store.getA2aDailySpend(NOW)}`);
    check(
      'Telegram "Subcontraté parte"',
      h.telegram.some((t) => t.includes('Subcontraté parte') && t.includes(`sub-#${childId}`)),
      h.telegram[0]?.slice(0, 80) ?? 'sin mensaje',
    );
    // Idempotencia: segundo intento para el mismo padre no duplica.
    const again = await h.manager.maybeSubcontract(parentId, chain.tasks[Number(parentId)]!, 'brief padre');
    check('idempotente ante re-procesado del padre', again === true && chain.writes.filter((w) => w.startsWith('createTask')).length === 1, 'sin duplicar createTask');
  }

  // ---- 4a. Precio por encima de A2A_MAX_SUB_WEI ------------------------------
  {
    const chain = new MockChain();
    chain.addAgent(AGENT_A, 'Caro · traducciones · traducción', 6n * E18, NATIVE_CURRENCY);
    const h = makeHarness(chain, llmPort, NOW);
    const parentId = chain.addParentTask(NATIVE_CURRENCY, BigInt(NOW + 10_000));
    const parked = await h.manager.maybeSubcontract(parentId, chain.tasks[Number(parentId)]!, 'brief');
    check(
      'precio > A2A_MAX_SUB_WEI → no subcontrata + Telegram',
      parked === false && chain.writes.length === 0 && h.telegram.some((t) => t.includes('por encima del límite')),
      `parked=${parked}`,
    );
  }

  // ---- 4b. Presupuesto diario agotado ----------------------------------------
  {
    const chain = new MockChain();
    chain.addAgent(AGENT_B, 'Polyglot · idiomas · traducción', 2n * E18, NATIVE_CURRENCY);
    const h = makeHarness(chain, llmPort, NOW);
    h.store.addA2aDailySpend(19n * E18, NOW); // 19 + 2 > 20 (presupuesto)
    const parentId = chain.addParentTask(NATIVE_CURRENCY, BigInt(NOW + 10_000));
    const parked = await h.manager.maybeSubcontract(parentId, chain.tasks[Number(parentId)]!, 'brief');
    check(
      'presupuesto diario respetado → no subcontrata + Telegram',
      parked === false && chain.writes.length === 0 && h.telegram.some((t) => t.includes('presupuesto diario')),
      `parked=${parked}`,
    );
  }

  // ---- 4c. Fondos insuficientes ----------------------------------------------
  {
    const chain = new MockChain();
    chain.nativeBalance = 5n * 10n ** 17n; // 0.5 MON < 1 MON
    chain.addAgent(AGENT_B, 'Polyglot · idiomas · traducción', 1n * E18, NATIVE_CURRENCY);
    const h = makeHarness(chain, llmPort, NOW);
    const parentId = chain.addParentTask(NATIVE_CURRENCY, BigInt(NOW + 10_000));
    const parked = await h.manager.maybeSubcontract(parentId, chain.tasks[Number(parentId)]!, 'brief');
    check(
      'fondos insuficientes → no subcontrata + Telegram',
      parked === false && chain.writes.length === 0 && h.telegram.some((t) => t.includes('insuficientes')),
      `parked=${parked}`,
    );
  }

  // ---- 4d. Sin candidato con la skill ----------------------------------------
  {
    const chain = new MockChain();
    chain.addAgent(AGENT_C, 'ArtistBot · ilustración · ilustración, arte', 1n * E18, NATIVE_CURRENCY);
    const h = makeHarness(chain, llmPort, NOW);
    const parentId = chain.addParentTask(NATIVE_CURRENCY, BigInt(NOW + 10_000));
    const parked = await h.manager.maybeSubcontract(parentId, chain.tasks[Number(parentId)]!, 'brief');
    check(
      'sin candidato → no subcontrata + Telegram',
      parked === false && chain.writes.length === 0 && h.telegram.some((t) => t.includes('no hay agente activo')),
      `parked=${parked}`,
    );
  }

  // ---- 5. Flujo feliz: hijo Delivered → rating 5 → approve → integración -----
  {
    const chain = new MockChain();
    chain.addAgent(AGENT_B, 'Polyglot · idiomas · traducción', 1n * E18, NATIVE_CURRENCY);
    const h = makeHarness(chain, llmPort, NOW);
    const parentId = chain.addParentTask(NATIVE_CURRENCY, BigInt(NOW + 10_000));
    await h.manager.maybeSubcontract(parentId, chain.tasks[Number(parentId)]!, 'brief padre');
    const childId = parentId + 1n;
    const childTask = chain.tasks[Number(childId)]!;

    // Endpoint REAL del bot hijo (http.ts) con el resultado de la sub-tarea.
    const CHILD_RESULT = '## Seção 2 (português)\n\nO mercado cresceu 12% no período…';
    const childDir = mkdtempSync(join(tmpdir(), 'panal-a2a-child-'));
    const childStore = new Store(childDir);
    childStore.saveResult(childId, CHILD_RESULT);
    childTask.status = TaskStatus.Delivered;
    childTask.resultHash = keccak256(toBytes(CHILD_RESULT));
    const childServer = createResultServer({
      store: childStore,
      fetchTask: async () => childTask, // client = bot.address (nosotros)
      allowLocalhostOrigin: true,
    });
    await new Promise<void>((r) => childServer.listen(0, '127.0.0.1', r));
    const childAddr = childServer.address();
    if (!childAddr || typeof childAddr === 'string') throw new Error('sin puerto hijo');
    // El hijo anuncia su endpoint en el metadata: bot:<url>
    chain.agents.get(AGENT_B)!.metadataURI = `Polyglot · idiomas · traducción · bot:http://127.0.0.1:${childAddr.port}`;

    llmScript.rating = '{"rating": 5, "comment": "traducción impecable"}';
    await h.manager.poll();

    const rec = h.store.getSubTask(parentId)!;
    check(
      'hijo aprobado on-chain (approveAndRelease → Completed)',
      chain.writes.some((w) => w.startsWith(`approveAndRelease(${childId},5)`)) && childTask.status === TaskStatus.Completed,
      `writes=${chain.writes.join(' | ')}`,
    );
    check(
      'resultado del hijo obtenido vía endpoint (EIP-191) y verificado',
      rec.childResult === CHILD_RESULT,
      `childResult=${rec.childResult?.slice(0, 40)}`,
    );
    check(
      'padre entregado INTEGRANDO el resultado del hijo',
      h.deliveredParents.length === 1 &&
        h.deliveredParents[0]!.taskId === parentId &&
        h.deliveredParents[0]!.text.includes('O mercado cresceu 12%'),
      `delivered=${h.deliveredParents.length}, integra=${h.deliveredParents[0]?.text.includes('O mercado cresceu 12%')}`,
    );
    check(
      'registro final completed + parentDelivered',
      rec.state === 'completed' && rec.parentDelivered === true && rec.rating === 5,
      `state=${rec.state} rating=${rec.rating}`,
    );
    check('Telegram de aprobación', h.telegram.some((t) => t.includes('aprobada') && t.includes('5/5')), 'OK');
    await h.manager.poll(); // no debe re-entregar ni duplicar writes
    check(
      'poll posterior no duplica trabajo',
      h.deliveredParents.length === 1 && chain.writes.filter((w) => w.startsWith('approveAndRelease')).length === 1,
      'idempotente',
    );
    childServer.close();
  }

  // ---- 6. Rating < A2A_MIN_RATING → NO aprueba -------------------------------
  {
    const chain = new MockChain();
    chain.addAgent(AGENT_B, 'Polyglot · idiomas · traducción', 1n * E18, NATIVE_CURRENCY);
    const h = makeHarness(chain, llmPort, NOW);
    const parentId = chain.addParentTask(NATIVE_CURRENCY, BigInt(NOW + 10_000));
    await h.manager.maybeSubcontract(parentId, chain.tasks[Number(parentId)]!, 'brief padre');
    const childId = parentId + 1n;
    chain.tasks[Number(childId)]!.status = TaskStatus.Delivered;
    chain.tasks[Number(childId)]!.resultHash = keccak256(toBytes('resultado malo'));
    // Sin endpoint: evaluación solo con hash/estado (limitación documentada).
    llmScript.rating = '{"rating": 2, "comment": "no se puede verificar el contenido"}';
    await h.manager.poll();
    const rec = h.store.getSubTask(parentId)!;
    check(
      'rating 2 < min → NO approveAndRelease',
      !chain.writes.some((w) => w.startsWith('approveAndRelease')) && rec.state === 'rejected',
      `state=${rec.state} writes=${chain.writes.join(' | ')}`,
    );
    check(
      'Telegram para revisión humana + padre entregado sin esa parte',
      h.telegram.some((t) => t.includes('NO aprobada') && t.includes('Revisión humana')) && h.deliveredParents.length === 1,
      'OK',
    );
  }

  // ---- 7. Timeout del hijo → cancelTask + padre sin esa parte -----------------
  {
    const chain = new MockChain();
    chain.addAgent(AGENT_B, 'Polyglot · idiomas · traducción', 1n * E18, NATIVE_CURRENCY);
    const h = makeHarness(chain, llmPort, NOW);
    const parentId = chain.addParentTask(NATIVE_CURRENCY, BigInt(NOW + 10_000));
    await h.manager.maybeSubcontract(parentId, chain.tasks[Number(parentId)]!, 'brief padre');
    const childId = parentId + 1n;
    h.setNow(NOW + 7_201); // deadline del hijo (NOW+7200) vencido
    await h.manager.poll();
    const rec = h.store.getSubTask(parentId)!;
    check(
      'timeout → cancelTask on-chain',
      chain.writes.some((w) => w.startsWith(`cancelTask(${childId})`)) && chain.tasks[Number(childId)]!.status === TaskStatus.Cancelled,
      `writes=${chain.writes.join(' | ')}`,
    );
    check(
      'padre entregado sin la parte subcontratada (nota)',
      h.deliveredParents.length === 1 && h.deliveredParents[0]!.text.includes('no llegó a tiempo'),
      `state=${rec.state}`,
    );
    check('Telegram de timeout', h.telegram.some((t) => t.includes('no entregó a tiempo')), 'OK');
  }

  // ---- 8. Pago en $PANAL: approve exacto + createTask value 0 ------------------
  {
    const chain = new MockChain();
    chain.panalBalance = 10n * E18;
    chain.addAgent(AGENT_PANAL, 'PanalWorker · tokens · traducción', 3n * E18, PANAL);
    const h = makeHarness(chain, llmPort, NOW);
    const parentId = chain.addParentTask(PANAL, BigInt(NOW + 10_000)); // padre en $PANAL
    const parked = await h.manager.maybeSubcontract(parentId, chain.tasks[Number(parentId)]!, 'brief padre');
    const approveWrite = chain.writes.find((w) => w.startsWith('approve('));
    const createWrite = chain.writes.find((w) => w.startsWith('createTask'));
    check(
      '$PANAL: approve exacto + createTask sin value',
      parked === true &&
        approveWrite !== undefined &&
        approveWrite.includes(`${ESCROW},${3n * E18}`) &&
        createWrite !== undefined &&
        !createWrite.includes('value='),
      `approve=${approveWrite} create=${createWrite}`,
    );
  }

  // ---- /status ----------------------------------------------------------------
  {
    const chain = new MockChain();
    chain.addAgent(AGENT_B, 'Polyglot · idiomas · traducción', 1n * E18, NATIVE_CURRENCY);
    const h = makeHarness(chain, llmPort, NOW);
    const parentId = chain.addParentTask(NATIVE_CURRENCY, BigInt(NOW + 10_000));
    await h.manager.maybeSubcontract(parentId, chain.tasks[Number(parentId)]!, 'brief padre');
    const status = h.manager.statusSummary();
    check(
      '/status incluye sub-tareas activas y gasto del día',
      status.includes(`#${parentId}→sub-#${parentId + 1n}`) && status.includes('Gasto de hoy') && status.includes('1 / 20'),
      status.split('\n').slice(1).join(' | '),
    );
  }

  llmServer.close();
  if (failures > 0) {
    console.error(`\n❌ ${failures} comprobaciones fallaron`);
    process.exit(1);
  }
  console.log('\n✅ Todas las comprobaciones A2A pasaron');
}

main().catch((err) => {
  console.error('❌ Error en el test A2A:', err);
  process.exit(1);
});
