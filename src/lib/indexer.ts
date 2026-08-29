/**
 * Panal — Cliente del indexador HTTP público del bot (bot/src/indexer-http.ts).
 *
 * El indexador mantiene un índice append-only de TODOS los eventos on-chain
 * (PanalRegistry + PanalEscrow) y expone stats agregadas por agente y
 * globales. Es la fuente de verdad para reseñas, actividad y rankings: los
 * datos que muestra son siempre eventos reales de Monad mainnet.
 *
 * Degradación graceful: si el indexador no responde (caída, CORS, timeout,
 * rate limit), `fetchJson` devuelve null y la UI muestra estados vacíos o
 * cae a los datos on-chain directos (RPC vía publicClient). En ningún caso
 * se inventan datos.
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

/**
 * Cuántos agentes llega a traerse el mercado.
 *
 * A 861 bytes por ficha —medido, no estimado— son unos 2,5 MB. Es mucho para
 * un móvil, y es el motivo real por el que esto tiene tope: la cadena y el
 * indexador aguantan de sobra, quien no aguanta es el navegador, que se lo
 * carga entero en memoria para poder filtrar sin ir y volver.
 *
 * Cuando este número se quede corto, subirlo NO es la solución: toca buscar y
 * ordenar en el indexador, que para eso tiene el índice, y traerse solo la
 * página que se está mirando.
 */
export const TOPE_CATALOGO = 3000;

/**
 * Tamaño de página.
 *
 * Importa por el limitador del indexador: 60 peticiones por minuto y por IP,
 * así que cada carga del mercado gasta `TOPE_CATALOGO / PAGINA` de ese
 * presupuesto. Con 3.000 agentes, 500 son seis peticiones y 200 son quince.
 *
 * Se empieza pidiendo 500 y se cae a 200 si el indexador de turno aún no lo
 * acepta —responde 400—. Así esto funciona contra el que está desplegado hoy y
 * mejora solo en cuanto se actualice, sin tener que sincronizar los dos
 * despliegues en el mismo minuto.
 */
const PAGINA_MAX = 500;
const PAGINA_SEGURA = 200;
let PAGINA = PAGINA_MAX;

export const INDEXER_URL: string = import.meta.env.VITE_INDEXER_URL ?? 'https://api.panal.lat';

/* ---------- Tipos (réplica exacta de bot/src/indexer-store.ts) ---------- */

/** Evento indexado (args serializados: bigint -> string decimal). */
export interface IndexedEvent {
  /** `${txHash}-${logIndex}` — clave de dedup. */
  id: string;
  contract: 'registry' | 'escrow';
  event: string;
  blockNumber: number;
  logIndex: number;
  txHash: string;
  /** Timestamp del bloque (segundos epoch). */
  ts: number;
  args: Record<string, string | number | boolean>;
}

/** Stats agregadas por agente. */
export interface AgentStats {
  /** address del agente en lowercase. */
  address: string;
  /** Tareas asignadas (TaskCreated con worker = agente). */
  tasks: number;
  /** Tareas completadas (TaskCompleted). */
  completed: number;
  /** Rating medio (TaskCompleted + DisputeResolved). null si no tiene. */
  avgRating: number | null;
  ratingCount: number;
  /** Volumen cobrado por moneda, en wei (string): 'MON' | '$PANAL'. */
  volume: Record<string, string>;
  firstSeenTs: number;
  lastSeenTs: number;
}

export interface DayStats {
  /** YYYY-MM-DD (UTC). */
  date: string;
  events: number;
  /** MON movido ese día (wei, string). */
  monMoved: string;
  /** $PANAL movido ese día (wei, string). */
  panalMoved: string;
  activeAgents: number;
}

export interface IndexStats {
  updatedAt: string;
  lastBlock: number;
  totalEvents: number;
  byType: Record<string, number>;
  totals: { events: number; agents: number; tasks: number; completed: number };
  daily30: DayStats[];
  daily7: DayStats[];
}

interface EventsResponse {
  events: IndexedEvent[];
  count: number;
  next: string | null;
}

interface AgentsResponse {
  agents: AgentStats[];
  count: number;
}

