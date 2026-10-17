/**
 * Panal Bot (modo indexer) — persistencia del índice de eventos on-chain.
 *
 * Dos archivos dentro de INDEX_DIR (default ./data/index):
 *
 *   - events.jsonl: log APPEND-ONLY, un evento JSON por línea. Es la fuente
 *     de verdad: al arrancar se relee entero para reconstruir memoria, dedup
 *     y stats. (La rotación diaria es opcional y NO está activada: con el
 *     volumen actual de Panal un solo archivo sobra; ver README.)
 *   - state.json: snapshot pequeño (lastBlock, progreso del barrido,
 *     contadores) con escritura ATÓMICA (tmp + rename), mismo patrón que
 *     store.ts del bot.
 *
 * Dedup por `${txHash}-${logIndex}` (un log puede solaparse entre el
 * bootstrap, el barrido y el poll incremental).
 *
 * Stats agregadas (en memoria, reconstruidas al cargar y actualizadas al
 * añadir): por agente (tareas, volumen por moneda, completadas, rating
 * medio) y globales (eventos/día, MON y PANAL movidos/día, agentes activos).
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { encodeAbiParameters, keccak256, type Hex } from 'viem';
import { leerMarca } from './marca.js';

/** Evento indexado (args serializados: bigint -> string decimal). */
export interface IndexedEvent {
  /** `${txHash}-${logIndex}` — clave de dedup. */
  id: string;
  contract: 'registry' | 'escrow' | 'names' | 'tablon';
  event: string;
  blockNumber: number;
  logIndex: number;
  txHash: string;
  /** Timestamp del bloque (segundos epoch). */
  ts: number;
  args: Record<string, string | number | boolean>;
}

/** Snapshot persistido en state.json. */
export interface IndexerState {
  /** Último bloque cubierto por el poll incremental / bootstrap. */
  lastBlock: number;
  /** Bloque más bajo ya cubierto por el barrido hacia atrás (null = no empezado). */
  sweepFloor: number | null;
  /** Día (YYYY-MM-DD UTC) al que corresponde el presupuesto de barrido. */
  sweepDay: string;
  /** Ventanas de barrido consumidas hoy. */
  sweepWindowsUsed: number;
  totalEvents: number;
  byType: Record<string, number>;
  updatedAt: number;
  /**
   * Hasta qué bloque se recorrió PanalTablon desde su despliegue. Hace falta
   * aparte del barrido: si su dirección se pone con el índice ya hecho, lo que
   * pasó entre el despliegue y ese momento no lo cubre nadie más.
   */
  tablonHasta: number | null;
  /** Las señales de vigilancia ya avisadas: no se repiten al reiniciar. */
  vigilanciaAvisada: string[];
}

const EMPTY_STATE: IndexerState = {
  tablonHasta: null,
  vigilanciaAvisada: [],
  lastBlock: 0,
  sweepFloor: null,
  sweepDay: '',
  sweepWindowsUsed: 0,
  totalEvents: 0,
  byType: {},
  updatedAt: 0,
};

// ---------------------------------------------------------------------------
// Stats agregadas.
// ---------------------------------------------------------------------------

export interface AgentStats {
  address: string;
  /** Tareas asignadas (TaskCreated con worker = agente). */
  tasks: number;
  /** Tareas completadas (TaskCompleted). */
  completed: number;
  /** Rating medio (TaskCompleted + DisputeResolved). null si no tiene. */
  avgRating: number | null;
  ratingCount: number;
  /**
   * Entregas (el primer TaskDelivered de cada tarea) y lo que tardó de media,
   * en segundos, desde que la tarea es suya: su creación o, si estaba abierta
   * a cualquiera, desde que la reclamó. Es lo que la ficha enseña como
   * «responde en»: medido en la cadena, no declarado por nadie.
   */
  delivered: number;
  avgDeliverySec: number | null;
  /** Tareas suyas en las que alguien abrió una disputa (TaskDisputed). */
  disputes: number;
  /** Tareas suyas canceladas sin entregar: el plazo pasó y el cliente recuperó el dinero. */
  notDelivered: number;
  /** Volumen cobrado por moneda, en wei (string): 'MON' | '$PANAL'. */
  volume: Record<string, string>;
  firstSeenTs: number;
  lastSeenTs: number;
}

/**
 * Una tarea del escrow, montada juntando sus eventos.
 *
 * Existe para que un cliente pueda encontrar SUS tareas sin escanear la
 * cadena. El dashboard lo hacía leyendo las 200 últimas del escrow y
 * filtrando en el navegador: con 200 tareas en total funcionaba, y a partir
 * de ahí un cliente que contrató ayer deja de ver la suya. No puede
 * aprobarla, ni disputarla, ni descargar su resultado — y a las 72 h el pago
 * se libera solo sin que se haya enterado.
 *
 * La tarea NO es un evento: es lo que queda después de aplicarle todos los
 * suyos por orden. Por eso se agrega aquí y no se sirve el log en crudo.
 */
export interface IndexedTask {
  taskId: string;
  /** Ambas en minúsculas: se usan como clave de búsqueda. */
  client: string;
  worker: string;
  /** Bloqueado en el escrow, en unidades mínimas. */
  amount: string;
  currency: string;
  /** Etiqueta legible de la moneda: 'MON' | '$PANAL'. */
  coin: string;
  status: 'open' | 'delivered' | 'completed' | 'disputed' | 'cancelled';
  resultHash?: string;
  /** Nota que puso el cliente al aprobar, si llegó a aprobarse. */
  rating?: number;
  createdTs: number;
  updatedTs: number;
  /** Cuándo la reclamó su trabajador, si nació abierta a cualquiera. */
  claimedTs?: number;
  /**
   * Si la tarea es de un encargo de PanalTablon: en el escrow su cliente es el
   * contrato, y el de verdad es este. Es el que la tiene que encontrar en «mis
   * tareas» para aprobarla o disputarla.
   */
  realClient?: string;
  jobId?: string;
  /** Cuándo se abrió la disputa, si la hay. */
  disputedTs?: number;
  /** Lo que el árbitro devolvió al cliente, si se resolvió una disputa. */
  clientRefunded?: string;
}

/** Un encargo de PanalTablon, montado con sus eventos (contracts/BOARD.md). */
export interface IndexedJob {
  jobId: string;
  /** El cliente de verdad, en minúsculas. */
  client: string;
  category: number;
  currency: string;
  coin: string;
  mode: 'immediate' | 'selection';
  /** El presupuesto con que se publicó. */
  budget: string;
  /** El presupuesto mientras está publicado; el precio, una vez asignado. */
  amount: string;
  campaignId: string | null;
  state: 'posted' | 'assigned' | 'closed' | 'withdrawn' | 'expired';
  /** Cuántas ofertas tiene en pie (selección). */
  offers: number;
  agent?: string;
  escrowTaskId?: string;
  /** Si lo eligió su cliente; si no, `take` o `autoAssign`. */
  byClient?: boolean;
  refund?: string;
  penalized?: boolean;
  refundPending?: boolean;
  attestedBps?: number;
  /** Cuántas veces se volvió a publicar sin entrega. */
  relisted: number;
  /** Si alguna vez tuvo una oferta: los que nunca la tienen son demanda sin agente. */
  everOffered: boolean;
  /** Al asignar: cuántas ofertas había en pie, y la más barata (selección). */
  offersAtAssignment?: number;
  cheapestAtAssignment?: string;
  /** Su campaña: `keccak256(abi.encode(cliente, campaignId))`, como en el contrato. */
  campaignKey?: string;
  postedTs: number;
  assignedTs?: number;
  closedTs?: number;
  updatedTs: number;
}

/** Una oferta en pie en un encargo de selección. */
export interface OfertaIndexada {
  agent: string;
  /** El nivel con el que ofertó. */
  level: number;
  price: string;
  workDuration: number;
  ts: number;
}

/** Un agente en el tablón: sus categorías, sus faltas y lo que ha cogido. */
export interface AgenteEnElTablon {
  agent: string;
  categorias: number[];
  /** Todas las faltas, y las de los últimos 90 días según el contrato. */
  faltas: number;
  faltasEn90Dias: number;
  /** Unix en segundos; 0 si no lo han suspendido nunca. */
  suspendidoHasta: number;
  ultimaFaltaTs?: number;
  asignados: number;
  cerrados: number;
  sancionados: number;
}

/** Cómo está el tablón ahora: lo que la web necesita para validar antes de firmar. */
export interface ConfigTablon {
  /** Por moneda (dirección en minúsculas): tope por encargo y total, en unidades mínimas. "0" = sin tope. */
  caps: Record<string, { perJob: string; total: string }>;
  paused: boolean;
  levels: { minCompleted: number; minRating: number; dailyCap: number }[] | null;
  newcomerJobs: number | null;
  updatedTs: number;
}

/** Una campaña: de quien la publica, con lo que ha cogido cada agente. */
export interface CampanaIndexada {
  key: string;
  campaignId: string;
  owner: string;
  jobs: number;
  /** El tope por agente, leído del contrato (`campaignCap`). null hasta leerlo. */
  cap: number | null;
  tomados: Record<string, number>;
}

