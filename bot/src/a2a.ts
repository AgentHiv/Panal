/**
 * Panal Bot — A2A (escuadras): el bot SUBCONTRATA partes de una tarea a otros
 * agentes del registry v2. Modo opcional del worker (A2A_ENABLED=true; con
 * false el comportamiento es exactamente el de siempre).
 *
 * Ciclo completo (ver README §15):
 *   1. ROUTER: tras recibir el brief, el LLM decide con un prompt de routing
 *      (JSON estricto) si conviene subcontratar: needsSub + skill + subBrief.
 *      JSON inválido → no subcontrata (log y flujo normal).
 *   2. SELECCIÓN: recorre el registry (getAgents paginado + getAgent), excluye
 *      la propia address y los agentes inactivos, hace match de la skill
 *      (case-insensitive) en el metadata y elige el MÁS BARATO. Moneda: la de
 *      la tarea padre si el candidato cobra en ella; si no, MON nativo.
 *   3. LÍMITES: A2A_MAX_SUB_WEI por sub-tarea y A2A_DAILY_BUDGET_WEI por día
 *      (contador persistido en el store). También verifica fondos reales
 *      (balance nativo / balanceOf+allowance de $PANAL) antes de comprometerse.
 *   4. SUB-TAREA: createTask hijo (MON: value=price; $PANAL: approve exacto +
 *      value 0) con taskHash=keccak256(subBrief) y deadline =
 *      min(deadline padre, now + A2A_SUB_TIMEOUT_S). El brief hijo se guarda
 *      en el store (mismo sistema de briefs local) y el padre queda APARCADO.
 *   5. VIGILANCIA (poll en el mismo loop del worker): cuando el hijo entrega
 *      (Delivered) se obtiene el resultado de su endpoint /result (si su
 *      metadata anuncia bot:<url>) con la firma EIP-191 del bot como CLIENTE y
 *      se verifica el resultHash recomputado contra el anclado on-chain. El
 *      LLM puntúa 1-5: >= A2A_MIN_RATING → approveAndRelease; < min → no se
 *      aprueba (el auto-release de 72 h cubre al hijo) y se avisa por Telegram
 *      para revisión humana.
 *   6. INTEGRACIÓN: con el hijo Completed, el LLM integra el resultado del
 *      hijo en el resultado final del padre y se entrega el padre normalmente.
 *   7. TIMEOUT: si el hijo no entrega antes de su deadline, se cancela la
 *      sub-tarea (cancelTask: el contrato lo permite al cliente con deadline
 *      vencido) y el padre entrega sin esa parte (nota en el resultado).
 *
 * Anti-ciclos: nunca se subcontrata a la propia address (también lo prohíbe
 * el contrato: "no self-task") y el prompt del router prohíbe que los
 * subBriefs pidan sub-subcontratación, así que un hijo que también sea un bot
 * A2A recibiría un brief acotado cuyo router devolvería needsSub=false.
 */

import { keccak256, toBytes, type Address } from 'viem';
import type { BotConfig } from './config.js';
import {
  NATIVE_CURRENCY,
  TaskStatus,
  currencySymbol,
  formatAmount,
  shortAddress,
  approveAndReleaseTx,
  approveToken,
  cancelTaskTx,
  createTaskTx,
  getAgentCount,
  getAgentsPage,
  getNativeBalance,
  getRegistryAgent,
  getTask,
  getTokenAllowance,
  getTokenBalance,
  politePause,
  type ChainClients,
  type RegistryAgent,
  type Task,
} from './chain.js';
import { chatWithSystem, generateResult } from './llm.js';
import { resultSignMessage } from './http.js';
import type { A2aSubTaskRecord, Store } from './store.js';
import type { Telegram } from './telegram.js';

/** Prompt de routing por defecto (sobreescribible con A2A_ROUTER_PROMPT). */
export const DEFAULT_ROUTER_PROMPT =
  'Eres el ROUTER de un agente autónomo del marketplace Panal. Analiza el brief del cliente y ' +
  'decide si conviene SUBCONTRATAR una parte a otro agente especializado.\n\n' +
  'Responde SOLO con un JSON estricto (sin markdown ni texto extra) con esta forma exacta:\n' +
  '{"needsSub": boolean, "skill": string|null, "subBrief": string|null, "reason": string}\n\n' +
  'Reglas:\n' +
  '- needsSub=true SOLO si el brief requiere claramente una habilidad concreta que un ' +
  'especialista haría mejor y que puede entregarse como subtarea independiente y acotada.\n' +
  '- "skill": una palabra o frase corta (p. ej. "traducción", "ilustración", "auditoría de ' +
  'smart contracts", "análisis de datos"). Debe coincidir con las skills que los agentes ' +
  'anuncian en su metadata.\n' +
  '- "subBrief": el pedido COMPLETO y AUTOSUFICIENTE para el subcontratista, con todo el ' +
  'contexto necesario. NUNCA pidas al subcontratista que subcontrate a su vez: los subBriefs ' +
  'no pueden requerir sub-subcontratación (prohibido).\n' +
  '- Si el brief es simple o está dentro de tus capacidades normales: needsSub=false, ' +
  'skill=null, subBrief=null.\n' +
  '- "reason": una frase corta explicando la decisión.';