/* ---------- fetch con timeout; null ante cualquier fallo ---------- */

async function fetchJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${INDEXER_URL}${path}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/**
 * Los ids de las tareas en las que participa una dirección, como cliente o
 * como trabajador. `null` si el indexador no responde — quien llama decide
 * qué hacer con eso, y en el panel se cae al escaneo de la cadena.
 *
 * Se piden solo los ids: los datos se leen del escrow, porque los eventos no
 * traen `deadline`, `taskHash` ni `deliveredAt`.
 */
export async function fetchTaskIdsOf(address: string, cabezaCadena?: bigint): Promise<bigint[] | null> {
  const res = await fetchJson<{ tasks: { taskId: string }[]; lastBlock?: number }>(
    `/index/tasks?address=${encodeURIComponent(address)}&limit=1000`,
  );
  if (!res?.tasks) return null;

  // Un indexador VIVO PERO ATRASADO es peor que uno caído: devuelve una lista
  // incompleta y quien pregunta se la cree. Pasa mientras hace el backfill
  // inicial, o si estuvo parado. Se comprueba por dónde va antes de fiarse.
  //
  // Con bloques de 0,30 s y sondeo cada 15 s, el retraso normal son ~50
  // bloques. 2000 son diez minutos: eso ya no es retraso, es que no está al día.
  if (cabezaCadena !== undefined && typeof res.lastBlock === 'number') {
    if (cabezaCadena - BigInt(res.lastBlock) > 2000n) return null;
  }
  const ids: bigint[] = [];
  for (const t of res.tasks) {
    // El indexador es un servicio, o sea que su respuesta se valida igual que
    // la de cualquier desconocido: un id que no sea un entero se descarta en
    // vez de reventar el panel entero con un BigInt() que lanza.
    if (/^\d+$/.test(t.taskId)) ids.push(BigInt(t.taskId));
  }
  return ids;
}

/** La ficha de un agente en el catálogo del indexador. */
export interface CatalogAgent {
  address: string;
  owner: string;
  name: string;
  description: string;
  skills: string[];
  botUrl: string | null;
  /**
   * La ficha en crudo, tal y como está en el registro.
   *
   * Opcional porque un indexador anterior a la marca no la manda, y el mercado
   * tiene que seguir funcionando contra el que esté desplegado: sin ella, el
   * agente sale sin logo, con todo lo demás en su sitio.
   */
  metadataURI?: string;
  /**
   * Su descripción en cada idioma del marketplace, por código ISO.
   *
   * La traduce el propio agente y el indexador la guarda. Opcional porque un
   * indexador anterior a esto no la manda y un agente que no sabe traducirse
   * no la tiene: en los dos casos se enseña su texto original, que es lo que
   * se enseñaba antes.
   */
  idiomas?: Record<string, string>;
  /** En unidades mínimas. String porque no cabe en un number. */
  pricePerTask: string;
  currency: string;
  coin: string;
  active: boolean;
  registeredAt: number;
  stats: AgentStats | null;

  /**
   * Si su dominio declara esta misma dirección en `/agent.json`.
   *
   * El nombre lo escribe el propio agente y no es único: cualquiera puede
   * registrarse como "Lint". El dominio sí es de alguien, y su tarjeta declara
   * la dirección, así que el indexador va a buscarla y la compara.
   * `undefined` mientras no se haya mirado.
   */
  verificado?: boolean;
  /** Por qué no está verificado. */
  verificadoMotivo?: string;

  /** Su nombre en PanalNames, si lo tiene y el contrato está desplegado. */
  nombre?: NombreDeAgente | null;
}

/**
 * El nombre de un agente en PanalNames, y cómo llegó a tenerlo.
 *
 * El «cómo» importa tanto como el nombre. Los nombres se venden, y lo único que
 * viaja con ellos es el nombre: la reputación, el historial y la verificación
 * del dominio se quedan en la dirección. Quien compra `lint` hereda el nombre y
 * ninguna de las tareas que lo hicieron valer.
 */
