/**
 * Panal Bot — servidor HTTP mínimo (node:http, sin frameworks) para la
 * operación 100% headless del agente: recepción de briefs máquina-a-máquina
 * y entrega PRIVADA y VERIFICABLE de resultados al cliente.
 *
 * On-chain solo viaja `taskHash = keccak256(brief)` y, al entregar,
 * `resultHash = keccak256(texto)`; los contenidos viven en el store local.
 * El CLIENTE de la tarea demuestra su identidad firmando (EIP-191, gratis,
 * sin gas) un mensaje que incluye el taskId (anti-replay entre tareas):
 *
 *     Panal brief #<taskId>       (POST /brief)
 *     Panal resultado #<taskId>   (GET /result)
 *
 * Rutas:
 *   POST /brief/:taskId   body {"brief","address","signature"}
 *     1. Valida el body (brief no vacío, máx. 4000 chars; 400 si no).
 *     2. Lee `tasks(taskId)` del escrow v2 (con el retry/backoff de chain.ts).
 *     3. verifyMessage() de viem contra task.client → 403 {"error":"not client"}.
 *     4. Rechaza tareas cerradas (Completed/Cancelled) → 409 {"error":"task closed"}.
 *     5. Guarda el brief con store.setBrief() (lo lee el worker) → 200 {"ok":true}.
 *   GET /result/:taskId?address=0x…&signature=0x…
 *     1. Lee `tasks(taskId)` del escrow v2 (con el retry/backoff de chain.ts).
 *     2. Recupera el firmante con verifyMessage() de viem; si no coincide con
 *        task.client → 403 {"error":"not client"}.
 *     3. Devuelve 200 {taskId, resultText, resultHash} con resultHash
 *        RECOMPUTADO como keccak256(toBytes(resultText)) para que el cliente
 *        lo compare con el anclado on-chain.
 *   GET /agent.json
 *     Descriptor público máquina-legible del agente (identidad, contratos,
 *     skills/precio leídos del registry, endpoints y pasos para contratarlo).
 *   Cualquier otra ruta → 404 genérico {"error":"not found"}.
 *
 * Protecciones:
 *   - CORS restringido a https://panal.lat (y http://localhost:* fuera de
 *     producción, para desarrollo).
 *   - Rate limit por IP: 30 peticiones/minuto → 429.
 *   - Body de POST limitado a 16 KiB.
 *
 * El servidor arranca junto al worker cuando BOT_HTTP_PORT > 0 (ver index.ts).
 * Para pruebas, `createResultServer` acepta `fetchTask` y `fetchAgentJson`
 * inyectables (bot/scripts/test-http.ts los usa con datos simulados).
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { clientIp } from './net.js';
import { generateResult } from './llm.js';
import {
  buildQuote,
  parsePaymentHeader,
  permitNonce,
  readPermitDomain,
  SCHEME,
  verifyAndSettle,
  type PermitDomain,
  type SettleResult,
  type X402Payment,
} from './x402.js';
import {
  getAddress,
  isAddress,
  isHex,
  keccak256,
  toBytes,
  verifyMessage,
  type Address,
  type Hex,
} from 'viem';
import type { BotConfig } from './config.js';
import {
  currencySymbol,
  getRegistryAgent,
  getTask,
  monad,
  TaskStatus,
  type ChainClients,
  type RegistryAgent,
  type Task,
} from './chain.js';
import type { Store } from './store.js';

/** Mensaje exacto que firma el cliente (debe coincidir con el frontend). */
export function resultSignMessage(taskId: bigint): string {
  return `Panal resultado #${taskId.toString()}`;
}

/**
 * Mensaje que firma el cliente para entregar el brief (POST /brief).
 * Análogo al de /result; incluye el taskId para evitar replay entre tareas.
 * Debe coincidir con briefSignMessage() de src/lib/botEndpoint.ts (frontend).
 */
export function briefSignMessage(taskId: bigint): string {
  return `Panal brief #${taskId.toString()}`;
}

// ---------------------------------------------------------------------------
// Rate limit por IP: ventana deslizante de 1 minuto, 30 peticiones máximo.
// ---------------------------------------------------------------------------

const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_WINDOW_MS = 60_000;

const hitsByIp = new Map<string, number[]>();

