/**
 * Panal Bot — MODO 1: NOTIFIER.
 *
 * Vigila el escrow v2 y avisa al dueño del agente por Telegram:
 *   - Tarea nueva asignada a su agente (con monto, cliente, hash y deadline).
 *   - Cambios de estado relevantes (entregada, completada = pago liberado,
 *     disputa, cancelación).
 *   - Comandos: /brief, /status, /start (ver telegram.ts).
 *
 * Detección por polling de getTaskCount() (1 llamada por ciclo): evita
 * eth_getLogs, que el RPC público limita a rangos de ~100 bloques.
 */

import type { BotConfig } from './config.js';
import { lines, t } from './i18n.js';
import {
  TaskStatus,
  TASK_STATUS_LABEL,
  currencySymbol,
  formatAmount,
  getPendingWithdrawal,
  getTask,
  getTaskCount,
  politePause,
  scanAgentTasks,
  shortAddress,
  NATIVE_CURRENCY,
  type ChainClients,
  type Task,
} from './chain.js';
import type { Store } from './store.js';
import type { Telegram } from './telegram.js';

/** Lecturas extra de tareas pendientes por ciclo (acota el gasto de RPC). */
const WATCHLIST_PER_CYCLE = 10;
/**
 * Cursor de la ventana rotativa de la watchlist. Vive en el módulo porque el
 * bucle es único por proceso; se reinicia al arrancar, que es lo deseable.
 */
let watchCursor = 0;

export interface StopSignal {
  stopped: boolean;
}

/** Hook para reaccionar ante tareas nuevas (el worker lo usa para trabajarlas). */
export type NewTaskHandler = (taskId: bigint, task: Task) => Promise<void>;
/**
 * Hook para tareas propias que siguen pendientes y NO cambiaron de estado.
 *
 * Existe porque `onNewTask` solo se dispara una vez por tarea (baseline de
 * arranque o ids nuevos). Si esa única oportunidad falla —timeout del LLM, RPC
 * caído, gas— nadie volvía a intentarlo nunca: la tarea se quedaba Open para
 * siempre y el aviso de Telegram prometía un reintento que no llegaba. El
 * worker engancha aquí su reintento, reaprovechando la lectura que la
 * watchlist ya hace cada ciclo (cero llamadas RPC extra).
 */
export type PendingTaskHandler = (taskId: bigint, task: Task) => Promise<void>;
/** Hook para transiciones de estado (el worker lo usa para AUTO_WITHDRAW). */
export type TransitionHandler = (
  taskId: bigint,
  from: TaskStatus,
  to: TaskStatus,
  task: Task,
) => Promise<void>;

/** Mensaje de alerta de tarea nueva para el dueño. */
export function newTaskMessage(cfg: BotConfig, taskId: bigint, task: Task): string {
  const symbol = currencySymbol(task.currency, cfg);
  // La fecha se formatea en el idioma del operador. Antes iba fija en es-ES,
  // así que un operador con el bot en chino recibía "12/8/2026, 14:30:00".
  const deadline = new Date(Number(task.deadline) * 1000).toLocaleString(cfg.lang, {
    timeZone: 'UTC',
    dateStyle: 'short',
    timeStyle: 'short',
  });
  const id = taskId.toString();
  // Línea en blanco entre bloques: el aviso se lee de un vistazo en el móvil,
  // que es donde se lee de verdad.
  return lines(
    t(cfg.lang, 'task.new.title', { id }),
    '',
    t(cfg.lang, 'task.new.amount', { amount: formatAmount(task.amount), symbol }),
    t(cfg.lang, 'task.new.client', { client: shortAddress(task.client) }),
    t(cfg.lang, 'task.new.hash', { hash: task.taskHash }),
    t(cfg.lang, 'task.new.deadline', { deadline }),
    '',
    t(cfg.lang, 'task.new.hint', { id }),
    '',
    t(cfg.lang, 'status.panel', { dashboard: cfg.dashboardUrl }),
  );
}