/** Prompt del evaluador de resultados de subcontratistas (rating 1-5). */
const RATING_PROMPT =
  'Eres el EVALUADOR de calidad de un agente autónomo. Puntúa del 1 al 5 el resultado que un ' +
  'subcontratista entregó para la subtarea indicada (1 = inútil/incorrecto, 3 = aceptable, ' +
  '5 = excelente y listo para entregar al cliente final).\n' +
  'Responde SOLO con un JSON estricto (sin markdown): {"rating": <entero 1-5>, "comment": "..."}';

/** Decisión del router LLM (JSON estricto). */
export interface RouterDecision {
  needsSub: boolean;
  skill: string | null;
  subBrief: string | null;
  reason: string;
}

interface Candidate {
  address: Address;
  agent: RegistryAgent;
}

export interface A2aDeps {
  cfg: BotConfig;
  clients: ChainClients;
  store: Store;
  telegram: Pick<Telegram, 'send'>;
  /** Brief del padre (el worker lo resuelve: store o brief genérico). */
  parentBrief: (taskId: bigint) => string;
  /** Entrega el resultado final del padre (el worker: saveResult + deliverResult + Telegram). */
  deliverParent: (taskId: bigint, resultText: string) => Promise<void>;
  /** Reloj inyectable (epoch seconds) para tests. */
  nowS?: () => number;
}

/** Parseo robusto de la respuesta del router: JSON inválido → null (no subcontrata). */
export function parseRouterDecision(raw: string): RouterDecision | null {
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]) as Record<string, unknown>;
    const needsSub = j.needsSub === true;
    const skill = typeof j.skill === 'string' && j.skill.trim() !== '' ? j.skill.trim() : null;
    const subBrief = typeof j.subBrief === 'string' && j.subBrief.trim() !== '' ? j.subBrief.trim() : null;
    const reason = typeof j.reason === 'string' ? j.reason : '';
    return { needsSub, skill, subBrief, reason };
  } catch {
    return null;
  }
}

/** Match de la skill buscada en el metadata del agente (case-insensitive). */
export function skillMatches(metadataURI: string, skill: string): boolean {
  return metadataURI.toLowerCase().includes(skill.trim().toLowerCase());
}

/** Extrae el token "bot:<url>" del metadata (misma convención que el frontend). */
export function parseBotUrl(metadataURI: string): string | null {
  for (const seg of metadataURI.split('·').map((s) => s.trim())) {
    const m = /^bot:\s*(\S.*)$/i.exec(seg);
    if (m) {
      try {
        const u = new URL(m[1]!.trim());
        if (u.protocol === 'http:' || u.protocol === 'https:') return u.toString().replace(/\/+$/, '');
      } catch {
        // URL inválida: ignorar
      }
    }
  }
  return null;
}

/**
 * Entre los candidatos cuyo metadata contiene la skill, elige el MÁS BARATO.
 * Moneda elegida: primero los que cobran en la moneda de la tarea padre; si
 * ninguno, los que cobran en MON nativo. Devuelve null si no hay candidato.
 */
export function pickCheapest(
  candidates: Candidate[],
  skill: string,
  parentCurrency: Address,
): Candidate | null {
  const matching = candidates.filter((c) => skillMatches(c.agent.metadataURI, skill));
  const inParent = matching.filter(
    (c) => c.agent.currency.toLowerCase() === parentCurrency.toLowerCase(),
  );
  const pool =
    inParent.length > 0
      ? inParent
      : matching.filter((c) => c.agent.currency.toLowerCase() === NATIVE_CURRENCY.toLowerCase());
  if (pool.length === 0) return null;
  pool.sort((a, b) => (a.agent.pricePerTask < b.agent.pricePerTask ? -1 : a.agent.pricePerTask > b.agent.pricePerTask ? 1 : 0));
  return pool[0]!;
}

const REGISTRY_CHUNK = 25n;
/** Margen mínimo de vida de la sub-tarea para que merezca la pena crearla. */
const MIN_SUB_WINDOW_S = 600;

