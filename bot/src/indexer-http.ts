/**
 * Panal Bot (modo indexer) — API HTTP PÚBLICA del índice de eventos.
 *
 * Servidor node:http propio (puerto INDEX_HTTP_PORT, default 8788), separado
 * del servidor de resultados del worker (http.ts) para no tocar su ruta
 * `/result/:id` ni su CORS/rate-limit.
 *
 * Rutas (todas GET, respuestas JSON):
 *   GET /index/events?limit=50&before=<cursor>
 *       Eventos desc por tiempo. `limit` 1..200 (default 50). `before` es el
 *       cursor opaco `next` devuelto por la llamada anterior
 *       ("<ts>:<blockNumber>:<logIndex>"); también acepta un ts epoch en
 *       segundos (exclusivo). Respuesta: { events, count, next }.
 *   GET /index/agents
 *       Agentes con stats agregadas: { agents: [{ address, tasks, completed,
 *       avgRating, ratingCount, volume: { MON, $PANAL } (wei, string),
 *       firstSeenTs, lastSeenTs }] }.
 *   GET /index/stats
 *       Contadores globales + series diarias: { lastBlock, totalEvents,
 *       byType, totals: { agents, tasks, completed }, daily30, daily7 }.
 *
 * Protecciones (mismo patrón que http.ts):
 *   - CORS restringido a https://panal.lat (y http://localhost:* fuera de
 *     producción, para desarrollo).
 *   - Rate limit por IP: 60 peticiones/minuto -> 429.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { BotConfig } from './config.js';
import type { IndexStore } from './indexer-store.js';

// ---------------------------------------------------------------------------
// Rate limit por IP: ventana deslizante de 1 minuto, 60 peticiones máximo.
// ---------------------------------------------------------------------------

const RATE_LIMIT_MAX = 60;
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
// Helpers.
// ---------------------------------------------------------------------------

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(payload);
}

// ---------------------------------------------------------------------------
// Servidor.
// ---------------------------------------------------------------------------

export interface IndexServerDeps {
  store: IndexStore;
  /** Permitir orígenes http://localhost:* (desarrollo). */
  allowLocalhostOrigin: boolean;
  /** Límite de tamaño de URL aceptado (defensa ante URLs gigantes). */
  maxUrlLength?: number;
}

const EVENTS_DEFAULT_LIMIT = 50;
const EVENTS_MAX_LIMIT = 200;

export function createIndexServer(deps: IndexServerDeps): Server {
  const maxUrlLength = deps.maxUrlLength ?? 2_048;
  const { store } = deps;

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

    // ---- Routing ---------------------------------------------------------------
    const rawUrl = req.url ?? '/';
    if (rawUrl.length > maxUrlLength) {
      json(res, 414, { error: 'uri too long' });
      return;
    }
    const url = new URL(rawUrl, 'http://localhost');
    if (req.method !== 'GET') {
      json(res, 404, { error: 'not found' });
      return;
    }

    switch (url.pathname) {
      case '/index/events': {
        const limitRaw = url.searchParams.get('limit');
        let limit = EVENTS_DEFAULT_LIMIT;
        if (limitRaw !== null) {
          const n = Number.parseInt(limitRaw, 10);
          if (!Number.isFinite(n) || n < 1 || n > EVENTS_MAX_LIMIT) {
            json(res, 400, { error: `bad limit (1..${EVENTS_MAX_LIMIT})` });
            return;
          }
          limit = n;
        }
        const before = url.searchParams.get('before') ?? undefined;
        const { events, next } = store.queryEvents(limit, before);
        json(res, 200, { events, count: events.length, next });
        return;
      }

      case '/index/agents': {
        json(res, 200, { agents: store.agentStats(), count: store.agentStats().length });
        return;
      }

      case '/index/stats': {
        const agents = store.agentStats();
        const totals = {
          events: store.totalEvents,
          agents: agents.length,
          tasks: agents.reduce((acc, a) => acc + a.tasks, 0),
          completed: agents.reduce((acc, a) => acc + a.completed, 0),
        };
        const daily30 = store.dailyStats(30);
        json(res, 200, {
          updatedAt: new Date().toISOString(),
          lastBlock: store.lastBlock,
          totalEvents: store.totalEvents,
          byType: store.byType,
          totals,
          daily30,
          daily7: daily30.slice(-7),
        });
        return;
      }

      default:
        json(res, 404, { error: 'not found' });
        return;
    }
  };

  return createServer((req, res) => {
    handler(req, res).catch((err) => {
      console.error(`[index-http] error interno: ${err instanceof Error ? err.message : err}`);
      if (!res.headersSent) json(res, 500, { error: 'internal error' });
      else res.end();
    });
  });
}

/**
 * Arranca la API pública del indexador. Devuelve el Server para poder
 * cerrarlo en el apagado.
 */
export function startIndexServer(cfg: BotConfig, store: IndexStore): Server {
  const server = createIndexServer({
    store,
    // En producción (NODE_ENV=production) solo panal.lat; en dev también localhost.
    allowLocalhostOrigin: cfg.dryRun || process.env.NODE_ENV !== 'production',
  });
  server.listen(cfg.indexHttpPort, () => {
    console.log(`   API del índice: http://localhost:${cfg.indexHttpPort}/index/events|agents|stats`);
  });
  return server;
}
