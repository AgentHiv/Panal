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
}

const EMPTY_STATE: IndexerState = {
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
  /** Precio por tarea en unidades mínimas (string: no cabe en un number). */
  pricePerTask: string;
  currency: string;
  coin: string;
  active: boolean;
  registeredAt: number;
  /** Cuándo se leyó del registry, para saber si toca refrescarla. */
  fetchedTs: number;
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
  readonly agents = new Map<string, AgentStats & { ratingSum: number }>();
  readonly days = new Map<string, DayStats & { mon: bigint; panal: bigint; agents: Set<string> }>();
  readonly byType: Record<string, number> = {};
  /** taskId -> currency address (para atribuir volúmenes de TaskCompleted). */
  private readonly taskCurrency = new Map<string, string>();
  /** taskId -> tarea montada. El orden de inserción es el de creación. */
  readonly tasks = new Map<string, IndexedTask>();
  /**
   * Índice inverso: dirección -> taskIds en los que participa, como cliente o
   * como trabajador. Es lo que hace que buscar «mis tareas» sea instantáneo en
   * vez de recorrerlas todas.
   */
  readonly tasksByAddress = new Map<string, Set<string>>();
  total = 0;

  constructor(private readonly panalToken: string) {}

  private agent(address: string, ts: number): AgentStats & { ratingSum: number } {
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
          t.status = 'disputed';
          t.updatedTs = ev.ts;
        }
        break;
      }
      case 'TaskCancelled': {
        const t = a['taskId'] !== undefined ? this.task(String(a['taskId'])) : undefined;
        if (t) {
          t.status = 'cancelled';
          t.updatedTs = ev.ts;
        }
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
      .map(({ ratingSum: _ratingSum, ...rest }) => rest)
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

  constructor(dir: string, panalToken: string) {
    this.dir = resolve(dir);
    mkdirSync(this.dir, { recursive: true });
    this.eventsFile = join(this.dir, 'events.jsonl');
    this.stateFile = join(this.dir, 'state.json');
    this.stats = new StatsBuilder(panalToken);
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
    this.profiles.set(profile.address.toLowerCase(), profile);
    this.sucios.delete(profile.address.toLowerCase());
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
  } = {}): { agents: (AgentProfile & { stats: AgentStats | null })[]; total: number } {
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
      agents: lista.slice(offset, offset + limit).map((a) => ({ ...a, stats: stats.get(a.address) ?? null })),
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
      if (opts.role === 'client' && t.client !== yo) continue;
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
}
