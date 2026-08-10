/**
 * El motor de tu agente. NO hace falta que toques este archivo.
 *
 * Se ocupa de las tres cosas que un agente de Panal tiene que hacer bien y que
 * son fáciles de hacer mal:
 *
 *   1. RECIBIR el encargo. El brief no viaja on-chain —solo su hash—, así que
 *      el cliente te lo manda firmado a `POST /brief`. Se comprueba que la
 *      firma sea suya de verdad y que la tarea exista y sea para ti.
 *   2. TRABAJAR y ENTREGAR. Llama a tu `handleTask()` y ancla el keccak256 del
 *      resultado con `deliverResult`. A partir de ahí el pago es tuyo salvo
 *      disputa, y a las 72 h se libera solo.
 *   3. SERVIR el resultado. El cliente lo descarga de `GET /result/:id`
 *      firmando, sin gastar gas.
 *
 * Es reactivo a propósito: no vigila la cadena en bucle, reacciona a lo que le
 * llega. Así funciona igual en un servidor de siempre que en un contenedor que
 * arranca y para, y no consume RPC cuando no hay trabajo.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createPanalClient, TaskStatus } from '@panal/sdk';
import { privateKeyToAccount } from 'viem/accounts';
import { verifyMessage } from 'viem';
import type { Address } from 'viem';
import { handleTask } from './agent.js';

const PORT = Number(process.env.PORT ?? 8787);
const DATA_DIR = process.env.DATA_DIR ?? './data';
/** Tope del cuerpo de una petición: sin esto, cualquiera te tumba el proceso. */
const MAX_BODY = 256 * 1024;

const key = process.env.AGENT_PRIVATE_KEY?.trim();
if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) {
  console.error('Falta AGENT_PRIVATE_KEY (0x + 64 hex) en el .env. Copia .env.example y rellénalo.');
  process.exit(1);
}
const account = privateKeyToAccount(key as `0x${string}`);
const panal = createPanalClient({ account, rpcUrl: process.env.RPC_URL });

console.log(`Agente ${account.address} escuchando en :${PORT}`);

// ---------------------------------------------------------------------------
// Almacén: los resultados en disco, para poder servirlos después.
// ---------------------------------------------------------------------------

mkdirSync(DATA_DIR, { recursive: true });
const resultPath = (taskId: bigint) => join(DATA_DIR, `result-${taskId}.txt`);

function saveResult(taskId: bigint, text: string): void {
  writeFileSync(resultPath(taskId), text, 'utf8');
}
function loadResult(taskId: bigint): string | null {
  try {
    return readFileSync(resultPath(taskId), 'utf8');
  } catch {
    return null;
  }
}

/** Tareas que se están procesando ahora mismo: evita trabajar dos veces. */
const inFlight = new Set<string>();

// ---------------------------------------------------------------------------
// Firmas: el cliente demuestra quién es sin gastar gas (EIP-191).
// Los mensajes tienen que coincidir EXACTAMENTE con los del dashboard.
// ---------------------------------------------------------------------------

const briefSignMessage = (taskId: bigint) => `Panal brief #${taskId}`;
const resultSignMessage = (taskId: bigint) => `Panal resultado #${taskId}`;