/** Las cifras del tablón de un periodo, para la foto del mes (BOARD.md §10.1). */
export interface MetricasTablon {
  desde: number;
  hasta: number;
  volumen: {
    publicados: number;
    asignados: number;
    retirados: number;
    caducados: number;
    republicados: number;
    /** Presupuesto publicado, por moneda, en unidades mínimas. */
    publicadoPorMoneda: Record<string, string>;
  };
  /** Mediana de segundos entre publicar y asignar, por modo. null sin datos. */
  rapidez: { inmediato: number | null; seleccion: number | null };
  competencia: {
    medianaOfertas: number | null;
    sinOfertaParte: number | null;
    /** Mediana del precio elegido entre el presupuesto (1 = el presupuesto). */
    medianaPrecioSobrePresupuesto: number | null;
  };
  eleccion: { porElCliente: number; automatica: number; noLaMasBarata: number };
  entrega: { completados: number; cancelados: number; disputas: number; devueltoPorMoneda: Record<string, string> };
  sanciones: { faltas: number; suspensiones7: number; suspensiones30: number; agentes: number };
  /** Los agentes que cogieron encargos: la foto mira en la cadena su nivel al corte. */
  agentes: string[];
  porCategoria: { categoria: number; encargos: number; sinOferta: number; medianaPorMoneda: Record<string, string> }[];
}

/**
 * Lo que vigila el indexador en el tablón con reglas
 * (contracts/TABLON-SECURITY.md). Son señales para una persona, no veredictos.
 */
export interface Vigilancia {
  /** Repartos atestados en PanalTablon que no cuadran con el del escrow. */
  repartosDistintos: { jobId: string; escrowTaskId: string; atestado: string; escrow: string }[];
  /** Disputas abiertas hace 7 días o más: a los 14 se devuelven sin falta (F5). */
  disputasLargas: { taskId: string; jobId?: string; abiertaTs: number; dias: number }[];
  /** Agentes cuyas tareas completadas vienen casi todas de uno o dos clientes (F7). */
  parejas: { agente: string; completadas: number; clientes: number; principal: string; parte: number }[];
  /** Dos direcciones que se contratan la una a la otra (F7, de ida y vuelta). */
  cruzados: { a: string; b: string; aParaB: number; bParaA: number }[];
  generado: number;
}

/** La mediana de una lista de números; null si está vacía. */
function mediana(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const o = [...xs].sort((x, y) => x - y);
  const m = Math.floor(o.length / 2);
  return o.length % 2 ? o[m]! : (o[m - 1]! + o[m]!) / 2;
}

function medianaBig(xs: bigint[]): bigint {
  const o = [...xs].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
  return o[Math.floor((o.length - 1) / 2)] ?? 0n;
}

const VACIO_32 = /^0x0+$/;

/** La clave de una campaña, como `_campaignKey` en PanalTablon.sol. */
export function claveDeCampana(owner: string, campaignId: string): string {
  return keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'bytes32' }], [owner as Hex, campaignId as Hex]));
}

/**
 * Qué pasó al mirar el dominio de un agente.
 *
 * `true` lo confirma, `false` lo desmiente y `'sin-dominio'` es que no había
 * nada que mirar: quien recibe en el buzón de Panal no tiene dominio propio, y
 * `api.panal.lat` no es suyo sino nuestro.
 *
 * SON TRES COSAS Y NO DOS. Con un booleano, toda persona registrada salía en
 * rojo y con el texto «se miró su dominio y no confirma esta dirección, puede
 * ser una suplantación» — sobre alguien a quien el propio formulario de
 * registro le puso el buzón porque eligió «soy una persona». Suspendía por no
 * presentarse a un examen que nunca se le puso, y no había forma de aprobarlo.
 *
 * En el cable es `boolean | 'sin-dominio'` y no un enum de tres palabras a
 * propósito: así un cliente anterior a esto —la web desplegada, la app— sigue
 * leyendo `=== true` y `=== false` como siempre, y lo nuevo le cae en el «aún
 * no se ha mirado», que es gris y no acusa a nadie.
 */
export type EstadoDominio = boolean | 'sin-dominio';

/**
 * Lo que se sabe de la cuenta pública que declara un agente.
 *
 * La insignia del dominio solo la puede ganar quien tiene servidor propio, y
 * quien recibe en el buzón no lo tiene. Esta es la que sí puede ganar: la ficha
 * ya declara `github:usuario`, y esto guarda si esa cuenta ha demostrado ser
 * suya publicando una firma de su dirección. Ver `verificar-cuenta.ts`.
 */
export interface CuentaVerificada {
  /** Dónde vive la cuenta. Hoy solo GitHub. */
  red: 'github';
  /** El usuario, normalizado: en minúsculas y sin el `/repo` de la ficha. */
  usuario: string;
  /**
   * Lo que decía la ficha cuando se comprobó.
   *
   * Igual que `idiomasDe`: si el agente cambia la cuenta que declara, lo
   * guardado deja de decir nada de la nueva y hay que volver a mirarlo. Sin
   * esto, cambiar `github:` por el de otro heredaría su insignia.
   */
  declarado: string;
  /** Si esa cuenta publica una firma de esta misma dirección. */
  ok: boolean;
  /** Por qué no, para poder enseñarlo. */
  motivo?: string;
  /** Cuándo se comprobó, para no repetirlo en cada vuelta. */
  ts: number;
}

/**
 * La ficha de un agente en el catálogo.
 *
 * NO sale de los eventos: `AgentRegistered` no lleva el metadata, así que hay
 * que leer `getAgent()` del registry. Se lee una vez por agente y se refresca
 * cuando cambia (MetadataUpdated, PriceUpdated, ActiveUpdated).
 *
 * Existe para que el mercado deje de leer el registro entero en cada visita.
 * La web pedía `getAgents(0, 50)` y luego dos llamadas por agente: 100 en cada
 * carga de página, y los agentes 51 en adelante no existían para nadie.
 */
export interface AgentProfile {
  address: string;
  owner: string;
  name: string;
  description: string;
  skills: string[];
  botUrl: string | null;
  /**
   * La ficha en crudo, tal y como está en el registro.
   *
   * Se publica entera además de troceada porque el mercado saca de ahí el logo
   * y los enlaces del creador (`src/lib/marca.ts`), y trocearlos aquí obligaría
   * a desplegar el indexador cada vez que se admita un token nuevo. Así el
   * formato puede crecer en el cliente sin tocar este servicio.
   */
  metadataURI: string;
  /** Precio por tarea en unidades mínimas (string: no cabe en un number). */
  pricePerTask: string;
  currency: string;
  coin: string;
  active: boolean;
  registeredAt: number;
  /** Cuándo se leyó del registry, para saber si toca refrescarla. */
  fetchedTs: number;

  /**
   * Si su dominio declara esta misma dirección en `/agent.json`.
   *
   * El nombre lo escribe el propio agente y no es único, así que por sí solo no
   * prueba nada: cualquiera puede registrarse como "Lint". El dominio sí es de
   * alguien, y la tarjeta que sirve declara su dirección. `undefined` mientras
   * no se haya mirado todavía.
   *
   * Y `'sin-dominio'` cuando no hay dominio que mirar, que no es lo mismo que
   * suspender. Ver `EstadoDominio`.
   */
  verificado?: EstadoDominio;
  /** Por qué no está verificado, para poder enseñarlo. */
  verificadoMotivo?: string;

  /**
   * Su descripción en cada idioma del marketplace, indexada por código ISO.
   *
   * Existe porque el catálogo es lo primero que ve todo el mundo y hasta ahora
   * salía en el idioma en que su dueño escribió la ficha: la interfaz entera en
   * árabe y los siete agentes descritos en español. La traduce cada agente con
   * su propio modelo (`?lang=` de su `/agent.json`) y aquí solo se guarda, para
   * que el escaparate no tenga que pedirle nada a nadie al pintar una lista.
   *
   * Vacío o ausente significa que ese agente no sabe traducirse —los que corren
   * una plantilla anterior— y entonces se enseña su texto original, que es
   * exactamente lo que se enseñaba antes de que esto existiera.
   */
  idiomas?: Record<string, string>;

  /**
   * La ficha que se tradujo, para saber si lo guardado sigue valiendo.
   *
   * Sin esto habría que elegir entre volver a pedir diez traducciones en cada
   * repaso —diez llamadas al modelo de cada agente, cada pocos minutos— o no
   * volver a pedirlas nunca y quedarse con la descripción de hace un año.
   */
  idiomasDe?: string;

  /** Cuándo se pidieron por última vez, para poder reintentar las que faltan. */
  idiomasTs?: number;
  /** Con qué versión del lector se guardaron. Ver `IDIOMAS_V` en el indexador. */
  idiomasV?: number;
  /** Cuándo se comprobó, para no repetirlo en cada vuelta. */
  verificadoTs?: number;

  /**
   * Si la cuenta pública que declara es suya. `undefined` si no declara
   * ninguna, o si todavía no se ha mirado.
   */
  cuenta?: CuentaVerificada;
}

/**
 * El nombre que tiene un agente en PanalNames, y cómo llegó a tenerlo.
 *
 * El «cómo» importa tanto como el nombre. Los nombres se pueden vender, y lo
 * único que viaja con ellos es el nombre: la reputación, el historial y la
 * verificación del dominio se quedan en la dirección. Así que quien compra
 * `lint` hereda el nombre y ninguna de las 200 tareas que lo hicieron valer, y
 * el cliente que lo busca por el nombre tiene derecho a enterarse.
 */
export interface NombreDeAgente {
  nombre: string;
  /** Cuándo pasó a ser de esta dirección (segundos epoch). */
  desdeTs: number;
  /** Reclamado de cero, comprado a otro, o recibido sin pagar. */
  origen: 'reclamado' | 'comprado' | 'recibido';
  /** Lo que se pagó, en unidades mínimas. Solo si se compró. */
  precio?: string;
}

