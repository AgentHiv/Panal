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
 *   El tablón con reglas (PanalTablon). Rutas y campos en inglés, como el
 *   resto de la API pública; por dentro el índice habla en español, y se
 *   traduce aquí al responder (ver `enIngles`):
 *   GET /index/board/jobs?state=&category=&client=&agent=&limit=
 *       Los encargos, del más nuevo al más viejo. `state`: posted | assigned |
 *       closed | withdrawn | expired.
 *   GET /index/board/job?id=<jobId>
 *       Un encargo, con sus ofertas en pie, su tarea del escrow y su campaña.
 *   GET /index/board/agent?address=
 *       Un agente: categorías, faltas, suspensión y encargos.
 *   GET /index/board/client?address=
 *       Un cliente: lo que el tablón le debe por moneda y sus encargos.
 *   GET /index/board/config
 *       Topes por moneda, pausa, niveles y encargos de novato vigentes.
 *   GET /index/board/campaigns?owner=   ·   GET /index/board/campaign?key=
 *       Las campañas, con su tope por agente y lo que ha cogido cada uno.
 *   GET /index/board/metrics?from=<ts>&to=<ts>
 *       Las cifras de un periodo, para la foto del mes.
 *   GET /index/board/monitoring
 *       Las señales de contracts/TABLON-SECURITY.md.
 *
 * Protecciones (mismo patrón que http.ts):
 *   - CORS restringido a https://panal.lat (y http://localhost:* fuera de
 *     producción, para desarrollo).
 *   - Rate limit por IP: 60 peticiones/minuto -> 429.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { allowedOrigin, clientIp, crearLimitador, escuchar } from './net.js';
import type { BotConfig } from './config.js';
import type {
  AgenteEnElTablon,
  CampanaIndexada,
  IndexStore,
  MetricasTablon,
  Vigilancia,
} from './indexer-store.js';

/*
 * El índice guarda en español, como el resto del código; la API pública
 * responde en inglés, como sus otras rutas. Esto traduce en el borde.
 */
const enIngles = {
  agente: (a: AgenteEnElTablon) => ({
    agent: a.agent,
    categories: a.categorias,
    strikes: a.faltas,
    strikesIn90Days: a.faltasEn90Dias,
    suspendedUntil: a.suspendidoHasta,
    lastStrikeTs: a.ultimaFaltaTs ?? null,
    assigned: a.asignados,
    closed: a.cerrados,
    penalized: a.sancionados,
  }),
  campana: (c: CampanaIndexada) => ({
    key: c.key,
    campaignId: c.campaignId,
    owner: c.owner,
    jobs: c.jobs,
    cap: c.cap,
    taken: c.tomados,
  }),
  metricas: (m: MetricasTablon) => ({
    from: m.desde,
    to: m.hasta,
    volume: {
      posted: m.volumen.publicados,
      assigned: m.volumen.asignados,
      withdrawn: m.volumen.retirados,
      expired: m.volumen.caducados,
      relisted: m.volumen.republicados,
      postedByCoin: m.volumen.publicadoPorMoneda,
    },
    speed: { immediate: m.rapidez.inmediato, selection: m.rapidez.seleccion },
    competition: {
      medianOffers: m.competencia.medianaOfertas,
      noOfferShare: m.competencia.sinOfertaParte,
      medianPriceToBudget: m.competencia.medianaPrecioSobrePresupuesto,
    },
    choice: {
      byClient: m.eleccion.porElCliente,
      automatic: m.eleccion.automatica,
      notCheapest: m.eleccion.noLaMasBarata,
    },
    delivery: {
      completed: m.entrega.completados,
      cancelled: m.entrega.cancelados,
      disputes: m.entrega.disputas,
      refundedByCoin: m.entrega.devueltoPorMoneda,
    },
    penalties: {
      strikes: m.sanciones.faltas,
      suspensions7d: m.sanciones.suspensiones7,
      suspensions30d: m.sanciones.suspensiones30,
      agents: m.sanciones.agentes,
    },
    agents: m.agentes,
    byCategory: m.porCategoria.map((c) => ({
      category: c.categoria,
      jobs: c.encargos,
      noOffer: c.sinOferta,
      medianByCoin: c.medianaPorMoneda,
    })),
  }),
  vigilancia: (v: Vigilancia) => ({
    mismatchedSplits: v.repartosDistintos.map((r) => ({
      jobId: r.jobId,
      escrowTaskId: r.escrowTaskId,
      attestedRefund: r.atestado,
      escrowRefund: r.escrow,
    })),
    longDisputes: v.disputasLargas.map((d) => ({ taskId: d.taskId, jobId: d.jobId ?? null, openedTs: d.abiertaTs, days: d.dias })),
    concentratedAgents: v.parejas.map((p) => ({
      agent: p.agente,
      completed: p.completadas,
      clients: p.clientes,
      topClient: p.principal,
      share: p.parte,
    })),
    crossHiring: v.cruzados.map((c) => ({ a: c.a, b: c.b, aForB: c.aParaB, bForA: c.bParaA })),
    generatedTs: v.generado,
  }),
};

