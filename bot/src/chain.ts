/**
 * Panal Bot — clientes de cadena (viem) y helpers de lectura/escritura
 * contra el escrow v2 de Panal en Monad mainnet (chainId 143).
 *
 * ABI mínima embebida (no importamos de ../src para que `bot/` sea un
 * paquete 100% independiente). Fuente: src/contracts/abis.ts (panalEscrowV2Abi).
 *
 * Rate limits del RPC público (documentados en el brief del proyecto):
 *   - eth_call: ~15 req/s
 *   - eth_getLogs: rangos de ~100 bloques -> NO lo usamos; el loop principal
 *     hace polling con getTaskCount() (1 sola llamada por ciclo).
 * Todas las lecturas pasan por `withRetry` (backoff exponencial) para
 * sobrevivir a 429/timeouts transitorios.
 */

import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  getAddress,
  type Address,
  type PublicClient,
  type WalletClient,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import type { BotConfig } from './config.js';

/** Monad mainnet. */
export const monad = defineChain({
  id: 143,
  name: 'Monad',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.monad.xyz'] } },
  blockExplorers: { default: { name: 'MonadVision', url: 'https://monadvision.com' } },
});

/** MON nativo se codifica como address(0) en los contratos v2. */
export const NATIVE_CURRENCY: Address = '0x0000000000000000000000000000000000000000';

/** Status de Task en el escrow v2. */
export enum TaskStatus {
  Open = 0,
  Delivered = 1,
  Completed = 2,
  Disputed = 3,
  Cancelled = 4,
}

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  [TaskStatus.Open]: 'Abierta',
  [TaskStatus.Delivered]: 'Entregada',
  [TaskStatus.Completed]: 'Completada',
  [TaskStatus.Disputed]: 'En disputa',
  [TaskStatus.Cancelled]: 'Cancelada',
};

/** Tupla `tasks(uint256)` del escrow v2. */
export interface Task {
  client: Address;
  worker: Address;
  amount: bigint;
  taskHash: `0x${string}`;
  resultHash: `0x${string}`;
  deadline: bigint;
  createdAt: bigint;
  status: TaskStatus;
  currency: Address;
}

/** Subconjunto del ABI del escrow v2 que usa el bot. */
export const escrowAbi = [
  {
    type: 'function',
    name: 'getTaskCount',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'tasks',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'uint256' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'client', type: 'address' },
          { name: 'worker', type: 'address' },
          { name: 'amount', type: 'uint256' },
          { name: 'taskHash', type: 'bytes32' },
          { name: 'resultHash', type: 'bytes32' },
          { name: 'deadline', type: 'uint256' },
          { name: 'createdAt', type: 'uint256' },
          { name: 'status', type: 'uint8' },
          { name: 'currency', type: 'address' },
        ],
      },
    ],
  },
  {
    type: 'function',
    name: 'deliverResult',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'taskId', type: 'uint256' },
      { name: 'resultHash', type: 'bytes32' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'pendingWithdrawals',
    stateMutability: 'view',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'account', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'withdraw',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'token', type: 'address' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'createTask',
    stateMutability: 'payable',
    inputs: [
      { name: 'worker', type: 'address' },
      { name: 'taskHash', type: 'bytes32' },
      { name: 'deadline', type: 'uint256' },
      { name: 'currency', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: 'taskId', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'approveAndRelease',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'taskId', type: 'uint256' },
      { name: 'rating', type: 'uint8' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'cancelTask',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'taskId', type: 'uint256' }],
    outputs: [],
  },
] as const;

/** Subconjunto del ABI del registry v2 que usa el modo A2A (subcontratación). */
export const registryAbi = [
  {
    type: 'function',
    name: 'getAgentCount',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'getAgents',
    stateMutability: 'view',
    inputs: [
      { name: 'offset', type: 'uint256' },
      { name: 'limit', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'address[]' }],
  },
  {
    type: 'function',
    name: 'getAgent',
    stateMutability: 'view',
    inputs: [{ name: 'agent', type: 'address' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'owner', type: 'address' },
          { name: 'metadataURI', type: 'string' },
          { name: 'pricePerTask', type: 'uint256' },
          { name: 'active', type: 'bool' },
          { name: 'registeredAt', type: 'uint256' },
          { name: 'currency', type: 'address' },
        ],
      },
    ],
  },
] as const;

