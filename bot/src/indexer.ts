/**
 * Panal Bot (modo indexer) — indexador de eventos on-chain con histórico
 * completo incremental.
 *
 * Problema: el RPC público de Monad limita eth_getLogs a rangos de ~100
 * bloques, así que el frontend solo ve actividad muy reciente. Este modo
 * construye el histórico COMPLETO de Registry v2 y Escrow v2 y lo sirve por
 * HTTP (ver indexer-http.ts):
 *
 *   1. BOOTSTRAP POR PUNTOS (solo cuando el índice está vacío): usa los
 *      timestamps on-chain para acotar — getAgent(a).registeredAt para cada
 *      agente de getAgents() (paginado) y tasks(i).createdAt para cada task
 *      de getTaskCount() (lotes de 5) —, localiza el bloque exacto con
 *      búsqueda binaria (misma idea que src/hooks/useOnchainEvents.ts del
 *      frontend) y pide getLogs solo en una ventana pequeña alrededor de
 *      cada punto (±INDEX_WINDOW bloques).
 *   2. BARRIDO HACIA ATRÁS: ventanas de ~100 bloques desde el head del
 *      bootstrap hacia el bloque 0, con presupuesto diario
 *      (INDEX_SWEEP_WINDOWS_PER_DAY, default 2000) para no ahogar el RPC.
 *      Cubre lo que los puntos no capturan (p. ej. PriceUpdated,
 *      TaskClaimed/Delivered/Completed de tareas viejas).
 *   3. INCREMENTAL: cada INDEX_POLL_INTERVAL_MS (15 s), getLogs desde
 *      lastBlock+1 hasta head, troceado en ventanas de maxLogRange.
 *
 * El tamaño de ventana se auto-detecta (el RPC anuncia su límite en el
 * mensaje de error). Todo pasa por reintentos con backoff; un fallo de RPC
 * en un tick no tumba el proceso: se reintenta en el siguiente.
 *
 * Limitación honesta: hasta que el barrido llega al bloque 0, el histórico
 * garantizado es "puntos conocidos + lo barrido". Ver bot/README.md.
 */

import { parseAbiItem, type Address } from 'viem';
import { esTokenDeMarca } from './marca.js';
import { esTokenDeNivel } from './niveles.js';
import { fichaEnIdioma, IDIOMAS, type Idioma } from './idiomas.js';
import type { BotConfig } from './config.js';
import { escrowAbi, politePause, withRetry, type ChainClients } from './chain.js';
import type { StopSignal } from './notifier.js';
import { IndexStore, type IndexedEvent } from './indexer-store.js';
import { verificarDominio } from './verificar-dominio.js';

// ---------------------------------------------------------------------------
// ABIs y eventos (firmas exactas de contracts/src/v2/).
// ---------------------------------------------------------------------------