export class A2aManager {
  private readonly cfg: BotConfig;
  private readonly clients: ChainClients;
  private readonly store: Store;
  private readonly telegram: Pick<Telegram, 'send'>;
  private readonly deps: A2aDeps;

  constructor(deps: A2aDeps) {
    this.deps = deps;
    this.cfg = deps.cfg;
    this.clients = deps.clients;
    this.store = deps.store;
    this.telegram = deps.telegram;
  }

  private nowS(): number {
    return this.deps.nowS ? this.deps.nowS() : Math.floor(Date.now() / 1000);
  }

  private get routerPrompt(): string {
    return this.cfg.a2a.routerPrompt ?? DEFAULT_ROUTER_PROMPT;
  }

  // -------------------------------------------------------------------------
  // 1-2. Router + selección
  // -------------------------------------------------------------------------

  /** Llama al router LLM. Ante cualquier fallo: no subcontrata (flujo normal). */
  private async route(briefText: string): Promise<RouterDecision | null> {
    let raw: string;
    try {
      raw = await chatWithSystem(this.cfg, this.routerPrompt, briefText);
    } catch (err) {
      console.warn(`[a2a] Router LLM falló (${err instanceof Error ? err.message : err}): no se subcontrata.`);
      return null;
    }
    const decision = parseRouterDecision(raw);
    if (!decision) {
      console.warn(`[a2a] Respuesta del router no es JSON válido: "${raw.slice(0, 160)}" — no se subcontrata.`);
      return null;
    }
    return decision;
  }

  /** Lista los agentes del registry (paginado), excluyendo propia address e inactivos. */
  private async listCandidates(): Promise<Candidate[]> {
    const out: Candidate[] = [];
    const total = await getAgentCount(this.clients, this.cfg);
    for (let offset = 0n; offset < total; offset += REGISTRY_CHUNK) {
      const page = await getAgentsPage(this.clients, this.cfg, offset, REGISTRY_CHUNK);
      await politePause();
      for (const address of page) {
        // Nunca subcontratarse a uno mismo (el contrato también lo prohíbe).
        if (address.toLowerCase() === this.cfg.agentAddress.toLowerCase()) continue;
        try {
          const agent = await getRegistryAgent(this.clients, this.cfg, address);
          if (!agent.active || agent.registeredAt === 0n) continue;
          out.push({ address, agent });
        } catch (err) {
          console.warn(`[a2a] No se pudo leer getAgent(${address}): ${err instanceof Error ? err.message : err}`);
        }
        await politePause();
      }
    }
    return out;
  }

  // -------------------------------------------------------------------------
  // 3-4. Decisión + creación de la sub-tarea
  // -------------------------------------------------------------------------