// ---------------------------------------------------------------------------
// Rate limit por IP: ventana deslizante de 1 minuto, 60 peticiones máximo.
// ---------------------------------------------------------------------------

const RATE_LIMIT_MAX = 60;
const RATE_LIMIT_WINDOW_MS = 60_000;

const limitador = crearLimitador(RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS);
const rateLimitOk = limitador.permite;

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
  /** Cuánto se reutiliza una página del catálogo ya montada. 0 la apaga. */
  catalogoCacheMs?: number;
}

/**
 * Las páginas del catálogo que pide la web se reutilizan unos segundos.
 *
 * Es lo que más se pide y lo que más pesa: 500 fichas son unos 430 KB que montar
 * por petición. Con 338 IP dentro de su límite de 60/min serían 338 por segundo,
 * más de lo que puede un solo hilo cuando el catálogo crezca. Solo sin `q` ni
 * `skill`, y con pocas entradas: unos segundos de retraso aquí no se notan.
 */
const CATALOGO_CACHE_MS = 5_000;
const CATALOGO_CACHE_MAX = 64;

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
/**
 * Tope de página del catálogo.
 *
 * 500 fichas son unos 430 KB, que se montan en memoria y se sirven de una. Se
 * subió de 200 porque con miles de agentes el mercado tenía que pedir quince
 * páginas por carga, y el limitador son 60 peticiones por minuto y por IP: a
 * cuatro cargas se quedaba sin presupuesto.
 */
const AGENTS_MAX_LIMIT = 500;

