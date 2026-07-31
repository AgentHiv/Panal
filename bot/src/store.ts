/**
 * Panal Bot — estado persistente en disco (JSON).
 *
 * Guarda:
 *   - lastTaskCount: último getTaskCount() conocido (para detectar tareas nuevas)
 *   - taskStatuses:  status conocido por taskId (para detectar transiciones,
 *                    p. ej. Delivered -> Completed = "pago liberado")
 *   - briefs:        texto del pedido por taskId. El brief NO está on-chain
 *                    (solo su keccak256); el dueño lo carga por Telegram con
 *                    `/brief #N <texto>` cuando el cliente se lo pasa.
 *   - telegramOffset: offset de getUpdates para no reprocesar comandos.
 *
 * Los resultados del modo worker se guardan como Markdown en
 * `<STORE_DIR>/results/<taskId>.md`.
 *
 * Escritura ATÓMICA: se escribe a `<file>.tmp` y luego rename(), así un
 * corte de luz a mitad de escritura nunca deja el JSON corrupto.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Sub-tarea A2A persistida (modo worker con A2A_ENABLED=true): una parte de
 * la tarea padre subcontratada a otro agente del registry. Los bigint se
 * guardan como string. Clave del mapa: parentTaskId.
 */
export interface A2aSubTaskRecord {
  parentTaskId: string;
  childTaskId: string;
  childWorker: string;
  skill: string;
  /** Precio pagado al subcontratista, en wei (string). */
  amount: string;
  /** Moneda de la sub-tarea (address; address(0) = MON nativo). */
  currency: string;
  /** Epoch seconds de creación de la sub-tarea. */
  createdAt: number;
  /** Deadline (epoch seconds) de la sub-tarea. */
  deadline: number;
  /**
   * open      → creada, esperando entrega del hijo
   * delivered → hijo entregó; evaluada/aprobada (o pendiente de aprobación)
   * completed → hijo Completed y resultado integrado al padre (final)
   * rejected  → rating < A2A_MIN_RATING: no se aprobó (auto-release 72 h) (final)
   * timeout   → hijo no entregó antes de su deadline: cancelada (final)
   * cancelled → hijo cancelado on-chain (final)
   */
  state: 'open' | 'delivered' | 'completed' | 'rejected' | 'timeout' | 'cancelled';
  /** Resultado del hijo (texto) si se obtuvo de su endpoint /result. */
  childResult?: string;
  /** Rating 1-5 que el LLM asignó al resultado del hijo. */
  rating?: number;
  /** Nota libre (p. ej. por qué se rechazó o limitaciones de la evaluación). */
  note?: string;
  /** true cuando el padre ya fue entregado (con o sin la parte del hijo). */
  parentDelivered?: boolean;
}

export interface StoreState {
  lastTaskCount: number | null;
  taskStatuses: Record<string, number>;
  briefs: Record<string, string>;
  telegramOffset: number;
  a2aSubTasks: Record<string, A2aSubTaskRecord>;
  /** Día UTC (YYYY-MM-DD) del contador de gasto A2A. */
  a2aSpendDay: string | null;
  /** Gasto A2A acumulado en a2aSpendDay, en wei (string). */
  a2aSpendWei: string;
}

const EMPTY_STATE: StoreState = {
  lastTaskCount: null,
  taskStatuses: {},
  briefs: {},
  telegramOffset: 0,
  a2aSubTasks: {},
  a2aSpendDay: null,
  a2aSpendWei: '0',
};

export class Store {
  readonly dir: string;
  readonly resultsDir: string;
  private readonly stateFile: string;
  private state: StoreState;

  constructor(dir: string) {
    this.dir = resolve(dir);
    this.resultsDir = join(this.dir, 'results');
    mkdirSync(this.resultsDir, { recursive: true });
    this.stateFile = join(this.dir, 'state.json');
    this.state = this.load();
  }

  private load(): StoreState {
    if (!existsSync(this.stateFile)) return structuredClone(EMPTY_STATE);
    try {
      const parsed = JSON.parse(readFileSync(this.stateFile, 'utf8')) as Partial<StoreState>;
      return {
        lastTaskCount: typeof parsed.lastTaskCount === 'number' ? parsed.lastTaskCount : null,
        taskStatuses: parsed.taskStatuses ?? {},
        briefs: parsed.briefs ?? {},
        telegramOffset: typeof parsed.telegramOffset === 'number' ? parsed.telegramOffset : 0,
        a2aSubTasks: parsed.a2aSubTasks ?? {},
        a2aSpendDay: typeof parsed.a2aSpendDay === 'string' ? parsed.a2aSpendDay : null,
        a2aSpendWei: typeof parsed.a2aSpendWei === 'string' ? parsed.a2aSpendWei : '0',
      };
    } catch (err) {
      // JSON corrupto (no debería pasar con escrituras atómicas): no perdemos
      // el archivo, lo dejamos para inspección manual y arrancamos de cero.
      console.warn(`[store] state.json corrupto, se reinicia el estado: ${String(err)}`);
      return structuredClone(EMPTY_STATE);
    }
  }

