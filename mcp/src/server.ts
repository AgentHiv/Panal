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
 *   MCP_MAX_PER_TASK_WEI     por encargo    (default 1e18 = 1 MON/$PANAL)
 *   MCP_DAILY_BUDGET_WEI     por día UTC    (default 5e18)
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
  type Agent,
  type PanalClient,
} from '@panal/sdk';
import { QuoteBook, SpendLedger, limitsFromEnv } from './limits.js';
import { briefSignMessage, fetchResultText, pushBrief, resultSignMessage } from './fetch-result.js';

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
      'Este servidor está en SOLO LECTURA. Para contratar hay que arrancarlo con ' +
      'MCP_ENABLE_WRITES=true y una MCP_PRIVATE_KEY con fondos. Dile a la persona que lo configure ella: ' +
      'no intentes rodearlo.'
    );
  }
  if (!account) {
    return 'MCP_ENABLE_WRITES está activo pero no hay una MCP_PRIVATE_KEY válida, así que no hay wallet con la que pagar.';
  }
  return null;
}

// ---------------------------------------------------------------------------
// Presentación
// ---------------------------------------------------------------------------

function symbolOf(currency: Address): string {
  return currency.toLowerCase() === NATIVE_CURRENCY.toLowerCase() ? 'MON' : '$PANAL';
}

function renderAgent(agent: Agent): string {
  const price = `${formatEther(agent.pricePerTask)} ${symbolOf(agent.currency)}`;
  const skills = agent.metadata.skills.length ? agent.metadata.skills.join(', ') : '(sin skills declaradas)';
  return [
    `${agent.metadata.name || '(sin nombre)'} — ${agent.address}`,
    `  Estado: ${agent.active ? 'activo' : 'DADO DE BAJA (no acepta encargos)'}`,
    `  Precio: ${price} por tarea`,
    `  Skills: ${skills}`,
    agent.metadata.description ? `  Descripción: ${agent.metadata.description}` : null,
    agent.metadata.botUrl ? `  Endpoint: ${agent.metadata.botUrl}` : null,
    `  Ficha: ${EXPLORER}/address/${agent.address}`,
  ]
    .filter(Boolean)
    .join('\n');
}

function renderTask(task: Awaited<ReturnType<PanalClient['getTask']>>): string {
  const deadline = new Date(Number(task.deadline) * 1000).toISOString();
  return [
    `Tarea #${task.id} — ${TaskStatus[task.status] ?? task.status}`,
    `  Cliente: ${task.client}`,
    `  Agente:  ${task.worker}`,
    `  Importe: ${formatEther(task.amount)} ${symbolOf(task.currency)}`,
    `  Plazo:   ${deadline}`,
    `  Hash del encargo: ${task.taskHash}`,
    task.resultHash && !/^0x0+$/.test(task.resultHash) ? `  Hash del resultado: ${task.resultHash}` : null,
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
      'Busca agentes de IA en el marketplace Panal (Monad mainnet) por texto libre sobre su nombre, ' +
      'descripción y skills. Sin búsqueda devuelve todos los activos. Datos leídos de la cadena en vivo.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Qué buscas, p. ej. "traducción" o "resúmenes legales".' },
        include_inactive: { type: 'boolean', description: 'Incluir agentes dados de baja. Por defecto no.' },
      },
    },
    handler: async (args) => {
      const found = await panal.searchAgents(str(args.query), {
        includeInactive: args.include_inactive === true,
      });
      if (!found.length) {
        return str(args.query)
          ? `Ningún agente activo encaja con "${str(args.query)}". Prueba con un término más general o mira todos sin búsqueda.`
          : 'Ahora mismo no hay agentes activos en el marketplace.';
      }
      return `${found.length} agente(s):\n\n${found.map(renderAgent).join('\n\n')}`;
    },
  },
  {
    name: 'panal_get_agent',
    description: 'Ficha completa de un agente de Panal por su dirección.',
    inputSchema: {
      type: 'object',
      properties: { address: { type: 'string', description: 'Dirección 0x… del agente.' } },
      required: ['address'],
    },
    handler: async (args) => {
      const address = str(args.address);
      if (!address || !isAddress(address)) return 'Necesito una dirección 0x válida.';
      return renderAgent(await panal.getAgent(address));
    },
  },
  {
    name: 'panal_get_task',
    description: 'Estado de un encargo en el escrow de Panal: importe, plazo, agente y si ya se entregó.',
    inputSchema: {
      type: 'object',
      properties: { task_id: { type: 'number', description: 'Id numérico de la tarea.' } },
      required: ['task_id'],
    },
    handler: async (args) => {
      const id = Number(args.task_id);
      if (!Number.isInteger(id) || id < 0) return 'El id de la tarea es un entero mayor o igual que cero.';
      const count = await panal.getTaskCount();
      if (BigInt(id) >= count) return `La tarea #${id} no existe: ahora mismo hay ${count}.`;
      return renderTask(await panal.getTask(BigInt(id)));
    },
  },
  {
    name: 'panal_marketplace_stats',
    description: 'Cifras del marketplace Panal: cuántos agentes hay, cuántos activos y cuántos encargos van.',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      const [agents, taskCount] = await Promise.all([panal.listAgents(), panal.getTaskCount()]);
      const active = agents.filter((a) => a.active);
      return [
        `Agentes registrados: ${agents.length}`,
        `Agentes activos: ${active.length}`,
        `Encargos creados: ${taskCount}`,
        `Escrow: ${panal.addresses.escrow}`,
        `Registry: ${panal.addresses.registry}`,
        '',
        active.length ? `Activos ahora:\n${active.map(renderAgent).join('\n\n')}` : 'No hay agentes activos.',
      ].join('\n');
    },
  },
];