function rateLimitOk(ip: string): boolean {
  const now = Date.now();
  const hits = (hitsByIp.get(ip) ?? []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (hits.length >= RATE_LIMIT_MAX) {
    hitsByIp.set(ip, hits);
    return false;
  }
  hits.push(now);
  hitsByIp.set(ip, hits);
  return true;
}

// ---------------------------------------------------------------------------
// CORS: solo el dashboard oficial (y localhost en desarrollo).
// ---------------------------------------------------------------------------

const PROD_ORIGIN = 'https://panal.lat';
const LOCALHOST_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i;

function allowedOrigin(origin: string | undefined, allowLocalhost: boolean): string | null {
  if (!origin) return null;
  if (origin === PROD_ORIGIN) return origin;
  if (allowLocalhost && LOCALHOST_ORIGIN.test(origin)) return origin;
  return null;
}

// ---------------------------------------------------------------------------
// Descriptor del agente (GET /agent.json): identidad, contratos, skills y
// precio (leídos del registry on-chain) y pasos para contratarlo M2M.
// ---------------------------------------------------------------------------

/** Límite del brief aceptado por POST /brief (chars). */
export const MAX_BRIEF_CHARS = 4_000;
/** Límite del body HTTP de POST /brief (bytes). */
const MAX_BODY_BYTES = 16_384;

export interface AgentJson {
  name: string;
  description: string;
  agentAddress: Address;
  chainId: number;
  contracts: { escrow: Address; registry: Address; token: Address };
  skills: string[];
  price: { amountWei: string; currency: Address; symbol: string } | null;
  active: boolean | null;
  endpoints: {
    /** URL pública base del bot (BOT_HTTP_PUBLIC_URL), null si no se publicó. */
    base: string | null;
    postBrief: { method: 'POST'; path: '/brief/:taskId'; signMessage: string; body: string };
    getResult: { method: 'GET'; path: '/result/:taskId?address&signature'; signMessage: string };
    /** API pública del indexador Panal (agentes, tareas y eventos). */
    indexer: string;
  };
  howToHire: string[];
}

/** Parsea el metadataURI "Nombre · descripción · skill1, skill2 · bot:<url>". */
function parseMetadataURI(uri: string): { name?: string; description?: string; skills: string[] } {
  const parts = uri
    .split('·')
    .map((p) => p.trim())
    .filter((p) => p && !p.toLowerCase().startsWith('bot:'));
  return {
    name: parts[0],
    description: parts[1],
    skills: parts[2] ? parts[2].split(',').map((s) => s.trim()).filter(Boolean).slice(0, 8) : [],
  };
}

/**
 * Construye el descriptor de GET /agent.json. Lee el registry on-chain (nombre,
 * skills, precio, active); si el RPC falla, sirve el descriptor con lo
 * estático de la config (mejor degradado que un 502).
 */
export async function buildAgentJson(cfg: BotConfig, clients: ChainClients): Promise<AgentJson> {
  let agent: RegistryAgent | null = null;
  try {
    agent = await getRegistryAgent(clients, cfg, cfg.agentAddress);
  } catch (err) {
    console.warn(
      `[http] agent.json: no se pudo leer el registry: ${err instanceof Error ? err.message.split('\n')[0] : err}`,
    );
  }
  const meta = parseMetadataURI(agent?.metadataURI ?? '');
  const base = cfg.httpPublicUrl?.replace(/\/+$/, '') ?? null;
  const basePath = base ?? '<BOT_URL>';
  return {
    name: meta.name ?? `Agente Panal ${cfg.agentAddress}`,
    description: meta.description ?? 'Agente autónomo del marketplace Panal (Monad).',
    agentAddress: cfg.agentAddress,
    chainId: monad.id,
    contracts: {
      escrow: cfg.escrowAddress,
      registry: cfg.registryAddress,
      token: cfg.panalTokenAddress,
    },
    skills: meta.skills,
    price: agent
      ? {
          amountWei: agent.pricePerTask.toString(),
          currency: agent.currency,
          symbol: currencySymbol(agent.currency, cfg),
        }
      : null,
    active: agent ? agent.active : null,
    endpoints: {
      base,
      postBrief: {
        method: 'POST',
        path: '/brief/:taskId',
        signMessage: 'Panal brief #<taskId>  (EIP-191, firmado por el cliente de la tarea)',
        body: '{"brief": string (máx. 4000 chars), "address": "0x…", "signature": "0x…"}',
      },
      getResult: {
        method: 'GET',
        path: '/result/:taskId?address&signature',
        signMessage: 'Panal resultado #<taskId>  (EIP-191, firmado por el cliente de la tarea)',
      },
      indexer: cfg.indexerPublicUrl,
    },
    howToHire: [
      `1. Lee este agente en el registry (${cfg.registryAddress}): getAgent(${cfg.agentAddress}) → pricePerTask y currency.`,
      `2. Crea la tarea en el escrow (${cfg.escrowAddress}, chainId ${monad.id}): createTask(worker=${cfg.agentAddress}, taskHash=keccak256(brief), deadline, currency, amount). MON nativo: msg.value=amount. $PANAL: approve(escrow, amount) previo y msg.value=0. El evento TaskCreated devuelve el taskId.`,
      `3. Firma EIP-191 "Panal brief #<taskId>" con la wallet cliente y haz POST ${basePath}/brief/<taskId> con {"brief","address","signature"} (sin firma también vale reenviar el brief al operador, pero el agente headless lo necesita aquí).`,
      '4. Espera la entrega: poll tasks(taskId) hasta status=1 (Delivered).',
      `5. Descarga el resultado: firma "Panal resultado #<taskId>" y GET ${basePath}/result/<taskId>?address&signature. Verifica keccak256(resultText) contra el resultHash on-chain.`,
      '6. Libera el pago: approveAndRelease(taskId, rating 1-5). Si no actúas, el auto-release lo hace a las 72 h de la entrega.',
    ],
  };
}

// ---------------------------------------------------------------------------
// Helpers de respuesta.
// ---------------------------------------------------------------------------

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(payload);
}

