/**
 * Panal Bot — MODO 2: WORKER (agente autónomo).
 *
 * Por cada tarea Open asignada a AGENT_ADDRESS:
 *   1. Recupera el brief guardado por el dueño (`/brief #N …` en Telegram) o,
 *      si no existe, usa un brief genérico documentado (ver GENERIC_BRIEF).
 *   2. Genera el resultado con el LLM configurado (llm.ts).
 *   3. Entrega on-chain: deliverResult(taskId, keccak256(resultText)) firmado
 *      con BOT_PRIVATE_KEY (la wallet DEDICADA del agente; ver README >
 *      Seguridad). El resultado completo NO va on-chain, solo su hash.
 *   4. Guarda el resultado en <STORE_DIR>/results/<taskId>.md.
 *   5. Avisa por Telegram.
 *
 * Con AUTO_WITHDRAW=true, cuando una tarea pasa a Completed retira los
 * saldos pull-payment (MON y $PANAL) con withdraw(token).
 */

import { keccak256, toBytes } from 'viem';
import type { BotConfig } from './config.js';
import {
  TaskStatus,
  deliverResult,
  formatAmount,
  getPendingWithdrawal,
  politePause,
  withdraw,
  NATIVE_CURRENCY,
  type ChainClients,
  type Task,
} from './chain.js';
import { generateResult } from './llm.js';
import {
  buildStatusSummary,
  newTaskMessage,
  pollOnce,
  transitionMessage,
  type NewTaskHandler,
  type StopSignal,
  type TransitionHandler,
} from './notifier.js';
import type { Store } from './store.js';
import type { Telegram } from './telegram.js';

/**
 * Brief genérico cuando el dueño no cargó el pedido real. El brief del
 * cliente NO está on-chain (solo su keccak256), así que sin intervención
 * humana el bot no puede conocerlo: esto está documentado en el README y
 * en el mensaje de alerta de tarea nueva.
 */
const GENERIC_BRIEF = (taskId: bigint, taskHash: string) =>
  `Eres un agente autónomo del marketplace Panal. Se te ha asignado la tarea #${taskId} ` +
  `(hash del pedido on-chain: ${taskHash}), pero el texto del pedido no está disponible: ` +
  `el cliente solo publicó su hash. Genera una respuesta útil, profesional y completa ` +
  `dentro de tus capacidades descritas en el system prompt, indicando al final que, ` +
  `si el pedido era más específico, el cliente puede abrir una disputa o contactar al agente.`;

/** Reintento de entregas fallidas: no reintentar antes de este intervalo. */
const RETRY_FAILED_AFTER_MS = 10 * 60 * 1000;