export interface DayStats {
  /** YYYY-MM-DD (UTC). */
  date: string;
  events: number;
  /** MON movido ese día (wei, string): TaskCreated.amount + Withdrawal.amount en MON. */
  monMoved: string;
  /** PANAL movido ese día (wei, string): idem en token $PANAL. */
  panalMoved: string;
  /** Agentes distintos con actividad ese día. */
  activeAgents: number;
}

const NATIVE = '0x0000000000000000000000000000000000000000';

/** Eventos tras los que la ficha del registry deja de estar al dia. */
const AFECTAN_A_LA_FICHA = new Set(['AgentRegistered', 'MetadataUpdated', 'PriceUpdated', 'ActiveUpdated']);

function dayKey(tsSec: number): string {
  return new Date(tsSec * 1000).toISOString().slice(0, 10);
}

/** Currency address -> etiqueta de stats ('MON' | '$PANAL'). */
function coinOf(currency: string | undefined, panalToken: string): string {
  if (!currency || currency.toLowerCase() === NATIVE) return 'MON';
  return currency.toLowerCase() === panalToken.toLowerCase() ? '$PANAL' : currency;
}

function addWei(acc: Record<string, string>, coin: string, amount: string): void {
  acc[coin] = (BigInt(acc[coin] ?? '0') + BigInt(amount)).toString();
}

/** Acumulador mutable de stats; se reconstruye rejugando events.jsonl. */
class StatsBuilder {
  readonly agents = new Map<string, AgentStats & { ratingSum: number; deliverySecSum: number }>();
  readonly days = new Map<string, DayStats & { mon: bigint; panal: bigint; agents: Set<string> }>();
  readonly byType: Record<string, number> = {};
  /** taskId -> currency address (para atribuir volúmenes de TaskCompleted). */
  private readonly taskCurrency = new Map<string, string>();
  /** Quién tiene cada nombre de PanalNames, y cómo lo consiguió. */
  private readonly nombres = new Map<string, NombreDeAgente>();
  /** taskId -> tarea montada. El orden de inserción es el de creación. */
  readonly tasks = new Map<string, IndexedTask>();
  /**
   * Índice inverso: dirección -> taskIds en los que participa, como cliente o
   * como trabajador. Es lo que hace que buscar «mis tareas» sea instantáneo en
   * vez de recorrerlas todas.
   */
  readonly tasksByAddress = new Map<string, Set<string>>();
  /** Los encargos de PanalTablon. */
  readonly jobs = new Map<string, IndexedJob>();
  /** Tarea del escrow -> encargo del tablón que la creó. */
  private readonly jobDeTarea = new Map<string, string>();
  /** Las ofertas en pie de cada encargo, por agente. */
  readonly ofertas = new Map<string, Map<string, OfertaIndexada>>();
  /** Las categorías que ha declarado cada agente en el tablón. */
  readonly categorias = new Map<string, number[]>();
  /** Faltas, suspensión y encargos de cada agente en el tablón. */
  readonly agentesTablon = new Map<string, Omit<AgenteEnElTablon, 'agent' | 'categorias'>>();
  /** Lo que el tablón le debe a cada cliente, por moneda (Credited − Claimed). */
  readonly porCobrar = new Map<string, Map<string, bigint>>();
  readonly configTablon: ConfigTablon = { caps: {}, paused: false, levels: null, newcomerJobs: null, updatedTs: 0 };
  readonly campanas = new Map<string, { key: string; campaignId: string; owner: string; jobs: number; cap: number | null; tomados: Map<string, number> }>();
  /** Para las métricas: cada falta, cada republicación y cada cierre, con su fecha. */
  readonly faltas: { agent: string; ts: number; suspendidoHasta: number }[] = [];
  readonly republicaciones: number[] = [];
  readonly cierres: { ts: number; refund: bigint; coin: string; penalized: boolean }[] = [];
  total = 0;

  constructor(
    private readonly panalToken: string,
    private readonly tablon: string | null = null,
  ) {}

  /**
   * Ata una tarea del escrow a su encargo del tablón: su cliente de verdad
   * pasa a encontrarla en «mis tareas». Da igual qué evento llegue antes.
   */
  private vincular(taskId: string, jobId: string): void {
    this.jobDeTarea.set(taskId, jobId);
    const t = this.tasks.get(taskId);
    const j = this.jobs.get(jobId);
    if (!t || !j) return;
    // Solo si en el escrow su cliente es de verdad el tablón: una dirección mal
    // configurada no puede atribuirle a nadie las tareas de otro.
    if (this.tablon && t.client !== this.tablon) return;
    t.realClient = j.client;
    t.jobId = jobId;
    this.ligar(j.client, taskId);
  }

  private job(jobId: unknown): IndexedJob | undefined {
    return jobId === undefined ? undefined : this.jobs.get(String(jobId));
  }

  private sinOfertas(j: IndexedJob): void {
    this.ofertas.delete(j.jobId);
    j.offers = 0;
  }

  private agenteTablon(agent: string): Omit<AgenteEnElTablon, 'agent' | 'categorias'> {
    const k = agent.toLowerCase();
    let a = this.agentesTablon.get(k);
    if (!a) {
      a = { faltas: 0, faltasEn90Dias: 0, suspendidoHasta: 0, asignados: 0, cerrados: 0, sancionados: 0 };
      this.agentesTablon.set(k, a);
    }
    return a;
  }

  private agent(address: string, ts: number): AgentStats & { ratingSum: number; deliverySecSum: number } {
    const key = address.toLowerCase();
    let a = this.agents.get(key);
    if (!a) {
      a = {
        address: key,
        tasks: 0,
        completed: 0,
        avgRating: null,
        ratingCount: 0,
        ratingSum: 0,
        delivered: 0,
        avgDeliverySec: null,
        deliverySecSum: 0,
        disputes: 0,
        notDelivered: 0,
        volume: {},
        firstSeenTs: ts,
        lastSeenTs: ts,
      };
      this.agents.set(key, a);
    }
    if (ts < a.firstSeenTs) a.firstSeenTs = ts;
    if (ts > a.lastSeenTs) a.lastSeenTs = ts;
    return a;
  }

  /** La tarea ya montada, o undefined si su TaskCreated aún no se ha visto. */
  private task(taskId: string): IndexedTask | undefined {
    return this.tasks.get(taskId);
  }

  /** Ata una dirección a una tarea en el índice inverso. */
  private ligar(address: string, taskId: string): void {
    const key = address.toLowerCase();
    let set = this.tasksByAddress.get(key);
    if (!set) {
      set = new Set();
      this.tasksByAddress.set(key, set);
    }
    set.add(taskId);
  }

  private day(ts: number): DayStats & { mon: bigint; panal: bigint; agents: Set<string> } {
    const key = dayKey(ts);
    let d = this.days.get(key);
    if (!d) {
      d = { date: key, events: 0, monMoved: '0', panalMoved: '0', activeAgents: 0, mon: 0n, panal: 0n, agents: new Set() };
      this.days.set(key, d);
    }
    return d;
  }

  private move(day: ReturnType<StatsBuilder['day']>, coin: string, amount: string): void {
    if (coin === 'MON') day.mon += BigInt(amount);
    else if (coin === '$PANAL') day.panal += BigInt(amount);
  }

  nombreDe(address: string): NombreDeAgente | null {
    return this.nombres.get(address.toLowerCase()) ?? null;
  }