const WRITE_TOOLS: Tool[] = [
  {
    name: 'panal_wallet',
    description:
      'Estado de la wallet con la que este servidor pagaría: dirección, saldo y cuánto queda del ' +
      'presupuesto de hoy. Úsala antes de contratar para saber si hay fondos.',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      const blocked = writesBlockedReason();
      if (blocked) return blocked;
      const address = account!.address;
      const [balance, spent] = [await panal.publicClient.getBalance({ address }), ledger.spentToday()];
      const left = limits.dailyBudgetWei > spent ? limits.dailyBudgetWei - spent : 0n;
      return [
        `Wallet: ${address}`,
        `Saldo: ${formatEther(balance)} MON`,
        `Tope por encargo: ${formatEther(limits.maxPerTaskWei)}`,
        `Presupuesto de hoy: gastado ${formatEther(spent)} de ${formatEther(limits.dailyBudgetWei)} · queda ${formatEther(left)}`,
      ].join('\n');
    },
  },
  {
    name: 'panal_quote_hire',
    description:
      'Presupuesta un encargo SIN pagar nada. Devuelve el precio real del agente y un quote_id. ' +
      'Enseña siempre el precio a la persona y espera su visto bueno antes de llamar a panal_hire.',
    inputSchema: {
      type: 'object',
      properties: {
        agent: { type: 'string', description: 'Dirección 0x… del agente.' },
        brief: { type: 'string', description: 'El encargo, redactado con todo el detalle necesario.' },
      },
      required: ['agent', 'brief'],
    },
    handler: async (args) => {
      const blocked = writesBlockedReason();
      if (blocked) return blocked;
      const address = str(args.agent);
      const brief = str(args.brief);
      if (!address || !isAddress(address)) return 'Necesito una dirección 0x válida del agente.';
      if (!brief) return 'Necesito el texto del encargo.';

      const agent = await panal.getAgent(address);
      if (!agent.active) return `${agent.metadata.name || address} está dado de baja y no acepta encargos.`;

      const amount = agent.pricePerTask;
      const symbol = symbolOf(agent.currency);
      if (amount > limits.maxPerTaskWei) {
        return (
          `Ese agente cobra ${formatEther(amount)} ${symbol} y el tope por encargo de este servidor es ` +
          `${formatEther(limits.maxPerTaskWei)}. No se puede contratar sin que la persona suba MCP_MAX_PER_TASK_WEI.`
        );
      }
      const spent = ledger.spentToday();
      if (spent + amount > limits.dailyBudgetWei) {
        return (
          `Se pasaría del presupuesto de hoy: llevas ${formatEther(spent)} de ${formatEther(limits.dailyBudgetWei)} ` +
          `y esto cuesta ${formatEther(amount)} ${symbol}.`
        );
      }

      const quote = quotes.issue({
        worker: agent.address,
        agentName: agent.metadata.name || agent.address,
        brief,
        amount,
        currency: agent.currency,
        symbol,
        botUrl: agent.metadata.botUrl,
      });

      return [
        `Presupuesto para ${quote.agentName}:`,
        `  Precio: ${formatEther(amount)} ${symbol}`,
        `  Plazo: ${limits.deadlineHours} h desde que se contrate`,
        `  Encargo: ${brief.length > 200 ? `${brief.slice(0, 200)}…` : brief}`,
        '',
        `quote_id: ${quote.id}  (vale 5 minutos)`,
        '',
        'Enséñale este precio a la persona. Solo si dice que sí, llama a panal_hire con ese quote_id ' +
          'y confirmed_by_user: true. Esto mueve dinero real.',
      ].join('\n');
    },
  },
  {
    name: 'panal_hire',
    description:
      'Contrata al agente y BLOQUEA EL PAGO REAL en el escrow. Exige un quote_id de panal_quote_hire y ' +
      'que la persona haya dicho que sí de forma explícita. No lo llames por iniciativa propia.',
    inputSchema: {
      type: 'object',
      properties: {
        quote_id: { type: 'string', description: 'El id devuelto por panal_quote_hire.' },
        confirmed_by_user: {
          type: 'boolean',
          description: 'true solo si la persona ha visto el precio y ha dado su visto bueno.',
        },
      },
      required: ['quote_id', 'confirmed_by_user'],
    },
    handler: async (args) => {
      const blocked = writesBlockedReason();
      if (blocked) return blocked;
      if (args.confirmed_by_user !== true) {
        return 'No contrato sin confirmed_by_user: true. Enséñale el presupuesto a la persona y pregúntale primero.';
      }
      const id = str(args.quote_id);
      if (!id) return 'Falta el quote_id. Pide antes un presupuesto con panal_quote_hire.';

      const redeemed = quotes.redeem(id);
      if ('error' in redeemed) return redeemed.error;
      const quote = redeemed.quote;

      // Los topes se re-evalúan al contratar: entre el presupuesto y el "sí"
      // pueden haber pasado minutos y otros encargos.
      const spent = ledger.spentToday();
      if (spent + quote.amount > limits.dailyBudgetWei) {
        return `Mientras tanto se agotó el presupuesto de hoy (${formatEther(spent)} de ${formatEther(limits.dailyBudgetWei)}).`;
      }

      const deadline = BigInt(Math.floor(Date.now() / 1000) + limits.deadlineHours * 3600);
      try {
        const result = await panal.hire({ agent: quote.worker, brief: quote.brief, deadline });
        ledger.record(result.amount);
        log(`contratada #${result.taskId} a ${quote.worker} por ${formatEther(result.amount)} ${quote.symbol}`);

        // Contratar sin entregar el encargo deja la tarea a medias: el pago
        // bloqueado y el agente esperando un texto que nadie le manda. Se hace
        // aquí, no se le pide al usuario, porque quien está leyendo esto es un
        // modelo en mitad de una conversación y no va a abrir una terminal.
        let entregaBrief: string;
        if (!quote.botUrl) {
          entregaBrief = 'Ese agente no publica endpoint: hazle llegar el encargo por el canal que uses con él.';
        } else {
          const firma = await account!.signMessage({ message: briefSignMessage(result.taskId) });
          const fallo = await pushBrief(quote.botUrl, result.taskId, quote.brief, account!.address, firma);
          if (fallo === null) {
            entregaBrief = `Encargo entregado a ${quote.botUrl}: el agente ya está trabajando.`;
            log(`brief #${result.taskId} entregado en ${quote.botUrl}`);
          } else {
            entregaBrief =
              `AVISO: el pago está bloqueado pero el encargo NO llegó (${fallo}).\n` +
              `El agente no puede empezar. Reintenta con panal_send_brief ${result.taskId}, ` +
              `o el pago vuelve solo cuando venza el plazo.`;
            log(`brief #${result.taskId} NO entregado: ${fallo}`);
          }
        }

        return [
          `Contratado. Tarea #${result.taskId} creada y pago bloqueado en el escrow.`,
          `  Agente: ${quote.agentName}`,
          `  Importe: ${formatEther(result.amount)} ${quote.symbol}`,
          `  tx: ${EXPLORER}/tx/${result.txHash}`,
          '',
          entregaBrief,
          '',
          `Cuando entregue, revisa con panal_get_task ${result.taskId} y aprueba con panal_approve_task.`,
        ].join('\n');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log(`fallo al contratar: ${msg}`);
        return `No se pudo contratar: ${msg}`;
      }
    },
  },
  {
    name: 'panal_get_result',
    description:
      'Recoge el resultado de una tarea ya entregada. El texto vive fuera de la cadena: se le pide al ' +
      'endpoint del agente firmando como cliente, y se comprueba que su hash coincide con el anclado ' +
      'on-chain. Solo funciona para tareas que contrató la wallet de este servidor.',
    inputSchema: {
      type: 'object',
      properties: { task_id: { type: 'number', description: 'Id de la tarea entregada.' } },
      required: ['task_id'],
    },
    handler: async (args) => {
      if (!account) return 'Sin MCP_PRIVATE_KEY no se puede firmar la petición del resultado.';
      const id = Number(args.task_id);
      if (!Number.isInteger(id) || id < 0) return 'El id de la tarea es un entero mayor o igual que cero.';
      const taskId = BigInt(id);

      const task = await panal.getTask(taskId);
      if (task.client.toLowerCase() !== account.address.toLowerCase()) {
        return `La tarea #${id} la contrató ${task.client}, no esta wallet. Solo el cliente puede recoger el resultado.`;
      }
      if (/^0x0+$/.test(task.resultHash)) {
        return `La tarea #${id} todavía no tiene resultado entregado (estado: ${TaskStatus[task.status] ?? task.status}).`;
      }

      const agent = await panal.getAgent(task.worker);
      if (!agent.metadata.botUrl) {
        return (
          `El agente ${agent.metadata.name || task.worker} no publica endpoint, así que el resultado no se puede ` +
          `descargar por aquí. En la cadena consta su hash (${task.resultHash}): pídeselo por vuestro canal y ` +
          'comprueba que el hash coincide.'
        );
      }

      try {
        const signature = await account.signMessage({ message: resultSignMessage(taskId) });
        const text = await fetchResultText(agent.metadata.botUrl, taskId, account.address, signature);

        // Lo que importa de todo esto: que el texto sea EXACTAMENTE el que se
        // ancló. Sin esta comprobación, el agente podría entregar una cosa
        // on-chain y enseñarte otra distinta.
        const actual = keccak256(toBytes(text));
        if (actual.toLowerCase() !== task.resultHash.toLowerCase()) {
          return (
            `⚠️ El resultado que devuelve el agente NO coincide con el anclado on-chain.\n` +
            `  esperado: ${task.resultHash}\n  recibido: ${actual}\n\n` +
            'No lo apruebes: o el agente cambió el texto después de entregar, o alguien alteró la respuesta. ' +
            'Puedes abrir una disputa desde https://panal.lat/dashboard.'
          );
        }
        return `Resultado de la tarea #${id} (hash verificado contra la cadena):\n\n${text}`;
      } catch (err) {
        return `No se pudo recoger el resultado: ${err instanceof Error ? err.message : err}`;
      }
    },
  },
  {
    name: 'panal_send_brief',
    description:
      'Vuelve a entregarle el encargo a un agente ya contratado, cuando el envío automático de ' +
      'panal_hire no llegó. NO cuesta dinero: el pago ya está bloqueado, esto solo repite el envío ' +
      'por HTTP. El texto tiene que ser EXACTAMENTE el que se contrató, porque su hash quedó en la cadena.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'number', description: 'Id de la tarea ya creada.' },
        brief: { type: 'string', description: 'El encargo, palabra por palabra igual que al contratar.' },
      },
      required: ['task_id', 'brief'],
    },
    handler: async (args) => {
      const blocked = writesBlockedReason();
      if (blocked) return blocked;
      const id = Number(args.task_id);
      if (!Number.isInteger(id) || id < 0) return 'Necesito un id de tarea válido.';
      const brief = str(args.brief);
      if (!brief) return 'Necesito el texto del encargo.';

      const task = await panal.getTask(BigInt(id));
      if (task.client.toLowerCase() !== account!.address.toLowerCase()) {
        return `La tarea #${id} no la contrató esta wallet, así que su firma no vale para mandarle el encargo.`;
      }
      if (task.status !== TaskStatus.Open) {
        return `La tarea #${id} está ${TaskStatus[task.status]}: ya no admite el encargo.`;
      }
      // Se comprueba aquí antes de molestar al agente: así el error dice que el
      // texto no es el mismo, en vez de un 409 sin contexto desde el endpoint.
      if (keccak256(toBytes(brief)) !== task.taskHash) {
        return [
          'Ese texto NO es el que se contrató: su hash no coincide con el de la cadena.',
          `  hash contratado: ${task.taskHash}`,
          `  hash de tu texto: ${keccak256(toBytes(brief))}`,
          'Tiene que ser idéntico, carácter por carácter. Un espacio de más ya lo cambia.',
        ].join('\n');
      }

      const agent = await panal.getAgent(task.worker);
      if (!agent.metadata.botUrl) return 'Ese agente no publica endpoint: no hay a dónde mandarle el encargo.';

      const firma = await account!.signMessage({ message: briefSignMessage(BigInt(id)) });
      const fallo = await pushBrief(agent.metadata.botUrl, BigInt(id), brief, account!.address, firma);
      if (fallo === null) {
        log(`brief #${id} entregado (reintento) en ${agent.metadata.botUrl}`);
        return `Encargo entregado. El agente ya está trabajando en la tarea #${id}.`;
      }
      return `Sigue sin llegar (${fallo}). El pago sigue bloqueado y vuelve solo al vencer el plazo.`;
    },
  },
  {
    name: 'panal_approve_task',
    description:
      'Aprueba el resultado entregado, LIBERA EL PAGO al agente y le deja una valoración de 1 a 5. ' +
      'Solo tras enseñarle el resultado a la persona y que ella decida la nota.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'number', description: 'Id de la tarea entregada.' },
        rating: { type: 'number', description: 'Valoración de 1 a 5 que ha decidido la persona.' },
        confirmed_by_user: { type: 'boolean', description: 'true solo si la persona lo ha aprobado.' },
      },
      required: ['task_id', 'rating', 'confirmed_by_user'],
    },
    handler: async (args) => {
      const blocked = writesBlockedReason();
      if (blocked) return blocked;
      if (args.confirmed_by_user !== true) {
        return 'No libero el pago sin confirmed_by_user: true. Enséñale el resultado a la persona primero.';
      }
      const id = Number(args.task_id);
      const rating = Number(args.rating);
      if (!Number.isInteger(id) || id < 0) return 'El id de la tarea es un entero.';
      if (!Number.isInteger(rating) || rating < 1 || rating > 5) return 'La valoración es un entero de 1 a 5.';

      try {
        const hash = await panal.approveTask(BigInt(id), rating);
        return `Pago liberado para la tarea #${id} con valoración ${rating}/5.\n  tx: ${EXPLORER}/tx/${hash}`;
      } catch (err) {
        return `No se pudo aprobar: ${err instanceof Error ? err.message : err}`;
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
        replyError(req.id, -32602, `No existe la herramienta "${name}".`);
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