  /**
   * Decide si la tarea padre se aparca tras subcontratar una parte.
   * Devuelve true si el padre queda APARCADO (el ciclo A2A lo continuará),
   * false si debe seguir el flujo normal (generar resultado y entregar).
   * Nunca lanza: cualquier fallo interno degrada a flujo normal.
   */
  async maybeSubcontract(taskId: bigint, task: Task, briefText: string): Promise<boolean> {
    try {
      // Idempotencia (reinicios del bot): si ya hay sub-tarea para este padre,
      // el padre lo gestiona el ciclo A2A, no el flujo normal.
      const existing = this.store.getSubTask(taskId);
      if (existing) {
        console.log(`[a2a] Padre #${taskId} ya tiene sub-#${existing.childTaskId} (${existing.state}): sigue aparcado.`);
        return true;
      }

      const decision = await this.route(briefText);
      if (!decision || !decision.needsSub || !decision.skill || !decision.subBrief) {
        if (decision?.needsSub) {
          console.log(`[a2a] Router pidió subcontratar pero falta skill/subBrief (${decision.reason}): flujo normal.`);
        }
        return false;
      }
      console.log(`[a2a] Router: subcontratar "${decision.skill}" — ${decision.reason}`);

      // Guarda de deadline: la sub-tarea necesita una ventana mínima de vida.
      const now = this.nowS();
      const childDeadline = Math.min(Number(task.deadline), now + this.cfg.a2a.subTimeoutS);
      if (childDeadline - now < MIN_SUB_WINDOW_S) {
        console.log(`[a2a] Deadline del padre #${taskId} demasiado cercano para subcontratar: flujo normal.`);
        await this.telegram.send(
          `ℹ️ *A2A:* la tarea #${taskId} pediría subcontratar "${decision.skill}", pero su deadline ` +
            `está demasiado cerca. Se resuelve sin subcontratar.`,
        );
        return false;
      }

      const candidates = await this.listCandidates();
      const chosen = pickCheapest(candidates, decision.skill, task.currency);
      if (!chosen) {
        console.log(`[a2a] Sin candidato activo con skill "${decision.skill}": flujo normal.`);
        await this.telegram.send(
          `ℹ️ *A2A:* quise subcontratar "${decision.skill}" para #${taskId} pero no hay agente activo ` +
            `con esa skill. Se resuelve sin subcontratar.`,
        );
        return false;
      }

      const price = chosen.agent.pricePerTask;
      const payCurrency = chosen.agent.currency;
      const symbol = currencySymbol(payCurrency, this.cfg);

      if (price > this.cfg.a2a.maxSubWei) {
        console.log(`[a2a] ${shortAddress(chosen.address)} cobra ${formatAmount(price)} ${symbol} > A2A_MAX_SUB_WEI: no se subcontrata.`);
        await this.telegram.send(
          `ℹ️ *A2A:* el candidato más barato para "${decision.skill}" cobra ${formatAmount(price)} ${symbol}, ` +
            `por encima del límite por sub-tarea. Se resuelve sin subcontratar.`,
        );
        return false;
      }

      const dailySpend = this.store.getA2aDailySpend(now);
      if (dailySpend + price > this.cfg.a2a.dailyBudgetWei) {
        console.log(`[a2a] Presupuesto diario A2A agotado (${formatAmount(dailySpend)}/${formatAmount(this.cfg.a2a.dailyBudgetWei)}): no se subcontrata.`);
        await this.telegram.send(
          `ℹ️ *A2A:* presupuesto diario de subcontratación agotado ` +
            `(${formatAmount(dailySpend)}/${formatAmount(this.cfg.a2a.dailyBudgetWei)} gastado). ` +
            `#${taskId} se resuelve sin subcontratar.`,
        );
        return false;
      }

      // Fondos reales antes de comprometerse.
      const bot = this.clients.botAddress;
      if (!bot || !this.clients.walletClient) {
        console.warn('[a2a] Sin wallet del bot (¿BOT_PRIVATE_KEY?): no se puede subcontratar.');
        return false;
      }
      const isNative = payCurrency.toLowerCase() === NATIVE_CURRENCY.toLowerCase();
      if (isNative) {
        const balance = await getNativeBalance(this.clients, bot);
        if (balance < price) {
          console.log(`[a2a] Balance nativo insuficiente (${formatAmount(balance)} < ${formatAmount(price)} MON): no se subcontrata.`);
          await this.telegram.send(
            `ℹ️ *A2A:* fondos MON insuficientes para subcontratar "${decision.skill}" ` +
              `(${formatAmount(price)} MON). #${taskId} se resuelve sin subcontratar.`,
          );
          return false;
        }
      } else {
        const balance = await getTokenBalance(this.clients, this.cfg, payCurrency, bot);
        if (balance < price) {
          console.log(`[a2a] Balance $PANAL insuficiente (${formatAmount(balance)} < ${formatAmount(price)}): no se subcontrata.`);
          await this.telegram.send(
            `ℹ️ *A2A:* fondos $PANAL insuficientes para subcontratar "${decision.skill}" ` +
              `(${formatAmount(price)} $PANAL). #${taskId} se resuelve sin subcontratar.`,
          );
          return false;
        }
        // approve exacto antes de createTask (value 0).
        const allowance = await getTokenAllowance(this.clients, this.cfg, payCurrency, bot, this.cfg.escrowAddress);
        if (allowance < price) {
          console.log(`[a2a] Aprobando ${formatAmount(price)} $PANAL al escrow…`);
          await approveToken(this.clients, this.cfg, payCurrency, this.cfg.escrowAddress, price);
        }
      }

      // Crear la sub-tarea on-chain.
      const subBrief = decision.subBrief;
      const taskHash = keccak256(toBytes(subBrief));
      const { taskId: childId, txHash } = await createTaskTx(
        this.clients,
        this.cfg,
        chosen.address,
        taskHash,
        BigInt(childDeadline),
        payCurrency,
        price,
      );

      // Persistir: brief hijo (mismo sistema de briefs local) + registro A2A.
      this.store.setBrief(childId, subBrief);
      const record: A2aSubTaskRecord = {
        parentTaskId: taskId.toString(),
        childTaskId: childId.toString(),
        childWorker: chosen.address,
        skill: decision.skill,
        amount: price.toString(),
        currency: payCurrency,
        createdAt: now,
        deadline: childDeadline,
        state: 'open',
      };
      this.store.setSubTask(record);
      this.store.addA2aDailySpend(price, now);

      console.log(`[a2a] Sub-#${childId} creada: padre #${taskId} → ${shortAddress(chosen.address)} por ${formatAmount(price)} ${symbol}. tx: ${txHash}`);
      await this.telegram.send(
        `🤝 *Subcontraté parte de #${taskId}* → agente \`${shortAddress(chosen.address)}\` ` +
          `por *${formatAmount(price)} ${symbol}* (sub-#${childId}).\n` +
          `Skill: ${decision.skill} · Deadline sub-tarea: ${new Date(childDeadline * 1000).toLocaleString('es-ES', { timeZone: 'UTC' })} UTC`,
      );
      return true;
    } catch (err) {
      // Cualquier fallo inesperado NO debe romper el flujo normal del worker.
      console.error(`[a2a] Falló la subcontratación de #${taskId} (${err instanceof Error ? err.message : err}): flujo normal.`);
      return false;
    }
  }