  add(ev: IndexedEvent): void {
    this.total += 1;
    this.byType[ev.event] = (this.byType[ev.event] ?? 0) + 1;
    const d = this.day(ev.ts);
    d.events += 1;
    const a = ev.args;

    switch (ev.event) {
      case 'AgentRegistered': {
        const ag = this.agent(String(a['agent']), ev.ts);
        d.agents.add(ag.address);
        break;
      }
      case 'PriceUpdated':
      case 'MetadataUpdated':
      case 'ActiveUpdated': {
        const ag = this.agent(String(a['agent']), ev.ts);
        d.agents.add(ag.address);
        break;
      }
      case 'TaskCreated': {
        const worker = String(a['worker']);
        const ag = this.agent(worker, ev.ts);
        ag.tasks += 1;
        d.agents.add(ag.address);
        const currency = String(a['currency'] ?? NATIVE);
        if (a['taskId'] !== undefined) this.taskCurrency.set(String(a['taskId']), currency);
        if (a['amount'] !== undefined) this.move(d, coinOf(currency, this.panalToken), String(a['amount']));

        // Nace la tarea, y se ata a sus DOS partes: el cliente la busca para
        // aprobarla o disputarla, el trabajador para saber qué tiene pendiente.
        if (a['taskId'] !== undefined && a['client'] !== undefined) {
          const taskId = String(a['taskId']);
          const client = String(a['client']).toLowerCase();
          const w = worker.toLowerCase();
          this.tasks.set(taskId, {
            taskId,
            client,
            worker: w,
            amount: String(a['amount'] ?? '0'),
            currency,
            coin: coinOf(currency, this.panalToken),
            status: 'open',
            createdTs: ev.ts,
            updatedTs: ev.ts,
          });
          this.ligar(client, taskId);
          if (w && w !== NATIVE) this.ligar(w, taskId);
          const jobId = this.jobDeTarea.get(taskId);
          if (jobId) this.vincular(taskId, jobId);
        }
        break;
      }
      case 'TaskClaimed': {
        const ag = this.agent(String(a['worker']), ev.ts);
        d.agents.add(ag.address);
        // Una tarea abierta a cualquiera no tenía trabajador al nacer: al
        // reclamarla hay que atárselo, o no la encontraría en «mis tareas».
        const t = a['taskId'] !== undefined ? this.task(String(a['taskId'])) : undefined;
        if (t) {
          t.worker = ag.address;
          t.claimedTs = ev.ts;
          t.updatedTs = ev.ts;
          this.ligar(ag.address, t.taskId);
        }
        break;
      }
      case 'TaskCompleted': {
        const ag = this.agent(String(a['worker']), ev.ts);
        ag.completed += 1;
        d.agents.add(ag.address);
        if (a['rating'] !== undefined) {
          ag.ratingSum += Number(a['rating']);
          ag.ratingCount += 1;
          ag.avgRating = ag.ratingSum / ag.ratingCount;
        }
        const currency = a['taskId'] !== undefined ? this.taskCurrency.get(String(a['taskId'])) : undefined;
        if (a['workerPaid'] !== undefined) {
          const coin = coinOf(currency, this.panalToken);
          addWei(ag.volume, coin, String(a['workerPaid']));
          this.move(d, coin, String(a['workerPaid']));
        }
        const tc = a['taskId'] !== undefined ? this.task(String(a['taskId'])) : undefined;
        if (tc) {
          tc.status = 'completed';
          tc.updatedTs = ev.ts;
          if (a['rating'] !== undefined) tc.rating = Number(a['rating']);
        }
        break;
      }
      case 'DisputeResolved': {
        // No trae worker; el rating cuenta para el historial global por task.
        if (a['workerPaid'] !== undefined && a['taskId'] !== undefined) {
          const currency = this.taskCurrency.get(String(a['taskId']));
          this.move(d, coinOf(currency, this.panalToken), String(a['workerPaid']));
        }
        const tr = a['taskId'] !== undefined ? this.task(String(a['taskId'])) : undefined;
        if (tr) {
          tr.status = 'completed';
          tr.updatedTs = ev.ts;
          if (a['rating'] !== undefined) tr.rating = Number(a['rating']);
          if (a['clientRefunded'] !== undefined) tr.clientRefunded = String(a['clientRefunded']);
        }
        break;
      }
      // Estos tres se indexaban como eventos pero no tocaban ningún agregado.
      // Sin ellos una tarea entregada seguía figurando como abierta, que es
      // justo la diferencia que el cliente necesita ver: si está entregada
      // tiene que aprobarla o disputarla, y si no hace nada el pago se libera
      // solo a las 72 horas.
      case 'TaskDelivered': {
        const t = a['taskId'] !== undefined ? this.task(String(a['taskId'])) : undefined;
        if (t) {
          // La primera entrega es la que cuenta para el tiempo: una posterior
          // (tras una disputa) no es lo que tardó en entregar.
          if (t.status === 'open' && t.worker && t.worker !== NATIVE) {
            const ag = this.agent(t.worker, ev.ts);
            ag.delivered += 1;
            ag.deliverySecSum += Math.max(0, ev.ts - (t.claimedTs ?? t.createdTs));
            ag.avgDeliverySec = ag.deliverySecSum / ag.delivered;
          }
          // Solo desde abierta: una disputa posterior no debe volver atrás.
          if (t.status === 'open') t.status = 'delivered';
          if (a['resultHash'] !== undefined) t.resultHash = String(a['resultHash']);
          t.updatedTs = ev.ts;
        }
        break;
      }
      case 'TaskDisputed': {
        const t = a['taskId'] !== undefined ? this.task(String(a['taskId'])) : undefined;
        if (t) {
          if (t.status !== 'disputed' && t.worker && t.worker !== NATIVE) this.agent(t.worker, ev.ts).disputes += 1;
          t.status = 'disputed';
          t.disputedTs = ev.ts;
          t.updatedTs = ev.ts;
        }
        break;
      }
      case 'TaskCancelled': {
        const t = a['taskId'] !== undefined ? this.task(String(a['taskId'])) : undefined;
        if (t) {
          // Con trabajador y sin entregar, el escrow solo deja cancelar cuando
          // venció el plazo: es un encargo que no entregó. Sin trabajador, es
          // una tarea abierta que nadie cogió y no es culpa de nadie.
          if (t.status === 'open' && t.worker && t.worker !== NATIVE) this.agent(t.worker, ev.ts).notDelivered += 1;
          t.status = 'cancelled';
          t.updatedTs = ev.ts;
        }
        break;
      }
      // ── PanalNames ──────────────────────────────────────────────────────
      // Se guarda quién tiene cada nombre Y cómo lo consiguió. Un nombre
      // comprado ayer y uno reclamado hace un año valen lo mismo como
      // identificador y no valen lo mismo como señal.
      case 'Reclamado': {
        const dueno = String(ev.args.dueno ?? '').toLowerCase();
        const nombre = String(ev.args.nombre ?? '');
        if (dueno && nombre) {
          this.nombres.set(dueno, { nombre, desdeTs: ev.ts, origen: 'reclamado' });
        }
        break;
      }
      case 'Vendido':
      case 'Transferido': {
        const de = String(ev.args.de ?? '').toLowerCase();
        const a = String(ev.args.a ?? '').toLowerCase();
        const nombre = String(ev.args.nombre ?? '');
        // El vendedor se queda sin nombre: el contrato solo deja uno por
        // dirección, así que dejarle el viejo apuntando sería mentira.
        if (de) this.nombres.delete(de);
        if (a && nombre) {
          this.nombres.set(a, {
            nombre,
            desdeTs: ev.ts,
            origen: ev.event === 'Vendido' ? 'comprado' : 'recibido',
            ...(ev.event === 'Vendido' ? { precio: String(ev.args.precio ?? '0') } : {}),
          });
        }
        break;
      }
      case 'Liberado': {
        const dueno = String(ev.args.dueno ?? '').toLowerCase();
        if (dueno) this.nombres.delete(dueno);
        break;
      }

      // ── PanalTablon (contracts/BOARD.md) ─────────────────────────────────
      case 'JobPosted': {
        const jobId = String(a['jobId']);
        const amount = String(a['amount'] ?? '0');
        const currency = String(a['currency'] ?? NATIVE);
        const campana = String(a['campaignId'] ?? '');
        this.jobs.set(jobId, {
          jobId,
          client: String(a['client']).toLowerCase(),
          category: Number(a['category'] ?? 0),
          currency,
          coin: coinOf(currency, this.panalToken),
          mode: Number(a['mode']) === 1 ? 'selection' : 'immediate',
          budget: amount,
          amount,
          campaignId: VACIO_32.test(campana) || !campana ? null : campana,
          state: 'posted',
          offers: 0,
          relisted: 0,
          everOffered: false,
          postedTs: ev.ts,
          updatedTs: ev.ts,
        });
        const j = this.jobs.get(jobId)!;
        if (j.campaignId) {
          j.campaignKey = claveDeCampana(j.client, j.campaignId);
          let c = this.campanas.get(j.campaignKey);
          if (!c) {
            c = { key: j.campaignKey, campaignId: j.campaignId, owner: j.client, jobs: 0, cap: null, tomados: new Map() };
            this.campanas.set(j.campaignKey, c);
          }
          c.jobs += 1;
        }
        break;
      }
      case 'Applied':
      case 'OfferWithdrawn': {
        const j = this.job(a['jobId']);
        if (!j) break;
        let enPie = this.ofertas.get(j.jobId);
        if (!enPie) {
          enPie = new Map();
          this.ofertas.set(j.jobId, enPie);
        }
        const agente = String(a['agent']).toLowerCase();
        if (ev.event === 'Applied') {
          // Volver a ofertar la sustituye: la última es la que cuenta.
          enPie.set(agente, {
            agent: agente,
            level: Number(a['level'] ?? 0),
            price: String(a['price'] ?? '0'),
            workDuration: Number(a['workDuration'] ?? 0),
            ts: ev.ts,
          });
          j.everOffered = true;
        } else {
          enPie.delete(agente);
        }
        j.offers = enPie.size;
        j.updatedTs = ev.ts;
        break;
      }
      case 'JobAssigned': {
        const j = this.job(a['jobId']);
        if (!j) break;
        j.state = 'assigned';
        j.agent = String(a['agent']).toLowerCase();
        j.escrowTaskId = String(a['escrowTaskId']);
        j.amount = String(a['price'] ?? j.amount);
        j.byClient = a['byClient'] === true || a['byClient'] === 'true';
        j.assignedTs = ev.ts;
        j.updatedTs = ev.ts;
        const enPie = [...(this.ofertas.get(j.jobId)?.values() ?? [])];
        if (j.mode === 'selection') {
          j.offersAtAssignment = enPie.length;
          if (enPie.length > 0) {
            j.cheapestAtAssignment = enPie.reduce((m, o) => (BigInt(o.price) < BigInt(m) ? o.price : m), enPie[0]!.price);
          }
        }
        this.sinOfertas(j);
        this.vincular(j.escrowTaskId, j.jobId);
        this.agenteTablon(j.agent).asignados += 1;
        if (j.campaignKey) {
          const c = this.campanas.get(j.campaignKey);
          if (c) c.tomados.set(j.agent, (c.tomados.get(j.agent) ?? 0) + 1);
        }
        break;
      }
      case 'JobWithdrawn':
      case 'JobExpired': {
        const j = this.job(a['jobId']);
        if (!j) break;
        j.state = ev.event === 'JobWithdrawn' ? 'withdrawn' : 'expired';
        j.closedTs = ev.ts;
        j.updatedTs = ev.ts;
        this.sinOfertas(j);
        break;
      }
      case 'JobRelisted': {
        // Llega justo después de su JobSettled, en la misma transacción.
        const j = this.job(a['jobId']);
        if (!j) break;
        // Lo de la ronda anterior no es de este encargo publicado: la falta
        // del agente queda en su evento Strike, no aquí.
        j.state = 'posted';
        j.relisted += 1;
        for (const k of [
          'agent',
          'escrowTaskId',
          'closedTs',
          'assignedTs',
          'byClient',
          'refund',
          'penalized',
          'refundPending',
          'attestedBps',
          'offersAtAssignment',
          'cheapestAtAssignment',
        ] as const) {
          delete j[k];
        }
        j.amount = j.budget;
        j.updatedTs = ev.ts;
        this.republicaciones.push(ev.ts);
        break;
      }
      case 'JobSettled': {
        const j = this.job(a['jobId']);
        if (!j) break;
        j.state = 'closed';
        j.refund = String(a['refundToClient'] ?? '0');
        j.penalized = a['penalized'] === true || a['penalized'] === 'true';
        j.refundPending = false;
        j.closedTs = ev.ts;
        j.updatedTs = ev.ts;
        this.cierres.push({ ts: ev.ts, refund: BigInt(j.refund), coin: j.coin, penalized: j.penalized });
        if (j.agent) {
          const ag = this.agenteTablon(j.agent);
          ag.cerrados += 1;
          if (j.penalized) ag.sancionados += 1;
        }
        break;
      }
      case 'RefundPending': {
        const j = this.job(a['jobId']);
        if (!j) break;
        j.state = 'closed';
        j.refundPending = true;
        j.closedTs = ev.ts;
        j.updatedTs = ev.ts;
        break;
      }
      case 'ResolutionAttested': {
        const j = this.job(a['jobId']);
        if (!j) break;
        j.attestedBps = Number(a['workerShareBps']);
        j.updatedTs = ev.ts;
        break;
      }
      case 'Strike': {
        const agente = String(a['agent']).toLowerCase();
        const ag = this.agenteTablon(agente);
        const hasta = Number(a['suspendedUntil'] ?? 0);
        ag.faltas += 1;
        ag.faltasEn90Dias = Number(a['strikesIn90Days'] ?? 0);
        ag.suspendidoHasta = Math.max(ag.suspendidoHasta, hasta);
        ag.ultimaFaltaTs = ev.ts;
        this.faltas.push({ agent: agente, ts: ev.ts, suspendidoHasta: hasta });
        break;
      }
      case 'Credited':
      case 'Claimed': {
        const cliente = String(a['client']).toLowerCase();
        const moneda = String(a['currency'] ?? NATIVE).toLowerCase();
        let porMoneda = this.porCobrar.get(cliente);
        if (!porMoneda) {
          porMoneda = new Map();
          this.porCobrar.set(cliente, porMoneda);
        }
        const antes = porMoneda.get(moneda) ?? 0n;
        const cuanto = BigInt(String(a['amount'] ?? '0'));
        porMoneda.set(moneda, ev.event === 'Credited' ? antes + cuanto : antes > cuanto ? antes - cuanto : 0n);
        break;
      }
      case 'CapsChanged': {
        this.configTablon.caps[String(a['currency'] ?? NATIVE).toLowerCase()] = {
          perJob: String(a['perJob'] ?? '0'),
          total: String(a['total'] ?? '0'),
        };
        this.configTablon.updatedTs = ev.ts;
        break;
      }
      case 'PausedSet': {
        this.configTablon.paused = a['paused'] === true || a['paused'] === 'true';
        this.configTablon.updatedTs = ev.ts;
        break;
      }
      case 'NewcomerJobsChanged': {
        this.configTablon.newcomerJobs = Number(a['jobs'] ?? 0);
        this.configTablon.updatedTs = ev.ts;
        break;
      }
      case 'LevelsChanged': {
        const crudo = a['levels'];
        if (typeof crudo === 'string') {
          const niveles = JSON.parse(crudo) as { minCompleted: unknown; minRating: unknown; dailyCap: unknown }[];
          this.configTablon.levels = niveles.map((n) => ({
            minCompleted: Number(n.minCompleted),
            minRating: Number(n.minRating),
            dailyCap: Number(n.dailyCap),
          }));
          this.configTablon.updatedTs = ev.ts;
        }
        break;
      }
      case 'CategoriesSet': {
        const cats = a['categories'];
        const lista = typeof cats === 'string' ? (JSON.parse(cats) as unknown[]) : [];
        this.categorias.set(
          String(a['agent']).toLowerCase(),
          lista.map(Number).filter((c) => Number.isInteger(c) && c >= 0 && c <= 255),
        );
        break;
      }

      case 'Withdrawal': {
        const to = String(a['to']);
        const ag = this.agent(to, ev.ts);
        d.agents.add(ag.address);
        if (a['amount'] !== undefined) this.move(d, coinOf(String(a['token']), this.panalToken), String(a['amount']));
        break;
      }
      default:
        break;
    }
  }

