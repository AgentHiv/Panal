#!/usr/bin/env node
/**
 * panal-mcp — servidor MCP de Panal.
 *
 *   npx panal-mcp
 *
 * Deja que un modelo busque agentes de IA en Panal (Monad mainnet), pida
 * presupuesto y —si se le autoriza explícitamente— los contrate pagando de
 * verdad. Sin configuración arranca en SOLO LECTURA contra mainnet.
 *
 * Para contratar hacen falta DOS cosas, y tener solo una no basta:
 *   MCP_ENABLE_WRITES=true   consentimiento explícito
 *   MCP_PRIVATE_KEY=0x…      wallet dedicada del CLIENTE, con fondos
 *
 * Topes (todos opcionales, con valores conservadores por defecto):
 *   MCP_MAX_PER_TASK_WEI          por encargo, en MON      (default 1e18)
 *   MCP_DAILY_BUDGET_WEI          por día UTC, en MON      (default 5e18)
 *   MCP_MAX_PER_TASK_PANAL_WEI    por encargo, en $PANAL   (default 1e18)
 *   MCP_DAILY_BUDGET_PANAL_WEI    por día UTC, en $PANAL   (default 5e18)
 *
 * Cada moneda lleva su cuenta. MON y $PANAL no valen lo mismo y no hay tipo de
 * cambio entre ellos, así que un solo contador para los dos era una suma
 * inventada: gastar en una agotaba el presupuesto de la otra.
 *   MCP_TASK_DEADLINE_HOURS  plazo de entrega (default 24)
 *   MCP_SPEND_FILE           dónde persistir el gasto del día
 *
 * Protocolo: JSON-RPC 2.0 sobre stdio, implementado a mano. stdout está
 * RESERVADO para los mensajes del protocolo —un `console.log` suelto ahí
 * corrompe la sesión entera—, así que todo el registro va por stderr.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { formatEther, isAddress, keccak256, parseEther, toBytes } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import type { Address } from 'viem';
import {
  NATIVE_CURRENCY,
  TaskStatus,
  createPanalClient,
  erc20Abi,
  type Agent,
  type PanalClient,
} from '@panal/sdk';
import { QuoteBook, SpendLedger, limitFor, limitsFromEnv } from './limits.js';
import {
  briefSignMessage,
  expiraEn,
  fetchAgentLimits,
  fetchResultText,
  pushBrief,
  resultSignMessage,
} from './fetch-result.js';

const SERVER_NAME = 'panal';
/**
 * Sale del package.json, no de una constante a mano: la copiada se quedó en
 * 0.1.0 mientras el paquete iba por 0.1.3, y un servidor que se anuncia con
 * una versión falsa hace imposible saber qué está corriendo el usuario.
 */
const SERVER_VERSION = ((): string => {
  try {
    const aqui = dirname(fileURLToPath(import.meta.url));
    return (JSON.parse(readFileSync(resolve(aqui, '..', 'package.json'), 'utf8')) as { version: string }).version;
  } catch {
    return '0.0.0';
  }
})();
/** Versiones del protocolo que sabemos hablar; la primera es la preferida. */
const SUPPORTED_PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];

const EXPLORER = 'https://monadvision.com';

/** Registro. SIEMPRE por stderr: stdout es del protocolo. */
function log(msg: string): void {
  process.stderr.write(`[panal-mcp] ${msg}\n`);
}

// ---------------------------------------------------------------------------
// Configuración
// ---------------------------------------------------------------------------

const limits = limitsFromEnv();
const quotes = new QuoteBook();
const ledger = new SpendLedger(SpendLedger.defaultFile(), (m) => log(`⚠️  ${m}`));

const writesRequested = (process.env.MCP_ENABLE_WRITES ?? '').trim().toLowerCase() === 'true';

const account = (() => {
  const key = process.env.MCP_PRIVATE_KEY?.trim();
  if (!key) return undefined;
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
    log('MCP_PRIVATE_KEY no tiene el formato 0x + 64 hex: se ignora y el servidor queda en solo lectura.');
    return undefined;
  }
  return privateKeyToAccount(key as `0x${string}`);
})();

const panal: PanalClient = createPanalClient({
  rpcUrl: process.env.RPC_URL?.trim(),
  account,
});

/** Motivo por el que no se puede escribir, o null si sí se puede. */
function writesBlockedReason(): string | null {
  if (!writesRequested) {
    return (
      'This server is READ-ONLY. To hire, it must be started with MCP_ENABLE_WRITES=true and an ' +
      'MCP_PRIVATE_KEY with funds. Tell the person to configure it themselves: do not try to work around it.'
    );
  }
  if (!account) {
    return 'MCP_ENABLE_WRITES is on but there is no valid MCP_PRIVATE_KEY, so there is no wallet to pay with.';
  }
  return null;
}

// ---------------------------------------------------------------------------
// Presentación
// ---------------------------------------------------------------------------

/** ¿Es la moneda nativa de la cadena, o un token? */
function esNativa(currency: Address): boolean {
  return currency.toLowerCase() === NATIVE_CURRENCY.toLowerCase();
}

function symbolOf(currency: Address): string {
  return esNativa(currency) ? 'MON' : '$PANAL';
}

/** Las monedas que este servidor sabe manejar: las que tienen presupuesto. */
function monedasConocidas(): Address[] {
  return [...limits.porMoneda.keys()] as Address[];
}

/**
 * Saldo de una wallet en una moneda: a la cadena si es la nativa, al contrato
 * del token si es un ERC-20.
 *
 * `null` es «no se pudo leer», y se distingue de cero a propósito. Enseñar 0
 * cuando la consulta falla es afirmar que no hay fondos, que es una respuesta
 * distinta: llevaría a no intentar un pago que sí se podía hacer.
 */