  /** Persiste el estado actual de forma atómica (tmp + rename). */
  save(): void {
    const tmp = `${this.stateFile}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.state, null, 2), 'utf8');
    renameSync(tmp, this.stateFile);
  }

  // ---- lastTaskCount ------------------------------------------------------

  get lastTaskCount(): number | null {
    return this.state.lastTaskCount;
  }

  setLastTaskCount(n: number): void {
    this.state.lastTaskCount = n;
    this.save();
  }

  // ---- statuses por tarea --------------------------------------------------

  getTaskStatus(taskId: bigint): number | undefined {
    return this.state.taskStatuses[taskId.toString()];
  }

  setTaskStatus(taskId: bigint, status: number): void {
    this.state.taskStatuses[taskId.toString()] = status;
  }

  /** Ids de tareas cuyo último status conocido es uno de los dados. */
  taskIdsWithStatus(statuses: number[]): bigint[] {
    return Object.entries(this.state.taskStatuses)
      .filter(([, s]) => statuses.includes(s))
      .map(([id]) => BigInt(id))
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  }

  // ---- briefs ---------------------------------------------------------------

  getBrief(taskId: bigint): string | undefined {
    return this.state.briefs[taskId.toString()];
  }

  setBrief(taskId: bigint, text: string): void {
    this.state.briefs[taskId.toString()] = text;
    this.save();
  }

  /** Briefs cargados que aún no tienen tarea procesada (informativo). */
  briefCount(): number {
    return Object.keys(this.state.briefs).length;
  }

  // ---- telegram offset -------------------------------------------------------

  get telegramOffset(): number {
    return this.state.telegramOffset;
  }

  setTelegramOffset(offset: number): void {
    this.state.telegramOffset = offset;
    // no save() en caliente aquí: getUpdates llega a ráfagas; el loop guarda.
  }

  // ---- A2A: sub-tareas (modo worker con A2A_ENABLED) --------------------------

  getSubTask(parentTaskId: bigint): A2aSubTaskRecord | undefined {
    return this.state.a2aSubTasks[parentTaskId.toString()];
  }

  setSubTask(record: A2aSubTaskRecord): void {
    this.state.a2aSubTasks[record.parentTaskId] = record;
    this.save();
  }

  /** Todas las sub-tareas registradas (ordenadas por padre). */
  listSubTasks(): A2aSubTaskRecord[] {
    return Object.values(this.state.a2aSubTasks).sort((a, b) =>
      a.parentTaskId < b.parentTaskId ? -1 : a.parentTaskId > b.parentTaskId ? 1 : 0,
    );
  }

  /** Sub-tareas aún no finalizadas (las vigila el loop del worker). */
  listPendingSubTasks(): A2aSubTaskRecord[] {
    const finals = new Set(['completed', 'rejected', 'timeout', 'cancelled']);
    return this.listSubTasks().filter((r) => !finals.has(r.state) || !r.parentDelivered);
  }

  // ---- A2A: presupuesto diario (día UTC) ---------------------------------------

  /** Gasto A2A del día UTC actual, en wei. */
  getA2aDailySpend(nowS = Math.floor(Date.now() / 1000)): bigint {
    const today = new Date(nowS * 1000).toISOString().slice(0, 10);
    if (this.state.a2aSpendDay !== today) return 0n;
    try {
      return BigInt(this.state.a2aSpendWei);
    } catch {
      return 0n;
    }
  }

  /** Suma un gasto al contador del día UTC actual (resetea al cambiar de día). */
  addA2aDailySpend(amountWei: bigint, nowS = Math.floor(Date.now() / 1000)): void {
    const today = new Date(nowS * 1000).toISOString().slice(0, 10);
    const current = this.getA2aDailySpend(nowS);
    this.state.a2aSpendDay = today;
    this.state.a2aSpendWei = (current + amountWei).toString();
    this.save();
  }

  // ---- resultados (modo worker) ----------------------------------------------

  /** Guarda el resultado entregado como Markdown. Devuelve la ruta del archivo. */
  saveResult(taskId: bigint, resultText: string): string {
    const file = join(this.resultsDir, `${taskId.toString()}.md`);
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, resultText, 'utf8');
    renameSync(tmp, file);
    return file;
  }

  /** Lee un resultado guardado (null si no existe). */
  getResult(taskId: bigint): string | null {
    try {
      const file = join(this.resultsDir, `${taskId.toString()}.md`);
      return readFileSync(file, 'utf8');
    } catch {
      return null;
    }
  }
}