export interface NombreDeAgente {
  nombre: string;
  /** Cuándo pasó a ser de esta dirección (segundos epoch). */
  desdeTs: number;
  /**
   * Cómo llegó a tenerlo, si se sabe.
   *
   * OPCIONAL porque sale de los eventos del contrato, y eso solo lo tiene el
   * indexador. Leyendo la cadena directamente están `nombreDe()` y `fichaDe()`,
   * que dicen cuál es el nombre y desde cuándo es suyo, pero no cómo llegó a
   * serlo. Sin dato es `undefined`, y hay que tratarlo como «no lo sé», nunca
   * como «reclamado»: dar por bueno el origen limpio es justo lo que la
   * advertencia existe para evitar.
   */
  origen?: 'reclamado' | 'comprado' | 'recibido';
  /** Lo pagado, en unidades mínimas. Solo si se compró. */
  precio?: string;
}

/**
 * El catálogo completo, paginando hasta un tope.
 *
 * Sustituye al `getAgents(0, 50)` de la cadena, que tenía dos problemas: el
 * agente 51 en adelante NO EXISTÍA para el mercado —ni en el listado, ni en el
 * buscador, ni en las categorías, y sin ningún aviso—, y leerlos costaba dos
 * llamadas RPC por agente, o sea 100 en cada carga de página.
 *
 * Se traen TODOS y se sigue filtrando en el navegador, que es lo que hace que
 * el mercado responda al instante al escribir. Con mil agentes son cinco
 * peticiones y unos 400 KB; el día que sean diez mil, el filtrado tendrá que
 * mudarse al indexador y esta función pasará a pedir una página.
 *
 * Devuelve null —no una lista vacía— si el indexador no responde o va
 * atrasado: quien llama tiene que poder distinguir «no hay agentes» de «no lo
 * sé», porque en el segundo caso toca leer la cadena.
 */
export async function fetchCatalogo(cabezaCadena?: bigint, tope = TOPE_CATALOGO): Promise<CatalogAgent[] | null> {
  const pagina = await unaPagina(0);
  if (!pagina) return null;

  // Solo en la primera página: si el indexador va atrasado, no vale ninguna.
  if (cabezaCadena !== undefined && typeof pagina.lastBlock === 'number') {
    if (cabezaCadena - BigInt(pagina.lastBlock) > 2000n) return null;
  }

  const total = Math.min(pagina.total, tope);
  if (pagina.agents.length >= total || !pagina.hasMore) return pagina.agents.slice(0, tope);

  // EN PARALELO, no una detrás de otra. `total` viene en la primera página, así
  // que se sabe cuántas faltan sin ir descubriéndolas: con 3.000 agentes eso es
  // la diferencia entre un viaje y catorce viajes seguidos.
  const cuantas = Math.ceil(total / PAGINA) - 1;
  const restantes = await Promise.all(
    Array.from({ length: cuantas }, (_, i) => unaPagina(i + 1)),
  );

  const out = [...pagina.agents];
  for (const r of restantes) {
    // Una página que falla invalida el catálogo entero: servir 1.800 agentes de
    // 3.000 sin decirlo es peor que caer al respaldo, porque el que falta no
    // parece ausente, parece que no existe.
    if (!r) return null;
    out.push(...r.agents);
  }
  return out.slice(0, tope);
}

interface PaginaCatalogo {
  agents: CatalogAgent[];
  total: number;
  hasMore: boolean;
  lastBlock?: number;
}

/**
 * Una página del catálogo, validada.
 *
 * `total` solo lo devuelve la respuesta del catálogo: un indexador viejo ignora
 * `page` y `limit` y responde su lista de stats de siempre, que no trae ni
 * nombre ni skills. Sin esa marca, el mercado se llenaría de agentes sin nombre.
 */
async function unaPagina(page: number): Promise<PaginaCatalogo | null> {
  const res = await pideJson(page);
  if (!res) return null;
  if (!Array.isArray(res.agents)) return null;
  if (typeof res.total !== 'number') return null;
  return {
    agents: res.agents,
    total: res.total,
    hasMore: res.hasMore === true,
    lastBlock: typeof res.lastBlock === 'number' ? res.lastBlock : undefined,
  };
}

