/**
 * Panal Bot (modo mcp) — servidor MCP (Model Context Protocol) de SOLO LECTURA.
 *
 * Expone el marketplace de Panal como herramientas para clientes MCP (Claude
 * Desktop, Claude Code, Cursor…), de forma que una persona pueda buscar
 * agentes, ver su reputación real y consultar tareas sin salir de su
 * conversación y sin pasar por el frontend.
 *
 * DATOS 100 % REALES DE MAINNET. No hay mocks, fixtures ni datos de ejemplo:
 *   - Estado autoritativo y en tiempo real (agentes, tareas)  -> lectura directa
 *     de los contratos en Monad mainnet (chain 143) vía RPC.
 *   - Agregados históricos (reputación, volumen, series)      -> API pública del
 *     indexador (https://api.panal.lat), que también sirve mainnet.
 * Cuando el indexador no responde, las herramientas degradan a los datos de
 * cadena en vez de fallar: se prefiere un resultado parcial y etiquetado como
 * tal antes que ninguno.
 *
 * DOS MODOS. Arranca en SOLO LECTURA: sin clave privada, sin firmar nada, sin
 * poder mover un céntimo. La contratación se habilita aparte, con
 * MCP_ENABLE_WRITES=true y una MCP_PRIVATE_KEY, y entonces el servidor crea
 * tareas y libera pagos DE VERDAD en mainnet.
 *
 * Los topes de gasto (por encargo y diarios) viven en el servidor, no en el
 * prompt: un prompt se puede convencer, un `if` no. Y contratar exige un
 * presupuesto previo —`panal_quote_hire` emite un quote_id que `panal_hire`
 * consume—, así que el precio pasa obligatoriamente por la conversación antes
 * de que se gaste nada.
 *
 * TRANSPORTE: stdio con JSON-RPC 2.0 delimitado por saltos de línea,
 * implementado aquí sin dependencias nuevas (el bot sigue con viem + dotenv).
 *
 *   ⚠️  stdout ES EL CANAL DEL PROTOCOLO. Cualquier `console.log` lo corrompe
 *       y el cliente MCP se desconecta sin explicación. TODA traza va a stderr
 *       a través de `log()`. No uses console.log en este archivo.
 *
 * ARRANQUE (sin configuración: trae los valores de mainnet por defecto)
 *   npx tsx src/mcp.ts
 *
 * Registro en Claude Desktop / Claude Code (`claude_desktop_config.json`):
 *   {
 *     "mcpServers": {
 *       "panal": { "command": "npx", "args": ["tsx", "/ruta/a/bot/src/mcp.ts"] }
 *     }
 *   }
 *
 * Variables opcionales (todas con default de mainnet):
 *   RPC_URL, REGISTRY_ADDRESS, ESCROW_ADDRESS, PANAL_TOKEN_ADDRESS, INDEX_API_URL
 */

import {
  createPublicClient,
  createWalletClient,
  formatEther,
  getAddress,
  http,
  keccak256,
  parseEther,
  toBytes,
  type Address,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { erc20Abi, escrowAbi, monad, registryAbi, TASK_STATUS_LABEL, TaskStatus } from './chain.js';
import { briefSignMessage, resultSignMessage } from './http.js';
import { assertPublicUrl, fetchJsonLimited } from './net.js';
import { esTokenDeMarca } from './marca.js';
import { esTokenDeNivel } from './niveles.js';

// ---------------------------------------------------------------------------
// Configuración — defaults de mainnet para que funcione sin .env.
// ---------------------------------------------------------------------------

const SERVER_NAME = 'panal';
const SERVER_VERSION = '0.1.0';

/** Versiones del protocolo MCP que sabemos hablar (la primera es la preferida). */
const SUPPORTED_PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];

const RPC_URL = process.env.RPC_URL?.trim() || 'https://rpc.monad.xyz';
const REGISTRY_ADDRESS = getAddress(
  process.env.REGISTRY_ADDRESS?.trim() || '0x89a812BFb1c35fc814ef25a3E6Ca75068B16Ac51',
);
const ESCROW_ADDRESS = getAddress(
  process.env.ESCROW_ADDRESS?.trim() || '0xe138A9A492CFe27A13f8b7A6D312DA831791bCe9',
);
const PANAL_TOKEN = getAddress(
  process.env.PANAL_TOKEN_ADDRESS?.trim() || '0x2e2e44e7fa6178822d4397299f719e89d1a67777',
);
const INDEX_API = (process.env.INDEX_API_URL?.trim() || 'https://api.panal.lat').replace(/\/+$/, '');

const EXPLORER = 'https://monadvision.com';

/** Tope de agentes leídos por página del registry (una llamada RPC por página). */
const REGISTRY_PAGE = 50;
/** Tope duro de agentes recorridos, por si el registro crece mucho. */
const REGISTRY_MAX = 500;
/** Timeout de las llamadas al indexador. */
const INDEX_TIMEOUT_MS = 8_000;

const publicClient = createPublicClient({
  chain: monad,
  transport: http(RPC_URL),
});

/** Traza al canal correcto: stderr. stdout está reservado al protocolo. */
function log(msg: string): void {
  process.stderr.write(`[mcp] ${msg}\n`);
}

// ---------------------------------------------------------------------------
// Metadata on-chain: "Nombre · Descripción · skill1, skill2 · bot:https://…"
// Es texto libre separado por '·'; el segmento del endpoint lleva prefijo 'bot:'.
// ---------------------------------------------------------------------------

interface AgentMeta {
  name: string;
  description: string;
  skills: string[];
  botUrl: string | null;
}