/** Lee el body crudo de un POST (null si supera maxBytes o hay error). */
function readBody(req: IncomingMessage, maxBytes: number): Promise<string | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        resolve(null);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', () => resolve(null));
  });
}

// ---------------------------------------------------------------------------
// Servidor.
// ---------------------------------------------------------------------------

export interface ResultServerDeps {
  store: Store;
  /** Lectura de la task on-chain (inyectable en tests). */
  fetchTask: (taskId: bigint) => Promise<Task>;
  /** Descriptor de GET /agent.json (inyectable en tests; si falta → 404). */
  fetchAgentJson?: () => Promise<AgentJson>;
  /** Permitir orígenes http://localhost:* (desarrollo). */
  allowLocalhostOrigin: boolean;
  /** Límite de tamaño de URL aceptado (defensa ante URLs gigantes). */
  maxUrlLength?: number;
  /**
   * Cobro por llamada (x402). Si falta, `/x402/ask` responde 404 y el agente
   * sigue funcionando solo con encargos por escrow.
   */
  x402?: X402Endpoint;
}

/** Todo lo que necesita la ruta de pago por llamada. */
export interface X402Endpoint {
  priceWei: bigint;
  token: Address;
  tokenSymbol: string;
  /** Quién cobra: la wallet del agente, que también es el spender del permit. */
  payee: Address;
  /** Dominio EIP-712 del token. Perezoso: se lee de la cadena y se cachea. */
  getDomain: () => Promise<PermitDomain>;
  maxPromptChars: number;
  /** Nonce de permit del pagador, para incluirlo en el presupuesto. */
  nonceOf: (payer: Address) => Promise<bigint>;
  /** Verifica la firma y cobra on-chain. Sirve solo si sale bien. */
  settle: (payment: X402Payment, price: bigint) => Promise<SettleResult>;
  /** Genera la respuesta que se vende. */
  answer: (prompt: string) => Promise<string>;
}

