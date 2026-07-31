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
        break;
      }
      case 'TaskClaimed': {
        const ag = this.agent(String(a['worker']), ev.ts);
        d.agents.add(ag.address);
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
        break;
      }
      case 'DisputeResolved': {
        // No trae worker; el rating cuenta para el historial global por task.
        if (a['workerPaid'] !== undefined && a['taskId'] !== undefined) {
          const currency = this.taskCurrency.get(String(a['taskId']));
          this.move(d, coinOf(currency, this.panalToken), String(a['workerPaid']));
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
    for (const ev of fresh) this.stats.add(ev);
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

  dailyStats(days: number): DayStats[] {
    return this.stats.dailySeries(days);
  }
}