function parseMetadata(metadataURI: string): AgentMeta {
  const segments = metadataURI
    .split('·')
    .map((s) => s.trim())
    .filter(Boolean);

  let botUrl: string | null = null;
  const rest: string[] = [];
  for (const seg of segments) {
    const candidate = seg.toLowerCase().startsWith('bot:') ? seg.slice(4).trim() : null;
    if (candidate && /^https?:\/\//i.test(candidate)) {
      botUrl = candidate;
      continue;
    }
    // Marca y niveles fuera antes de repartir posiciones. Hasta ahora esto se
    // salvaba de milagro —esos tokens se escriben al final, así que caían en
    // la cuarta posición y nadie la lee—, pero basta con un agente que no haya
    // puesto descripción para que todo suba un puesto y sus skills pasen a ser
    // un `nivel:0.03|Un archivo` a medio leer.
    if (esTokenDeMarca(seg) || esTokenDeNivel(seg)) continue;
    rest.push(seg);
  }

  // Convención observada: [nombre, descripción, skills]. Los campos que falten
  // quedan vacíos en vez de desplazar a los siguientes.
  const [name = '', description = '', skillsRaw = ''] = rest;
  const skills = skillsRaw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  return { name, description, skills, botUrl };
}

function currencySymbol(currency: Address): '$PANAL' | 'MON' {
  return currency.toLowerCase() === PANAL_TOKEN.toLowerCase() ? '$PANAL' : 'MON';
}

function formatAmount(wei: bigint, currency: Address): string {
  return `${formatEther(wei)} ${currencySymbol(currency)}`;
}

// ---------------------------------------------------------------------------
// Indexador (agregados históricos). Degrada a null si no responde.
// ---------------------------------------------------------------------------

interface IndexAgentStats {
  address: string;
  tasks: number;
  completed: number;
  avgRating: number | null;
  ratingCount: number;
  volume: Record<string, string>;
  firstSeenTs?: number;
  lastSeenTs?: number;
}

async function fetchIndex<T>(path: string): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), INDEX_TIMEOUT_MS);
  try {
    const res = await fetch(`${INDEX_API}${path}`, { signal: controller.signal });
    if (!res.ok) {
      log(`indexador ${path} respondió ${res.status}; se sigue solo con datos de cadena`);
      return null;
    }
    return (await res.json()) as T;
  } catch (err) {
    log(`indexador ${path} no disponible (${err instanceof Error ? err.message : err}); solo cadena`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function agentStatsByAddress(): Promise<Map<string, IndexAgentStats>> {
  const data = await fetchIndex<{ agents: IndexAgentStats[] }>('/index/agents');
  const map = new Map<string, IndexAgentStats>();
  for (const a of data?.agents ?? []) map.set(a.address.toLowerCase(), a);
  return map;
}

// ---------------------------------------------------------------------------
// Lecturas de cadena (fuente autoritativa y en tiempo real).
// ---------------------------------------------------------------------------

interface OnChainAgent {
  address: Address;
  owner: Address;
  metadataURI: string;
  pricePerTask: bigint;
  active: boolean;
  registeredAt: bigint;
  currency: Address;
}

async function readAllAgents(): Promise<OnChainAgent[]> {
  const count = Number(
    await publicClient.readContract({
      address: REGISTRY_ADDRESS,
      abi: registryAbi,
      functionName: 'getAgentCount',
    }),
  );

  const addresses: Address[] = [];
  for (let offset = 0; offset < Math.min(count, REGISTRY_MAX); offset += REGISTRY_PAGE) {
    const page = (await publicClient.readContract({
      address: REGISTRY_ADDRESS,
      abi: registryAbi,
      functionName: 'getAgents',
      args: [BigInt(offset), BigInt(REGISTRY_PAGE)],
    })) as readonly Address[];
    addresses.push(...page);
    if (page.length < REGISTRY_PAGE) break;
  }

  const agents = await Promise.all(
    addresses.map(async (address) => {
      const a = (await publicClient.readContract({
        address: REGISTRY_ADDRESS,
        abi: registryAbi,
        functionName: 'getAgent',
        args: [address],
      })) as {
        owner: Address;
        metadataURI: string;
        pricePerTask: bigint;
        active: boolean;
        registeredAt: bigint;
        currency: Address;
      };
      return { address, ...a } satisfies OnChainAgent;
    }),
  );

  return agents;
}

// ---------------------------------------------------------------------------
// MODO ESCRITURA — contratar y pagar de verdad en Monad mainnet.
//
// Apagado salvo que se pida explícitamente. Un MCP con clave privada es un LLM
// gastando dinero real a petición de quien esté conversando, así que los topes
// se aplican AQUÍ, en el servidor, y no en el prompt: un prompt se puede
// convencer, un `if` no.
//
//   MCP_ENABLE_WRITES=true      obligatorio, no basta con tener clave
//   MCP_PRIVATE_KEY=0x…         wallet CLIENTE (la que paga). Dedicada, no la principal.
//   MCP_MAX_PER_TASK_WEI        tope por encargo   (default 1e18 = 1 MON/$PANAL)
//   MCP_DAILY_BUDGET_WEI        tope diario UTC    (default 5e18)
//   MCP_TASK_DEADLINE_HOURS     margen del deadline (default 24 h)
// ---------------------------------------------------------------------------

const WRITES_ENABLED = (process.env.MCP_ENABLE_WRITES ?? '').trim().toLowerCase() === 'true';
const MAX_PER_TASK_WEI = BigInt(process.env.MCP_MAX_PER_TASK_WEI?.trim() || parseEther('1').toString());
const DAILY_BUDGET_WEI = BigInt(process.env.MCP_DAILY_BUDGET_WEI?.trim() || parseEther('5').toString());
const DEADLINE_HOURS = Number(process.env.MCP_TASK_DEADLINE_HOURS?.trim() || '24');

/** Mínimos que exige el escrow (PanalEscrowV2). */
const MIN_NATIVE_WEI = parseEther('0.001');
const MIN_TOKEN_WEI = parseEther('1');

const account = (() => {
  const key = process.env.MCP_PRIVATE_KEY?.trim();
  if (!key) return undefined;
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
    log('MCP_PRIVATE_KEY no tiene el formato 0x + 64 hex: se ignora, el servidor queda en solo lectura');
    return undefined;
  }
  return privateKeyToAccount(key as Hex);
})();

const walletClient =
  account && WRITES_ENABLED
    ? createWalletClient({ account, chain: monad, transport: http(RPC_URL, { timeout: 20_000 }) })
    : undefined;

/** Motivo por el que no se puede escribir, o null si sí se puede. */
function writesBlockedReason(): string | null {
  if (!WRITES_ENABLED) {
    return 'Este servidor está en SOLO LECTURA. Para contratar hace falta arrancarlo con MCP_ENABLE_WRITES=true y una MCP_PRIVATE_KEY con fondos.';
  }
  if (!account || !walletClient) {
    return 'MCP_ENABLE_WRITES está activo pero no hay MCP_PRIVATE_KEY válida, así que no hay wallet con la que pagar.';
  }
  return null;
}

// ---- Registro de gasto: persistido, porque un tope que se borra al reiniciar
// ---- no es un tope. Un día UTC por archivo, escritura atómica.
const SPEND_FILE =
  process.env.MCP_SPEND_FILE?.trim() ||
  resolve(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'mcp-spend.json');

function utcDay(): string {
  return new Date().toISOString().slice(0, 10);
}

function readSpentToday(): bigint {
  try {
    const raw = JSON.parse(readFileSync(SPEND_FILE, 'utf8')) as { day?: string; spentWei?: string };
    if (raw.day !== utcDay()) return 0n;
    return BigInt(raw.spentWei ?? '0');
  } catch {
    return 0n;
  }
}

function recordSpend(wei: bigint): void {
  const total = readSpentToday() + wei;
  try {
    mkdirSync(dirname(SPEND_FILE), { recursive: true });
    const tmp = `${SPEND_FILE}.tmp`;
    writeFileSync(tmp, JSON.stringify({ day: utcDay(), spentWei: total.toString() }, null, 2));
    renameSync(tmp, SPEND_FILE);
  } catch (err) {
    // Si no se puede persistir, es preferible saberlo: el tope diario deja de
    // ser fiable entre reinicios.
    log(`⚠️  no se pudo registrar el gasto en ${SPEND_FILE}: ${err instanceof Error ? err.message : err}`);
  }
}

// ---- Presupuestos: cotizar antes de gastar -------------------------------
//
// `panal_hire` NO acepta una dirección y un importe sueltos: exige el id de un
// presupuesto emitido antes por `panal_quote_hire`. Así el precio pasa
// obligatoriamente por la conversación —la persona lo ve— antes de que se
// mueva un céntimo, y el modelo no puede inventarse el importe.

interface Quote {
  id: string;
  worker: Address;
  agentName: string;
  brief: string;
  amount: bigint;
  currency: Address;
  symbol: string;
  botUrl: string;
  expiresAt: number;
}

const QUOTE_TTL_MS = 5 * 60 * 1000;
const quotes = new Map<string, Quote>();

function pruneQuotes(): void {
  const now = Date.now();
  for (const [id, q] of quotes) if (q.expiresAt <= now) quotes.delete(id);
}

async function balanceFor(currency: Address, owner: Address): Promise<bigint> {
  if (currency.toLowerCase() === '0x0000000000000000000000000000000000000000') {
    return publicClient.getBalance({ address: owner });
  }
  return publicClient.readContract({
    address: currency,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [owner],
  }) as Promise<bigint>;
}

// ---------------------------------------------------------------------------
// Herramientas.
// ---------------------------------------------------------------------------

interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run: (args: Record<string, unknown>) => Promise<string>;
}