  /**
   * Simulación A2A para DRY_RUN: ejecuta router + selección + chequeos de
   * límites/fondos (solo lectura) y loguea lo que HARÍA, sin firmar ni
   * persistir nada.
   */
  async simulate(taskId: bigint, task: Task, briefText: string): Promise<void> {
    console.log(`[a2a:dry-run] Simulando routing de #${taskId}…`);
    if (!this.cfg.llm.apiKey) {
      console.log('[a2a:dry-run] Sin LLM_API_KEY: no se llama al router (en seco no es obligatorio).');
      return;
    }
    const decision = await this.route(briefText);
    if (!decision) return;
    console.log(`[a2a:dry-run] Decisión del router: ${JSON.stringify(decision)}`);
    if (!decision.needsSub || !decision.skill || !decision.subBrief) {
      console.log('[a2a:dry-run] needsSub=false → no se subcontrataría (flujo normal).');
      return;
    }
    try {
      const candidates = await this.listCandidates();
      const chosen = pickCheapest(candidates, decision.skill, task.currency);
      if (!chosen) {
        console.log(`[a2a:dry-run] No habría candidato para "${decision.skill}" (${candidates.length} agentes activos vistos).`);
        return;
      }
      const price = chosen.agent.pricePerTask;
      const symbol = currencySymbol(chosen.agent.currency, this.cfg);
      const now = this.nowS();
      const childDeadline = Math.min(Number(task.deadline), now + this.cfg.a2a.subTimeoutS);
      const withinCap = price <= this.cfg.a2a.maxSubWei;
      const withinBudget = this.store.getA2aDailySpend(now) + price <= this.cfg.a2a.dailyBudgetWei;
      console.log(
        `[a2a:dry-run] Candidato elegido: ${chosen.address} (${chosen.agent.metadataURI.slice(0, 80)}) ` +
          `por ${formatAmount(price)} ${symbol} · límite/sub OK=${withinCap} · presupuesto diario OK=${withinBudget}`,
      );
      if (this.clients.botAddress) {
        try {
          const balance = await getNativeBalance(this.clients, this.clients.botAddress);
          console.log(`[a2a:dry-run] Balance nativo del bot: ${formatAmount(balance)} MON`);
        } catch {
          /* solo informativo */
        }
      }
      console.log(
        `[a2a:dry-run] Simularía createTask hijo → worker=${chosen.address}, deadline=${childDeadline}, ` +
          `taskHash=keccak256(subBrief) — NO se firma ni se persiste nada.`,
      );
    } catch (err) {
      console.warn(`[a2a:dry-run] Simulación incompleta: ${err instanceof Error ? err.message : err}`);
    }
  }

  // -------------------------------------------------------------------------
  // 5-7. Vigilancia, evaluación, aprobación, integración y timeout
  // -------------------------------------------------------------------------

  /** Un ciclo de vigilancia de las sub-tareas pendientes (mismo loop del worker). */
  async poll(): Promise<void> {
    if (this.cfg.dryRun) return; // en seco nunca hay sub-tareas persistidas
    const pending = this.store.listPendingSubTasks();
    for (const rec of pending) {
      try {
        await this.pollOne(rec);
      } catch (err) {
        console.error(`[a2a] Error vigilando sub-#${rec.childTaskId}: ${err instanceof Error ? err.message : err}`);
      }
      await politePause();
    }
  }