export function createResultServer(deps: ResultServerDeps): Server {
  const maxUrlLength = deps.maxUrlLength ?? 2_048;

  // ---- GET /result/:taskId?address&signature --------------------------------
  const handleGetResult = async (taskId: bigint, url: URL, res: ServerResponse): Promise<void> => {
    const addressParam = url.searchParams.get('address') ?? '';
    const signatureParam = url.searchParams.get('signature') ?? '';
    if (!isAddress(addressParam)) {
      json(res, 400, { error: 'bad address' });
      return;
    }
    if (!isHex(signatureParam)) {
      json(res, 400, { error: 'bad signature' });
      return;
    }
    const address = getAddress(addressParam);
    const signature = signatureParam as Hex;

    // Lee la task on-chain (con retry/backoff vía fetchTask)
    let task: Task;
    try {
      task = await deps.fetchTask(taskId);
    } catch (err) {
      console.warn(
        `[http] no se pudo leer tasks(${taskId}): ${err instanceof Error ? err.message.split('\n')[0] : err}`,
      );
      json(res, 502, { error: 'rpc error' });
      return;
    }

    // Verifica la firma EIP-191 contra el cliente de la task
    let signerOk = false;
    try {
      signerOk = await verifyMessage({
        address,
        message: resultSignMessage(taskId),
        signature,
      });
    } catch {
      signerOk = false;
    }
    if (!signerOk || address.toLowerCase() !== task.client.toLowerCase()) {
      json(res, 403, { error: 'not client' });
      return;
    }

    // Sirve el resultado + hash recomputado
    const resultText = deps.store.getResult(taskId);
    if (resultText === null) {
      json(res, 404, { error: 'not found' });
      return;
    }
    json(res, 200, {
      taskId: taskId.toString(),
      resultText,
      resultHash: keccak256(toBytes(resultText)),
    });
  };

  // ---- POST /brief/:taskId  {"brief","address","signature"} -----------------
  const handlePostBrief = async (taskId: bigint, req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const raw = await readBody(req, MAX_BODY_BYTES);
    if (raw === null) {
      json(res, 413, { error: 'body too large' });
      return;
    }
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      json(res, 400, { error: 'bad json' });
      return;
    }
    const { brief, address: addressParam, signature: signatureParam } = (body ?? {}) as Record<string, unknown>;
    if (typeof brief !== 'string' || brief.trim().length === 0 || brief.length > MAX_BRIEF_CHARS) {
      json(res, 400, { error: `bad brief (string no vacío, máx. ${MAX_BRIEF_CHARS} chars)` });
      return;
    }
    if (typeof addressParam !== 'string' || !isAddress(addressParam)) {
      json(res, 400, { error: 'bad address' });
      return;
    }
    if (typeof signatureParam !== 'string' || !isHex(signatureParam)) {
      json(res, 400, { error: 'bad signature' });
      return;
    }
    const address = getAddress(addressParam);
    const signature = signatureParam as Hex;

    // Lee la task on-chain (con retry/backoff vía fetchTask)
    let task: Task;
    try {
      task = await deps.fetchTask(taskId);
    } catch (err) {
      console.warn(
        `[http] no se pudo leer tasks(${taskId}): ${err instanceof Error ? err.message.split('\n')[0] : err}`,
      );
      json(res, 502, { error: 'rpc error' });
      return;
    }

    // Verifica la firma EIP-191 contra el cliente de la task
    let signerOk = false;
    try {
      signerOk = await verifyMessage({
        address,
        message: briefSignMessage(taskId),
        signature,
      });
    } catch {
      signerOk = false;
    }
    if (!signerOk || address.toLowerCase() !== task.client.toLowerCase()) {
      json(res, 403, { error: 'not client' });
      return;
    }

    // Solo tareas vivas: Completed/Cancelled ya no aceptan brief.
    if (task.status === TaskStatus.Completed || task.status === TaskStatus.Cancelled) {
      json(res, 409, { error: 'task closed' });
      return;
    }

    deps.store.setBrief(taskId, brief);
    console.log(`[http] brief recibido para la tarea #${taskId} (${brief.length} chars, cliente ${address})`);
    json(res, 200, { ok: true });
  };

  // ---- POST /x402/ask  {"prompt"} -------------------------------------------
  //
  // Sin cabecera X-Payment se responde 402 con el presupuesto; con ella se
  // cobra y se sirve en la misma llamada. Se COBRA ANTES DE RESPONDER: al
  // revés, un cobro fallido habría regalado el trabajo.
  const handleX402Ask = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const x = deps.x402;
    if (!x) {
      json(res, 404, { error: 'este agente no cobra por llamada (x402 deshabilitado)' });
      return;
    }

    const raw = await readBody(req, MAX_BODY_BYTES);
    if (raw === null) {
      json(res, 413, { error: 'body too large' });
      return;
    }
    let prompt = '';
    try {
      const body = JSON.parse(raw || '{}') as { prompt?: unknown };
      if (typeof body.prompt === 'string') prompt = body.prompt.trim();
    } catch {
      json(res, 400, { error: 'bad json' });
      return;
    }
    if (prompt.length === 0 || prompt.length > x.maxPromptChars) {
      json(res, 400, { error: `prompt requerido, máx. ${x.maxPromptChars} caracteres` });
      return;
    }

    const header = req.headers['x-payment'];
    const paymentHeader = Array.isArray(header) ? header[0] : header;

    if (!paymentHeader) {
      // 402 con el presupuesto. Si el cliente se identifica con X-Payment-Payer
      // se le devuelve además su nonce, para que no tenga que leerlo él.
      const payerHeader = req.headers['x-payment-payer'];
      const payerRaw = Array.isArray(payerHeader) ? payerHeader[0] : payerHeader;
      let payerNonce: bigint | undefined;
      if (typeof payerRaw === 'string' && isAddress(payerRaw)) {
        payerNonce = await x.nonceOf(getAddress(payerRaw)).catch(() => undefined);
      }
      const domain = await x.getDomain();
      const quote = buildQuote({
        asset: x.token,
        assetSymbol: x.tokenSymbol,
        amount: x.priceWei,
        payTo: x.payee,
        resource: '/x402/ask',
        description: 'Una consulta al agente, respondida al momento.',
        domain,
        payerNonce,
      });
      res.writeHead(402, {
        'content-type': 'application/json; charset=utf-8',
        // Cabecera estándar de HTTP para que un cliente genérico sepa qué hacer.
        'www-authenticate': `${SCHEME} realm="panal", chain="${domain.chainId}"`,
      });
      res.end(JSON.stringify(quote));
      return;
    }

    const parsed = parsePaymentHeader(paymentHeader);
    if (!parsed.ok) {
      json(res, 402, { error: parsed.error });
      return;
    }

    const settled = await x.settle(parsed.payment, x.priceWei);
    if (!settled.ok) {
      json(res, settled.status, { error: settled.error });
      return;
    }

    let answer: string;
    try {
      answer = await x.answer(prompt);
    } catch (err) {
      // El cobro ya está hecho: es dinero del cliente, así que el fallo se
      // reporta con el hash para que pueda reclamar con prueba en la mano.
      console.error(`[x402] cobrado ${settled.txHash} pero la respuesta falló: ${err instanceof Error ? err.message : err}`);
      json(res, 502, {
        error: 'el pago se cobró pero la respuesta falló',
        paymentTx: settled.txHash,
      });
      return;
    }

    console.log(`[x402] ${parsed.payment.payer} pagó ${settled.amount} por /x402/ask · tx ${settled.txHash}`);
    res.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'x-payment-response': Buffer.from(
        JSON.stringify({ settled: true, txHash: settled.txHash, amount: settled.amount.toString() }),
      ).toString('base64'),
    });
    res.end(JSON.stringify({ answer, payment: { txHash: settled.txHash, amount: settled.amount.toString() } }));
  };

  // ---- GET /agent.json -------------------------------------------------------
  const handleAgentJson = async (res: ServerResponse): Promise<void> => {
    if (!deps.fetchAgentJson) {
      json(res, 404, { error: 'not found' });
      return;
    }
    try {
      json(res, 200, await deps.fetchAgentJson());
    } catch (err) {
      console.warn(`[http] agent.json falló: ${err instanceof Error ? err.message.split('\n')[0] : err}`);
      json(res, 502, { error: 'rpc error' });
    }
  };

  const handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    // ---- CORS (incluye preflight OPTIONS) ----------------------------------
    const origin = allowedOrigin(req.headers.origin, deps.allowLocalhostOrigin);
    if (origin) {
      res.setHeader('access-control-allow-origin', origin);
      res.setHeader('vary', 'origin');
    }
    if (req.method === 'OPTIONS') {
      res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
      res.setHeader('access-control-allow-headers', 'content-type');
      res.setHeader('access-control-max-age', '600');
      res.writeHead(204);
      res.end();
      return;
    }

    // ---- Rate limit por IP ---------------------------------------------------
    // clientIp() y no req.socket.remoteAddress: detrás de Caddy todas las
    // peticiones entran por loopback, así que la IP del socket es siempre
    // 127.0.0.1 y el tope "por IP" se comportaba como un tope GLOBAL —un solo
    // cliente agotaba la cuota de todos. Ver net.ts para por qué solo se hace
    // caso a X-Forwarded-For cuando la conexión viene de loopback.
    const ip = clientIp(req);
    if (!rateLimitOk(ip)) {
      json(res, 429, { error: 'rate limited' });
      return;
    }

    // ---- Enrutado ------------------------------------------------------------
    const rawUrl = req.url ?? '/';
    if (rawUrl.length > maxUrlLength) {
      json(res, 414, { error: 'uri too long' });
      return;
    }
    const url = new URL(rawUrl, 'http://localhost');
    const resultMatch = /^\/result\/(\d{1,20})$/.exec(url.pathname);
    const briefMatch = /^\/brief\/(\d{1,20})$/.exec(url.pathname);

    if (resultMatch && req.method === 'GET') {
      await handleGetResult(BigInt(resultMatch[1]!), url, res);
      return;
    }
    if (briefMatch && req.method === 'POST') {
      await handlePostBrief(BigInt(briefMatch[1]!), req, res);
      return;
    }
    if (url.pathname === '/agent.json' && req.method === 'GET') {
      await handleAgentJson(res);
      return;
    }
    if (url.pathname === '/x402/ask' && req.method === 'POST') {
      await handleX402Ask(req, res);
      return;
    }
    json(res, 404, { error: 'not found' });
  };

  return createServer((req, res) => {
    handler(req, res).catch((err) => {
      console.error(`[http] error interno: ${err instanceof Error ? err.message : err}`);
      if (!res.headersSent) json(res, 500, { error: 'internal error' });
      else res.end();
    });
  });
}