  /** Series diarias ascendentes por fecha, recortadas a los últimos `days` días. */
  dailySeries(days: number): DayStats[] {
    const out: DayStats[] = [];
    const today = new Date();
    for (let i = days - 1; i >= 0; i--) {
      const key = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - i))
        .toISOString()
        .slice(0, 10);
      const d = this.days.get(key);
      out.push({
        date: key,
        events: d?.events ?? 0,
        monMoved: d ? d.mon.toString() : '0',
        panalMoved: d ? d.panal.toString() : '0',
        activeAgents: d ? d.agents.size : 0,
      });
    }
    return out;
  }

  agentList(): AgentStats[] {
    return [...this.agents.values()]
      .map(({ ratingSum: _ratingSum, deliverySecSum: _deliverySecSum, ...rest }) => rest)
      .sort((x, y) => y.tasks - x.tasks || y.completed - x.completed || y.lastSeenTs - x.lastSeenTs);
  }
}

// ---------------------------------------------------------------------------
// Store del índice.
// ---------------------------------------------------------------------------

export class IndexStore {
  readonly dir: string;
  private readonly eventsFile: string;
  private readonly stateFile: string;
  private readonly events: IndexedEvent[] = [];
  private readonly seen = new Set<string>();
  private readonly stats: StatsBuilder;
  private state: IndexerState;

  constructor(dir: string, panalToken: string, tablon: string | null = null) {
    this.dir = resolve(dir);
    mkdirSync(this.dir, { recursive: true });
    this.eventsFile = join(this.dir, 'events.jsonl');
    this.stateFile = join(this.dir, 'state.json');
    this.stats = new StatsBuilder(panalToken, tablon?.toLowerCase() ?? null);
    this.loadEvents();
    this.state = this.loadState();
  }

  // ---- carga ---------------------------------------------------------------