  private async pollOne(rec: A2aSubTaskRecord): Promise<void> {
    const childId = BigInt(rec.childTaskId);
    const parentId = BigInt(rec.parentTaskId);
    const child = await getTask(this.clients, this.cfg, childId);
    const now = this.nowS();
    const symbol = currencySymbol(rec.currency as Address, this.cfg);
    const amount = `${formatAmount(BigInt(rec.amount))} ${symbol}`;

    switch (child.status) {
      case TaskStatus.Open: {
        // Timeout: el hijo no entregó antes de su deadline.
        if (now > Number(child.deadline)) {
          let note = 'el subcontratista no entregó antes del deadline';
          try {
            const tx = await cancelTaskTx(this.clients, this.cfg, childId);
            note += '; sub-tarea cancelada on-chain (fondos recuperados)';
            console.log(`[a2a] Sub-#${childId} cancelada (timeout). tx: ${tx}`);
          } catch (err) {
            note += `; cancelTask falló (${err instanceof Error ? err.message.split('\n')[0] : err})`;
            console.warn(`[a2a] cancelTask(sub-#${childId}) falló: ${note}`);
          }
          rec.state = 'timeout';
          rec.note = note;
          this.store.setSubTask(rec);
          await this.telegram.send(
            `⏱️ *Sub-#${childId}* (${rec.skill}, ${amount}) no entregó a tiempo. ` +
              `El padre #${parentId} se entrega sin esa parte.`,
          );
          await this.deliverParentWithoutSub(rec, 'no llegó a tiempo');
        }
        break;
      }

      case TaskStatus.Delivered: {
        // Ya evaluada pero el approve falló antes (RPC/gas): reintentar approve.
        if (rec.state === 'delivered' && rec.rating !== undefined) {
          try {
            const tx = await approveAndReleaseTx(this.clients, this.cfg, childId, rec.rating);
            rec.state = 'completed';
            this.store.setSubTask(rec);
            console.log(`[a2a] Sub-#${childId} aprobada en reintento (rating ${rec.rating}/5). tx: ${tx}`);
            await this.integrateAndDeliverParent(rec, child);
          } catch (err) {
            console.error(`[a2a] approveAndRelease(sub-#${childId}) reintento falló: ${err instanceof Error ? err.message : err}`);
          }
          break;
        }
        if (rec.state !== 'open') break; // ya evaluada; esperando approve reintentado o completed
        const { text, note: fetchNote } = await this.fetchChildResult(rec, child);
        const { rating, comment } = await this.rateChild(rec, child, text, fetchNote);
        rec.childResult = text;
        rec.rating = rating;
        rec.note = comment;
        if (rating >= this.cfg.a2a.minRating) {
          try {
            const tx = await approveAndReleaseTx(this.clients, this.cfg, childId, rating);
            rec.state = 'completed';
            this.store.setSubTask(rec);
            console.log(`[a2a] Sub-#${childId} aprobada (rating ${rating}/5). tx: ${tx}`);
            await this.telegram.send(
              `⭐ *Sub-#${childId} aprobada* con rating ${rating}/5 (${amount}). ` +
                `Integrando el resultado en el padre #${parentId}…`,
            );
            await this.integrateAndDeliverParent(rec, child);
          } catch (err) {
            // Approve falló (RPC/gas): se reintenta en el próximo ciclo.
            rec.state = 'delivered';
            this.store.setSubTask(rec);
            console.error(`[a2a] approveAndRelease(sub-#${childId}) falló: ${err instanceof Error ? err.message : err}`);
          }
        } else {
          rec.state = 'rejected';
          this.store.setSubTask(rec);
          console.log(`[a2a] Sub-#${childId} rechazada (rating ${rating}/5 < ${this.cfg.a2a.minRating}).`);
          await this.telegram.send(
            `⚠️ *Sub-#${childId} NO aprobada:* el evaluador le dio ${rating}/5 (mínimo ${this.cfg.a2a.minRating}).\n` +
              `Motivo: ${comment}\nNo se libera el pago (el auto-release de 72 h cubre al hijo). ` +
              `*Revisión humana recomendada* — si el resultado es válido, apruébala desde ${this.cfg.dashboardUrl}.\n` +
              `El padre #${parentId} se entrega sin esa parte.`,
          );
          await this.deliverParentWithoutSub(rec, 'no superó la evaluación de calidad');
        }
        break;
      }

      case TaskStatus.Completed: {
        // Aprobada en un ciclo anterior pero la integración falló, o liberada
        // por autoRelease: integrar si el padre aún no se entregó.
        if (!rec.parentDelivered) {
          if (!rec.childResult) {
            const { text } = await this.fetchChildResult(rec, child);
            rec.childResult = text;
          }
          await this.integrateAndDeliverParent(rec, child);
        }
        rec.state = 'completed';
        this.store.setSubTask(rec);
        break;
      }

      case TaskStatus.Cancelled: {
        rec.state = 'cancelled';
        rec.note = rec.note ?? 'sub-tarea cancelada on-chain';
        this.store.setSubTask(rec);
        if (!rec.parentDelivered) {
          await this.telegram.send(
            `❌ *Sub-#${childId}* (${rec.skill}) fue cancelada. El padre #${parentId} se entrega sin esa parte.`,
          );
          await this.deliverParentWithoutSub(rec, 'la sub-tarea fue cancelada');
        }
        break;
      }

      case TaskStatus.Disputed: {
        if (!rec.note?.includes('disputa notificada')) {
          await this.telegram.send(
            `⚠️ *Sub-#${childId} en disputa* (${amount}). Revisa el caso desde ${this.cfg.dashboardUrl} ` +
              `(el padre #${parentId} sigue aparcado de momento).`,
          );
          rec.note = `${rec.note ?? ''} disputa notificada`.trim();
          this.store.setSubTask(rec);
        }
        break;
      }
    }
  }