async function saldoDe(owner: Address, currency: Address): Promise<bigint | null> {
  try {
    if (esNativa(currency)) return await panal.publicClient.getBalance({ address: owner });
    return (await panal.publicClient.readContract({
      address: currency,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [owner],
    })) as bigint;
  } catch {
    return null;
  }
}

/**
 * ¿Cabe este gasto en el presupuesto de SU moneda? Devuelve el motivo, o null.
 *
 * Cada moneda lleva su cuenta. Sumar MON y $PANAL en un solo número exigiría un
 * tipo de cambio que nadie tiene, y el resultado era que tres consultas de
 * $PANAL agotaban un tope puesto pensando en MON.
 *
 * Sin presupuesto para una moneda, se dice que no. La alternativa —tirar del
 * tope de otra— es exactamente la conversión a ojo que este cambio elimina.
 */
function revisarPresupuesto(currency: Address, amount: bigint, symbol: string): string | null {
  const lim = limitFor(limits, currency);
  if (!lim) {
    return (
      `That agent charges in a token this server has no budget for (${currency}). ` +
      'Only MON and $PANAL have caps configured; there is no exchange rate to reuse another one.'
    );
  }
  if (amount > lim.maxPerTaskWei) {
    return (
      `That costs ${formatEther(amount)} ${symbol} and the per-item cap for ${symbol} is ` +
      `${formatEther(lim.maxPerTaskWei)}. Raise ${lim.envMaxPerTask} if that is intended.`
    );
  }
  const spent = ledger.spentToday(currency);
  if (spent + amount > lim.dailyBudgetWei) {
    return (
      `That would blow today's ${symbol} budget: ${formatEther(spent)} of ` +
      `${formatEther(lim.dailyBudgetWei)} spent and this costs ${formatEther(amount)} ${symbol}. ` +
      `Raise ${lim.envDailyBudget} if that is intended.`
    );
  }
  return null;
}

/** Días desde un timestamp en segundos. */
function daysSince(ts: number): number {
  return Math.max(0, Math.floor(Date.now() / 1000 - ts) / 86_400);
}

/**
 * Lo que hay que saber de un agente ANTES de contratarlo, no después.
 *
 * Un nombre no prueba nada: cualquiera puede registrarse como "Lint" con la
 * misma descripción, y cuesta una transacción. Lo que sí es de alguien es su
 * dominio, así que se dice si lo confirma. Y si su nombre acaba de cambiar de
 * manos, también: en una venta lo único que viaja es el nombre, la reputación
 * se queda con el vendedor.
 *
 * Va en la ficha y no en un campo aparte porque quien lee esto elige por su
 * cuenta, y lo que no está delante no se mira.
 *
 * `verificado` tiene TRES estados y aquí se dicen los tres. `undefined` no es
 * un «no»: es que por esta ruta no se ha mirado —la ficha viene de la cadena,
 * que no guarda verificaciones de dominio—, o el agente cambió de endpoint y
 * lo de antes ya no dice nada de la URL nueva. Contarlo como «no verificado»
 * acusaba en falso a agentes que sí lo están, y hacía que dos herramientas del
 * mismo servidor afirmaran lo contrario la una de la otra sobre el mismo
 * agente: marketplace_stats lee la cadena y search_agents el indexador. Una
 * insignia que se contradice consigo misma no sirve para lo único que sirve
 * una insignia, que es decidir.
 */
function trustLine(agent: Agent): string | null {
  const partes: string[] = [];

  if (agent.verificado === true) partes.push('domain verified (its endpoint declares this same address)');
  else if (agent.verificado === false)
    partes.push('DOMAIN NOT VERIFIED — the name alone proves nothing about who this is');
  else
    partes.push(
      'domain NOT CHECKED on this listing — it was read from the chain, which does not record verification; the name alone proves nothing about who this is',
    );

  // El nombre unico se dice SIEMPRE que lo haya. Es la unica prueba de
  // identidad que vive en la cadena: el nombre del perfil es texto libre y se
  // repite —hay tres direcciones anunciandose como "LexPanal"— mientras que
  // este lo tiene una sola. Y a diferencia del dominio, no depende de que el
  // indexador este vivo para poder afirmarlo.
  if (agent.nombre) {
    partes.push(`holds the unique name "${agent.nombre.nombre}" in PanalNames`);
    // La advertencia solo con origen CONOCIDO y distinto de reclamado. Sin
    // dato no se avisa: `undefined` seria «no lo se», y convertirlo en una
    // acusacion de compra reciente es inventarse la mitad que importa.
    if (agent.nombre.origen && agent.nombre.origen !== 'reclamado') {
      const dias = Math.round(daysSince(agent.nombre.desdeTs));
      if (dias <= 30) {
        partes.push(
          `its name "${agent.nombre.nombre}" changed hands ${dias}d ago — reputation stays with the previous owner`,
        );
      }
    }
  }

  return `  Trust: ${partes.join('; ')}`;
}

function renderAgent(agent: Agent): string {
  const price = `${formatEther(agent.pricePerTask)} ${symbolOf(agent.currency)}`;
  const skills = agent.metadata.skills.length ? agent.metadata.skills.join(', ') : '(no skills declared)';
  return [
    `${agent.metadata.name || '(no name)'} — ${agent.address}`,
    `  Status: ${agent.active ? 'active' : 'DELISTED (does not take jobs)'}`,
    trustLine(agent),
    // "Per task" y no "Price" a secas: hay dos precios (tarea por escrow y
    // consulta por x402) y llamar "el precio" a uno de ellos fue justo lo que
    // hizo invisible al otro.
    `  Per task: ${price} (escrow, with deadline and dispute window)`,
    `  Skills: ${skills}`,
    agent.metadata.description ? `  Description: ${agent.metadata.description}` : null,
    agent.metadata.botUrl ? `  Endpoint: ${agent.metadata.botUrl}` : null,
    `  Profile: ${EXPLORER}/address/${agent.address}`,
  ]
    .filter(Boolean)
    .join('\n');
}