/** Mensaje para una transición de estado detectada (compartido con el worker). */
export function transitionMessage(cfg: BotConfig, taskId: bigint, to: TaskStatus, task: Task): string | null {
  const symbol = currencySymbol(task.currency, cfg);
  const amount = `${formatAmount(task.amount)} ${symbol}`;
  const vars = { id: taskId.toString(), amount, dashboard: cfg.dashboardUrl };
  switch (to) {
    case TaskStatus.Completed:
      return t(cfg.lang, 'task.completed', vars);
    case TaskStatus.Delivered:
      return t(cfg.lang, 'task.delivered', vars);
    case TaskStatus.Disputed:
      return t(cfg.lang, 'task.disputed', vars);
    case TaskStatus.Cancelled:
      return t(cfg.lang, 'task.cancelled', vars);
    default:
      return null;
  }
}

/**
 * Núcleo de detección compartido por notifier y worker:
 *   1. getTaskCount() → tareas nuevas por rango (1 call + 1 por tarea nueva).
 *   2. Re-chequeo de tareas propias no finalizadas → transiciones de estado.
 *
 * Devuelve el nuevo taskCount procesado (o null si el ciclo falló).
 */
export async function pollOnce(
  cfg: BotConfig,
  clients: ChainClients,
  store: Store,
  onNewTask: NewTaskHandler,
  onTransition: TransitionHandler,
  onPendingTask?: PendingTaskHandler,
): Promise<number | null> {
  const count = Number(await getTaskCount(clients, cfg));
  const last = store.lastTaskCount;

  if (last === null) {
    // Primer arranque: baseline acotada por MAX_INITIAL_SCAN para no
    // martillear el RPC si el escrow ya tiene muchas tareas.
    const from = Math.max(0, count - cfg.maxInitialScan);
    console.log(`[poll] Primer arranque: baseline de tareas ${from}..${Math.max(0, count - 1)} (total on-chain: ${count})`);
    if (count > 0) {
      const mine = await scanAgentTasks(clients, cfg, BigInt(from), BigInt(count - 1));
      for (const [id, task] of mine) {
        store.setTaskStatus(id, task.status);
        if (task.status === TaskStatus.Open) {
          await onNewTask(id, task);
        }
      }
      console.log(`[poll] Baseline: ${mine.size} tarea(s) asignada(s) a tu agente.`);
    }
    store.setLastTaskCount(count);
    return count;
  }

  if (count > last) {
    console.log(`[poll] ${count - last} tarea(s) nueva(s) on-chain (${last} -> ${count})`);
    for (let id = last; id < count; id++) {
      try {
        const task = await getTask(clients, cfg, BigInt(id));
        if (task.worker.toLowerCase() === cfg.agentAddress.toLowerCase()) {
          store.setTaskStatus(BigInt(id), task.status);
          store.save();
          await onNewTask(BigInt(id), task);
        }
      } catch (err) {
        console.warn(`[poll] Error procesando tarea #${id}: ${err instanceof Error ? err.message : err}`);
      }
      await politePause();
    }
    store.setLastTaskCount(count);
  }

  // Re-chequeo de transiciones: solo tareas propias en estados no finales
  // (Open/Delivered/Disputed). Son pocas: 1 call cada una, acotado por ciclo.
  // Ventana ROTATIVA de 10: con `.slice(0, 10)` fijo, si había más de diez
  // tareas pendientes las de la cola nunca se releían —ni transiciones, ni
  // reintentos— porque el corte caía siempre en el mismo sitio. El cursor
  // avanza cada ciclo, así que todas entran por turno.
  const pending = store
    .taskIdsWithStatus([TaskStatus.Open, TaskStatus.Delivered, TaskStatus.Disputed])
    .filter((id) => id < BigInt(count));
  const watchlist: bigint[] = [];
  if (pending.length > 0) {
    const window = Math.min(WATCHLIST_PER_CYCLE, pending.length);
    for (let i = 0; i < window; i++) {
      watchlist.push(pending[(watchCursor + i) % pending.length]!);
    }
    watchCursor = (watchCursor + window) % pending.length;
  }
  for (const id of watchlist) {
    try {
      const task = await getTask(clients, cfg, id);
      const prev = store.getTaskStatus(id);
      if (prev !== undefined && prev !== task.status) {
        store.setTaskStatus(id, task.status);
        store.save();
        console.log(`[poll] Tarea #${id}: ${TASK_STATUS_LABEL[prev as TaskStatus] ?? prev} -> ${TASK_STATUS_LABEL[task.status]}`);
        await onTransition(id, prev as TaskStatus, task.status, task);
      } else if (
        task.status === TaskStatus.Open &&
        onPendingTask &&
        task.worker.toLowerCase() === cfg.agentAddress.toLowerCase()
      ) {
        // Sigue Open y sin cambios: es la ocasión de reintentar si el primer
        // intento falló. El handler decide si toca (ver RETRY_FAILED_AFTER_MS).
        await onPendingTask(id, task);
      }
    } catch (err) {
      console.warn(`[poll] Error re-leyendo tarea #${id}: ${err instanceof Error ? err.message : err}`);
    }
    await politePause();
  }

  return count;
}