export async function runWorker(
  cfg: BotConfig,
  clients: ChainClients,
  store: Store,
  telegram: Telegram,
  stop: StopSignal,
): Promise<void> {
  console.log(
    `[worker] Agente autónomo ${cfg.agentAddress} | LLM: ${cfg.llm.model} @ ${cfg.llm.baseUrl} | ` +
      `AUTO_WITHDRAW=${cfg.autoWithdraw} | DRY_RUN=${cfg.dryRun}`,
  );

  // Tareas cuya entrega falló recientemente (en memoria: se reintentan tras
  // 10 min o tras reiniciar el bot).
  const failedAt = new Map<string, number>();
  // Entregas en curso, para no duplicar trabajo si el poll se solapa.
  const inFlight = new Set<string>();

  const processTask = async (taskId: bigint, task: Task): Promise<void> => {
    const key = taskId.toString();
    if (inFlight.has(key)) return;
    const lastFail = failedAt.get(key);
    if (lastFail && Date.now() - lastFail < RETRY_FAILED_AFTER_MS) return;
    inFlight.add(key);
    try {
      const brief = store.getBrief(taskId);
      const briefText = brief ?? GENERIC_BRIEF(taskId, task.taskHash);
      if (!brief) {
        console.log(`[worker] Tarea #${taskId} sin brief cargado: se usa el brief genérico.`);
      }

      if (cfg.dryRun) {
        console.log(
          `[worker:dry-run] Simularía entrega de #${taskId}: brief=${brief ? 'del store' : 'genérico'}, ` +
            `LLM=${cfg.llm.model}, deliverResult(${taskId}, keccak256(resultado))`,
        );
        return;
      }

      console.log(`[worker] Generando resultado para #${taskId}…`);
      const resultText = await generateResult(cfg, briefText);
      const resultHash = keccak256(toBytes(resultText));

      const resultFile = store.saveResult(taskId, resultText);
      console.log(`[worker] Resultado de #${taskId} guardado en ${resultFile}`);

      const txHash = await deliverResult(clients, cfg, taskId, resultHash);
      console.log(`[worker] #${taskId} entregada on-chain. tx: ${txHash}`);

      await telegram.send(
        `✅ *Entregada #${taskId}* (resultado guardado en \`results/${taskId}.md\`).\n` +
          `Pendiente de aprobación del cliente o auto-release en 72 h.\n` +
          `tx: \`${txHash}\``,
      );
      failedAt.delete(key);
    } catch (err) {
      failedAt.set(key, Date.now());
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[worker] Falló la entrega de #${taskId}: ${msg}`);
      await telegram.send(
        `🚨 *Falló la entrega de #${taskId}*: ${msg.slice(0, 400)}\nSe reintentará automáticamente en ~10 min.`,
      );
    } finally {
      inFlight.delete(key);
    }
  };

  const onNewTask: NewTaskHandler = async (taskId, task) => {
    if (task.status !== TaskStatus.Open) return;
    await telegram.send(newTaskMessage(cfg, taskId, task));
    await processTask(taskId, task);
  };

  const onTransition: TransitionHandler = async (taskId, _from, to, task) => {
    const msg = transitionMessage(cfg, taskId, to, task);
    if (msg) await telegram.send(msg);
    if (to === TaskStatus.Completed && cfg.autoWithdraw) {
      await autoWithdraw(cfg, clients, telegram);
    }
  };

  const commandsLoop = telegram.pollCommands({ getStatus: () => buildStatusSummary(cfg, clients, store) }, store, stop);

  while (!stop.stopped) {
    try {
      await pollOnce(cfg, clients, store, onNewTask, onTransition);
    } catch (err) {
      console.error(`[worker] Ciclo fallido: ${err instanceof Error ? err.message : err}`);
    }
    await sleep(cfg.pollIntervalMs);
  }

  await commandsLoop.catch(() => undefined);
}

/**
 * Retira los saldos pendientes (MON nativo y $PANAL) de la wallet del agente.
 * withdraw() paga a msg.sender, que es la wallet dedicada del bot.
 */
async function autoWithdraw(cfg: BotConfig, clients: ChainClients, telegram: Telegram): Promise<void> {
  const account = clients.botAddress;
  if (!account || !clients.walletClient) {
    console.warn('[worker] AUTO_WITHDRAW activo pero no hay wallet del bot configurada.');
    return;
  }
  const tokens: Array<{ token: `0x${string}`; symbol: string }> = [
    { token: NATIVE_CURRENCY, symbol: 'MON' },
    { token: cfg.panalTokenAddress, symbol: '$PANAL' },
  ];
  for (const { token, symbol } of tokens) {
    try {
      const pending = await getPendingWithdrawal(clients, cfg, token, account);
      await politePause();
      if (pending === 0n) continue;
      console.log(`[worker] Retirando ${formatAmount(pending)} ${symbol}…`);
      const txHash = await withdraw(clients, cfg, token);
      await telegram.send(`🏧 *Retirados ${formatAmount(pending)} ${symbol}* a la wallet del agente.\ntx: \`${txHash}\``);
    } catch (err) {
      console.error(`[worker] withdraw(${symbol}) falló: ${err instanceof Error ? err.message : err}`);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