/** ERC-20 mínimo para pagos en $PANAL (A2A) y chequeos de fondos. */
export const erc20Abi = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'allowance',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;

/** Tupla `getAgent(address)` del registry v2. */
export interface RegistryAgent {
  owner: Address;
  metadataURI: string;
  pricePerTask: bigint;
  active: boolean;
  registeredAt: bigint;
  currency: Address;
}

export interface ChainClients {
  publicClient: PublicClient;
  /** Solo existe en modo worker con BOT_PRIVATE_KEY configurada. */
  walletClient?: WalletClient;
  botAddress?: Address;
}

export function createClients(cfg: BotConfig): ChainClients {
  const publicClient = createPublicClient({
    chain: monad,
    transport: http(cfg.rpcUrl, { timeout: 20_000 }),
  });

  if (!cfg.botPrivateKey) return { publicClient };

  const account = privateKeyToAccount(cfg.botPrivateKey);

  // ------------------------------------------------------------------
  // SEGURIDAD: la wallet del bot debe ser la wallet DEDICADA del agente
  // (la registrada en Panal), NUNCA la principal del dueño:
  //   - deliverResult exige msg.sender == task.worker (= AGENT_ADDRESS),
  //     así que si la clave no corresponde al agente, toda entrega revertiría.
  //   - Si coincide con la del dueño (OWNER_ADDRESS), una máquina
  //     comprometida expondría los fondos principales: abortamos.
  // ------------------------------------------------------------------
  if (cfg.ownerAddress && account.address.toLowerCase() === cfg.ownerAddress.toLowerCase()) {
    console.error(
      '\n❌ SEGURIDAD: BOT_PRIVATE_KEY corresponde a tu wallet principal (OWNER_ADDRESS).\n' +
        '   La wallet del agente debe ser DEDICADA y fondeada solo con gas. Ver README > Seguridad.\n',
    );
    process.exit(1);
  }
  if (account.address.toLowerCase() !== cfg.agentAddress.toLowerCase()) {
    console.error(
      `\n❌ BOT_PRIVATE_KEY no corresponde a AGENT_ADDRESS.\n` +
        `   La clave deriva a ${account.address} pero tu agente es ${cfg.agentAddress}.\n` +
        '   En Panal, deliverResult solo lo puede firmar la wallet del agente (task.worker).\n',
    );
    process.exit(1);
  }

  const walletClient = createWalletClient({
    account,
    chain: monad,
    transport: http(cfg.rpcUrl, { timeout: 20_000 }),
  });

  return { publicClient, walletClient, botAddress: getAddress(account.address) };
}

// ---------------------------------------------------------------------------
// Backoff exponencial para errores de RPC (429, timeouts, errores de red).
// Estrategia: espera base*2^intento con jitter, hasta maxMs. Documentado en
// el README ("Solución de problemas > RPC 429").
// ---------------------------------------------------------------------------

const RETRY_BASE_MS = 2_000;
const RETRY_MAX_MS = 60_000;
const RETRY_ATTEMPTS = 5;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Ejecuta `fn` reintentando con backoff exponencial ante errores de RPC/red. */
export async function withRetry<T>(what: string, fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const wait = Math.min(RETRY_BASE_MS * 2 ** attempt, RETRY_MAX_MS);
      const jitter = Math.floor(Math.random() * 500);
      const msg = err instanceof Error ? err.message.split('\n')[0] : String(err);
      console.warn(
        `[rpc] ${what} falló (intento ${attempt + 1}/${RETRY_ATTEMPTS}): ${msg}. Reintentando en ${wait + jitter} ms…`,
      );
      await sleep(wait + jitter);
    }
  }
  throw lastError;
}

// ---------------------------------------------------------------------------
// Lecturas concretas del escrow v2 (todas pasan por withRetry).
// ---------------------------------------------------------------------------

export async function getTaskCount(clients: ChainClients, cfg: BotConfig): Promise<bigint> {
  return withRetry('getTaskCount', () =>
    clients.publicClient.readContract({
      address: cfg.escrowAddress,
      abi: escrowAbi,
      functionName: 'getTaskCount',
    }),
  );
}