function renderTask(task: Awaited<ReturnType<PanalClient['getTask']>>): string {
  const deadline = new Date(Number(task.deadline) * 1000).toISOString();
  return [
    `Task #${task.id} — ${TaskStatus[task.status] ?? task.status}`,
    `  Client: ${task.client}`,
    `  Agent:   ${task.worker}`,
    `  Amount:  ${formatEther(task.amount)} ${symbolOf(task.currency)}`,
    `  Deadline: ${deadline}`,
    `  Job hash: ${task.taskHash}`,
    task.resultHash && !/^0x0+$/.test(task.resultHash) ? `  Result hash: ${task.resultHash}` : null,
  ]
    .filter(Boolean)
    .join('\n');
}

// ---------------------------------------------------------------------------
// Herramientas
// ---------------------------------------------------------------------------

interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<string>;
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

const READ_TOOLS: Tool[] = [
  {
    name: 'panal_search_agents',
    description:
      'Search AI agents on the Panal marketplace (Monad mainnet) by free text over their name, ' +
      'description and skills. With no query it returns every active agent. Read live from the chain.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What you are looking for, e.g. "translation" or "legal summaries".' },
        include_inactive: { type: 'boolean', description: 'Include delisted agents. Off by default.' },
      },
    },
    handler: async (args) => {
      const found = await panal.searchAgents(str(args.query), {
        includeInactive: args.include_inactive === true,
      });
      if (!found.length) {
        return str(args.query)
          ? `No active agent matches "${str(args.query)}". Try a broader term, or list them all with no query.`
          : 'There are no active agents on the marketplace right now.';
      }
      return `${found.length} agent(s):\n\n${found.map(renderAgent).join('\n\n')}`;
    },
  },
  {
    name: 'panal_get_agent',
    description: 'Full profile of a Panal agent, by address.',
    inputSchema: {
      type: 'object',
      properties: { address: { type: 'string', description: 'The agent 0x… address.' } },
      required: ['address'],
    },
    handler: async (args) => {
      const address = str(args.address);
      if (!address || !isAddress(address)) return 'I need a valid 0x address.';
      const agent = await panal.getAgent(address);
      // El perfil es donde alguien mira el precio, así que aquí sí se paga la
      // llamada al manifiesto del agente: enseñar solo el de tarea era la
      // razón de que el precio por consulta fuese invisible desde aquí. En
      // `panal_search_agents` no se hace, porque serían N llamadas HTTP a
      // servidores ajenos por cada búsqueda.
      let porLlamada: string;
      try {
        const q = await panal.quoteAgent(address, 'Price check.');
        porLlamada = `  Per question: ${formatEther(BigInt(q.amount))} ${q.assetSymbol ?? symbolOf(q.asset)} (x402, answered on the spot)`;
      } catch {
        porLlamada = '  Per question: not offered (this agent only takes jobs through escrow)';
      }
      return `${renderAgent(agent)}\n${porLlamada}`;
    },
  },
  {
    name: 'panal_get_task',
    description: 'State of a job in the Panal escrow: amount, deadline, agent, and whether it was delivered.',
    inputSchema: {
      type: 'object',
      properties: { task_id: { type: 'number', description: 'Numeric task id.' } },
      required: ['task_id'],
    },
    handler: async (args) => {
      const id = Number(args.task_id);
      if (!Number.isInteger(id) || id < 0) return 'The task id is an integer greater than or equal to zero.';
      const count = await panal.getTaskCount();
      if (BigInt(id) >= count) return `Task #${id} does not exist: there are ${count} so far.`;
      return renderTask(await panal.getTask(BigInt(id)));
    },
  },
  {
    name: 'panal_quote_ask',
    description:
      'Ask an agent what it charges for ONE question, answered on the spot (x402 per-call pricing). ' +
      'Costs nothing and needs no wallet. This is a DIFFERENT price from the per-task price in the ' +
      'agent profile: per-task means hiring a job through escrow, with a deadline and a dispute window. ' +
      'The two can differ by a lot, so quote the one you actually mean to use.',
    inputSchema: {
      type: 'object',
      properties: {
        agent: { type: 'string', description: 'The agent 0x… address.' },
        prompt: { type: 'string', description: 'The question, so the agent can price it if it prices per question.' },
      },
      required: ['agent', 'prompt'],
    },
    handler: async (args) => {
      const address = str(args.agent);
      const prompt = str(args.prompt);
      if (!address || !isAddress(address)) return 'I need a valid 0x address for the agent.';
      if (!prompt) return 'I need the question.';

      const agent = await panal.getAgent(address);
      const name = agent.metadata.name || address;
      let quote;
      try {
        quote = await panal.quoteAgent(address, prompt);
      } catch (err) {
        // Cobrar por llamada es opcional: un agente puede trabajar solo por
        // escrow. Se dice cuál es la alternativa en vez de dejarlo en error.
        const msg = err instanceof Error ? err.message : String(err);
        return (
          `${name} does not answer per-question requests (${msg}).\n` +
          `It can still be hired for a job: ${formatEther(agent.pricePerTask)} ${symbolOf(agent.currency)} ` +
          `per task, via panal_quote_hire.`
        );
      }

      const amount = BigInt(quote.amount);
      const symbol = quote.assetSymbol ?? symbolOf(quote.asset);
      const saved = quotes.issue({
        kind: 'ask',
        worker: agent.address,
        agentName: name,
        brief: prompt,
        amount,
        currency: quote.asset,
        symbol,
        botUrl: agent.metadata.botUrl,
      });

      return [
        `${name} charges per question:`,
        `  Price: ${formatEther(amount)} ${symbol} for this one question`,
        `  Paid to: ${quote.payTo}`,
        quote.description ? `  Covers: ${quote.description}` : null,
        '',
        `For comparison, hiring it for a job costs ${formatEther(agent.pricePerTask)} ${symbolOf(agent.currency)} ` +
          'per task (escrow, with deadline and dispute window).',
        '',
        `quote_id: ${saved.id}  (valid for 5 minutes)`,
        '',
        'Show this price to the person. Only if they say yes, call panal_ask with that quote_id and ' +
          'confirmed_by_user: true. This moves real money.',
      ]
        .filter((l) => l !== null)
        .join('\n');
    },
  },
  {
    name: 'panal_marketplace_stats',
    description: 'Panal marketplace figures: how many agents exist, how many are active, how many jobs so far.',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      const [agents, taskCount] = await Promise.all([panal.listAgents(), panal.getTaskCount()]);
      const active = agents.filter((a) => a.active);
      return [
        `Registered agents: ${agents.length}`,
        `Active agents: ${active.length}`,
        `Jobs created: ${taskCount}`,
        `Escrow: ${panal.addresses.escrow}`,
        `Registry: ${panal.addresses.registry}`,
        '',
        active.length ? `Active now:\n${active.map(renderAgent).join('\n\n')}` : 'No active agents.',
      ].join('\n');
    },
  },
];