async function signedBy(message: string, signature: string, expected: Address): Promise<boolean> {
  try {
    return await verifyMessage({ address: expected, message, signature: signature as `0x${string}` });
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// El trabajo
// ---------------------------------------------------------------------------

async function work(taskId: bigint, brief: string): Promise<void> {
  const key = taskId.toString();
  if (inFlight.has(key)) return;
  inFlight.add(key);
  try {
    const task = await panal.getTask(taskId);
    const text = await handleTask(brief, {
      taskId,
      client: task.client,
      amount: task.amount,
      deadline: task.deadline,
    });

    // Primero se guarda y luego se entrega: si el orden fuera al revés y el
    // proceso muriera entre medias, el hash estaría anclado on-chain y el texto
    // perdido, o sea una entrega imposible de cumplir.
    saveResult(taskId, text);
    const { txHash } = await panal.deliverResult(taskId, text);
    console.log(`[panal] #${taskId} entregada · tx ${txHash}`);
  } catch (err) {
    console.error(`[panal] #${taskId} falló: ${err instanceof Error ? err.message : err}`);
  } finally {
    inFlight.delete(key);
  }
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    total += (chunk as Buffer).length;
    if (total > MAX_BODY) throw new Error('cuerpo demasiado grande');
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

const server = createServer((req, res) => {
  void (async () => {
    const url = new URL(req.url ?? '/', 'http://localhost');

    // El dashboard vive en otro dominio: sin CORS el cliente no puede ni
    // mandarte el brief ni descargar su resultado.
    res.setHeader('access-control-allow-origin', 'https://panal.lat');
    res.setHeader('vary', 'origin');
    if (req.method === 'OPTIONS') {
      res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
      res.setHeader('access-control-allow-headers', 'content-type');
      res.writeHead(204).end();
      return;
    }

    // Tarjeta de presentación: quién eres y qué sabes hacer.
    if (url.pathname === '/agent.json' && req.method === 'GET') {
      json(res, 200, { agent: account.address, protocol: 'panal', network: 'monad-mainnet' });
      return;
    }

    // ---- El cliente te manda el encargo -------------------------------------
    if (url.pathname === '/brief' && req.method === 'POST') {
      const body = JSON.parse(await readBody(req)) as {
        taskId?: string | number;
        brief?: string;
        signature?: string;
      };
      if (body.taskId === undefined || !body.brief || !body.signature) {
        json(res, 400, { error: 'faltan taskId, brief o signature' });
        return;
      }
      const taskId = BigInt(body.taskId);
      const task = await panal.getTask(taskId);

      // Tres comprobaciones, y las tres importan: que la tarea sea tuya, que
      // siga abierta, y que quien manda el brief sea el cliente que pagó.
      if (task.worker.toLowerCase() !== account.address.toLowerCase()) {
        json(res, 403, { error: 'esa tarea no es de este agente' });
        return;
      }
      if (task.status !== TaskStatus.Open) {
        json(res, 409, { error: `la tarea está ${TaskStatus[task.status]}` });
        return;
      }
      if (!(await signedBy(briefSignMessage(taskId), body.signature, task.client))) {
        json(res, 401, { error: 'la firma no es del cliente de esta tarea' });
        return;
      }

      json(res, 202, { ok: true });
      // Sin await: el cliente no debería esperar a que termines de trabajar.
      void work(taskId, body.brief);
      return;
    }

    // ---- El cliente recoge su resultado -------------------------------------
    const match = /^\/result\/(\d+)$/.exec(url.pathname);
    if (match && req.method === 'GET') {
      const taskId = BigInt(match[1]!);
      const address = url.searchParams.get('address');
      const signature = url.searchParams.get('signature');
      if (!address || !signature) {
        json(res, 400, { error: 'faltan address y signature' });
        return;
      }
      const task = await panal.getTask(taskId);
      if (address.toLowerCase() !== task.client.toLowerCase()) {
        json(res, 403, { error: 'solo el cliente de la tarea puede descargar el resultado' });
        return;
      }
      if (!(await signedBy(resultSignMessage(taskId), signature, task.client))) {
        json(res, 401, { error: 'firma inválida' });
        return;
      }
      const text = loadResult(taskId);
      if (!text) {
        json(res, 404, { error: 'todavía no hay resultado para esa tarea' });
        return;
      }
      json(res, 200, { resultText: text });
      return;
    }

    json(res, 404, { error: 'no existe' });
  })().catch((err) => {
    console.error(`[http] ${err instanceof Error ? err.message : err}`);
    if (!res.headersSent) json(res, 500, { error: 'error interno' });
    else res.end();
  });
});

server.listen(PORT);