export async function getTask(clients: ChainClients, cfg: BotConfig, taskId: bigint): Promise<Task> {
  const raw = await withRetry(`tasks(${taskId})`, () =>
    clients.publicClient.readContract({
      address: cfg.escrowAddress,
      abi: escrowAbi,
      functionName: 'tasks',
      args: [taskId],
    }),
  );
  return { ...raw, status: Number(raw.status) as TaskStatus };
}

export async function getPendingWithdrawal(
  clients: ChainClients,
  cfg: BotConfig,
  token: Address,
  account: Address,
): Promise<bigint> {
  return withRetry(`pendingWithdrawals(${token})`, () =>
    clients.publicClient.readContract({
      address: cfg.escrowAddress,
      abi: escrowAbi,
      functionName: 'pendingWithdrawals',
      args: [token, account],
    }),
  );
}

// ---------------------------------------------------------------------------
// Escrituras (solo modo worker, firmadas con la wallet dedicada del bot).
// ---------------------------------------------------------------------------

export async function deliverResult(
  clients: ChainClients,
  cfg: BotConfig,
  taskId: bigint,
  resultHash: `0x${string}`,
): Promise<`0x${string}`> {
  if (!clients.walletClient) throw new Error('walletClient no disponible (¿BOT_PRIVATE_KEY configurada?)');
  // simular primero para no gastar gas en una tx que revertiría
  await withRetry(`simulate deliverResult(${taskId})`, () =>
    clients.publicClient.simulateContract({
      address: cfg.escrowAddress,
      abi: escrowAbi,
      functionName: 'deliverResult',
      args: [taskId, resultHash],
      account: clients.walletClient!.account!,
    }),
  );
  const hash = await withRetry(`deliverResult(${taskId})`, () =>
    clients.walletClient!.writeContract({
      address: cfg.escrowAddress,
      abi: escrowAbi,
      functionName: 'deliverResult',
      args: [taskId, resultHash],
      account: clients.walletClient!.account!,
      chain: monad,
    }),
  );
  await withRetry(`wait deliverResult(${taskId})`, () =>
    clients.publicClient.waitForTransactionReceipt({ hash }),
  );
  return hash;
}

export async function withdraw(
  clients: ChainClients,
  cfg: BotConfig,
  token: Address,
): Promise<`0x${string}`> {
  if (!clients.walletClient) throw new Error('walletClient no disponible (¿BOT_PRIVATE_KEY configurada?)');
  const hash = await withRetry(`withdraw(${token})`, () =>
    clients.walletClient!.writeContract({
      address: cfg.escrowAddress,
      abi: escrowAbi,
      functionName: 'withdraw',
      args: [token],
      account: clients.walletClient!.account!,
      chain: monad,
    }),
  );
  await withRetry(`wait withdraw(${token})`, () =>
    clients.publicClient.waitForTransactionReceipt({ hash }),
  );
  return hash;
}

/** Pausa amable entre lecturas secuenciales para respetar el rate limit (~15 req/s). */
export function politePause(ms = 250): Promise<void> {
  return sleep(ms);
}

// ---------------------------------------------------------------------------
// Utilidades de formato y escaneo compartidas por notifier y worker.
// ---------------------------------------------------------------------------

/** Símbolo legible de la moneda de una tarea: address(0) = MON, token $PANAL. */
export function currencySymbol(currency: Address, cfg: BotConfig): 'MON' | '$PANAL' {
  return currency.toLowerCase() === cfg.panalTokenAddress.toLowerCase() ? '$PANAL' : 'MON';
}