  private loadEvents(): void {
    if (!existsSync(this.eventsFile)) return;
    const text = readFileSync(this.eventsFile, 'utf8');
    let bad = 0;
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        const ev = JSON.parse(line) as IndexedEvent;
        if (this.seen.has(ev.id)) continue;
        this.seen.add(ev.id);
        this.events.push(ev);
        this.stats.add(ev);
      } catch {
        bad += 1;
      }
    }
    if (bad > 0) console.warn(`[index] events.jsonl: ${bad} líneas corruptas ignoradas`);
    this.sortEvents();
    if (this.events.length > 0) {
      console.log(`[index] ${this.events.length} eventos cargados de ${this.eventsFile}`);
    }
  }

  private loadState(): IndexerState {
    if (!existsSync(this.stateFile)) return structuredClone(EMPTY_STATE);
    try {
      const parsed = JSON.parse(readFileSync(this.stateFile, 'utf8')) as Partial<IndexerState>;
      return {
        ...structuredClone(EMPTY_STATE),
        ...parsed,
        byType: parsed.byType ?? {},
      };
    } catch (err) {
      console.warn(`[index] state.json corrupto, se reinicia: ${String(err)}`);
      return structuredClone(EMPTY_STATE);
    }
  }

  private sortEvents(): void {
    this.events.sort((a, b) =>
      a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber - b.blockNumber,
    );
  }

  // ---- escritura -------------------------------------------------------------

  /** Añade eventos nuevos (dedup por id). Devuelve cuántos eran realmente nuevos. */
  append(events: IndexedEvent[]): number {
    const fresh: IndexedEvent[] = [];
    for (const ev of events) {
      if (this.seen.has(ev.id)) continue;
      this.seen.add(ev.id);
      fresh.push(ev);
    }
    if (fresh.length === 0) return 0;
    const lines = fresh.map((ev) => JSON.stringify(ev)).join('\n') + '\n';
    appendFileSync(this.eventsFile, lines, 'utf8');
    this.events.push(...fresh);
    this.sortEvents();
    for (const ev of fresh) {
      this.stats.add(ev);
      // La ficha del registry no sale de los eventos, pero los eventos SI
      // dicen cuando ha dejado de valer. Se marca aqui, dentro de append, y no
      // en cada sitio que ingiere: asi da igual si el evento vino del arranque,
      // del bootstrap o del sondeo incremental.
      if (AFECTAN_A_LA_FICHA.has(ev.event)) {
        const quien = ev.args['agent'];
        if (typeof quien === 'string') this.marcarSucio(quien);
      }
    }
    this.state.totalEvents = this.stats.total;
    this.state.byType = { ...this.stats.byType };
    this.state.updatedAt = Date.now();
    return fresh.length;
  }

  /** Persiste state.json de forma atómica (tmp + rename). */
  saveState(): void {
    this.state.totalEvents = this.stats.total;
    this.state.byType = { ...this.stats.byType };
    this.state.updatedAt = Date.now();
    const tmp = `${this.stateFile}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.state, null, 2), 'utf8');
    renameSync(tmp, this.stateFile);
  }

  // ---- estado del cursor -----------------------------------------------------

  get lastBlock(): number {
    return this.state.lastBlock;
  }

  setLastBlock(n: number): void {
    this.state.lastBlock = n;
  }

  get sweepFloor(): number | null {
    return this.state.sweepFloor;
  }

  setSweepFloor(n: number | null): void {
    this.state.sweepFloor = n;
  }

  /**
   * Presupuesto diario de ventanas de barrido. Devuelve las ventanas que
   * quedan hoy y marca `used` como consumidas (resetea al cambiar de día UTC).
   */
  sweepBudgetRemaining(perDay: number): number {
    const today = new Date().toISOString().slice(0, 10);
    if (this.state.sweepDay !== today) {
      this.state.sweepDay = today;
      this.state.sweepWindowsUsed = 0;
    }
    return Math.max(0, perDay - this.state.sweepWindowsUsed);
  }

  consumeSweepBudget(windows: number): void {
    this.state.sweepWindowsUsed += windows;
  }

  // ---- consultas para la API ---------------------------------------------------

  get totalEvents(): number {
    return this.stats.total;
  }

  get byType(): Record<string, number> {
    return { ...this.stats.byType };
  }

  /**
   * Eventos en orden descendente (más reciente primero) con paginado por
   * cursor. `before` es un cursor opaco devuelto como `next` por esta misma
   * función ("<ts>:<blockNumber>:<logIndex>"); también acepta un ts en
   * segundos plano (exclusivo). Devuelve los eventos y el siguiente cursor.
   */
  queryEvents(limit: number, before?: string): { events: IndexedEvent[]; next: string | null } {
    let start = this.events.length - 1; // recorremos desde el final (desc)
    if (before) {
      const m = /^(\d+):(\d+):(\d+)$/.exec(before);
      let key: [number, number, number];
      if (m) {
        key = [Number(m[1]), Number(m[2]), Number(m[3])];
      } else if (/^\d+$/.test(before)) {
        // ts plano: todo lo de ese segundo o posterior queda fuera.
        key = [Number(before), 0, 0];
      } else {
        return { events: [], next: null };
      }
      // Primer índice (desde el final) cuyo (ts, block, logIndex) < key.
      start = -1;
      for (let i = this.events.length - 1; i >= 0; i--) {
        const ev = this.events[i]!;
        const cmp =
          ev.ts === key[0]
            ? ev.blockNumber === key[1]
              ? ev.logIndex - key[2]
              : ev.blockNumber - key[1]
            : ev.ts - key[0];
        if (cmp < 0) {
          start = i;
          break;
        }
      }
      if (start === -1) return { events: [], next: null };
    }
    const out: IndexedEvent[] = [];
    for (let i = start; i >= 0 && out.length < limit; i--) {
      out.push(this.events[i]!);
    }
    const last = out[out.length - 1];
    const hasMore = last !== undefined && start - out.length >= 0;
    const next = hasMore && last ? `${last.ts}:${last.blockNumber}:${last.logIndex}` : null;
    return { events: out, next };
  }

  agentStats(): AgentStats[] {
    return this.stats.agentList();
  }

  /**
   * El catálogo: la ficha de cada agente unida a sus estadísticas.
   *
   * Vive fuera de StatsBuilder a propósito: las stats se reconstruyen rejugando
   * el log, y esto no sale del log — sale de leer el registry. Rejugar no
   * puede inventárselo.
   */
  private readonly profiles = new Map<string, AgentProfile>();
  /** Agentes cuya ficha hay que releer: nuevos, o que cambiaron algo. */
  private readonly sucios = new Set<string>();

  upsertProfile(profile: AgentProfile): void {
    const clave = profile.address.toLowerCase();
    // La verificación del dominio NO viene del registry, va por su cuenta y es
    // cara (una petición HTTP a un tercero). Si se dejara pisar aquí, cada
    // relectura de la ficha la borraría y habría que rehacerla entera.
    const antes = this.profiles.get(clave);
    if (antes && profile.verificado === undefined) {
      profile.verificado = antes.verificado;
      profile.verificadoMotivo = antes.verificadoMotivo;
      profile.verificadoTs = antes.verificadoTs;
    }
    // Las traducciones, por lo mismo y con más motivo: son DIEZ peticiones a
    // un bot ajeno, cada una con una llamada a su modelo detrás. Dejarlas
    // pisar aquí sería rehacerlas —y hacérselas pagar— en cada relectura de la
    // ficha. Se arrastran con la ficha DE LA QUE SALIERON: si el agente ha
    // reescrito su descripción, `idiomasDe` deja de cuadrar con la de ahora y
    // `pendientesDeTraducir` las vuelve a pedir sola.
    if (antes && profile.idiomas === undefined) {
      profile.idiomas = antes.idiomas;
      profile.idiomasDe = antes.idiomasDe;
    }
    // Salvo que haya cambiado de endpoint: entonces lo anterior ya no dice nada
    // de la URL nueva y hay que volver a mirarlo.
    if (antes && antes.botUrl !== profile.botUrl) {
      profile.verificado = undefined;
      profile.verificadoMotivo = undefined;
      profile.verificadoTs = undefined;
    }
    // La cuenta, por lo mismo que el dominio: no viene del registry, cuesta dos
    // peticiones a GitHub y se borraría en cada relectura de la ficha.
    if (antes && profile.cuenta === undefined) profile.cuenta = antes.cuenta;
    // Y caduca sola si la ficha ya no declara la misma cuenta. Sin esto, cambiar
    // el `github:` por el de otro heredaría la insignia que se ganó el anterior.
    if (profile.cuenta && profile.cuenta.declarado !== (leerMarca(profile.metadataURI).github ?? '')) {
      profile.cuenta = undefined;
    }
    this.profiles.set(clave, profile);
    this.sucios.delete(clave);
  }

  /** Guarda el resultado de mirar el dominio de un agente. */
  marcarVerificacion(address: string, estado: EstadoDominio, motivo: string): void {
    const p = this.profiles.get(address.toLowerCase());
    if (!p) return;
    p.verificado = estado;
    // El motivo se guarda también cuando no aplica: ahí no es una acusación,
    // es el diagnóstico de por qué no hay examen que poner.
    p.verificadoMotivo = estado === true ? undefined : motivo;
    p.verificadoTs = Math.floor(Date.now() / 1000);
  }

  /** Guarda el resultado de mirar la cuenta pública de un agente. */
  marcarCuenta(address: string, cuenta: CuentaVerificada): void {
    const p = this.profiles.get(address.toLowerCase());
    if (!p) return;
    p.cuenta = cuenta;
  }

  /**
   * Los que toca (re)mirar la cuenta: los que declaran una y no se ha mirado, o
   * se miró hace rato.
   *
   * Se repasa por lo mismo que el dominio, y con más motivo: un gist se borra
   * en dos clics, y una insignia que se ganó en marzo no dice nada de hoy si la
   * prueba ya no está publicada.
   */
  pendientesDeVerificarCuenta(maxEdadS: number, tope: number): AgentProfile[] {
    const ahora = Math.floor(Date.now() / 1000);
    const toca = [...this.profiles.values()].filter((p) => {
      if (!leerMarca(p.metadataURI).github) return false;
      return p.cuenta === undefined || ahora - p.cuenta.ts > maxEdadS;
    });
    // Primero los que nunca se han mirado, igual que con el dominio.
    toca.sort((a, b) => (a.cuenta?.ts ?? 0) - (b.cuenta?.ts ?? 0));
    return toca.slice(0, tope);
  }

  /**
   * Guarda las descripciones traducidas de un agente.
   *
   * `de` es la ficha de la que salieron: mientras no cambie, no hay que volver
   * a pedirlas. Se guardan aunque vengan a medias —un idioma puede haber
   * fallado— porque el que falte se sirve en el original y se reintentará
   * cuando el agente cambie su ficha.
   */
  guardarIdiomas(address: string, de: string, idiomas: Record<string, string>, version: number): void {
    const p = this.profiles.get(address.toLowerCase());
    if (!p) return;
    p.idiomas = idiomas;
    p.idiomasDe = de;
    p.idiomasTs = Math.floor(Date.now() / 1000);
    p.idiomasV = version;
  }

  /**
   * Los que toca (re)verificar: sin mirar todavía, o mirados hace rato.
   *
   * Se rehace cada tanto y no una sola vez porque un dominio caduca, se vende o
   * deja de apuntar donde apuntaba, y una insignia de verificado que se ganó
   * hace ocho meses no dice nada de hoy.
   */
  pendientesDeVerificar(maxEdadS: number, tope: number): AgentProfile[] {
    const ahora = Math.floor(Date.now() / 1000);
    const toca = [...this.profiles.values()].filter(
      (p) => p.botUrl && (p.verificadoTs === undefined || ahora - p.verificadoTs > maxEdadS),
    );
    // Primero los que nunca se han mirado: un agente recién llegado sin
    // insignia se ve peor que uno cuya insignia es de ayer.
    toca.sort((a, b) => (a.verificadoTs ?? 0) - (b.verificadoTs ?? 0));
    return toca.slice(0, tope);
  }

  /**
   * Los que toca traducir: nunca traducidos, con la ficha cambiada, o a los que
   * les faltan idiomas y ya ha pasado un rato.
   *
   * HAY QUE VOLVER A POR LAS QUE FALTEN. Un agente no traduce dentro de la
   * petición: sirve el original y encarga la traducción por detrás, así que la
   * primera vez que se le preguntan los diez idiomas contesta los diez sin
   * traducir. Dando eso por bueno, un agente se quedaría con su texto original
   * para siempre por haber llegado el indexador antes que su modelo.
   *
   * `idiomasDe` guarda de qué `metadataURI` salieron las traducciones que hay.
   * Comparar con la de ahora es lo que permite refrescarlas cuando alguien
   * reescribe su descripción SIN pedirle diez traducciones a cada agente en
   * cada vuelta del bucle, que sería un ataque contra sus propios bots.
   *
   * Solo los que publican endpoint: sin bot no hay a quién pedírselas.
   */
  pendientesDeTraducir(
    tope: number,
    completo: number,
    reintentoS: number,
    version: number,
  ): AgentProfile[] {
    const ahora = Math.floor(Date.now() / 1000);
    const toca = [...this.profiles.values()].filter((p) => {
      if (!p.botUrl) return false;
      // Lo guardado con un lector anterior no vale, aunque parezca completo.
      if ((p.idiomasV ?? 0) !== version) return true;
      if (p.idiomasDe !== p.metadataURI) return true;
      const tiene = Object.keys(p.idiomas ?? {}).length;
      return tiene < completo && ahora - (p.idiomasTs ?? 0) > reintentoS;
    });
    // El más olvidado primero. Sin ordenar, dos agentes que no sepan traducirse
    // ocupan las dos plazas de cada vuelta para siempre y nadie más pasa: el
    // mismo reparto que ya hace `pendientesDeVerificar`.
    toca.sort((a, b) => (a.idiomasTs ?? 0) - (b.idiomasTs ?? 0));
    return toca.slice(0, tope);
  }

  /** El nombre de un agente en PanalNames, o null si no tiene. */
  nombre(address: string): NombreDeAgente | null {
    return this.stats.nombreDe(address);
  }

  /** Marca una ficha como vieja. La llama el indexador al ver un evento suyo. */
  marcarSucio(address: string): void {
    this.sucios.add(address.toLowerCase());
  }

  /** Los que hay que releer del registry: sin ficha todavía, o cambiados. */
  pendientesDeFicha(): string[] {
    const fuera = new Set(this.sucios);
    for (const a of this.stats.agents.keys()) if (!this.profiles.has(a)) fuera.add(a);
    return [...fuera];
  }

  profile(address: string): AgentProfile | null {
    return this.profiles.get(address.toLowerCase()) ?? null;
  }

  /**
   * El catálogo filtrado y paginado.
   *
   * `q` busca en nombre, descripción y skills; `skill` solo en skills, que es
   * lo que pregunta un agente cuando quiere delegar y no le sirve encontrarse
   * a sí mismo en la descripción de otro.
   */
  catalogo(opts: {
    q?: string;
    skill?: string;
    includeInactive?: boolean;
    offset?: number;
    limit?: number;
  } = {}): { agents: (AgentProfile & { stats: AgentStats | null; nombre: NombreDeAgente | null })[]; total: number } {
    const stats = new Map(this.stats.agentList().map((a) => [a.address, a]));
    let lista = [...this.profiles.values()];

    if (!opts.includeInactive) lista = lista.filter((a) => a.active);

    if (opts.skill) {
      const aguja = opts.skill.toLowerCase();
      lista = lista.filter((a) => a.skills.some((s) => s.toLowerCase().includes(aguja)));
    }
    if (opts.q) {
      // Todas las palabras tienen que aparecer en algún sitio: buscar "json
      // legal" y que salga todo lo que tenga una de las dos no es buscar.
      const agujas = opts.q.toLowerCase().split(/\s+/).filter(Boolean);
      lista = lista.filter((a) => {
        const pajar = [a.name, a.description, ...a.skills].join(' ').toLowerCase();
        return agujas.every((n) => pajar.includes(n));
      });
    }

    // Orden estable: sin él, dos páginas seguidas pueden repetir o saltarse
    // agentes cuando el catálogo cambia entre una y otra.
    lista.sort((a, b) => a.registeredAt - b.registeredAt || a.address.localeCompare(b.address));

    const total = lista.length;
    const offset = Math.max(0, opts.offset ?? 0);
    const limit = opts.limit ?? total;
    return {
      agents: lista.slice(offset, offset + limit).map((a) => ({
        ...a,
        stats: stats.get(a.address) ?? null,
        nombre: this.stats.nombreDe(a.address),
      })),
      total,
    };
  }

  dailyStats(days: number): DayStats[] {
    return this.stats.dailySeries(days);
  }

  /**
   * Las tareas de una dirección, como cliente o como trabajador.
   *
   * Sale del índice inverso, así que cuesta lo que cuestan SUS tareas y no lo
   * que cuestan todas. Es la diferencia entre que el panel funcione con veinte
   * mil tareas en el escrow o deje de encontrar las tuyas.
   *
   * Se devuelven de la más reciente a la más antigua: lo que hay que atender
   * está siempre arriba.
   */
  tasksOf(address: string, opts: { role?: 'client' | 'worker'; limit?: number } = {}): IndexedTask[] {
    const ids = this.stats.tasksByAddress.get(address.toLowerCase());
    if (!ids) return [];
    const yo = address.toLowerCase();
    const out: IndexedTask[] = [];
    for (const id of ids) {
      const t = this.stats.tasks.get(id);
      if (!t) continue;
      if (opts.role === 'client' && t.client !== yo && t.realClient !== yo) continue;
      if (opts.role === 'worker' && t.worker !== yo) continue;
      out.push(t);
    }
    out.sort((a, b) => b.createdTs - a.createdTs || Number(b.taskId) - Number(a.taskId));
    return opts.limit !== undefined ? out.slice(0, opts.limit) : out;
  }

  /** Una tarea suelta, para consultarla por id sin leer la cadena. */
  task(taskId: string): IndexedTask | null {
    return this.stats.tasks.get(taskId) ?? null;
  }

  // ---- PanalTablon ---------------------------------------------------------

  get tablonHasta(): number | null {
    return this.state.tablonHasta;
  }

  setTablonHasta(n: number): void {
    this.state.tablonHasta = n;
  }

  yaAvisado(clave: string): boolean {
    return this.state.vigilanciaAvisada.includes(clave);
  }

  /** Anota una señal avisada. Se guardan las 2.000 últimas: de sobra para no repetir. */
  marcarAvisado(clave: string): void {
    this.state.vigilanciaAvisada.push(clave);
    if (this.state.vigilanciaAvisada.length > 2_000) this.state.vigilanciaAvisada.splice(0, 500);
  }

  /** Los encargos del tablón, del más nuevo al más viejo, con filtros. */
  jobs(f: {
    state?: IndexedJob['state'];
    category?: number;
    client?: string;
    agent?: string;
    limit?: number;
  } = {}): IndexedJob[] {
    const out: IndexedJob[] = [];
    for (const j of this.stats.jobs.values()) {
      if (f.state && j.state !== f.state) continue;
      if (f.category !== undefined && j.category !== f.category) continue;
      if (f.client && j.client !== f.client.toLowerCase()) continue;
      if (f.agent && j.agent !== f.agent.toLowerCase()) continue;
      out.push(j);
    }
    out.sort((a, b) => Number(b.jobId) - Number(a.jobId));
    return f.limit !== undefined ? out.slice(0, f.limit) : out;
  }

  job(jobId: string): IndexedJob | null {
    return this.stats.jobs.get(jobId) ?? null;
  }

  /** Las categorías que declaró un agente en el tablón. */
  categoriasDe(agent: string): number[] {
    return this.stats.categorias.get(agent.toLowerCase()) ?? [];
  }

  /**
   * Lo que hay que mirar, con los umbrales de contracts/TABLON-SECURITY.md:
   * repartos atestados que no cuadran con el escrow, disputas abiertas desde
   * hace 7 días o más, y agentes que trabajan casi solo para uno o dos clientes.
   */
  vigilancia(ahoraS: number = Math.floor(Date.now() / 1000)): Vigilancia {
    const repartosDistintos: Vigilancia['repartosDistintos'] = [];
    for (const j of this.stats.jobs.values()) {
      if (j.attestedBps === undefined || !j.escrowTaskId) continue;
      const t = this.stats.tasks.get(j.escrowTaskId);
      if (t?.clientRefunded === undefined) continue;
      const precio = BigInt(j.amount);
      const atestado = precio - (precio * BigInt(j.attestedBps)) / 10_000n;
      if (atestado.toString() !== t.clientRefunded) {
        repartosDistintos.push({
          jobId: j.jobId,
          escrowTaskId: j.escrowTaskId,
          atestado: atestado.toString(),
          escrow: t.clientRefunded,
        });
      }
    }

    const disputasLargas: Vigilancia['disputasLargas'] = [];
    const parejasPorAgente = new Map<string, Map<string, number>>();
    // Lo que importa es cómo trabaja AHORA: una pareja de hace un año no dice
    // nada de hoy, y sin ventana un agente veterano arrastraría su historia.
    const desde = ahoraS - 90 * 86_400;
    for (const t of this.stats.tasks.values()) {
      if (t.status === 'disputed' && t.disputedTs !== undefined) {
        const dias = Math.floor((ahoraS - t.disputedTs) / 86_400);
        if (dias >= 7) disputasLargas.push({ taskId: t.taskId, jobId: t.jobId, abiertaTs: t.disputedTs, dias });
      }
      if (t.status === 'completed' && t.worker && t.worker !== NATIVE && t.updatedTs >= desde) {
        const cliente = t.realClient ?? t.client;
        let porCliente = parejasPorAgente.get(t.worker);
        if (!porCliente) {
          porCliente = new Map();
          parejasPorAgente.set(t.worker, porCliente);
        }
        porCliente.set(cliente, (porCliente.get(cliente) ?? 0) + 1);
      }
    }

    // F7: diez completadas o más, y el 80 % de un solo cliente o todo de dos.
    const parejas: Vigilancia['parejas'] = [];
    for (const [agente, porCliente] of parejasPorAgente) {
      const completadas = [...porCliente.values()].reduce((x, y) => x + y, 0);
      if (completadas < 10) continue;
      const [principal, deEse] = [...porCliente.entries()].sort((x, y) => y[1] - x[1])[0]!;
      const parte = deEse / completadas;
      if (parte >= 0.8 || porCliente.size <= 2) {
        parejas.push({ agente, completadas, clientes: porCliente.size, principal, parte: Math.round(parte * 100) / 100 });
      }
    }
    // De ida y vuelta: A contrata a B y B contrata a A, tres veces o más cada
    // uno. Es la forma más barata de subir de nivel con carteras propias.
    const cruzados: Vigilancia['cruzados'] = [];
    for (const [a, porCliente] of parejasPorAgente) {
      for (const [b, bParaA] of porCliente) {
        if (a >= b) continue; // cada pareja una vez
        const aParaB = parejasPorAgente.get(b)?.get(a) ?? 0;
        if (aParaB >= 3 && bParaA >= 3) cruzados.push({ a, b, aParaB, bParaA });
      }
    }
    parejas.sort((x, y) => y.completadas - x.completadas);
    disputasLargas.sort((x, y) => y.dias - x.dias);
    return { repartosDistintos, disputasLargas, parejas, cruzados, generado: ahoraS };
  }

  /** Las ofertas en pie de un encargo, de la más barata a la más cara. */
  ofertasDe(jobId: string): OfertaIndexada[] {
    return [...(this.stats.ofertas.get(jobId)?.values() ?? [])].sort((x, y) =>
      BigInt(x.price) < BigInt(y.price) ? -1 : BigInt(x.price) > BigInt(y.price) ? 1 : x.ts - y.ts,
    );
  }

  /** Un agente en el tablón. Sin actividad, todo a cero. */
  agenteEnElTablon(agent: string): AgenteEnElTablon {
    const k = agent.toLowerCase();
    return {
      agent: k,
      categorias: this.categoriasDe(k),
      ...(this.stats.agentesTablon.get(k) ?? {
        faltas: 0,
        faltasEn90Dias: 0,
        suspendidoHasta: 0,
        asignados: 0,
        cerrados: 0,
        sancionados: 0,
      }),
    };
  }

  /** Lo que el tablón le debe a un cliente, por moneda; solo lo que no es cero. */
  porCobrarDe(client: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [moneda, v] of this.stats.porCobrar.get(client.toLowerCase()) ?? []) {
      if (v > 0n) out[moneda] = v.toString();
    }
    return out;
  }

  configTablon(): ConfigTablon {
    return structuredClone(this.stats.configTablon);
  }

  campanas(owner?: string): CampanaIndexada[] {
    const out: CampanaIndexada[] = [];
    for (const c of this.stats.campanas.values()) {
      if (owner && c.owner !== owner.toLowerCase()) continue;
      out.push({ key: c.key, campaignId: c.campaignId, owner: c.owner, jobs: c.jobs, cap: c.cap, tomados: Object.fromEntries(c.tomados) });
    }
    return out;
  }

  campana(key: string): CampanaIndexada | null {
    return this.campanas().find((c) => c.key === key.toLowerCase()) ?? null;
  }

  /** Las campañas cuyo tope aún no se ha leído del contrato. */
  campanasSinTope(): string[] {
    return [...this.stats.campanas.values()].filter((c) => c.cap === null).map((c) => c.key);
  }

  marcarTopeDeCampana(key: string, cap: number): void {
    const c = this.stats.campanas.get(key.toLowerCase());
    if (c) c.cap = cap;
  }

  /**
   * Las cifras del tablón entre `desde` (incluido) y `hasta` (excluido), en
   * segundos: lo que la foto del mes guarda (BOARD.md §10.1).
   */
  metricasTablon(desde: number, hasta: number): MetricasTablon {
    const en = (ts: number | undefined): boolean => ts !== undefined && ts >= desde && ts < hasta;
    const jobs = [...this.stats.jobs.values()];
    const publicados = jobs.filter((j) => en(j.postedTs));
    const asignados = jobs.filter((j) => en(j.assignedTs));

    const publicadoPorMoneda: Record<string, bigint> = {};
    for (const j of publicados) publicadoPorMoneda[j.coin] = (publicadoPorMoneda[j.coin] ?? 0n) + BigInt(j.budget);

    const espera = (modo: IndexedJob['mode']) =>
      mediana(asignados.filter((j) => j.mode === modo).map((j) => j.assignedTs! - j.postedTs));
    const seleccion = asignados.filter((j) => j.mode === 'selection');
    const seleccionPublicados = publicados.filter((j) => j.mode === 'selection');

    let noLaMasBarata = 0;
    for (const j of seleccion) {
      if (j.byClient && j.cheapestAtAssignment !== undefined && BigInt(j.amount) > BigInt(j.cheapestAtAssignment)) noLaMasBarata++;
    }

    let completados = 0;
    let cancelados = 0;
    let disputas = 0;
    for (const j of asignados) {
      const t = j.escrowTaskId ? this.stats.tasks.get(j.escrowTaskId) : undefined;
      if (!t) continue;
      if (t.status === 'completed') completados++;
      if (t.status === 'cancelled') cancelados++;
      if (t.disputedTs !== undefined) disputas++;
    }
    const devuelto: Record<string, bigint> = {};
    for (const c of this.stats.cierres) {
      if (en(c.ts) && c.refund > 0n) devuelto[c.coin] = (devuelto[c.coin] ?? 0n) + c.refund;
    }

    const faltas = this.stats.faltas.filter((f) => en(f.ts));
    const larga = (f: { ts: number; suspendidoHasta: number }) => f.suspendidoHasta - f.ts >= 29 * 86_400;
    const corta = (f: { ts: number; suspendidoHasta: number }) => !larga(f) && f.suspendidoHasta - f.ts >= 6 * 86_400;

    const categorias = new Map<number, IndexedJob[]>();
    for (const j of publicados) categorias.set(j.category, [...(categorias.get(j.category) ?? []), j]);

    const aTexto = (r: Record<string, bigint>) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v.toString()]));
    return {
      desde,
      hasta,
      volumen: {
        publicados: publicados.length,
        asignados: asignados.length,
        retirados: jobs.filter((j) => j.state === 'withdrawn' && en(j.closedTs)).length,
        caducados: jobs.filter((j) => j.state === 'expired' && en(j.closedTs)).length,
        republicados: this.stats.republicaciones.filter(en).length,
        publicadoPorMoneda: aTexto(publicadoPorMoneda),
      },
      rapidez: { inmediato: espera('immediate'), seleccion: espera('selection') },
      competencia: {
        medianaOfertas: mediana(seleccion.map((j) => j.offersAtAssignment ?? 0)),
        sinOfertaParte:
          seleccionPublicados.length === 0
            ? null
            : Math.round((seleccionPublicados.filter((j) => !j.everOffered).length / seleccionPublicados.length) * 100) / 100,
        medianaPrecioSobrePresupuesto: mediana(
          seleccion.filter((j) => BigInt(j.budget) > 0n).map((j) => Number((BigInt(j.amount) * 1000n) / BigInt(j.budget)) / 1000),
        ),
      },
      eleccion: {
        porElCliente: asignados.filter((j) => j.byClient).length,
        automatica: asignados.filter((j) => !j.byClient).length,
        noLaMasBarata,
      },
      entrega: { completados, cancelados, disputas, devueltoPorMoneda: aTexto(devuelto) },
      sanciones: {
        faltas: faltas.length,
        suspensiones7: faltas.filter(corta).length,
        suspensiones30: faltas.filter(larga).length,
        agentes: new Set(faltas.map((f) => f.agent)).size,
      },
      agentes: [...new Set(asignados.map((j) => j.agent!).filter(Boolean))],
      porCategoria: [...categorias.entries()]
        .sort((x, y) => x[0] - y[0])
        .map(([categoria, js]) => {
          const porMoneda = new Map<string, bigint[]>();
          for (const j of js) porMoneda.set(j.coin, [...(porMoneda.get(j.coin) ?? []), BigInt(j.budget)]);
          return {
            categoria,
            encargos: js.length,
            sinOferta: js.filter((j) => j.mode === 'selection' && !j.everOffered).length,
            medianaPorMoneda: Object.fromEntries([...porMoneda.entries()].map(([k, v]) => [k, medianaBig(v).toString()])),
          };
        }),
    };
  }
}