/**
 * Arranca el servidor de resultados junto al worker. Lee las tasks del escrow
 * v2 configurado (con el retry/backoff de chain.ts). Devuelve el Server para
 * poder cerrarlo en el apagado.
 */
export function startResultServer(cfg: BotConfig, clients: ChainClients, store: Store): Server {
  // x402 solo tiene sentido con wallet: sin ella no se puede ejecutar el cobro,
  // y servir sin cobrar sería regalar el trabajo.
  let x402: X402Endpoint | undefined;
  if (cfg.x402.enabled && clients.walletClient && clients.botAddress) {
    let domainCache: Promise<PermitDomain> | undefined;
    x402 = {
      priceWei: cfg.x402.priceWei,
      token: cfg.panalTokenAddress,
      tokenSymbol: '$PANAL',
      payee: clients.botAddress,
      maxPromptChars: cfg.x402.maxPromptChars,
      getDomain: () => (domainCache ??= readPermitDomain(clients, cfg.panalTokenAddress)),
      nonceOf: (payer) => permitNonce(clients, cfg.panalTokenAddress, payer),
      settle: async (payment, price) =>
        verifyAndSettle(
          {
            clients,
            cfg,
            token: cfg.panalTokenAddress,
            domain: await (domainCache ??= readPermitDomain(clients, cfg.panalTokenAddress)),
            payee: clients.botAddress!,
          },
          payment,
          price,
        ),
      answer: (prompt) => generateResult(cfg, prompt),
    };
  } else if (cfg.x402.enabled) {
    console.warn('   ⚠ X402_ENABLED pero sin wallet del bot: el cobro por llamada queda deshabilitado.');
  }

  const server = createResultServer({
    store,
    x402,
    fetchTask: (taskId) => getTask(clients, cfg, taskId),
    fetchAgentJson: () => buildAgentJson(cfg, clients),
    // En producción (NODE_ENV=production) solo panal.lat; en dev también localhost.
    allowLocalhostOrigin: cfg.dryRun || process.env.NODE_ENV !== 'production',
  });
  server.listen(cfg.httpPort, () => {
    console.log(`   Endpoint HTTP: http://localhost:${cfg.httpPort}  (POST /brief/:taskId · GET /result/:taskId · GET /agent.json)`);
    if (cfg.httpPublicUrl) {
      console.log(`   URL pública (metadata del agente → "bot:${cfg.httpPublicUrl}")`);
    } else {
      console.log('   ⚠ BOT_HTTP_PUBLIC_URL vacío: publica "bot:<url>" en el metadata de tu agente');
    }
  });
  return server;
}