function renderAgent(agent: OnChainAgent, stats: IndexAgentStats | undefined, verbose: boolean): string {
  const meta = parseMetadata(agent.metadataURI);
  const price = formatAmount(agent.pricePerTask, agent.currency);
  const lines: string[] = [];

  lines.push(`### ${meta.name || agent.address}`);
  lines.push(`- Dirección: \`${agent.address}\``);
  lines.push(`- Estado: ${agent.active ? 'ACTIVO — se puede contratar' : 'INACTIVO — no acepta encargos'}`);
  lines.push(`- Precio de referencia: ${price}`);
  if (meta.description) lines.push(`- Qué hace: ${meta.description}`);
  if (meta.skills.length) lines.push(`- Skills: ${meta.skills.join(', ')}`);

  if (stats) {
    const rating = stats.avgRating === null ? 'sin valoraciones' : `${stats.avgRating}/5 (${stats.ratingCount} valoraciones)`;
    lines.push(`- Reputación on-chain: ${rating}`);
    lines.push(`- Tareas: ${stats.completed} completadas de ${stats.tasks} recibidas`);
    const vol = Object.entries(stats.volume ?? {})
      .map(([sym, wei]) => `${formatEther(BigInt(wei))} ${sym}`)
      .join(' · ');
    if (vol) lines.push(`- Volumen cobrado: ${vol}`);
  } else {
    lines.push('- Reputación on-chain: sin histórico (aún no ha completado tareas)');
  }

  if (verbose) {
    lines.push(`- Endpoint del agente: ${meta.botUrl ?? 'NO PUBLICADO — no puede recibir briefs ni entregar resultados'}`);
    lines.push(`- Dueño: \`${agent.owner}\``);
    lines.push(`- Registrado: ${new Date(Number(agent.registeredAt) * 1000).toISOString()}`);
    lines.push(`- Explorador: ${EXPLORER}/address/${agent.address}`);
  }

  return lines.join('\n');
}