interface RespuestaCatalogo {
  agents?: CatalogAgent[];
  total?: unknown;
  hasMore?: boolean;
  lastBlock?: number;
}

/**
 * Pide una página, bajando el tamaño si el indexador no acepta el grande.
 *
 * SOLO en la página 0. Si el tamaño cambiara a mitad de las peticiones
 * paralelas, «página 3» pasaría a señalar un tramo distinto del catálogo y
 * saldrían agentes repetidos y otros ausentes, sin ningún error de por medio.
 * A partir de la primera, un fallo es un fallo.
 */
async function pideJson(page: number): Promise<RespuestaCatalogo | null> {
  const res = await fetchJson<RespuestaCatalogo>(`/index/agents?page=${page}&limit=${PAGINA}`);
  if (res || page !== 0 || PAGINA === PAGINA_SEGURA) return res;

  // Se recuerda para el resto de la sesión: reintentar en cada página costaría
  // el doble de peticiones contra un limitador que las cuenta.
  PAGINA = PAGINA_SEGURA;
  return fetchJson<RespuestaCatalogo>(`/index/agents?page=0&limit=${PAGINA}`);
}


/* ---------- Hooks react-query ---------- */

/** Stats globales del índice (refresh 30 s). null si el indexador no responde. */
export function useIndexStats() {
  const query = useQuery({
    queryKey: ['indexer', 'stats'],
    queryFn: () => fetchJson<IndexStats>('/index/stats'),
    refetchInterval: 30_000,
    staleTime: 15_000,
    retry: 1,
  });
  return { stats: query.data ?? null, loading: query.isLoading };
}

/**
 * Agentes con stats agregadas (refresh 60 s). Devuelve la lista y un mapa
 * por address lowercase para cruzar con los agentes del registry on-chain.
 */
/**
 * Las estadísticas de cada agente, por dirección.
 *
 * Va por el catálogo PAGINADO. La ruta sin parámetros devuelve el mercado
 * entero de una vez, y con mil agentes eso son cientos de kilobytes en cada
 * carga de página, para tres componentes que solo miran unos pocos.
 *
 * Si el indexador es viejo y no entiende la paginación, se pide como antes:
 * peor, pero no deja a la web sin estadísticas.
 */
export function useIndexAgents() {
  const query = useQuery({
    queryKey: ['indexer', 'agents'],
    queryFn: async (): Promise<AgentsResponse | null> => {
      const catalogo = await fetchCatalogo();
      if (catalogo !== null) {
        return { agents: catalogo.map((f) => f.stats).filter((x): x is AgentStats => x !== null), count: catalogo.length };
      }
      return fetchJson<AgentsResponse>('/index/agents');
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
    retry: 1,
  });
  const agents = useMemo(() => query.data?.agents ?? [], [query.data]);
  const byAddress = useMemo(() => {
    const map = new Map<string, AgentStats>();
    for (const a of agents) map.set(a.address.toLowerCase(), a);
    return map;
  }, [agents]);
  return { agents, byAddress, loading: query.isLoading };
}

/**
 * Eventos del indexador que involucran a un agente (args.worker / args.agent
 * / args.to === address). Refresh 30 s; desactivado sin address.
 */
export function useIndexAgentEvents(address: string | undefined, limit = 200) {
  const query = useQuery({
    queryKey: ['indexer', 'events', address?.toLowerCase(), limit],
    queryFn: async () => {
      const addr = address?.toLowerCase();
      if (!addr) return [] as IndexedEvent[];
      const res = await fetchJson<EventsResponse>(`/index/events?limit=${limit}`);
      if (!res) return [] as IndexedEvent[];
      return res.events.filter((ev) => {
        const a = ev.args;
        return (
          String(a['worker'] ?? '').toLowerCase() === addr ||
          String(a['agent'] ?? '').toLowerCase() === addr ||
          String(a['to'] ?? '').toLowerCase() === addr
        );
      });
    },
    enabled: !!address,
    refetchInterval: 30_000,
    staleTime: 15_000,
    retry: 1,
  });
  return { events: query.data ?? [], loading: query.isLoading && !!address };
}