const WRITE_TOOLS: Tool[] = [
  {
    name: 'panal_wallet',
    description:
      'State of the wallet this server would pay with: address, the balance of EVERY currency Panal ' +
      'takes (MON and $PANAL), and how much of today\'s budget is left. Call it before hiring to know ' +
      'whether there are funds.',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      const blocked = writesBlockedReason();
      if (blocked) return blocked;
      const address = account!.address;
      const monedas = monedasConocidas();

      // Un saldo por moneda, no solo el nativo. Antes se leía únicamente MON y
      // justo debajo se listaban los topes de $PANAL: quien lo leía daba por
      // comprobado un saldo que nadie había mirado, y podía contratar en $PANAL
      // sin tener con qué pagar. Las lecturas son independientes, así que van
      // en paralelo.
      const [saldos, pendientes] = await Promise.all([
        Promise.all(monedas.map((m) => saldoDe(address, m))),
        // Lo acreditado en el escrow no aparece en el balance de la wallet: es
        // pull payment, así que un reembolso se queda ahí quieto hasta que se
        // reclama. Sin decirlo, el dinero devuelto es indistinguible del
        // perdido — y también hay que preguntarlo moneda a moneda.
        Promise.all(monedas.map((m) => panal.getPendingWithdrawal(address, m).catch(() => null))),
      ]);

      const importe = (v: bigint | null): string => (v === null ? 'could not be read' : formatEther(v));

      const balances = monedas.map((m, i) => `  ${symbolOf(m)}: ${importe(saldos[i] ?? null)}`);

      // Un presupuesto por moneda: MON y $PANAL no valen lo mismo y no hay
      // tipo de cambio, así que se enseñan por separado o no se entienden.
      const presupuestos = monedas.map((moneda) => {
        const lim = limitFor(limits, moneda)!;
        const spent = ledger.spentToday(moneda);
        const left = lim.dailyBudgetWei > spent ? lim.dailyBudgetWei - spent : 0n;
        return (
          `  ${symbolOf(moneda)}: per job ${formatEther(lim.maxPerTaskWei)} · today ${formatEther(spent)} of ` +
          `${formatEther(lim.dailyBudgetWei)} spent · ${formatEther(left)} left`
        );
      });

      // Solo se nombra lo que hay que cobrar, o lo que no se pudo comprobar. Un
      // «0» por cada moneda sería ruido en la respuesta más leída del servidor.
      const enEscrow = monedas
        .map((m, i) => ({ sym: symbolOf(m), v: pendientes[i] ?? null }))
        .filter(({ v }) => v === null || v > 0n)
        .map(({ sym, v }) => `  ${sym}: ${importe(v)}`);

      return [
        `Wallet: ${address}`,
        'Balance:',
        ...balances,
        'Caps and budgets (each currency is counted on its own):',
        ...presupuestos,
        enEscrow.length ? 'Waiting in the escrow — collect it with panal_withdraw:' : null,
        ...enEscrow,
      ]
        .filter(Boolean)
        .join('\n');
    },
  },
  {
    name: 'panal_quote_hire',
    description:
      'Quote a job WITHOUT paying anything. Returns the agent real price and a quote_id. ' +
      'Always show the price to the person and wait for their approval before calling panal_hire.',
    inputSchema: {
      type: 'object',
      properties: {
        agent: { type: 'string', description: 'The agent 0x… address.' },
        brief: { type: 'string', description: 'The job, written with all the detail the agent will need.' },
      },
      required: ['agent', 'brief'],
    },
    handler: async (args) => {
      const blocked = writesBlockedReason();
      if (blocked) return blocked;
      const address = str(args.agent);
      const brief = str(args.brief);
      if (!address || !isAddress(address)) return 'I need a valid 0x address for the agent.';
      if (!brief) return 'I need the text of the job.';

      const agent = await panal.getAgent(address);
      if (!agent.active) return `${agent.metadata.name || address} is delisted and does not take jobs.`;

      const amount = agent.pricePerTask;
      const symbol = symbolOf(agent.currency);
      const negativa = revisarPresupuesto(agent.currency, amount, symbol);
      if (negativa) return negativa;

      // El tope del brief se pregunta ANTES de presupuestar. Si no cabe, el
      // agente lo rechazaría con un 400 al recibirlo — pero eso ocurre ya con
      // el pago bloqueado, porque el encargo se entrega después de crear la
      // tarea. Aquí no cuesta nada y evita dejar dinero atrapado hasta que
      // vence el plazo.
      if (agent.metadata.botUrl) {
        const { alcanzable, maxBriefChars } = await fetchAgentLimits(agent.metadata.botUrl);
        // Que el endpoint no conteste descalifica el encargo entero: el brief se
        // entrega DESPUÉS de crear la tarea, así que contratar ahora dejaría el
        // pago bloqueado en una tarea que nadie puede empezar. Aquí no cuesta
        // nada y basta con reintentar cuando el agente vuelva.
        if (alcanzable === false) {
          return (
            `${agent.metadata.name || address} publishes ${agent.metadata.botUrl} but nothing answers there, ` +
            `so the job could not be delivered even after paying. Nothing was quoted and nothing was spent. ` +
            `Try again when the agent is back up.`
          );
        }
        if (maxBriefChars !== null && brief.length > maxBriefChars) {
          return (
            `That job does not fit: ${agent.metadata.name || address} accepts ${maxBriefChars} characters ` +
            `and this brief is ${brief.length}. Nothing was quoted and nothing was spent. ` +
            `Shorten it by ${brief.length - maxBriefChars} characters and ask again.`
          );
        }
      }

      const quote = quotes.issue({
        kind: 'hire',
        worker: agent.address,
        agentName: agent.metadata.name || agent.address,
        brief,
        amount,
        currency: agent.currency,
        symbol,
        botUrl: agent.metadata.botUrl,
      });

      return [
        `Quote for ${quote.agentName}:`,
        `  Price: ${formatEther(amount)} ${symbol}`,
        `  Deadline: ${limits.deadlineHours} h from the moment it is hired`,
        `  Job: ${brief.length > 200 ? `${brief.slice(0, 200)}…` : brief}`,
        '',
        `quote_id: ${quote.id}  (valid for 5 minutes)`,
        '',
        'Show this price to the person. Only if they say yes, call panal_hire with that quote_id ' +
          'and confirmed_by_user: true. This moves real money.',
      ].join('\n');
    },
  },
  {
    name: 'panal_ask',
    description:
      'Pay an agent for ONE question and get its answer in the same call (x402). Requires a quote_id from ' +
      'panal_quote_ask and an explicit yes from the person. This spends real money. Unlike panal_hire ' +
      'there is no escrow, no deadline and no dispute: once paid, it is paid.',
    inputSchema: {
      type: 'object',
      properties: {
        quote_id: { type: 'string', description: 'The id returned by panal_quote_ask.' },
        confirmed_by_user: {
          type: 'boolean',
          description: 'true only if the person has seen the price and approved it.',
        },
      },
      required: ['quote_id', 'confirmed_by_user'],
    },
    handler: async (args) => {
      const blocked = writesBlockedReason();
      if (blocked) return blocked;
      if (args.confirmed_by_user !== true) {
        return 'I will not pay without confirmed_by_user: true. Show the quote to the person and ask first.';
      }
      const id = str(args.quote_id);
      if (!id) return 'The quote_id is missing. Ask for a quote with panal_quote_ask first.';

      const redeemed = quotes.redeem(id, 'ask');
      if ('error' in redeemed) return redeemed.error;
      const quote = redeemed.quote;

      // Los mismos topes que contratar. Una consulta es barata, pero nada
      // impide encadenar mil: el presupuesto del día es lo que lo impide.
      const negativa = revisarPresupuesto(quote.currency, quote.amount, quote.symbol);
      if (negativa) return negativa;

      try {
        // `maxSpend` va atado al importe del presupuesto que la persona
        // aprobó, no al tope del servidor: si el agente sube el precio entre
        // el presupuesto y el sí, la firma no se produce.
        const res = await panal.askAgent(quote.worker, quote.brief, { maxSpend: quote.amount });
        // Se registra lo REALMENTE pagado, y en SU moneda: un gasto anotado en
        // el contador equivocado agota un presupuesto que nadie tocó.
        ledger.record(quote.currency, res.paid);
        log(`consulta pagada a ${quote.worker}: ${formatEther(res.paid)} ${quote.symbol}`);

        return [
          `Paid ${formatEther(res.paid)} ${quote.symbol} to ${quote.agentName}.`,
          res.txHash ? `  tx: ${EXPLORER}/tx/${res.txHash}` : null,
          '',
          'Answer:',
          res.answer,
        ]
          .filter((l) => l !== null)
          .join('\n');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log(`fallo al pagar la consulta: ${msg}`);
        return `Could not pay for the question: ${msg}`;
      }
    },
  },
  {
    name: 'panal_hire',
    description:
      'Hire the agent and LOCK THE REAL PAYMENT in escrow. Requires a quote_id from panal_quote_hire and ' +
      'an explicit yes from the person. Never call it on your own initiative.',
    inputSchema: {
      type: 'object',
      properties: {
        quote_id: { type: 'string', description: 'The id returned by panal_quote_hire.' },
        confirmed_by_user: {
          type: 'boolean',
          description: 'true only if the person has seen the price and approved it.',
        },
      },
      required: ['quote_id', 'confirmed_by_user'],
    },
    handler: async (args) => {
      const blocked = writesBlockedReason();
      if (blocked) return blocked;
      if (args.confirmed_by_user !== true) {
        return 'I will not hire without confirmed_by_user: true. Show the quote to the person and ask first.';
      }
      const id = str(args.quote_id);
      if (!id) return 'The quote_id is missing. Ask for a quote with panal_quote_hire first.';

      const redeemed = quotes.redeem(id, 'hire');
      if ('error' in redeemed) return redeemed.error;
      const quote = redeemed.quote;

      // Los topes se re-evalúan al contratar: entre el presupuesto y el "sí"
      // pueden haber pasado minutos y otros encargos.
      const negativa = revisarPresupuesto(quote.currency, quote.amount, quote.symbol);
      if (negativa) return negativa;

      const deadline = BigInt(Math.floor(Date.now() / 1000) + limits.deadlineHours * 3600);
      try {
        const result = await panal.hire({ agent: quote.worker, brief: quote.brief, deadline });
        ledger.record(quote.currency, result.amount);
        log(`contratada #${result.taskId} a ${quote.worker} por ${formatEther(result.amount)} ${quote.symbol}`);

        // Contratar sin entregar el encargo deja la tarea a medias: el pago
        // bloqueado y el agente esperando un texto que nadie le manda. Se hace
        // aquí, no se le pide al usuario, porque quien está leyendo esto es un
        // modelo en mitad de una conversación y no va a abrir una terminal.
        let entregaBrief: string;
        if (!quote.botUrl) {
          entregaBrief = 'That agent publishes no endpoint: get the job to them through whatever channel you use.';
        } else {
          const firma = await account!.signMessage({ message: briefSignMessage(result.taskId) });
          const fallo = await pushBrief(quote.botUrl, result.taskId, quote.brief, account!.address, firma);
          if (fallo === null) {
            entregaBrief = `Job delivered to ${quote.botUrl}: the agent is already working on it.`;
            log(`brief #${result.taskId} entregado en ${quote.botUrl}`);
          } else {
            entregaBrief =
              `WARNING: the payment is locked but the job did NOT arrive (${fallo}).\n` +
              `The agent cannot start. Retry with panal_send_brief ${result.taskId}, ` +
              `or the payment returns on its own when the deadline passes.`;
            log(`brief #${result.taskId} NO entregado: ${fallo}`);
          }
        }

        return [
          `Hired. Task #${result.taskId} created and payment locked in escrow.`,
          `  Agent: ${quote.agentName}`,
          `  Amount: ${formatEther(result.amount)} ${quote.symbol}`,
          `  tx: ${EXPLORER}/tx/${result.txHash}`,
          '',
          entregaBrief,
          '',
          `When it delivers, check with panal_get_task ${result.taskId} and approve with panal_approve_task.`,
        ].join('\n');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log(`fallo al contratar: ${msg}`);
        return `Could not hire: ${msg}`;
      }
    },
  },
  {
    name: 'panal_get_result',
    description:
      'Collect the result of a delivered task. The text lives off-chain: it is requested from the agent ' +
      'endpoint by signing as the client, and its hash is checked against the one anchored on-chain. ' +
      'Only works for tasks hired by this server wallet.',
    inputSchema: {
      type: 'object',
      properties: { task_id: { type: 'number', description: 'Id of the delivered task.' } },
      required: ['task_id'],
    },
    handler: async (args) => {
      if (!account) return 'Without MCP_PRIVATE_KEY the request for the result cannot be signed.';
      const id = Number(args.task_id);
      if (!Number.isInteger(id) || id < 0) return 'El id de la tarea es un entero mayor o igual que cero.';
      const taskId = BigInt(id);

      const task = await panal.getTask(taskId);
      if (task.client.toLowerCase() !== account.address.toLowerCase()) {
        return `Task #${id} was hired by ${task.client}, not this wallet. Only the client can collect the result.`;
      }
      if (/^0x0+$/.test(task.resultHash)) {
        return `Task #${id} has no delivered result yet (status: ${TaskStatus[task.status] ?? task.status}).`;
      }

      const agent = await panal.getAgent(task.worker);
      if (!agent.metadata.botUrl) {
        return (
          `Agent ${agent.metadata.name || task.worker} publishes no endpoint, so the result cannot be downloaded ` +
          `here. Its hash is on-chain (${task.resultHash}): ask them through your channel and check that the ` +
          'hash matches.'
        );
      }

      try {
        // La firma caduca: abre el resultado y todos los archivos de la tarea.
        const expira = expiraEn();
        const signature = await account.signMessage({ message: resultSignMessage(taskId, expira) });
        const text = await fetchResultText(agent.metadata.botUrl, taskId, account.address, signature, expira);

        // Lo que importa de todo esto: que el texto sea EXACTAMENTE el que se
        // ancló. Sin esta comprobación, el agente podría entregar una cosa
        // on-chain y enseñarte otra distinta.
        const actual = keccak256(toBytes(text));
        if (actual.toLowerCase() !== task.resultHash.toLowerCase()) {
          return (
            `⚠️ The result the agent serves does NOT match the one anchored on-chain.\n` +
            `  expected: ${task.resultHash}\n  received: ${actual}\n\n` +
            'Do not approve it: either the agent changed the text after delivering, or someone altered the ' +
            'response. You can open a dispute at https://panal.lat/dashboard.'
          );
        }
        return `Result of task #${id} (hash verified against the chain):\n\n${text}`;
      } catch (err) {
        return `Could not collect the result: ${err instanceof Error ? err.message : err}`;
      }
    },
  },
  {
    name: 'panal_send_brief',
    description:
      'Deliver the job again to an already-hired agent, when the automatic send from panal_hire did not ' +
      'arrive. It costs NO money: the payment is already locked, this only repeats the HTTP delivery. ' +
      'The text must be EXACTLY the one hired, because its hash is on the chain.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'number', description: 'Id of the already-created task.' },
        brief: { type: 'string', description: 'The job, word for word as it was when hired.' },
      },
      required: ['task_id', 'brief'],
    },
    handler: async (args) => {
      const blocked = writesBlockedReason();
      if (blocked) return blocked;
      const id = Number(args.task_id);
      if (!Number.isInteger(id) || id < 0) return 'I need a valid task id.';
      const brief = str(args.brief);
      if (!brief) return 'I need the text of the job.';

      const task = await panal.getTask(BigInt(id));
      if (task.client.toLowerCase() !== account!.address.toLowerCase()) {
        return `Task #${id} was not hired by this wallet, so its signature is not valid for delivering the job.`;
      }
      if (task.status !== TaskStatus.Open) {
        return `Task #${id} is ${TaskStatus[task.status]}: it no longer accepts the job.`;
      }
      // Se comprueba aquí antes de molestar al agente: así el error dice que el
      // texto no es el mismo, en vez de un 409 sin contexto desde el endpoint.
      if (keccak256(toBytes(brief)) !== task.taskHash) {
        return [
          'That text is NOT the one hired: its hash does not match the one on the chain.',
          `  hired hash: ${task.taskHash}`,
          `  your text hash: ${keccak256(toBytes(brief))}`,
          'It must be identical, character for character. One extra space already changes it.',
        ].join('\n');
      }

      const agent = await panal.getAgent(task.worker);
      if (!agent.metadata.botUrl) return 'That agent publishes no endpoint: there is nowhere to send the job.';

      const firma = await account!.signMessage({ message: briefSignMessage(BigInt(id)) });
      const fallo = await pushBrief(agent.metadata.botUrl, BigInt(id), brief, account!.address, firma);
      if (fallo === null) {
        log(`brief #${id} entregado (reintento) en ${agent.metadata.botUrl}`);
        return `Job delivered. The agent is already working on task #${id}.`;
      }
      return `It still does not arrive (${fallo}). The payment stays locked and returns on its own when the deadline passes.`;
    },
  },
  {
    name: 'panal_approve_task',
    description:
      'Approve the delivered result, RELEASE THE PAYMENT to the agent and leave a 1-5 rating. ' +
      'Only after showing the result to the person and letting them decide the score.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'number', description: 'Id de la tarea entregada.' },
        rating: { type: 'number', description: 'The 1-5 rating the person decided.' },
        confirmed_by_user: { type: 'boolean', description: 'true only if the person approved it.' },
      },
      required: ['task_id', 'rating', 'confirmed_by_user'],
    },
    handler: async (args) => {
      const blocked = writesBlockedReason();
      if (blocked) return blocked;
      if (args.confirmed_by_user !== true) {
        return 'I will not release the payment without confirmed_by_user: true. Show the result to the person first.';
      }
      const id = Number(args.task_id);
      const rating = Number(args.rating);
      if (!Number.isInteger(id) || id < 0) return 'The task id is an integer.';
      if (!Number.isInteger(rating) || rating < 1 || rating > 5) return 'The rating is an integer from 1 to 5.';

      try {
        const hash = await panal.approveTask(BigInt(id), rating);
        return `Payment released for task #${id} with a ${rating}/5 rating.\n  tx: ${EXPLORER}/tx/${hash}`;
      } catch (err) {
        return `Could not approve: ${err instanceof Error ? err.message : err}`;
      }
    },
  },
  {
    name: 'panal_cancel_task',
    description:
      'Cancel a job that never started and get the locked payment back. Only works on a task that was ' +
      'never delivered, and only once its deadline has passed (or no agent was ever assigned). ' +
      'The refund is CREDITED, not sent: call panal_withdraw afterwards to actually receive it.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'number', description: 'Id of the task to cancel.' },
        confirmed_by_user: { type: 'boolean', description: 'true only if the person asked to cancel it.' },
      },
      required: ['task_id', 'confirmed_by_user'],
    },
    handler: async (args) => {
      const blocked = writesBlockedReason();
      if (blocked) return blocked;
      if (args.confirmed_by_user !== true) {
        return 'I will not cancel a job without confirmed_by_user: true.';
      }
      const id = Number(args.task_id);
      if (!Number.isInteger(id) || id < 0) return 'The task id is an integer.';

      try {
        const hash = await panal.cancelTask(BigInt(id));
        return [
          `Task #${id} cancelled and the payment refunded.`,
          `  tx: ${EXPLORER}/tx/${hash}`,
          '',
          'The refund is credited in the escrow, not in the wallet yet: call panal_withdraw to collect it.',
        ].join('\n');
      } catch (err) {
        return `Could not cancel: ${err instanceof Error ? err.message : err}`;
      }
    },
  },
  {
    name: 'panal_open_dispute',
    description:
      'Dispute a delivered result and STOP the clock. If nobody approves or disputes, the escrow pays ' +
      'the agent on its own 3 days after delivery, with an implicit 5/5 — so doing nothing is not ' +
      'neutral, it pays. An arbitrator then splits the amount; if they do not act in 14 days, the ' +
      'client can be refunded in full. Use it when the delivery is wrong or never arrived.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'number', description: 'Id of the delivered task.' },
        confirmed_by_user: { type: 'boolean', description: 'true only if the person asked to dispute it.' },
      },
      required: ['task_id', 'confirmed_by_user'],
    },
    handler: async (args) => {
      const blocked = writesBlockedReason();
      if (blocked) return blocked;
      if (args.confirmed_by_user !== true) {
        return 'I will not open a dispute without confirmed_by_user: true. Show the person the result first.';
      }
      const id = Number(args.task_id);
      if (!Number.isInteger(id) || id < 0) return 'The task id is an integer.';

      try {
        const hash = await panal.openDispute(BigInt(id));
        return [
          `Dispute opened on task #${id}. The automatic release is stopped.`,
          `  tx: ${EXPLORER}/tx/${hash}`,
          '',
          'An arbitrator decides how to split it. If nobody resolves it within 14 days, the whole amount',
          'can be refunded to the client.',
        ].join('\n');
      } catch (err) {
        return `Could not open the dispute: ${err instanceof Error ? err.message : err}`;
      }
    },
  },
  {
    name: 'panal_withdraw',
    description:
      'Collect what the escrow owes this wallet — refunds from cancelled jobs — in EVERY currency it ' +
      'holds, one transaction each. The escrow is pull payment: it credits balances and never pushes ' +
      'them, so money sits there until this is called. Call panal_wallet first to see what is waiting.',
    inputSchema: {
      type: 'object',
      properties: {
        confirmed_by_user: { type: 'boolean', description: 'true only if the person asked to collect it.' },
      },
      required: ['confirmed_by_user'],
    },
    handler: async (args) => {
      const blocked = writesBlockedReason();
      if (blocked) return blocked;
      if (args.confirmed_by_user !== true) {
        return 'I will not move funds without confirmed_by_user: true.';
      }
      try {
        // Se retira MONEDA A MONEDA. El escrow lleva un saldo por cada una y
        // `withdraw` solo vacía la que se le pide; preguntando únicamente por
        // la nativa, un reembolso en $PANAL quedaba invisible y esta misma
        // herramienta contestaba que no había nada que cobrar. El dinero seguía
        // en el contrato, pero desde aquí no había forma de sacarlo.
        const monedas = monedasConocidas();
        const pendientes: Array<{ moneda: Address; importe: bigint }> = [];
        for (const moneda of monedas) {
          const importe = await panal.getPendingWithdrawal(account!.address, moneda);
          if (importe > 0n) pendientes.push({ moneda, importe });
        }
        if (!pendientes.length) return 'The escrow owes this wallet nothing: there is nothing to collect.';

        // Cada moneda es una transacción aparte, y si una falla se sigue con
        // las demás: quedarse sin cobrar el $PANAL porque el MON se quedó sin
        // gas es perder dos veces.
        const lineas: string[] = [];
        for (const { moneda, importe } of pendientes) {
          const sym = symbolOf(moneda);
          try {
            const hash = await panal.withdraw(moneda);
            lineas.push(`Collected ${formatEther(importe)} ${sym} from the escrow.\n  tx: ${EXPLORER}/tx/${hash}`);
          } catch (err) {
            lineas.push(
              `Could not collect the ${formatEther(importe)} ${sym}: ${err instanceof Error ? err.message : err}` +
                '\n  It is still credited in the escrow; calling this again will retry it.',
            );
          }
        }
        return lineas.join('\n');
      } catch (err) {
        return `Could not withdraw: ${err instanceof Error ? err.message : err}`;
      }
    },
  },
];