  /**
   * Obtiene el resultado del hijo desde su endpoint /result (si su metadata
   * anuncia bot:<url>), firmando como CLIENTE con la wallet del bot (EIP-191,
   * mismo mecanismo que http.ts) y verificando el resultHash recomputado
   * contra el anclado on-chain.
   *
   * LIMITACIÓN documentada: si el hijo no expone endpoint, no hay forma de
   * obtener el texto (solo su hash va on-chain); la evaluación se hace solo
   * con el hash/estado y el evaluador puntúa con criterio conservador.
   */
  private async fetchChildResult(
    rec: A2aSubTaskRecord,
    child: Task,
  ): Promise<{ text?: string; note?: string }> {
    const childId = BigInt(rec.childTaskId);
    let botUrl: string | null = null;
    try {
      const agent = await getRegistryAgent(this.clients, this.cfg, rec.childWorker as Address);
      botUrl = parseBotUrl(agent.metadataURI);
    } catch (err) {
      return { note: `no se pudo leer el metadata del hijo (${err instanceof Error ? err.message : err})` };
    }
    if (!botUrl) {
      return { note: 'el hijo no anuncia endpoint bot:<url> en su metadata; evaluación solo con hash/estado' };
    }
    const account = this.clients.walletClient?.account;
    const botAddress = this.clients.botAddress;
    if (!account || !botAddress || typeof account.signMessage !== 'function') {
      return { note: 'sin wallet del bot para firmar la petición al endpoint del hijo' };
    }
    try {
      const signature = await account.signMessage({ message: resultSignMessage(childId) });
      const url = `${botUrl}/result/${childId}?address=${botAddress}&signature=${signature}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) return { note: `endpoint del hijo respondió HTTP ${res.status}` };
      const body = (await res.json()) as { resultText?: unknown };
      if (typeof body.resultText !== 'string' || body.resultText === '') {
        return { note: 'la respuesta del endpoint del hijo no contiene resultText' };
      }
      const recomputed = keccak256(toBytes(body.resultText));
      if (recomputed.toLowerCase() !== child.resultHash.toLowerCase()) {
        return { note: 'el resultHash recomputado NO coincide con el anclado on-chain' };
      }
      return { text: body.resultText };
    } catch (err) {
      return { note: `fallo consultando el endpoint del hijo: ${err instanceof Error ? err.message : err}` };
    }
  }

  /** El LLM puntúa 1-5 el resultado del hijo. Fallo de evaluación → 3 (neutro). */
  private async rateChild(
    rec: A2aSubTaskRecord,
    child: Task,
    text: string | undefined,
    fetchNote: string | undefined,
  ): Promise<{ rating: number; comment: string }> {
    const subBrief = this.store.getBrief(BigInt(rec.childTaskId)) ?? `(subtarea de "${rec.skill}")`;
    const user = text
      ? `Subtarea encargada al subcontratista:\n${subBrief}\n\nResultado entregado (verificado on-chain):\n${text}`
      : `Subtarea encargada al subcontratista:\n${subBrief}\n\nNO hay texto del resultado ` +
        `(${fetchNote ?? 'sin endpoint'}). Solo conoces el hash on-chain (${child.resultHash}) y que ` +
        `entregó antes del deadline. Puntúa con criterio conservador (3 = neutro).`;
    try {
      const raw = await chatWithSystem(this.cfg, RATING_PROMPT, user);
      const m = raw.match(/\{[\s\S]*\}/);
      const j = JSON.parse(m ? m[0] : raw) as { rating?: unknown; comment?: unknown };
      const rating = typeof j.rating === 'number' ? Math.round(j.rating) : NaN;
      if (Number.isInteger(rating) && rating >= 1 && rating <= 5) {
        return { rating, comment: typeof j.comment === 'string' ? j.comment : '' };
      }
      return { rating: 3, comment: `respuesta del evaluador inválida ("${raw.slice(0, 120)}"): rating neutro` };
    } catch (err) {
      return { rating: 3, comment: `evaluación LLM falló (${err instanceof Error ? err.message : err}): rating neutro` };
    }
  }

  /** Hijo Completed: el LLM integra el resultado del hijo y se entrega el padre. */
  private async integrateAndDeliverParent(rec: A2aSubTaskRecord, child: Task): Promise<void> {
    const parentId = BigInt(rec.parentTaskId);
    if (rec.parentDelivered) return;
    const parentBrief = this.deps.parentBrief(parentId);
    const composed = rec.childResult
      ? `${parentBrief}\n\n---\nLa parte "${rec.skill}" la resolvió un colaborador especializado. ` +
        `Su resultado (verificado on-chain):\n${rec.childResult}\n\nGenera el resultado FINAL completo ` +
        `para el cliente integrando esa parte de forma natural. No menciones la colaboración salvo ` +
        `una breve nota al final.`
      : `${parentBrief}\n\n---\nLa parte "${rec.skill}" fue entregada y verificada on-chain por un ` +
        `colaborador (hash ${child.resultHash}), pero no expone endpoint para obtener el texto. ` +
        `Genera el resultado FINAL completo por tu cuenta e indica al final que esa parte fue ` +
        `validada externamente.`;
    console.log(`[a2a] Integrando sub-#${rec.childTaskId} en el padre #${parentId}…`);
    const resultText = await generateResult(this.cfg, composed);
    await this.deps.deliverParent(parentId, resultText);
    rec.parentDelivered = true;
    rec.state = 'completed';
    this.store.setSubTask(rec);
  }

  /** El padre entrega sin la parte subcontratada (nota en el resultado). */
  private async deliverParentWithoutSub(rec: A2aSubTaskRecord, reason: string): Promise<void> {
    const parentId = BigInt(rec.parentTaskId);
    if (rec.parentDelivered) return;
    const parentBrief = this.deps.parentBrief(parentId);
    const composed =
      `${parentBrief}\n\n---\n[Nota A2A: se había subcontratado la parte "${rec.skill}" ` +
      `(sub-#${rec.childTaskId}) pero ${reason}. Entrega el mejor resultado posible SIN esa parte ` +
      `e indícalo brevemente al final para el cliente.]`;
    console.log(`[a2a] Entregando padre #${parentId} sin la parte subcontratada (${reason})…`);
    try {
      const resultText = await generateResult(this.cfg, composed);
      await this.deps.deliverParent(parentId, resultText);
    } catch (err) {
      console.error(`[a2a] No se pudo entregar el padre #${parentId}: ${err instanceof Error ? err.message : err}`);
      return; // reintenta en el próximo ciclo
    }
    rec.parentDelivered = true;
    this.store.setSubTask(rec);
  }

  // -------------------------------------------------------------------------
  // /status
  // -------------------------------------------------------------------------

  /** Sección A2A para el comando /status (sub-tareas activas + gasto del día). */
  statusSummary(): string {
    const subs = this.store.listSubTasks();
    const finals = new Set(['completed', 'rejected', 'timeout', 'cancelled']);
    const active = subs.filter((r) => !finals.has(r.state) || !r.parentDelivered);
    const spend = this.store.getA2aDailySpend(this.nowS());
    const fmtState = (r: A2aSubTaskRecord) => {
      const label: Record<A2aSubTaskRecord['state'], string> = {
        open: 'esperando entrega',
        delivered: 'entregada, evaluando/aprobando',
        completed: 'completada',
        rejected: 'rechazada',
        timeout: 'timeout',
        cancelled: 'cancelada',
      };
      const sym = currencySymbol(r.currency as Address, this.cfg);
      return `#${r.parentTaskId}→sub-#${r.childTaskId} (${r.skill}, ${formatAmount(BigInt(r.amount))} ${sym}, ${label[r.state]})`;
    };
    return (
      `🤝 *A2A (subcontratación):*\n` +
      `• Sub-tareas activas (${active.length}): ${active.length ? active.map(fmtState).join(', ') : '—'}\n` +
      `• Sub-tareas históricas: ${subs.length}\n` +
      `• Gasto de hoy: ${formatAmount(spend)} / ${formatAmount(this.cfg.a2a.dailyBudgetWei)} (límite por sub: ${formatAmount(this.cfg.a2a.maxSubWei)})`
    );
  }
}
