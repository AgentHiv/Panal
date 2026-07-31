/**
 * Panal Bot — servidor HTTP mínimo (node:http, sin frameworks) para la
 * entrega PRIVADA y VERIFICABLE de resultados al cliente.
 *
 * Hoy deliverResult ancla on-chain solo `resultHash = keccak256(texto)`; el
 * contenido queda en `<STORE_DIR>/results/<taskId>.md`. Este servidor expone
 * ese contenido, pero SOLO al cliente de la tarea, que demuestra su identidad
 * firmando (EIP-191, gratis, sin gas) el mensaje:
 *
 *     Panal resultado #<taskId>
 *
 * Ruta única:
 *   GET /result/:taskId?address=0x…&signature=0x…
 *     1. Lee `tasks(taskId)` del escrow v2 (con el retry/backoff de chain.ts).
 *     2. Recupera el firmante con verifyMessage() de viem; si no coincide con
 *        task.client → 403 {"error":"not client"}.
 *     3. Devuelve 200 {taskId, resultText, resultHash} con resultHash
 *        RECOMPUTADO como keccak256(toBytes(resultText)) para que el cliente
 *        lo compare con el anclado on-chain.
 *   Cualquier otra ruta → 404 genérico {"error":"not found"}.
 *
 * Protecciones:
 *   - CORS restringido a https://panal.lat (y http://localhost:* fuera de
 *     producción, para desarrollo).
 *   - Rate limit por IP: 30 peticiones/minuto → 429.
 *
 * El servidor arranca junto al worker cuando BOT_HTTP_PORT > 0 (ver index.ts).
 * Para pruebas, `createResultServer` acepta un `fetchTask` inyectable
 * (bot/scripts/test-http.ts lo usa con una tarea simulada).
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import {
  getAddress,
  isAddress,
  isHex,
  keccak256,
  toBytes,
  verifyMessage,
  type Hex,
} from 'viem';
import type { BotConfig } from './config.js';
import { getTask, type ChainClients, type Task } from './chain.js';
import type { Store } from './store.js';

/** Mensaje exacto que firma el cliente (debe coincidir con el frontend). */
export function resultSignMessage(taskId: bigint): string {
  return `Panal resultado #${taskId.toString()}`;
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
// Helpers de respuesta.
// ---------------------------------------------------------------------------

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(payload);
}

// ---------------------------------------------------------------------------
// Servidor.
// ---------------------------------------------------------------------------

export interface ResultServerDeps {
  store: Store;
  /** Lectura de la task on-chain (inyectable en tests). */
  fetchTask: (taskId: bigint) => Promise<Task>;
  /** Permitir orígenes http://localhost:* (desarrollo). */
  allowLocalhostOrigin: boolean;
  /** Límite de tamaño de URL aceptado (defensa ante URLs gigantes). */
  maxUrlLength?: number;
}

export function createResultServer(deps: ResultServerDeps): Server {
  const maxUrlLength = deps.maxUrlLength ?? 2_048;

  const handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    // ---- CORS (incluye preflight OPTIONS) ----------------------------------
    const origin = allowedOrigin(req.headers.origin, deps.allowLocalhostOrigin);
    if (origin) {
      res.setHeader('access-control-allow-origin', origin);
      res.setHeader('vary', 'origin');
    }
    if (req.method === 'OPTIONS') {
      res.setHeader('access-control-allow-methods', 'GET, OPTIONS');
      res.setHeader('access-control-allow-headers', 'content-type');
      res.setHeader('access-control-max-age', '600');
      res.writeHead(204);
      res.end();
      return;
    }

    // ---- Rate limit por IP ---------------------------------------------------
    const ip = req.socket.remoteAddress ?? 'unknown';
    if (!rateLimitOk(ip)) {
      json(res, 429, { error: 'rate limited' });
      return;
    }

    // ---- Ruta única: GET /result/:taskId -------------------------------------
    const rawUrl = req.url ?? '/';
    if (rawUrl.length > maxUrlLength) {
      json(res, 414, { error: 'uri too long' });
      return;
    }
    const url = new URL(rawUrl, 'http://localhost');
    const match = /^\/result\/(\d{1,20})$/.exec(url.pathname);
    if (!match || req.method !== 'GET') {
      json(res, 404, { error: 'not found' });
      return;
    }

    const taskId = BigInt(match[1]!);
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

    // ---- Lee la task on-chain (con retry/backoff vía fetchTask) --------------
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

    // ---- Verifica la firma EIP-191 contra el cliente de la task --------------
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

    // ---- Sirve el resultado + hash recomputado -------------------------------
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
  const server = createResultServer({
    store,
    fetchTask: (taskId) => getTask(clients, cfg, taskId),
    // En producción (NODE_ENV=production) solo panal.lat; en dev también localhost.
    allowLocalhostOrigin: cfg.dryRun || process.env.NODE_ENV !== 'production',
  });
  server.listen(cfg.httpPort, () => {
    console.log(`   Endpoint de resultados: http://localhost:${cfg.httpPort}/result/:taskId`);
    if (cfg.httpPublicUrl) {
      console.log(`   URL pública (metadata del agente → "bot:${cfg.httpPublicUrl}")`);
    } else {
      console.log('   ⚠ BOT_HTTP_PUBLIC_URL vacío: publica "bot:<url>" en el metadata de tu agente');
    }
  });
  return server;
}