/** Las de escritura se anuncian siempre: si no, el modelo no sabe que existen. */
const TOOLS: Tool[] = [...READ_TOOLS, ...WRITE_TOOLS];

// ---------------------------------------------------------------------------
// JSON-RPC 2.0 sobre stdio
// ---------------------------------------------------------------------------

interface RpcRequest {
  jsonrpc?: string;
  id?: number | string | null;
  method?: string;
  params?: Record<string, unknown>;
}

function send(payload: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function reply(id: RpcRequest['id'], result: unknown): void {
  if (id === undefined || id === null) return; // notificación: no se contesta
  send({ jsonrpc: '2.0', id, result });
}

function replyError(id: RpcRequest['id'], code: number, message: string): void {
  if (id === undefined || id === null) return;
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

async function handle(req: RpcRequest): Promise<void> {
  switch (req.method) {
    case 'initialize': {
      const asked = typeof req.params?.protocolVersion === 'string' ? req.params.protocolVersion : undefined;
      const version = asked && SUPPORTED_PROTOCOLS.includes(asked) ? asked : SUPPORTED_PROTOCOLS[0]!;
      reply(req.id, {
        protocolVersion: version,
        capabilities: { tools: {} },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
      });
      return;
    }

    case 'notifications/initialized':
    case 'initialized':
      return;

    case 'ping':
      reply(req.id, {});
      return;

    case 'tools/list':
      reply(req.id, {
        tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
      });
      return;

    case 'tools/call': {
      const name = typeof req.params?.name === 'string' ? req.params.name : '';
      const tool = TOOLS.find((t) => t.name === name);
      if (!tool) {
        replyError(req.id, -32602, `There is no tool named "${name}".`);
        return;
      }
      const args = (req.params?.arguments as Record<string, unknown> | undefined) ?? {};
      try {
        const text = await tool.handler(args);
        reply(req.id, { content: [{ type: 'text', text }] });
      } catch (err) {
        // Un error se devuelve como resultado con isError, no como error del
        // protocolo: así el modelo lo lee y puede explicárselo a la persona.
        const msg = err instanceof Error ? err.message : String(err);
        log(`${name} falló: ${msg}`);
        reply(req.id, { content: [{ type: 'text', text: `Error en ${name}: ${msg}` }], isError: true });
      }
      return;
    }

    default:
      replyError(req.id, -32601, `Método no soportado: ${req.method}`);
  }
}

function main(): void {
  const mode = writesBlockedReason() === null ? `ESCRITURA (${account!.address})` : 'solo lectura';
  log(`v${SERVER_VERSION} · Monad mainnet · ${mode}`);
  if (writesRequested && !account) log('⚠️  MCP_ENABLE_WRITES=true pero sin clave válida: sigue en solo lectura.');

  const rl = createInterface({ input: process.stdin });
  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let req: RpcRequest;
    try {
      req = JSON.parse(trimmed) as RpcRequest;
    } catch {
      log(`línea que no es JSON, ignorada: ${trimmed.slice(0, 80)}`);
      return;
    }
    void handle(req).catch((err) => {
      log(`fallo interno: ${err instanceof Error ? err.message : err}`);
      replyError(req.id, -32603, 'Error interno del servidor.');
    });
  });
  rl.on('close', () => process.exit(0));
}

main();

// Solo para las pruebas: permite invocar una herramienta sin levantar el stdio.
export const _tools = TOOLS;
export { parseEther };
