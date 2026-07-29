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

export interface StoreState {
  lastTaskCount: number | null;
  taskStatuses: Record<string, number>;
  briefs: Record<string, string>;
  telegramOffset: number;
}

const EMPTY_STATE: StoreState = {
  lastTaskCount: null,
  taskStatuses: {},
  briefs: {},
  telegramOffset: 0,
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

  // ---- resultados (modo worker) ----------------------------------------------

  /** Guarda el resultado entregado como Markdown. Devuelve la ruta del archivo. */
  saveResult(taskId: bigint, resultText: string): string {
    const file = join(this.resultsDir, `${taskId.toString()}.md`);
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, resultText, 'utf8');
    renameSync(tmp, file);
    return file;
  }
}