const registryAbi = [
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

const REGISTRY_EVENTS = [
  parseAbiItem(
    'event AgentRegistered(address indexed agent, address indexed owner, uint256 pricePerTask, address currency)',
  ),
  parseAbiItem('event PriceUpdated(address indexed agent, uint256 newPrice, address currency)'),
  parseAbiItem('event MetadataUpdated(address indexed agent, string newMetadataURI)'),
  parseAbiItem('event ActiveUpdated(address indexed agent, bool active)'),
];

const ESCROW_EVENTS = [
  parseAbiItem(
    'event TaskCreated(uint256 indexed taskId, address indexed client, address indexed worker, uint256 amount, address currency)',
  ),
  parseAbiItem('event TaskClaimed(uint256 indexed taskId, address indexed worker)'),
  parseAbiItem('event TaskDelivered(uint256 indexed taskId, bytes32 resultHash)'),
  parseAbiItem(
    'event TaskCompleted(uint256 indexed taskId, address indexed worker, uint256 workerPaid, uint256 fee, uint8 rating)',
  ),
  parseAbiItem('event TaskDisputed(uint256 indexed taskId, address indexed openedBy)'),
  parseAbiItem('event DisputeResolved(uint256 indexed taskId, uint256 workerPaid, uint256 clientRefunded, uint8 rating)'),
  parseAbiItem('event TaskCancelled(uint256 indexed taskId)'),
  parseAbiItem('event Withdrawal(address indexed to, address indexed token, uint256 amount)'),
];

/**
 * PanalNames. Solo interesan los cambios de dueño: quien tiene cada nombre y
 * como lo consiguio.
 *
 * `Vendido` y `Transferido` son lo que hace falta vigilar. Un nombre se puede
 * vender, y lo unico que viaja con el es el nombre: la reputacion, el historial
 * y la verificacion del dominio se quedan en la direccion. Quien compra `lint`
 * hereda el nombre y ninguna de las tareas que lo hicieron valer.
 */
const NAMES_EVENTS = [
  parseAbiItem('event Reclamado(bytes32 indexed hash, string nombre, address indexed dueno, uint256 pagado)'),
  parseAbiItem(
    'event Vendido(bytes32 indexed hash, string nombre, address indexed de, address indexed a, uint256 precio, uint256 comision)',
  ),
  parseAbiItem('event Transferido(bytes32 indexed hash, string nombre, address indexed de, address indexed a)'),
  parseAbiItem('event Liberado(bytes32 indexed hash, string nombre, address indexed dueno)'),
];

/** Log decodificado por viem al pasar `events` al getLogs. */
interface DecodedLog {
  eventName?: string;
  args?: Record<string, unknown>;
  blockNumber: bigint;
  logIndex: number;
  transactionHash: string;
}

/** Media ventana del bootstrap: getLogs en [bloque-120, bloque+120]. */
const BOOTSTRAP_HALF_WINDOW = 120n;
/** Tamaño inicial de ventana de getLogs (el RPC limita a ~100; se auto-ajusta). */
const INITIAL_LOG_RANGE = 100n;
/** Ventanas de barrido procesadas como máximo por tick del loop principal. */
const SWEEP_BATCH_PER_TICK = 20;
/**
 * Cada cuánto se vuelve a mirar el dominio de un agente ya verificado.
 *
 * Seis horas. Un dominio caduca, se vende o deja de apuntar donde apuntaba, y
 * una insignia ganada hace meses no dice nada de hoy; pero repasarlo en cada
 * tick serían miles de peticiones diarias contra servidores ajenos.
 */
const VERIFICAR_CADA_S = 6 * 60 * 60;
/** Reintentos por ventana de getLogs ante errores NO relacionados con el rango. */
const WINDOW_ATTEMPTS = 3;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// getLogs troceado con auto-detección del límite de rango del RPC.
// ---------------------------------------------------------------------------

/** Rango máximo de eth_getLogs que acepta el RPC (mutable: se auto-detecta). */
let maxLogRange = INITIAL_LOG_RANGE;

/** Extrae el límite de rango de eth_getLogs del mensaje de error del RPC. */
function parseRangeLimit(err: unknown): bigint | null {
  const anyErr = err as { cause?: { message?: string }; message?: string };
  const msg = String(anyErr?.cause?.message ?? anyErr?.message ?? err);
  const m =
    msg.match(/limited to a ([\d,]+) range/i) ??
    msg.match(/(?:max(?:imum)?|limit(?:ed)?)[^\d]*([\d,]+)\s*blocks?/i);
  return m && m[1] !== undefined ? BigInt(m[1].replace(/,/g, '')) : null;
}

/** Una sola ventana de getLogs con reintentos cortos (backoff manual). */
async function fetchWindow(
  clients: ChainClients,
  address: Address,
  events: typeof REGISTRY_EVENTS | typeof ESCROW_EVENTS | typeof NAMES_EVENTS,
  fromBlock: bigint,
  toBlock: bigint,
): Promise<DecodedLog[]> {
  let lastError: unknown;
  for (let attempt = 0; attempt < WINDOW_ATTEMPTS; attempt++) {
    try {
      const logs = await clients.publicClient.getLogs({ address, events, fromBlock, toBlock });
      return logs as unknown as DecodedLog[];
    } catch (err) {
      // Los errores de rango se gestionan fuera (ajustando maxLogRange).
      if (parseRangeLimit(err) !== null) throw err;
      lastError = err;
      await sleep(1_000 * 2 ** attempt);
    }
  }
  throw lastError;
}

/** getLogs de [fromBlock, toBlock] troceado según maxLogRange. Secuencial (rate limit). */
async function getLogsChunked(
  clients: ChainClients,
  address: Address,
  events: typeof REGISTRY_EVENTS | typeof ESCROW_EVENTS | typeof NAMES_EVENTS,
  fromBlock: bigint,
  toBlock: bigint,
): Promise<DecodedLog[]> {
  const out: DecodedLog[] = [];
  let f = fromBlock;
  while (f <= toBlock) {
    let t = f + maxLogRange - 1n;
    if (t > toBlock) t = toBlock;
    try {
      const logs = await fetchWindow(clients, address, events, f, t);
      out.push(...logs);
      f = t + 1n;
      await politePause(120);
    } catch (err) {
      const limit = parseRangeLimit(err);
      if (limit !== null && limit >= 1n && limit < maxLogRange) {
        maxLogRange = limit; // reintenta el mismo tramo con el nuevo límite
        console.warn(`[index] RPC limita getLogs a ${limit} bloques: ajustando ventana`);
      } else if (limit === null && maxLogRange > 4n) {
        maxLogRange /= 2n;
        console.warn(`[index] error de rango sin límite explícito: reduciendo ventana a ${maxLogRange}`);
      } else {
        throw err;
      }
    }
  }
  return out;
}

/** getLogs de los contratos en un rango (registry + escrow + names si lo hay). */
async function getLogsBoth(
  clients: ChainClients,
  cfg: BotConfig,
  fromBlock: bigint,
  toBlock: bigint,
): Promise<{ registry: DecodedLog[]; escrow: DecodedLog[]; names: DecodedLog[] }> {
  const registry = await getLogsChunked(clients, cfg.registryAddress, REGISTRY_EVENTS, fromBlock, toBlock);
  const escrow = await getLogsChunked(clients, cfg.escrowAddress, ESCROW_EVENTS, fromBlock, toBlock);
  // Sin PanalNames desplegado no se pide nada: seria una llamada RPC por
  // ventana, en cada vuelta, a un contrato que no existe.
  const names = cfg.namesAddress
    ? await getLogsChunked(clients, cfg.namesAddress, NAMES_EVENTS, fromBlock, toBlock)
    : [];
  return { registry, escrow, names };
}

// ---------------------------------------------------------------------------
// Búsqueda binaria de bloque por timestamp (port de useOnchainEvents.ts).
// ---------------------------------------------------------------------------

/** Primer bloque con timestamp >= tsSec (≈26 getBlock en mainnet). */
async function blockAtTime(clients: ChainClients, tsSec: number, head: bigint): Promise<bigint> {
  let lo = 0n;
  let hi = head;
  while (hi - lo > 1n) {
    const mid = (lo + hi) / 2n;
    const b = await withRetry(`getBlock(${mid})`, () =>
      clients.publicClient.getBlock({ blockNumber: mid }),
    );
    if (Number(b.timestamp) >= tsSec) hi = mid;
    else lo = mid;
    await politePause(60);
  }
  return hi;
}

// ---------------------------------------------------------------------------
// Puntos de actividad on-chain (timestamps) para el bootstrap.
// ---------------------------------------------------------------------------

/** registeredAt de todos los agentes (getAgents paginado + getAgent por lotes). */
async function agentTimestamps(clients: ChainClients, cfg: BotConfig): Promise<number[]> {
  const count = await withRetry('getAgentCount', () =>
    clients.publicClient.readContract({
      address: cfg.registryAddress,
      abi: registryAbi,
      functionName: 'getAgentCount',
    }),
  );
  const addresses: Address[] = [];
  for (let offset = 0n; offset < count; offset += 200n) {
    const page = await withRetry(`getAgents(${offset})`, () =>
      clients.publicClient.readContract({
        address: cfg.registryAddress,
        abi: registryAbi,
        functionName: 'getAgents',
        args: [offset, 200n],
      }),
    );
    addresses.push(...page);
    await politePause();
  }
  const out: number[] = [];
  for (let i = 0; i < addresses.length; i += 5) {
    const stamps = await Promise.all(
      addresses.slice(i, i + 5).map(async (a) => {
        try {
          const ag = await clients.publicClient.readContract({
            address: cfg.registryAddress,
            abi: registryAbi,
            functionName: 'getAgent',
            args: [a],
          });
          return Number(ag.registeredAt);
        } catch {
          return null;
        }
      }),
    );
    for (const x of stamps) if (x) out.push(x);
    if (i + 5 < addresses.length) await politePause(300);
  }
  return out;
}

/** createdAt de todas las tareas (tasks(i) por lotes de 5). */
async function taskTimestamps(clients: ChainClients, cfg: BotConfig): Promise<number[]> {
  const count = await withRetry('getTaskCount', () =>
    clients.publicClient.readContract({
      address: cfg.escrowAddress,
      abi: escrowAbi,
      functionName: 'getTaskCount',
    }),
  );
  const out: number[] = [];
  for (let i = 0n; i < count; i += 5n) {
    const ids: bigint[] = [];
    for (let j = i; j < i + 5n && j < count; j++) ids.push(j);
    const stamps = await Promise.all(
      ids.map(async (id) => {
        try {
          const tk = await clients.publicClient.readContract({
            address: cfg.escrowAddress,
            abi: escrowAbi,
            functionName: 'tasks',
            args: [id],
          });
          return Number(tk.createdAt);
        } catch {
          return null;
        }
      }),
    );
    for (const x of stamps) if (x) out.push(x);
    if (i + 5n < count) await politePause(300);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Decodificado: DecodedLog -> IndexedEvent (con timestamp de bloque).
// ---------------------------------------------------------------------------

const blockTsCache = new Map<string, number>();

async function fetchBlockTimestamps(clients: ChainClients, blockNumbers: bigint[]): Promise<void> {
  const missing = [...new Set(blockNumbers.map((b) => b.toString()))].filter(
    (k) => !blockTsCache.has(k),
  );
  for (let i = 0; i < missing.length; i += 5) {
    const batch = missing.slice(i, i + 5);
    const blocks = await Promise.all(
      batch.map((k) =>
        clients.publicClient
          .getBlock({ blockNumber: BigInt(k) })
          .then((b) => Number(b.timestamp))
          .catch(() => null),
      ),
    );
    blocks.forEach((ts, j) => {
      if (ts !== null) blockTsCache.set(batch[j]!, ts);
    });
    if (i + 5 < missing.length) await politePause(120);
  }
}

/** Serializa un arg decodificado por viem (bigint -> string decimal). */
function serializeArg(value: unknown): string | number | boolean {
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  return String(value);
}

async function toIndexedEvents(
  clients: ChainClients,
  contract: 'registry' | 'escrow' | 'names',
  logs: DecodedLog[],
): Promise<IndexedEvent[]> {
  if (logs.length === 0) return [];
  await fetchBlockTimestamps(clients, logs.map((l) => l.blockNumber));
  const out: IndexedEvent[] = [];
  for (const log of logs) {
    if (!log.eventName) continue;
    const ts = blockTsCache.get(log.blockNumber.toString()) ?? Math.floor(Date.now() / 1000);
    const args: Record<string, string | number | boolean> = {};
    for (const [k, v] of Object.entries(log.args ?? {})) args[k] = serializeArg(v);
    out.push({
      id: `${log.transactionHash}-${log.logIndex}`,
      contract,
      event: log.eventName,
      blockNumber: Number(log.blockNumber),
      logIndex: log.logIndex,
      txHash: log.transactionHash,
      ts,
      args,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Bootstrap por puntos + barrido + incremental.
// ---------------------------------------------------------------------------

/** Bootstrap por puntos conocidos (solo con el índice vacío). */
async function bootstrapByPoints(
  cfg: BotConfig,
  clients: ChainClients,
  store: IndexStore,
  head: bigint,
): Promise<void> {
  console.log('[index] bootstrap: buscando puntos de actividad on-chain…');
  const [agentTs, taskTs] = [await agentTimestamps(clients, cfg), await taskTimestamps(clients, cfg)];
  const targets = [...new Set([...agentTs, ...taskTs])].sort((a, b) => a - b);
  console.log(
    `[index] bootstrap: ${agentTs.length} agentes y ${taskTs.length} tareas -> ${targets.length} puntos de tiempo`,
  );
  let total = 0;
  for (const ts of targets) {
    const b = await blockAtTime(clients, ts, head);
    const from = b > BOOTSTRAP_HALF_WINDOW ? b - BOOTSTRAP_HALF_WINDOW : 0n;
    const to = b + BOOTSTRAP_HALF_WINDOW < head ? b + BOOTSTRAP_HALF_WINDOW : head;
    const { registry, escrow, names } = await getLogsBoth(clients, cfg, from, to);
    const events = [
      ...(await toIndexedEvents(clients, 'registry', registry)),
      ...(await toIndexedEvents(clients, 'escrow', escrow)),
    ...(await toIndexedEvents(clients, 'names', names)),
      ...(await toIndexedEvents(clients, 'names', names)),
    ];
    const added = store.append(events);
    total += added;
    console.log(
      `[index] bootstrap: ts=${ts} bloque≈${b} ventana=[${from},${to}] -> ${registry.length + escrow.length} logs (${added} nuevos)`,
    );
  }
  store.setLastBlock(Number(head));
  store.setSweepFloor(Number(head)); // el barrido arranca desde aquí hacia atrás
  store.saveState();
  console.log(`[index] bootstrap por puntos listo: ${total} eventos nuevos (total ${store.totalEvents})`);
}

/** Poll incremental: getLogs desde lastBlock+1 hasta head (en ventanas). */
async function incremental(
  cfg: BotConfig,
  clients: ChainClients,
  store: IndexStore,
  head: bigint,
): Promise<number> {
  const from = BigInt(store.lastBlock) + 1n;
  if (from > head) return 0;
  const { registry, escrow, names } = await getLogsBoth(clients, cfg, from, head);
  const events = [
    ...(await toIndexedEvents(clients, 'registry', registry)),
    ...(await toIndexedEvents(clients, 'escrow', escrow)),
    ...(await toIndexedEvents(clients, 'names', names)),
  ];
  const added = store.append(events);
  store.setLastBlock(Number(head));
  if (added > 0) {
    console.log(`[index] incremental [${from},${head}]: ${added} eventos nuevos (total ${store.totalEvents})`);
  }
  return added;
}

/**
 * Barrido hacia atrás desde sweepFloor, acotado por el presupuesto diario
 * (INDEX_SWEEP_WINDOWS_PER_DAY) y por SWEEP_BATCH_PER_TICK por tick.
 */
async function sweepBackwards(
  cfg: BotConfig,
  clients: ChainClients,
  store: IndexStore,
): Promise<void> {
  if (cfg.indexSweepWindowsPerDay <= 0) return;
  let floor = store.sweepFloor;
  if (floor === null || floor <= 0) return; // barrido completo (o no iniciado)
  let budget = store.sweepBudgetRemaining(cfg.indexSweepWindowsPerDay);
  if (budget <= 0) return;
  let used = 0;
  while (used < SWEEP_BATCH_PER_TICK && used < budget && floor > 0) {
    const to: bigint = BigInt(floor) - 1n;
    const from: bigint = to + 1n > maxLogRange ? to + 1n - maxLogRange : 0n;
    const { registry, escrow, names } = await getLogsBoth(clients, cfg, from, to);
    const events = [
      ...(await toIndexedEvents(clients, 'registry', registry)),
      ...(await toIndexedEvents(clients, 'escrow', escrow)),
    ...(await toIndexedEvents(clients, 'names', names)),
      ...(await toIndexedEvents(clients, 'names', names)),
    ];
    const added = store.append(events);
    floor = Number(from);
    store.setSweepFloor(floor);
    used += 1;
    if (added > 0) {
      console.log(`[index] barrido [${from},${to}]: ${added} eventos nuevos (total ${store.totalEvents})`);
    }
    if (floor === 0) {
      console.log('[index] barrido COMPLETO: cubierto hasta el bloque 0');
      break;
    }
  }
  store.consumeSweepBudget(used);
  budget = store.sweepBudgetRemaining(cfg.indexSweepWindowsPerDay);
  if (used > 0) {
    console.log(`[index] barrido: ${used} ventanas, frente en bloque ${floor}, quedan ${budget} ventanas hoy`);
  }
}

/**
 * "Nombre · descripcion · skill1, skill2 · bot:https://…" -> campos.
 *
 * Se reimplementa aqui en vez de importarlo de @panal/sdk por lo mismo que el
 * frontend reimplementa los ABIs: el bot es un paquete INDEPENDIENTE, con su
 * propio lockfile, y solo depende de dotenv y viem. Añadir el SDK entero por
 * quince lineas traeria cliente, cadenas y un import('node:dns') que aqui no
 * pinta nada. Si cambia el formato, cambia en los dos sitios.
 */
function leerMetadata(metadataURI: string): {
  name: string;
  description: string;
  skills: string[];
  botUrl: string | null;
} {
  const segmentos = metadataURI
    .split('\u00b7')
    .map((x) => x.trim())
    .filter(Boolean);

  let botUrl: string | null = null;
  const resto: string[] = [];
  for (const seg of segmentos) {
    const candidato = seg.toLowerCase().startsWith('bot:') ? seg.slice(4).trim() : null;
    if (candidato && /^https?:\/\//i.test(candidato)) {
      botUrl = candidato;
      continue;
    }
    // Los tokens de marca (logo, web, github, x, telegram) tampoco son texto:
    // sin apartarlos, el `logo:https://…` de un agente acabaria de skill suya
    // en el catalogo, y de ahi en la tarjeta que ve todo el mundo. El formato
    // manda en `src/lib/marca.ts`; aqui solo hace falta reconocerlos.
    if (esTokenDeMarca(seg)) continue;
    // Los niveles tampoco: son hasta ocho segmentos mas por agente, y sin
    // apartarlos el catalogo anunciaria «nivel:0.03|Un archivo» de skill.
    if (esTokenDeNivel(seg)) continue;
    resto.push(seg);
  }
  // Los campos que falten quedan vacios en vez de desplazar a los siguientes:
  // un agente sin descripcion no debe acabar con sus skills de descripcion.
  const [name = '', description = '', skillsRaw = ''] = resto;
  return {
    name,
    description,
    skills: skillsRaw.split(',').map((x) => x.trim()).filter(Boolean),
    botUrl,
  };
}

/**
 * Relee del registry las fichas que hayan dejado de valer.
 *
 * `AgentRegistered` no lleva el metadataURI, asi que el catalogo no se puede
 * construir solo con eventos: hay que preguntarle al contrato. Lo que si dicen
 * los eventos es CUANDO preguntar, y eso es lo que evita releer el registro
 * entero en cada vuelta.
 *
 * De pocos en pocos y con pausa: esto compite por el mismo RPC que el sondeo
 * de eventos, que es el que no puede descolgarse.
 */
async function refrescarFichas(cfg: BotConfig, clients: ChainClients, store: IndexStore): Promise<void> {
  const pendientes = store.pendientesDeFicha();
  if (pendientes.length === 0) return;

  // Tope por vuelta: con mil agentes nuevos de golpe, leerlos todos aqui
  // dejaria al indexador sin atender la cadena. Se van haciendo por tandas.
  const tanda = pendientes.slice(0, 25);
  let leidas = 0;

  for (let i = 0; i < tanda.length; i += 5) {
    const trozo = tanda.slice(i, i + 5);
    await Promise.all(
      trozo.map(async (address) => {
        try {
          const ag = (await clients.publicClient.readContract({
            address: cfg.registryAddress,
            abi: registryAbi,
            functionName: 'getAgent',
            args: [address as Address],
          })) as {
            owner: Address;
            metadataURI: string;
            pricePerTask: bigint;
            active: boolean;
            registeredAt: bigint;
            currency?: Address;
          };
          // registeredAt en cero = esa direccion no esta registrada. Pasa si un
          // evento nombra a alguien que ya se dio de baja del registro.
          if (ag.registeredAt === 0n) return;
          const meta = leerMetadata(ag.metadataURI);
          const currency = (ag.currency ?? '0x0000000000000000000000000000000000000000') as string;
          store.upsertProfile({
            address: address.toLowerCase(),
            owner: ag.owner.toLowerCase(),
            name: meta.name,
            description: meta.description,
            skills: meta.skills,
            botUrl: meta.botUrl,
            metadataURI: ag.metadataURI ?? '',
            pricePerTask: ag.pricePerTask.toString(),
            currency,
            coin: currency.toLowerCase() === cfg.panalTokenAddress.toLowerCase() ? '$PANAL' : 'MON',
            active: ag.active,
            registeredAt: Number(ag.registeredAt),
            fetchedTs: Math.floor(Date.now() / 1000),
          });
          leidas += 1;
        } catch {
          // Que falle una ficha no puede tumbar el tick: se reintenta en la
          // proxima vuelta, porque sigue marcada como pendiente.
        }
      }),
    );
    if (i + 5 < tanda.length) await politePause(300);
  }

  if (leidas > 0) {
    const quedan = store.pendientesDeFicha().length;
    console.log(`[index] catalogo: ${leidas} fichas al dia${quedan ? `, quedan ${quedan}` : ''}`);
  }
}

/**
 * Comprueba que el dominio de cada agente lo respalda.
 *
 * Va aparte de `refrescarFichas` a proposito: aquella lee la cadena, que
 * responde rapido y es de fiar; esta pide a servidores de terceros, que pueden
 * tardar, colgarse o no existir. Mezclarlas dejaria el catalogo entero a merced
 * del endpoint mas lento.
 *
 * De cinco en cinco por vuelta y como mucho cada VERIFICAR_CADA_S por agente:
 * con mil agentes, pedirles la tarjeta a todos en cada tick serian mil
 * peticiones cada quince segundos contra dominios ajenos, que es un ataque, no
 * una comprobacion.
 */
async function verificarDominios(store: IndexStore): Promise<void> {
  const tanda = store.pendientesDeVerificar(VERIFICAR_CADA_S, 5);
  if (tanda.length === 0) return;

  let cambios = 0;
  await Promise.all(
    tanda.map(async (p) => {
      const antes = p.verificado;
      const { ok, motivo } = await verificarDominio(p.botUrl!, p.address);
      store.marcarVerificacion(p.address, ok, motivo);
      if (antes !== ok) {
        cambios += 1;
        console.log(
          `[index] ${p.name || p.address.slice(0, 10)}: ${ok ? 'dominio verificado' : `sin verificar (${motivo})`}`,
        );
      }
    }),
  );

  if (cambios === 0) console.log(`[index] dominios repasados: ${tanda.length}, sin cambios`);
}

/**
 * Las descripciones de los agentes, en los diez idiomas del marketplace.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * QUE ARREGLA
 *
 * El catalogo es lo primero que ve cualquiera, y salia en el idioma en que su
 * dueno escribio la ficha. Alguien que entra en arabe ve la interfaz entera en
 * arabe y todos los agentes descritos en espanol; y como el nombre del agente
 * y sus niveles los escriben sitios distintos, hoy en mainnet hay fichas que
 * ensenan dos idiomas a la vez en la misma tarjeta.
 *
 * QUIEN TRADUCE
 *
 * Cada agente, con su propio modelo, pidiendole `?lang=`. Aqui solo se guarda.
 * Un traductor central seria un servicio mas que pagar y del que el escaparate
 * pasaria a depender; el agente ya es un modelo y traducir cuatro frases suyas
 * es la llamada mas barata que va a hacer.
 *
 * CUANTO CUESTA
 *
 * Diez peticiones por agente, y SOLO cuando su ficha cambia: `idiomasDe`
 * guarda de que `metadataURI` salieron. Sin esa comprobacion habria que elegir
 * entre pedir diez traducciones a cada agente en cada vuelta —un ataque a sus
 * propios bots— o no refrescarlas nunca.
 *
 * Con una vuelta no basta. El agente no traduce dentro de la peticion: sirve el
 * original y encarga la traduccion por detras, asi que la PRIMERA vez contesta
 * los diez idiomas sin traducir. Por eso se vuelve a por los que falten, como
 * mucho cada REINTENTO_IDIOMAS_S.
 *
 * De dos en dos por vuelta, por lo mismo que la verificacion de dominios: son
 * peticiones contra dominios ajenos.
 * ─────────────────────────────────────────────────────────────────────────
 */
/** Cada cuanto se vuelve a por los idiomas que le faltan a un agente. */
const REINTENTO_IDIOMAS_S = 30 * 60;

/**
 * Version de lo que hay guardado en `idiomas`.
 *
 * Subirla invalida lo guardado y obliga a volver a pedirlo todo. Hizo falta la
 * primera vez porque lo almacenado no eran traducciones sino el texto original
 * —el indexador no miraba `lang`— y sin esto se habria quedado ahi para
 * siempre: la ficha del agente no habia cambiado, asi que nada lo delataba.
 */
const IDIOMAS_V = 2;

async function traducirFichas(store: IndexStore): Promise<void> {
  const tanda = store.pendientesDeTraducir(2, IDIOMAS.length, REINTENTO_IDIOMAS_S, IDIOMAS_V);
  if (tanda.length === 0) return;

  for (const p of tanda) {
    const idiomas: Record<string, string> = {};
    // En serie y no en paralelo: son diez peticiones al MISMO bot, y la
    // primera de cada idioma le cuesta una llamada a su modelo. Diez a la vez
    // es tumbarle el proceso a alguien por traducirle la ficha.
    for (const lang of IDIOMAS) {
      const texto = await descripcionEnIdioma(p.botUrl!, lang);
      if (texto) idiomas[lang] = texto;
    }
    store.guardarIdiomas(p.address, p.metadataURI, idiomas, IDIOMAS_V);
    const n = Object.keys(idiomas).length;
    const quien = p.name || p.address.slice(0, 10);
    console.log(
      n === IDIOMAS.length
        ? `[index] ${quien}: ficha en los ${n} idiomas`
        : n > 0
          ? `[index] ${quien}: ficha en ${n} de ${IDIOMAS.length}; vuelvo a por el resto en ${REINTENTO_IDIOMAS_S / 60} min`
          : `[index] ${quien}: aun no tiene traducciones listas, se queda su texto original`,
    );
  }
}

/**
 * La descripcion que sirve un agente en un idioma, o null si no la tiene.
 *
 * EL AGENTE TIENE QUE DECIR QUE LA TRADUJO, en el campo `lang` de su ficha. Un
 * 200 no basta: la traduccion se encarga por detras, asi que pedir `?lang=fr`
 * antes de que este lista devuelve la ficha ORIGINAL, perfectamente valida y
 * en ingles. Sin mirar `lang` se guardaba eso como si fuera el frances — y como
 * llegaban los diez idiomas, el agente quedaba marcado como traducido y no se
 * volvia a por el. Nueve de cada diez «traducciones» del catalogo eran el texto
 * original hasta que se miro.
 */
async function descripcionEnIdioma(botUrl: string, lang: Idioma): Promise<string | null> {
  try {
    const res = await fetch(fichaEnIdioma(botUrl, lang), {
      signal: AbortSignal.timeout(25_000),
    });
    if (!res.ok) return null;
    const card = (await res.json()) as { description?: unknown; lang?: unknown };
    // Sin `lang`, o con otro: esto no es una traduccion. Los agentes de una
    // plantilla anterior nunca lo mandan, y ahi no hay nada que guardar.
    if (card.lang !== lang) return null;
    if (typeof card.description !== 'string') return null;
    const texto = card.description.replace(/\s+/g, ' ').trim().slice(0, 400);
    return texto || null;
  } catch {
    // Agente caido, sin modelo, sin cuota o de una plantilla anterior que no
    // conoce `?lang=`: se queda su texto original, que es lo que habia antes.
    return null;
  }
}

/** Bucle principal del modo indexer. */
export async function runIndexer(
  cfg: BotConfig,
  clients: ChainClients,
  store: IndexStore,
  stop: StopSignal,
): Promise<void> {
  const head = await withRetry('getBlockNumber', () => clients.publicClient.getBlockNumber());

  if (store.lastBlock === 0) {
    await bootstrapByPoints(cfg, clients, store, head);
  } else {
    console.log(
      `[index] reanudando desde bloque ${store.lastBlock} (${store.totalEvents} eventos ya indexados)`,
    );
    if (store.sweepFloor === null) store.setSweepFloor(store.lastBlock);
  }

  console.log(`[index] poll incremental cada ${cfg.indexPollIntervalMs / 1000}s; barrido ≤ ${cfg.indexSweepWindowsPerDay} ventanas/día`);

  while (!stop.stopped) {
    try {
      const newHead = await withRetry('getBlockNumber', () => clients.publicClient.getBlockNumber());
      await incremental(cfg, clients, store, newHead);
      await refrescarFichas(cfg, clients, store);
      await verificarDominios(store);
      await traducirFichas(store);
      await sweepBackwards(cfg, clients, store);
      store.saveState();
    } catch (err) {
      // Un fallo de RPC no tumba el indexador: se reintenta en el próximo tick.
      console.error(`[index] error en el tick (se reintenta): ${err instanceof Error ? err.message.split('\n')[0] : err}`);
    }
    const deadline = Date.now() + cfg.indexPollIntervalMs;
    while (!stop.stopped && Date.now() < deadline) await sleep(250);
  }

  store.saveState();
  console.log('[index] apagado limpio: estado guardado');
}