export function createIndexServer(deps: IndexServerDeps): Server {
  const maxUrlLength = deps.maxUrlLength ?? 2_048;
  const { store } = deps;
  const catalogoCacheMs = deps.catalogoCacheMs ?? CATALOGO_CACHE_MS;
  const catalogoCache = new Map<string, { hasta: number; cuerpo: string }>();

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

        const includeInactive = url.searchParams.get('include_inactive') === 'true';
        const clave = !q && !skill && catalogoCacheMs > 0 ? `${page}:${limit}:${includeInactive}` : null;
        const guardada = clave ? catalogoCache.get(clave) : undefined;
        if (guardada && guardada.hasta > Date.now()) {
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
          res.end(guardada.cuerpo);
          return;
        }

        const { agents, total } = store.catalogo({
          q,
          skill,
          includeInactive,
          offset: page * limit,
          limit,
        });
        const cuerpo = JSON.stringify({
          agents,
          count: agents.length,
          total,
          page,
          limit,
          hasMore: page * limit + agents.length < total,
          lastBlock: store.lastBlock,
        });
        if (clave) {
          // `page` lo elige quien llama: sin tope, cada número sería una entrada más.
          if (catalogoCache.size >= CATALOGO_CACHE_MAX) catalogoCache.clear();
          catalogoCache.set(clave, { hasta: Date.now() + catalogoCacheMs, cuerpo });
        }
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
        res.end(cuerpo);
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

      // ---- El tablón con reglas (PanalTablon) ------------------------------
      //
      // La web y la app leen de aquí la lista, y la cadena solo para el
      // encargo que se abre: leer los 200 últimos encargos del contrato, uno a
      // uno, en cada carga sería lo que ya pasó con el catálogo.
      case '/index/board/jobs': {
        const estados = ['posted', 'assigned', 'closed', 'withdrawn', 'expired'] as const;
        const stateRaw = url.searchParams.get('state');
        if (stateRaw !== null && !(estados as readonly string[]).includes(stateRaw)) {
          json(res, 400, { error: `bad state (${estados.join(' | ')})` });
          return;
        }
        const catRaw = url.searchParams.get('category');
        const category = catRaw === null ? undefined : Number(catRaw);
        if (category !== undefined && (!Number.isInteger(category) || category < 0 || category > 255)) {
          json(res, 400, { error: 'bad category (0..255)' });
          return;
        }
        const quien = { client: url.searchParams.get('client'), agent: url.searchParams.get('agent') };
        for (const [k, v] of Object.entries(quien)) {
          if (v !== null && !/^0x[0-9a-fA-F]{40}$/.test(v)) {
            json(res, 400, { error: `bad ${k} (0x + 40 hex)` });
            return;
          }
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
        const jobs = store.jobs({
          state: (stateRaw ?? undefined) as (typeof estados)[number] | undefined,
          category,
          client: quien.client ?? undefined,
          agent: quien.agent ?? undefined,
          limit,
        });
        json(res, 200, { jobs, count: jobs.length, lastBlock: store.lastBlock });
        return;
      }

      case '/index/board/job': {
        const id = url.searchParams.get('id');
        if (!id || !/^\d{1,20}$/.test(id)) {
          json(res, 400, { error: 'id required' });
          return;
        }
        const job = store.job(id);
        if (!job) {
          json(res, 404, { error: 'no such job' });
          return;
        }
        json(res, 200, {
          job,
          offers: store.ofertasDe(id),
          task: job.escrowTaskId ? store.task(job.escrowTaskId) : null,
          campaign: (() => {
            const c = job.campaignKey ? store.campana(job.campaignKey) : null;
            return c ? enIngles.campana(c) : null;
          })(),
          lastBlock: store.lastBlock,
        });
        return;
      }

      case '/index/board/agent':
      case '/index/board/client': {
        const address = url.searchParams.get('address');
        if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
          json(res, 400, { error: 'address required (0x + 40 hex)' });
          return;
        }
        if (url.pathname === '/index/board/agent') {
          json(res, 200, {
            ...enIngles.agente(store.agenteEnElTablon(address)),
            jobs: store.jobs({ agent: address, limit: TASKS_DEFAULT_LIMIT }),
            lastBlock: store.lastBlock,
          });
        } else {
          json(res, 200, {
            client: address.toLowerCase(),
            owed: store.porCobrarDe(address),
            jobs: store.jobs({ client: address, limit: TASKS_DEFAULT_LIMIT }),
            lastBlock: store.lastBlock,
          });
        }
        return;
      }

      case '/index/board/config': {
        json(res, 200, { ...store.configTablon(), lastBlock: store.lastBlock });
        return;
      }

      case '/index/board/campaigns': {
        const owner = url.searchParams.get('owner');
        if (owner !== null && !/^0x[0-9a-fA-F]{40}$/.test(owner)) {
          json(res, 400, { error: 'bad owner (0x + 40 hex)' });
          return;
        }
        const campaigns = store.campanas(owner ?? undefined).map(enIngles.campana);
        json(res, 200, { campaigns, count: campaigns.length, lastBlock: store.lastBlock });
        return;
      }

      case '/index/board/campaign': {
        const key = url.searchParams.get('key');
        if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) {
          json(res, 400, { error: 'key required (0x + 64 hex)' });
          return;
        }
        const c = store.campana(key);
        if (!c) {
          json(res, 404, { error: 'no such campaign' });
          return;
        }
        json(res, 200, { ...enIngles.campana(c), lastBlock: store.lastBlock });
        return;
      }

      case '/index/board/metrics': {
        const from = Number(url.searchParams.get('from'));
        const to = Number(url.searchParams.get('to'));
        if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to <= from) {
          json(res, 400, { error: 'from and to required (unix seconds, from < to)' });
          return;
        }
        json(res, 200, { ...enIngles.metricas(store.metricasTablon(from, to)), lastBlock: store.lastBlock });
        return;
      }

      case '/index/board/monitoring': {
        json(res, 200, { ...enIngles.vigilancia(store.vigilancia()), lastBlock: store.lastBlock });
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
  escuchar(server, cfg.indexHttpPort, cfg.bindHost, () => {
    console.log(`   API del índice: http://localhost:${cfg.indexHttpPort}/index/events|agents|stats|tasks|board/…`);
  });
  return server;
}