const TOOLS: ToolDef[] = [
  {
    name: 'panal_search_agents',
    description:
      'Busca agentes de IA contratables en el marketplace Panal (Monad mainnet). Devuelve datos ' +
      'reales leídos de los contratos y la reputación real acumulada on-chain (tareas completadas, ' +
      'valoración media, volumen cobrado). Úsala cuando alguien quiera encontrar un agente para un ' +
      'trabajo o preguntar qué hay disponible en Panal.',
    inputSchema: {
      type: 'object',
      properties: {
        skill: {
          type: 'string',
          description:
            'Filtro por habilidad o palabra clave (ej. "translation", "legal", "data analysis"). ' +
            'Si se omite, devuelve todos los agentes.',
        },
        include_inactive: {
          type: 'boolean',
          description: 'Incluir agentes desactivados, que no se pueden contratar. Por defecto false.',
        },
        limit: { type: 'number', description: 'Máximo de agentes a devolver (por defecto 20).' },
      },
    },
    async run(args) {
      const skill = typeof args.skill === 'string' ? args.skill.trim().toLowerCase() : '';
      const includeInactive = args.include_inactive === true;
      const limit = typeof args.limit === 'number' && args.limit > 0 ? Math.floor(args.limit) : 20;

      const [agents, stats] = await Promise.all([readAllAgents(), agentStatsByAddress()]);

      const filtered = agents
        .filter((a) => includeInactive || a.active)
        .filter((a) => !skill || a.metadataURI.toLowerCase().includes(skill));

      // Mejor valorados primero, luego por tareas completadas: el orden importa
      // porque quien lea esto normalmente contrata al primero.
      const ranked = filtered.sort((x, y) => {
        const sx = stats.get(x.address.toLowerCase());
        const sy = stats.get(y.address.toLowerCase());
        const rx = sx?.avgRating ?? -1;
        const ry = sy?.avgRating ?? -1;
        if (ry !== rx) return ry - rx;
        return (sy?.completed ?? 0) - (sx?.completed ?? 0);
      });

      const shown = ranked.slice(0, limit);
      if (shown.length === 0) {
        return skill
          ? `No hay agentes ${includeInactive ? '' : 'activos '}que coincidan con "${skill}" en Panal. ` +
              `Hay ${agents.length} agentes registrados en total.`
          : 'No hay agentes registrados en Panal ahora mismo.';
      }

      const header =
        `${shown.length} de ${filtered.length} agentes${skill ? ` para "${skill}"` : ''} ` +
        `(${agents.length} registrados en total, ${agents.filter((a) => a.active).length} activos).\n` +
        `Datos leídos en directo de Monad mainnet.\n`;

      return `${header}\n${shown.map((a) => renderAgent(a, stats.get(a.address.toLowerCase()), false)).join('\n\n')}`;
    },
  },

  {
    name: 'panal_get_agent',
    description:
      'Ficha completa de un agente concreto de Panal por su dirección: qué hace, precio, si está ' +
      'activo, su reputación real on-chain y si tiene endpoint publicado para recibir encargos.',
    inputSchema: {
      type: 'object',
      properties: {
        address: { type: 'string', description: 'Dirección del agente (0x…).' },
      },
      required: ['address'],
    },
    async run(args) {
      const raw = typeof args.address === 'string' ? args.address.trim() : '';
      let address: Address;
      try {
        address = getAddress(raw);
      } catch {
        return `"${raw}" no es una dirección válida. Debe tener el formato 0x seguido de 40 caracteres hexadecimales.`;
      }

      const agent = (await publicClient.readContract({
        address: REGISTRY_ADDRESS,
        abi: registryAbi,
        functionName: 'getAgent',
        args: [address],
      })) as Omit<OnChainAgent, 'address'>;

      if (agent.registeredAt === 0n) {
        return `La dirección ${address} no está registrada como agente en Panal.`;
      }

      const stats = await agentStatsByAddress();
      return renderAgent({ address, ...agent }, stats.get(address.toLowerCase()), true);
    },
  },

  {
    name: 'panal_get_task',
    description:
      'Estado en tiempo real de un encargo (tarea) del escrow de Panal por su id: quién lo pidió, ' +
      'qué agente lo ejecuta, cuánto hay bloqueado, en qué estado está y si ya se entregó. ' +
      'Se lee directamente del contrato, no de un índice, así que refleja el estado del bloque actual.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'number', description: 'Identificador numérico de la tarea (empieza en 0).' },
      },
      required: ['task_id'],
    },
    async run(args) {
      const id = typeof args.task_id === 'number' ? Math.floor(args.task_id) : Number.NaN;
      if (!Number.isFinite(id) || id < 0) return 'task_id debe ser un número entero mayor o igual que 0.';

      const count = Number(
        await publicClient.readContract({
          address: ESCROW_ADDRESS,
          abi: escrowAbi,
          functionName: 'getTaskCount',
        }),
      );
      if (id >= count) {
        return `La tarea #${id} no existe todavía. Ahora mismo hay ${count} tareas creadas en Panal (ids 0..${count - 1}).`;
      }

      const t = (await publicClient.readContract({
        address: ESCROW_ADDRESS,
        abi: escrowAbi,
        functionName: 'tasks',
        args: [BigInt(id)],
      })) as {
        client: Address;
        worker: Address;
        amount: bigint;
        taskHash: `0x${string}`;
        resultHash: `0x${string}`;
        deadline: bigint;
        createdAt: bigint;
        status: number;
        currency: Address;
      };

      const status = TASK_STATUS_LABEL[t.status as TaskStatus] ?? `desconocido (${t.status})`;
      const delivered = t.resultHash !== `0x${'0'.repeat(64)}`;

      return [
        `### Tarea #${id}`,
        `- Estado: **${status}**`,
        `- Importe bloqueado: ${formatAmount(t.amount, t.currency)}`,
        `- Cliente: \`${t.client}\``,
        `- Agente: \`${t.worker}\``,
        `- Creada: ${new Date(Number(t.createdAt) * 1000).toISOString()}`,
        `- Fecha límite: ${new Date(Number(t.deadline) * 1000).toISOString()}`,
        `- Resultado entregado: ${delivered ? `sí — hash \`${t.resultHash}\`` : 'todavía no'}`,
        '',
        delivered
          ? 'El resultado vive fuera de la cadena: solo el cliente puede recuperarlo, firmando con su ' +
            'wallet contra el endpoint del agente. El hash de arriba permite verificar que el texto no cambió.'
          : '',
      ]
        .filter(Boolean)
        .join('\n');
    },
  },

  {
    name: 'panal_marketplace_stats',
    description:
      'Cifras globales reales del marketplace Panal: agentes registrados, tareas creadas y ' +
      'completadas, y actividad reciente. Útil para responder "cómo va Panal" o "cuánta actividad hay".',
    inputSchema: { type: 'object', properties: {} },
    async run() {
      const [chainCount, stats] = await Promise.all([
        publicClient.readContract({
          address: ESCROW_ADDRESS,
          abi: escrowAbi,
          functionName: 'getTaskCount',
        }) as Promise<bigint>,
        fetchIndex<{
          lastBlock: number;
          totalEvents: number;
          byType: Record<string, number>;
          totals: { agents: number; tasks: number; completed: number };
          daily7: { date: string; events: number; monMoved: string; panalMoved: string }[];
        }>('/index/stats'),
      ]);

      const currentBlock = await publicClient.getBlockNumber();
      const lines: string[] = [
        '### Panal — estado real (Monad mainnet)',
        `- Tareas creadas: **${chainCount}** (leído del escrow, bloque ${currentBlock})`,
      ];

      if (!stats) {
        lines.push('', '_El indexador no responde ahora mismo; solo se muestran datos de cadena._');
        return lines.join('\n');
      }

      lines.push(
        `- Tareas completadas y pagadas: **${stats.totals.completed}**`,
        `- Agentes con actividad: **${stats.totals.agents}**`,
        `- Eventos on-chain indexados: ${stats.totalEvents}`,
        `- Retraso del indexador: ${Number(currentBlock) - stats.lastBlock} bloques`,
      );

      const active = stats.daily7.filter((d) => d.events > 0);
      if (active.length) {
        lines.push('', '**Últimos 7 días con actividad:**');
        for (const d of active) {
          const mon = formatEther(BigInt(d.monMoved || '0'));
          const panal = formatEther(BigInt(d.panalMoved || '0'));
          lines.push(`- ${d.date}: ${d.events} eventos · ${mon} MON · ${panal} $PANAL`);
        }
      } else {
        lines.push('', '_Sin actividad on-chain en los últimos 7 días._');
      }

      return lines.join('\n');
    },
  },

  // -------------------------------------------------------------------------
  // Escritura: mueven fondos reales en Monad mainnet.
  // -------------------------------------------------------------------------

  {
    name: 'panal_wallet',
    description:
      'Estado de la wallet con la que este servidor contrata en Panal: dirección, saldo real de MON y ' +
      '$PANAL, y cuánto queda del presupuesto diario. Úsala antes de contratar o si el usuario pregunta ' +
      'si se puede pagar algo.',
    inputSchema: { type: 'object', properties: {} },
    async run() {
      if (!account) {
        return (
          'No hay wallet configurada: el servidor está en SOLO LECTURA.\n\n' +
          'Puede buscar agentes y consultar tareas, pero no contratar. Para habilitar la contratación ' +
          'hay que arrancarlo con MCP_ENABLE_WRITES=true y una MCP_PRIVATE_KEY con fondos.'
        );
      }
      const [mon, panal] = await Promise.all([
        balanceFor('0x0000000000000000000000000000000000000000' as Address, account.address),
        balanceFor(PANAL_TOKEN, account.address),
      ]);
      const spent = readSpentToday();
      const left = DAILY_BUDGET_WEI > spent ? DAILY_BUDGET_WEI - spent : 0n;
      return [
        '### Wallet del servidor MCP',
        `- Dirección: \`${account.address}\``,
        `- Contratación: ${WRITES_ENABLED ? '**HABILITADA** — las llamadas gastan fondos reales' : 'deshabilitada (solo lectura)'}`,
        `- Saldo: ${formatEther(mon)} MON · ${formatEther(panal)} $PANAL`,
        `- Tope por encargo: ${formatEther(MAX_PER_TASK_WEI)}`,
        `- Gastado hoy (UTC): ${formatEther(spent)} de ${formatEther(DAILY_BUDGET_WEI)} · queda ${formatEther(left)}`,
        `- Explorador: ${EXPLORER}/address/${account.address}`,
      ].join('\n');
    },
  },

  {
    name: 'panal_quote_hire',
    description:
      'Prepara un presupuesto para contratar a un agente de Panal: comprueba que está activo, que tiene ' +
      'endpoint, su precio real y si hay saldo y presupuesto suficientes. NO gasta nada ni crea nada ' +
      'on-chain. Devuelve un quote_id que hay que pasarle luego a panal_hire. Muéstrale SIEMPRE el ' +
      'precio al usuario y espera su confirmación antes de contratar.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_address: { type: 'string', description: 'Dirección del agente a contratar (0x…).' },
        brief: {
          type: 'string',
          description: 'El encargo, redactado con todo el detalle necesario. El agente solo recibe esto.',
        },
      },
      required: ['agent_address', 'brief'],
    },
    async run(args) {
      const blocked = writesBlockedReason();
      if (blocked) return blocked;

      const brief = typeof args.brief === 'string' ? args.brief.trim() : '';
      if (brief.length < 10) return 'El brief es demasiado corto: describe el encargo con detalle (mínimo 10 caracteres).';

      let worker: Address;
      try {
        worker = getAddress(typeof args.agent_address === 'string' ? args.agent_address.trim() : '');
      } catch {
        return `"${String(args.agent_address)}" no es una dirección válida.`;
      }
      if (worker.toLowerCase() === account!.address.toLowerCase()) {
        return 'No puedes contratarte a ti mismo: el escrow rechaza las auto-tareas.';
      }

      const agent = (await publicClient.readContract({
        address: REGISTRY_ADDRESS,
        abi: registryAbi,
        functionName: 'getAgent',
        args: [worker],
      })) as Omit<OnChainAgent, 'address'>;

      if (agent.registeredAt === 0n) return `${worker} no está registrada como agente en Panal.`;
      if (!agent.active) return `El agente ${worker} está INACTIVO: no acepta encargos ahora mismo.`;

      const meta = parseMetadata(agent.metadataURI);
      if (!meta.botUrl) {
        return (
          `El agente ${meta.name || worker} no publica endpoint (\`bot:<url>\`) en su metadata on-chain.\n\n` +
          'Sin endpoint no hay dónde entregarle el brief ni de dónde recoger el resultado, así que ' +
          'contratarlo dejaría los fondos bloqueados sin nada a cambio. No se emite presupuesto.'
        );
      }
      try {
        await assertPublicUrl(`${meta.botUrl}/brief/0`);
      } catch (err) {
        return `El endpoint del agente no supera la validación de seguridad: ${err instanceof Error ? err.message : err}`;
      }

      const amount = agent.pricePerTask;
      const symbol = currencySymbol(agent.currency);
      const isNative = agent.currency.toLowerCase() === '0x0000000000000000000000000000000000000000';
      const minimum = isNative ? MIN_NATIVE_WEI : MIN_TOKEN_WEI;

      if (amount < minimum) {
        return `El precio del agente (${formatEther(amount)} ${symbol}) está por debajo del mínimo del escrow (${formatEther(minimum)} ${symbol}).`;
      }
      if (amount > MAX_PER_TASK_WEI) {
        return (
          `Bloqueado por el tope por encargo: el agente pide ${formatEther(amount)} ${symbol} y el límite ` +
          `configurado es ${formatEther(MAX_PER_TASK_WEI)}. Súbelo con MCP_MAX_PER_TASK_WEI si de verdad quieres pagarlo.`
        );
      }
      const spent = readSpentToday();
      if (spent + amount > DAILY_BUDGET_WEI) {
        return (
          `Bloqueado por el presupuesto diario: hoy llevas ${formatEther(spent)} de ${formatEther(DAILY_BUDGET_WEI)} ` +
          `y este encargo son ${formatEther(amount)} más. Se reinicia a las 00:00 UTC.`
        );
      }
      const balance = await balanceFor(agent.currency, account!.address);
      if (balance < amount) {
        return (
          `Saldo insuficiente: la wallet ${account!.address} tiene ${formatEther(balance)} ${symbol} ` +
          `y el encargo cuesta ${formatEther(amount)} ${symbol}.`
        );
      }

      pruneQuotes();
      const id = randomUUID();
      quotes.set(id, {
        id,
        worker,
        agentName: meta.name || worker,
        brief,
        amount,
        currency: agent.currency,
        symbol,
        botUrl: meta.botUrl,
        expiresAt: Date.now() + QUOTE_TTL_MS,
      });

      return [
        '### Presupuesto (todavía no se ha gastado nada)',
        `- Agente: **${meta.name || worker}** \`${worker}\``,
        `- Precio: **${formatEther(amount)} ${symbol}**`,
        `- Comisión del protocolo: 2,5 % (la cobra el escrow al liberar el pago)`,
        `- Encargo: ${brief.length} caracteres`,
        `- Plazo: ${DEADLINE_HOURS} h`,
        `- Tras el encargo quedarán ${formatEther(DAILY_BUDGET_WEI - spent - amount)} de presupuesto diario`,
        '',
        `**quote_id:** \`${id}\` (válido 5 minutos)`,
        '',
        `Confirma con el usuario el precio antes de seguir. Al llamar a \`panal_hire\` con ese quote_id se ` +
          `crea la tarea en Monad mainnet y se bloquean ${formatEther(amount)} ${symbol} REALES en el escrow.`,
      ].join('\n');
    },
  },

  {
    name: 'panal_hire',
    description:
      'Contrata de verdad: crea la tarea en el escrow de Panal (Monad mainnet), bloquea el pago y ' +
      'entrega el encargo al agente. GASTA FONDOS REALES E IRREVERSIBLEMENTE. Exige un quote_id de ' +
      'panal_quote_hire y que el usuario haya confirmado el precio.',
    inputSchema: {
      type: 'object',
      properties: {
        quote_id: { type: 'string', description: 'El quote_id devuelto por panal_quote_hire.' },
        confirmed_by_user: {
          type: 'boolean',
          description: 'true solo si le has enseñado el precio al usuario y lo ha aceptado explícitamente.',
        },
      },
      required: ['quote_id', 'confirmed_by_user'],
    },
    async run(args) {
      const blocked = writesBlockedReason();
      if (blocked) return blocked;

      if (args.confirmed_by_user !== true) {
        return 'Falta la confirmación del usuario. Enséñale el precio del presupuesto y pídele que lo apruebe antes de contratar.';
      }
      pruneQuotes();
      const quote = quotes.get(typeof args.quote_id === 'string' ? args.quote_id : '');
      if (!quote) {
        return 'Ese quote_id no existe o ha caducado (duran 5 minutos). Pide un presupuesto nuevo con panal_quote_hire.';
      }

      // Los topes se revalidan aquí: entre el presupuesto y la confirmación
      // pueden haber pasado otros encargos.
      const spent = readSpentToday();
      if (spent + quote.amount > DAILY_BUDGET_WEI) {
        quotes.delete(quote.id);
        return `El presupuesto diario se agotó mientras confirmabas (${formatEther(spent)} de ${formatEther(DAILY_BUDGET_WEI)}).`;
      }

      const isNative = quote.currency.toLowerCase() === '0x0000000000000000000000000000000000000000';
      const deadline = BigInt(Math.floor(Date.now() / 1000) + DEADLINE_HOURS * 3600);
      const taskHash = keccak256(toBytes(quote.brief));
      const steps: string[] = [];

      // $PANAL: hay que autorizar al escrow antes de que pueda cobrar.
      if (!isNative) {
        const allowance = (await publicClient.readContract({
          address: quote.currency,
          abi: erc20Abi,
          functionName: 'allowance',
          args: [account!.address, ESCROW_ADDRESS],
        })) as bigint;
        if (allowance < quote.amount) {
          const approveTx = await walletClient!.writeContract({
            address: quote.currency,
            abi: erc20Abi,
            functionName: 'approve',
            args: [ESCROW_ADDRESS, quote.amount],
            account: account!,
            chain: monad,
          });
          await publicClient.waitForTransactionReceipt({ hash: approveTx });
          steps.push(`- approve(${formatEther(quote.amount)} $PANAL): \`${approveTx}\``);
        }
      }

      // Simular antes de firmar: si la tarea fuese a revertir, se sabe sin gastar gas.
      const sim = await publicClient.simulateContract({
        address: ESCROW_ADDRESS,
        abi: escrowAbi,
        functionName: 'createTask',
        args: [quote.worker, taskHash, deadline, quote.currency, quote.amount],
        value: isNative ? quote.amount : 0n,
        account: account!,
      });
      const taskId = (sim as { result: bigint }).result;

      const txHash = await walletClient!.writeContract({
        address: ESCROW_ADDRESS,
        abi: escrowAbi,
        functionName: 'createTask',
        args: [quote.worker, taskHash, deadline, quote.currency, quote.amount],
        value: isNative ? quote.amount : 0n,
        account: account!,
        chain: monad,
      });
      await publicClient.waitForTransactionReceipt({ hash: txHash });

      // El gasto se anota en cuanto la tarea existe: aunque falle la entrega
      // del brief, el dinero ya está comprometido en el escrow.
      recordSpend(quote.amount);
      quotes.delete(quote.id);
      steps.push(`- createTask → tarea **#${taskId}**: \`${txHash}\``);

      // El brief viaja fuera de la cadena, firmado como cliente.
      let briefNote: string;
      try {
        const url = await assertPublicUrl(`${quote.botUrl}/brief/${taskId}`);
        const signature = await account!.signMessage({ message: briefSignMessage(taskId) });
        const res = await fetchJsonLimited<{ ok?: boolean }>(url, {
          timeoutMs: 15_000,
          headers: { 'content-type': 'application/json' },
          method: 'POST',
          body: JSON.stringify({ brief: quote.brief, address: account!.address, signature }),
        });
        briefNote = res.ok
          ? '- Encargo entregado al agente por su endpoint (firmado EIP-191).'
          : `- ⚠️ La tarea existe pero el endpoint del agente rechazó el encargo: ${res.error}. ` +
            'El agente trabajará con un brief genérico salvo que se le reenvíe.';
      } catch (err) {
        briefNote = `- ⚠️ La tarea existe pero no se pudo entregar el encargo: ${err instanceof Error ? err.message : err}`;
      }
      steps.push(briefNote);

      return [
        `### Contratado: tarea #${taskId}`,
        `Se han bloqueado **${formatEther(quote.amount)} ${quote.symbol}** reales en el escrow para ${quote.agentName}.`,
        '',
        ...steps,
        '',
        `- Transacción: ${EXPLORER}/tx/${txHash}`,
        `- Plazo del agente: ${new Date(Number(deadline) * 1000).toISOString()}`,
        '',
        'El agente entregará el resultado on-chain. Consulta el estado con `panal_get_task` y recoge el ' +
          'texto con `panal_get_result` cuando aparezca como Entregada. Si no apruebas antes, el pago se ' +
          'libera solo a las 72 h.',
      ].join('\n');
    },
  },

  {
    name: 'panal_get_result',
    description:
      'Recoge el resultado de una tarea ya entregada. El texto vive fuera de la cadena: se pide al ' +
      'endpoint del agente firmando como cliente, y se comprueba que su hash coincide con el anclado ' +
      'on-chain. Solo funciona para tareas contratadas por la wallet de este servidor.',
    inputSchema: {
      type: 'object',
      properties: { task_id: { type: 'number', description: 'Id de la tarea.' } },
      required: ['task_id'],
    },
    async run(args) {
      if (!account) return 'Sin wallet configurada no se puede firmar la petición del resultado.';
      const id = typeof args.task_id === 'number' ? Math.floor(args.task_id) : Number.NaN;
      if (!Number.isFinite(id) || id < 0) return 'task_id debe ser un entero mayor o igual que 0.';
      const taskId = BigInt(id);

      const t = (await publicClient.readContract({
        address: ESCROW_ADDRESS,
        abi: escrowAbi,
        functionName: 'tasks',
        args: [taskId],
      })) as { client: Address; worker: Address; resultHash: Hex; status: number };

      if (t.client.toLowerCase() !== account.address.toLowerCase()) {
        return `La tarea #${id} la contrató ${t.client}, no esta wallet. Solo el cliente puede recoger el resultado.`;
      }
      if (t.resultHash === `0x${'0'.repeat(64)}`) {
        return `La tarea #${id} aún no tiene resultado entregado (estado: ${TASK_STATUS_LABEL[t.status as TaskStatus] ?? t.status}).`;
      }

      const agent = (await publicClient.readContract({
        address: REGISTRY_ADDRESS,
        abi: registryAbi,
        functionName: 'getAgent',
        args: [t.worker],
      })) as Omit<OnChainAgent, 'address'>;
      const botUrl = parseMetadata(agent.metadataURI).botUrl;
      if (!botUrl) return `El agente ${t.worker} no publica endpoint, así que no hay de dónde descargar el texto.`;

      const url = await assertPublicUrl(`${botUrl}/result/${taskId}`);
      const signature = await account.signMessage({ message: resultSignMessage(taskId) });
      url.searchParams.set('address', account.address);
      url.searchParams.set('signature', signature);

      const res = await fetchJsonLimited<{ resultText?: string }>(url, { timeoutMs: 20_000 });
      if (!res.ok) return `El endpoint del agente no devolvió el resultado: ${res.error}`;
      const text = res.data.resultText;
      if (typeof text !== 'string' || text === '') return 'El endpoint respondió sin resultado.';

      // Sin esta comprobación, un agente podría servir un texto distinto del
      // que ancló on-chain.
      const recomputed = keccak256(toBytes(text));
      if (recomputed.toLowerCase() !== t.resultHash.toLowerCase()) {
        return (
          `⚠️ El texto recibido NO coincide con el hash anclado en la cadena.\n` +
          `Esperado ${t.resultHash}, recibido ${recomputed}. No te fíes de este resultado.`
        );
      }

      return [
        `### Resultado de la tarea #${id}`,
        `_Hash verificado contra la cadena (${recomputed.slice(0, 18)}…): el texto es exactamente el que el agente ancló._`,
        '',
        text,
      ].join('\n');
    },
  },

  {
    name: 'panal_approve_task',
    description:
      'Aprueba una tarea entregada y libera el pago al agente, con una valoración de 1 a 5 que queda ' +
      'grabada en su reputación on-chain. ES IRREVERSIBLE Y MUEVE FONDOS REALES. Pídele al usuario la ' +
      'nota y su confirmación antes de llamarla.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'number', description: 'Id de la tarea entregada.' },
        rating: { type: 'number', description: 'Valoración de 1 a 5.' },
        confirmed_by_user: { type: 'boolean', description: 'true solo si el usuario lo ha aprobado explícitamente.' },
      },
      required: ['task_id', 'rating', 'confirmed_by_user'],
    },
    async run(args) {
      const blocked = writesBlockedReason();
      if (blocked) return blocked;
      if (args.confirmed_by_user !== true) {
        return 'Falta la confirmación del usuario: aprobar libera el pago y no se puede deshacer.';
      }
      const id = typeof args.task_id === 'number' ? Math.floor(args.task_id) : Number.NaN;
      const rating = typeof args.rating === 'number' ? Math.floor(args.rating) : Number.NaN;
      if (!Number.isFinite(id) || id < 0) return 'task_id debe ser un entero mayor o igual que 0.';
      if (!Number.isFinite(rating) || rating < 1 || rating > 5) return 'La valoración debe ser un entero de 1 a 5.';
      const taskId = BigInt(id);

      const t = (await publicClient.readContract({
        address: ESCROW_ADDRESS,
        abi: escrowAbi,
        functionName: 'tasks',
        args: [taskId],
      })) as { client: Address; amount: bigint; currency: Address; status: number };

      if (t.client.toLowerCase() !== account!.address.toLowerCase()) {
        return `La tarea #${id} la contrató ${t.client}, no esta wallet: solo el cliente puede aprobar.`;
      }
      if (t.status !== TaskStatus.Delivered) {
        return `La tarea #${id} está en estado "${TASK_STATUS_LABEL[t.status as TaskStatus] ?? t.status}" y solo se puede aprobar una Entregada.`;
      }

      await publicClient.simulateContract({
        address: ESCROW_ADDRESS,
        abi: escrowAbi,
        functionName: 'approveAndRelease',
        args: [taskId, rating],
        account: account!,
      });
      const txHash = await walletClient!.writeContract({
        address: ESCROW_ADDRESS,
        abi: escrowAbi,
        functionName: 'approveAndRelease',
        args: [taskId, rating],
        account: account!,
        chain: monad,
      });
      await publicClient.waitForTransactionReceipt({ hash: txHash });

      const symbol = currencySymbol(t.currency);
      const fee = (t.amount * 250n) / 10_000n;
      return [
        `### Tarea #${id} aprobada con ${rating}/5`,
        `- Al agente: ${formatEther(t.amount - fee)} ${symbol}`,
        `- Comisión del protocolo (2,5 %): ${formatEther(fee)} ${symbol}`,
        `- La valoración queda en la reputación on-chain del agente, para siempre.`,
        `- Transacción: ${EXPLORER}/tx/${txHash}`,
      ].join('\n');
    },
  },
];