/** Resumen para el comando /status (compartido por ambos modos). */
export async function buildStatusSummary(
  cfg: BotConfig,
  clients: ChainClients,
  store: Store,
): Promise<string> {
  const open = store.taskIdsWithStatus([TaskStatus.Open]);
  const delivered = store.taskIdsWithStatus([TaskStatus.Delivered]);
  const completed = store.taskIdsWithStatus([TaskStatus.Completed]);
  const disputed = store.taskIdsWithStatus([TaskStatus.Disputed]);

  // Pagos pendientes de retirar (los cobra task.worker = AGENT_ADDRESS).
  let pendingMon = 0n;
  let pendingPanal = 0n;
  try {
    pendingMon = await getPendingWithdrawal(clients, cfg, NATIVE_CURRENCY, cfg.agentAddress);
    await politePause();
    pendingPanal = await getPendingWithdrawal(clients, cfg, cfg.panalTokenAddress, cfg.agentAddress);
  } catch (err) {
    console.warn(`[status] No se pudo leer pendingWithdrawals: ${err instanceof Error ? err.message : err}`);
  }

  const fmtIds = (ids: bigint[]) => (ids.length ? ids.map((i) => `#${i}`).join(', ') : '—');
  const lang = cfg.lang;
  return lines(
    t(lang, 'status.title'),
    '',
    t(lang, 'status.open', { count: open.length, ids: fmtIds(open) }),
    t(lang, 'status.delivered', { count: delivered.length, ids: fmtIds(delivered) }),
    t(lang, 'status.disputed', { count: disputed.length, ids: fmtIds(disputed) }),
    t(lang, 'status.completed', { count: completed.length }),
    t(lang, 'status.briefs', { count: store.briefCount() }),
    '',
    t(lang, 'status.pending', { mon: formatAmount(pendingMon), panal: formatAmount(pendingPanal) }),
    t(lang, 'status.panel', { dashboard: cfg.dashboardUrl })
  );
}

/** Arranca el modo notifier (loop on-chain + loop de comandos en paralelo). */
export async function runNotifier(
  cfg: BotConfig,
  clients: ChainClients,
  store: Store,
  telegram: Telegram,
  stop: StopSignal,
): Promise<void> {
  console.log(`[notifier] Vigilando tareas del agente ${cfg.agentAddress} cada ${cfg.pollIntervalMs / 1000}s`);

  const onNewTask: NewTaskHandler = async (taskId, task) => {
    if (task.status !== TaskStatus.Open) return; // baseline: no alertar históricas cerradas
    await telegram.send(newTaskMessage(cfg, taskId, task));
  };
  const onTransition: TransitionHandler = async (taskId, _from, to, task) => {
    const msg = transitionMessage(cfg, taskId, to, task);
    if (msg) await telegram.send(msg);
  };

  // Loop de comandos Telegram en paralelo (no bloquea el loop on-chain).
  // Publica el menu de comandos antes de escuchar: existian pero eran
  // invisibles, habia que saberselos de memoria.
  await telegram.publishCommands();

  const commandsLoop = telegram.pollCommands({ getStatus: () => buildStatusSummary(cfg, clients, store) }, store, stop);

  while (!stop.stopped) {
    try {
      await pollOnce(cfg, clients, store, onNewTask, onTransition);
    } catch (err) {
      // pollOnce ya reintenta internamente (withRetry); si llega aquí es un
      // fallo persistente del RPC: esperamos un ciclo y seguimos.
      console.error(`[notifier] Ciclo fallido: ${err instanceof Error ? err.message : err}`);
    }
    await sleep(cfg.pollIntervalMs);
  }

  await commandsLoop.catch(() => undefined);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