/** Formatea un amount wei (18 decimales) recortando ceros: 1500… -> "1.5". */
export function formatAmount(amount: bigint): string {
  const whole = amount / 10n ** 18n;
  const frac = (amount % 10n ** 18n).toString().padStart(18, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac.slice(0, 6)}` : whole.toString();
}

/** Recorta una dirección para mostrarla: 0x1234…abcd. */
export function shortAddress(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

// ---------------------------------------------------------------------------
// A2A (subcontratación): lecturas del registry v2 y escrituras como CLIENTE
// de otros agentes. La wallet del bot es a la vez worker (sus tareas) y
// cliente (de las sub-tareas que crea); el escrow no restringe el rol.
// ---------------------------------------------------------------------------

export async function getAgentCount(clients: ChainClients, cfg: BotConfig): Promise<bigint> {
  return withRetry('getAgentCount', () =>
    clients.publicClient.readContract({
      address: cfg.registryAddress,
      abi: registryAbi,
      functionName: 'getAgentCount',
    }),
  );
}

/** Página de direcciones de agentes registrados (getAgents(offset, limit)). */
export async function getAgentsPage(
  clients: ChainClients,
  cfg: BotConfig,
  offset: bigint,
  limit: bigint,
): Promise<readonly Address[]> {
  return withRetry(`getAgents(${offset},${limit})`, () =>
    clients.publicClient.readContract({
      address: cfg.registryAddress,
      abi: registryAbi,
      functionName: 'getAgents',
      args: [offset, limit],
    }),
  );
}

export async function getRegistryAgent(
  clients: ChainClients,
  cfg: BotConfig,
  agent: Address,
): Promise<RegistryAgent> {
  return withRetry(`getAgent(${agent})`, () =>
    clients.publicClient.readContract({
      address: cfg.registryAddress,
      abi: registryAbi,
      functionName: 'getAgent',
      args: [agent],
    }),
  );
}

/** Balance nativo (MON) de una cuenta. */
export async function getNativeBalance(clients: ChainClients, account: Address): Promise<bigint> {
  return withRetry(`getBalance(${account})`, () => clients.publicClient.getBalance({ address: account }));
}

export async function getTokenBalance(
  clients: ChainClients,
  cfg: BotConfig,
  token: Address,
  account: Address,
): Promise<bigint> {
  return withRetry(`balanceOf(${account})`, () =>
    clients.publicClient.readContract({
      address: token,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [account],
    }),
  );
}

export async function getTokenAllowance(
  clients: ChainClients,
  cfg: BotConfig,
  token: Address,
  owner: Address,
  spender: Address,
): Promise<bigint> {
  return withRetry(`allowance(${owner})`, () =>
    clients.publicClient.readContract({
      address: token,
      abi: erc20Abi,
      functionName: 'allowance',
      args: [owner, spender],
    }),
  );
}

/** approve(spender, amount) exacto sobre el token $PANAL (pagos A2A). */
export async function approveToken(
  clients: ChainClients,
  cfg: BotConfig,
  token: Address,
  spender: Address,
  amount: bigint,
): Promise<`0x${string}`> {
  if (!clients.walletClient) throw new Error('walletClient no disponible (¿BOT_PRIVATE_KEY configurada?)');
  await withRetry(`simulate approve(${token})`, () =>
    clients.publicClient.simulateContract({
      address: token,
      abi: erc20Abi,
      functionName: 'approve',
      args: [spender, amount],
      account: clients.walletClient!.account!,
    }),
  );
  const hash = await withRetry(`approve(${token})`, () =>
    clients.walletClient!.writeContract({
      address: token,
      abi: erc20Abi,
      functionName: 'approve',
      args: [spender, amount],
      account: clients.walletClient!.account!,
      chain: monad,
    }),
  );
  await withRetry(`wait approve(${token})`, () =>
    clients.publicClient.waitForTransactionReceipt({ hash }),
  );
  return hash;
}

/**
 * Crea una tarea como CLIENTE (A2A: el bot subcontrata a otro agente).
 * MON nativo: value = amount. $PANAL: value = 0 (exige approve previo).
 * Devuelve el taskId (obtenido de la simulación) y el hash de la tx.
 */
export async function createTaskTx(
  clients: ChainClients,
  cfg: BotConfig,
  worker: Address,
  taskHash: `0x${string}`,
  deadline: bigint,
  currency: Address,
  amount: bigint,
): Promise<{ taskId: bigint; txHash: `0x${string}` }> {
  if (!clients.walletClient) throw new Error('walletClient no disponible (¿BOT_PRIVATE_KEY configurada?)');
  const value = currency.toLowerCase() === NATIVE_CURRENCY.toLowerCase() ? amount : 0n;
  const sim = await withRetry('simulate createTask(A2A)', () =>
    clients.publicClient.simulateContract({
      address: cfg.escrowAddress,
      abi: escrowAbi,
      functionName: 'createTask',
      args: [worker, taskHash, deadline, currency, amount],
      value,
      account: clients.walletClient!.account!,
    }),
  );
  const taskId = (sim as { result: bigint }).result;
  const txHash = await withRetry(`createTask(A2A → ${worker})`, () =>
    clients.walletClient!.writeContract({
      address: cfg.escrowAddress,
      abi: escrowAbi,
      functionName: 'createTask',
      args: [worker, taskHash, deadline, currency, amount],
      value,
      account: clients.walletClient!.account!,
      chain: monad,
    }),
  );
  await withRetry(`wait createTask(${taskId})`, () =>
    clients.publicClient.waitForTransactionReceipt({ hash: txHash }),
  );
  return { taskId, txHash };
}

/** Aprueba y libera el pago de una sub-tarea entregada (rating 1-5). */
export async function approveAndReleaseTx(
  clients: ChainClients,
  cfg: BotConfig,
  taskId: bigint,
  rating: number,
): Promise<`0x${string}`> {
  if (!clients.walletClient) throw new Error('walletClient no disponible (¿BOT_PRIVATE_KEY configurada?)');
  await withRetry(`simulate approveAndRelease(${taskId})`, () =>
    clients.publicClient.simulateContract({
      address: cfg.escrowAddress,
      abi: escrowAbi,
      functionName: 'approveAndRelease',
      args: [taskId, rating],
      account: clients.walletClient!.account!,
    }),
  );
  const hash = await withRetry(`approveAndRelease(${taskId})`, () =>
    clients.walletClient!.writeContract({
      address: cfg.escrowAddress,
      abi: escrowAbi,
      functionName: 'approveAndRelease',
      args: [taskId, rating],
      account: clients.walletClient!.account!,
      chain: monad,
    }),
  );
  await withRetry(`wait approveAndRelease(${taskId})`, () =>
    clients.publicClient.waitForTransactionReceipt({ hash }),
  );
  return hash;
}

/**
 * Cancela una sub-tarea Open cuyo deadline ya venció (el contrato solo lo
 * permite al cliente, con status Open y deadline pasado o sin worker).
 */
export async function cancelTaskTx(
  clients: ChainClients,
  cfg: BotConfig,
  taskId: bigint,
): Promise<`0x${string}`> {
  if (!clients.walletClient) throw new Error('walletClient no disponible (¿BOT_PRIVATE_KEY configurada?)');
  await withRetry(`simulate cancelTask(${taskId})`, () =>
    clients.publicClient.simulateContract({
      address: cfg.escrowAddress,
      abi: escrowAbi,
      functionName: 'cancelTask',
      args: [taskId],
      account: clients.walletClient!.account!,
    }),
  );
  const hash = await withRetry(`cancelTask(${taskId})`, () =>
    clients.walletClient!.writeContract({
      address: cfg.escrowAddress,
      abi: escrowAbi,
      functionName: 'cancelTask',
      args: [taskId],
      account: clients.walletClient!.account!,
      chain: monad,
    }),
  );
  await withRetry(`wait cancelTask(${taskId})`, () =>
    clients.publicClient.waitForTransactionReceipt({ hash }),
  );
  return hash;
}

/**
 * Escanea las tareas `[fromId, toId]` y devuelve las asignadas al agente.
 * Lecturas secuenciales con pausa (rate limit). Pensado para el primer
 * arranque (baseline) acotado por MAX_INITIAL_SCAN.
 */
export async function scanAgentTasks(
  clients: ChainClients,
  cfg: BotConfig,
  fromId: bigint,
  toId: bigint,
): Promise<Map<bigint, Task>> {
  const mine = new Map<bigint, Task>();
  for (let id = fromId; id <= toId; id++) {
    try {
      const task = await getTask(clients, cfg, id);
      if (task.worker.toLowerCase() === cfg.agentAddress.toLowerCase()) {
        mine.set(id, task);
      }
    } catch (err) {
      // Una tarea que no se puede leer no debe tumbar el escaneo completo.
      console.warn(`[scan] No se pudo leer tasks(${id}): ${err instanceof Error ? err.message : err}`);
    }
    await politePause();
  }
  return mine;
}
