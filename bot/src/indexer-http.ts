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
import { allowedOrigin, clientIp } from './net.js';
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

// (allowedOrigin vive en net.ts: lo comparten este servidor y el del índice)

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
/**
 * Cuantas tareas se devuelven de una direccion. Generoso a proposito: el panel
 * las quiere TODAS para poder contar las activas y las cerradas, y quien tiene
 * mil tareas es justo a quien no se le puede pedir que pagine para ver si le
 * falta aprobar algo.
 */
const TASKS_DEFAULT_LIMIT = 200;
const TASKS_MAX_LIMIT = 1000;

/**
 * Pagina del catalogo. 50 por defecto porque es lo que cabe en una pantalla
 * sin hacer scroll infinito; el tope de 200 acota lo que un cliente puede
 * pedir de una vez.
 */
const AGENTS_DEFAULT_LIMIT = 50;
const AGENTS_MAX_LIMIT = 200;

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
    // Detrás de Caddy la IP del socket es siempre loopback; sin esto el tope
    // de 60/min era global para toda la API pública. Ver net.ts.
    const ip = clientIp(req);
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

      // ---- Las tareas de una direccion -------------------------------------
      //
      // Existe porque el panel las buscaba escaneando las 200 ultimas tareas
      // del escrow y filtrando en el navegador. Con 200 en total funcionaba;
      // pasadas esas, un cliente que contrato ayer deja de ver la suya y no
      // puede aprobarla, disputarla ni descargar su resultado — y a las 72 h
      // el pago se libera solo sin que se haya enterado.
      case '/index/tasks': {
        const address = url.searchParams.get('address');
        if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
          json(res, 400, { error: 'address required (0x + 40 hex)' });
          return;
        }
        const roleRaw = url.searchParams.get('role');
        if (roleRaw !== null && roleRaw !== 'client' && roleRaw !== 'worker') {
          json(res, 400, { error: "bad role (client | worker)" });
          return;
        }
        const limitRaw = url.searchParams.get('limit');
        let limit = TASKS_DEFAULT_LIMIT;
        if (limitRaw !== null) {
          const n = Number.parseInt(limitRaw, 10);
          if (!Number.isFinite(n) || n < 1 || n > TASKS_MAX_LIMIT) {
            json(res, 400, { error: `bad limit (1..${TASKS_MAX_LIMIT})` });
            return;
          }
          limit = n;
        }
        const tasks = store.tasksOf(address, { role: roleRaw ?? undefined, limit });
        // `lastBlock` viaja con la respuesta a proposito: un indexador vivo
        // pero atrasado es peor que uno caido, porque quien pregunta se fia de
        // una lista incompleta. Con esto puede decidir por si mismo, y sin
        // pagar otra peticion.
        json(res, 200, { tasks, count: tasks.length, address: address.toLowerCase(), lastBlock: store.lastBlock });
        return;
      }

      // ---- El catalogo -------------------------------------------------------
      //
      // La web leia el registro con getAgents(0, 50) y dos llamadas mas por
      // agente: 100 llamadas RPC por carga de pagina, y el agente 51 en
      // adelante no existia para nadie — ni en el listado, ni en el buscador,
      // ni en las categorias. Sin error y sin aviso.
      //
      // `skill` esta separado de `q` a proposito: es lo que pregunta un AGENTE
      // cuando quiere delegar, y ahi encontrar a alguien porque la palabra
      // aparece en su descripcion no sirve.
      //
      // SIN parametros devuelve las stats de siempre, con la misma forma: hay
      // clientes publicados leyendo esto y romperlos no arregla nada.
      case '/index/agents': {
        const q = url.searchParams.get('q')?.trim() || undefined;
        const skill = url.searchParams.get('skill')?.trim() || undefined;
        const pagina = url.searchParams.has('page') || url.searchParams.has('limit');

        if (!q && !skill && !pagina) {
          const agents = store.agentStats();
          json(res, 200, { agents, count: agents.length });
          return;
        }

        for (const [nombre, valor] of [['q', q], ['skill', skill]] as const) {
          if (valor !== undefined && valor.length > 100) {
            json(res, 400, { error: `${nombre} too long` });
            return;
          }
        }

        let limit = AGENTS_DEFAULT_LIMIT;
        const limitRaw = url.searchParams.get('limit');
        if (limitRaw !== null) {
          const n = Number.parseInt(limitRaw, 10);
          if (!Number.isFinite(n) || n < 1 || n > AGENTS_MAX_LIMIT) {
            json(res, 400, { error: `bad limit (1..${AGENTS_MAX_LIMIT})` });
            return;
          }
          limit = n;
        }
        let page = 0;
        const pageRaw = url.searchParams.get('page');
        if (pageRaw !== null) {
          const n = Number.parseInt(pageRaw, 10);
          if (!Number.isFinite(n) || n < 0) {
            json(res, 400, { error: 'bad page (>= 0)' });
            return;
          }
          page = n;
        }

        const { agents, total } = store.catalogo({
          q,
          skill,
          includeInactive: url.searchParams.get('include_inactive') === 'true',
          offset: page * limit,
          limit,
        });
        json(res, 200, {
          agents,
          count: agents.length,
          total,
          page,
          limit,
          hasMore: page * limit + agents.length < total,
          lastBlock: store.lastBlock,
        });
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