// ---------------------------------------------------------------------------
// Transporte MCP: JSON-RPC 2.0 sobre stdio, delimitado por saltos de línea.
// ---------------------------------------------------------------------------

interface RpcRequest {
  jsonrpc: '2.0';
  id?: number | string | null;
  method: string;
  params?: Record<string, unknown>;
}

function send(payload: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function reply(id: number | string | null | undefined, result: unknown): void {
  if (id === undefined || id === null) return; // notificación: no lleva respuesta
  send({ jsonrpc: '2.0', id, result });
}

function replyError(id: number | string | null | undefined, code: number, message: string): void {
  if (id === undefined || id === null) return;
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

async function handle(req: RpcRequest): Promise<void> {
  switch (req.method) {
    case 'initialize': {
      const asked = typeof req.params?.protocolVersion === 'string' ? req.params.protocolVersion : '';
      // Se responde con la versión del cliente si la conocemos; si no, la nuestra.
      const version = SUPPORTED_PROTOCOLS.includes(asked) ? asked : SUPPORTED_PROTOCOLS[0];
      reply(req.id, {
        protocolVersion: version,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
        instructions:
          'Panal es un marketplace de agentes de IA en Monad mainnet. Todos los datos que devuelven ' +
          'estas herramientas son reales y se leen en directo de la cadena; no hay simulación. ' +
          (writesBlockedReason() === null
            ? 'La contratación está HABILITADA y gasta criptomoneda real e irreversible. Antes de contratar, ' +
              'pide siempre presupuesto con panal_quote_hire, enséñale el precio al usuario y espera su ' +
              'confirmación explícita. Nunca inventes importes ni llames a panal_hire por iniciativa propia.'
            : 'Este servidor está en solo lectura: puede buscar y consultar, pero no contratar ni mover fondos.'),
      });
      return;
    }

    case 'notifications/initialized':
      return; // notificación, sin respuesta

    case 'ping':
      reply(req.id, {});
      return;

    case 'tools/list':
      reply(req.id, {
        tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
      });
      return;

    case 'tools/call': {
      const name = typeof req.params?.name === 'string' ? req.params.name : '';
      const tool = TOOLS.find((t) => t.name === name);
      if (!tool) {
        replyError(req.id, -32602, `Herramienta desconocida: "${name}"`);
        return;
      }
      const args = (req.params?.arguments ?? {}) as Record<string, unknown>;
      try {
        const text = await tool.run(args);
        reply(req.id, { content: [{ type: 'text', text }] });
      } catch (err) {
        // Un fallo de RPC o del indexador se devuelve como error de herramienta
        // (isError), no como error de protocolo: el modelo puede reintentar o
        // explicárselo al usuario sin que se caiga la sesión.
        const msg = err instanceof Error ? err.message : String(err);
        log(`herramienta ${name} falló: ${msg}`);
        reply(req.id, {
          content: [{ type: 'text', text: `No se pudo consultar Panal: ${msg}` }],
          isError: true,
        });
      }
      return;
    }

    default:
      replyError(req.id, -32601, `Método no soportado: ${req.method}`);
  }
}

function main(): void {
  log(`servidor de solo lectura sobre Monad mainnet · RPC ${RPC_URL} · índice ${INDEX_API}`);

  let buffer = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk: string) => {
    buffer += chunk;
    let nl: number;
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      let req: RpcRequest;
      try {
        req = JSON.parse(line) as RpcRequest;
      } catch {
        log(`línea ilegible descartada: ${line.slice(0, 120)}`);
        continue;
      }
      void handle(req).catch((err) => {
        log(`error interno: ${err instanceof Error ? err.message : err}`);
        replyError(req.id, -32603, 'error interno del servidor');
      });
    }
  });

  process.stdin.on('close', () => process.exit(0));
}

main();
