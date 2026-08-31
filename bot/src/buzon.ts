/**
 * Panal — el BUZÓN: el correo de los agentes que no tienen servidor.
 *
 * QUÉ PROBLEMA RESUELVE
 *
 * El encargo no viaja on-chain: la cadena guarda `keccak256(brief)` y el texto
 * se le manda al agente a la URL que publica en su ficha (`bot:<url>`). Lo que
 * entrega se descarga de esa misma URL. Un agente sin servidor, por tanto, no
 * puede leer lo que le piden ni servir lo que hace — y eso deja fuera a todo
 * el que no quiera montar y mantener una máquina encendida, que es casi todo
 * el mundo, empezando por las personas.
 *
 * Esto es esa URL, prestada. Habla el MISMO protocolo que el servidor del bot
 * (`http.ts`), así que la web y la app no cambian una línea: un agente escribe
 * `bot:https://api.panal.lat/buzon/0x…` en su ficha y a partir de ahí recibe
 * encargos como cualquier otro. Añade dos rutas que el bot no necesita —él ES
 * el servidor— para que su dueño pueda leer y entregar desde el navegador:
 *
 *   Cliente (idéntico al bot):
 *     POST /buzon/:agente/brief/:taskId     deja el encargo
 *     POST /buzon/:agente/upload/:taskId    deja un adjunto del encargo
 *     GET  /buzon/:agente/result/:taskId    se lleva la entrega
 *     GET  /buzon/:agente/agent.json        la ficha, leída de la cadena
 *   Dueño del agente (nuevas):
 *     GET  /buzon/:agente/encargo/:taskId   lee lo que le han pedido
 *     POST /buzon/:agente/entrega/:taskId   deja lo que ha hecho
 *     POST /buzon/:agente/entrega-archivo/:taskId  deja un archivo entregado
 *   Los dos:
 *     GET  /buzon/:agente/archivo/:taskId/:nombre  se lleva un archivo
 *
 * QUÉ NO PUEDE HACER
 *
 * Ni cobrar, ni entregar, ni mover un encargo: todo eso lo firma una wallet, y
 * aquí no hay ninguna. No hay claves privadas en este proceso.
 *
 * Y tampoco puede mentir sobre lo que guarda, y no por buena voluntad:
 *
 *   - un brief solo se acepta si `keccak256(brief)` es el `taskHash` que ya
 *     está en la cadena;
 *   - una entrega, si la tarea ya tiene `resultHash` anclado, solo se acepta
 *     si sus bytes dan ese hash.
 *
 * Con eso, un buzón comprometido puede dejar de servir —eso sí— pero no puede
 * cambiar una coma de lo que las partes firmaron. El cliente, además, vuelve a
 * comprobarlo por su cuenta al descargar.
 *
 * LO QUE SÍ VE
 *
 * El texto de los encargos y de las entregas de quien lo use, en claro. Es el
 * precio de no tener servidor, y va dicho en la ficha del agente: no es un
 * detalle de implementación, es parte del trato.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { getAddress, isAddress, isHex, keccak256, toBytes, verifyMessage, type Address, type Hex } from 'viem';
import { allowedOrigin, clientIp } from './net.js';
import { leerNivelesDeMetadata } from './niveles.js';
import { currencySymbol, getRegistryAgent, getTask, monad, TaskStatus, type ChainClients, type RegistryAgent, type Task } from './chain.js';
import { MAX_BRIEF_CHARS, parseMetadataURI, type AgentJson } from './http.js';
import type { BotConfig } from './config.js';
import { MAX_ARCHIVO_BYTES, type BuzonStore } from './buzon-store.js';

/* ── lo que se firma ──────────────────────────────────────────────────────
 *
 * Las dos primeras las firma el CLIENTE y ya existen: son las del bot, y aquí
 * se repiten porque tienen que decir exactamente lo mismo. Las dos últimas las
 * firma el TRABAJADOR y son nuevas.
 *
 * Todas llevan el taskId dentro (una firma de un encargo no vale para otro) y
 * las nuevas llevan además la caducidad, porque una firma es un pase: si se
 * filtra, lo que limita el daño es que expire. Deben coincidir con las de
 * `src/lib/botEndpoint.ts` en la web.
 */

/** La firma con la que el cliente manda su encargo. */
export function briefSignMessage(taskId: bigint): string {
  return `Panal brief #${taskId.toString()}`;
}

/** La firma con la que el cliente se descarga la entrega (formato antiguo). */
export function resultSignMessage(taskId: bigint): string {
  return `Panal resultado #${taskId.toString()}`;
}

/** La misma, con caducidad dentro. Es la que manda la web. */
export function resultSignMessageConCaducidad(taskId: bigint, expira: number): string {
  return `Panal resultado #${taskId.toString()} · ${expira}`;
}

/** La firma con la que el TRABAJADOR lee lo que le han encargado. */
export function encargoSignMessage(taskId: bigint, expira: number): string {
  return `Panal encargo #${taskId.toString()} · ${expira}`;
}

/** La firma con la que el TRABAJADOR deja su entrega en el buzón. */
export function entregaSignMessage(taskId: bigint, expira: number): string {
  return `Panal entrega #${taskId.toString()} · ${expira}`;
}

/** Lo máximo que puede durar una firma. Abre un encargo entero. */
const MAX_VENTANA_S = 15 * 60;

/**
 * Tope de la entrega, en caracteres.
 *
 * Más generoso que el del encargo porque la asimetría es real: se pide en un
 * párrafo y se contesta con un informe. El tope existe para que el buzón no
 * sea un disco duro gratis, no para acotar lo que alguien puede escribir.
 */
export const MAX_ENTREGA_CHARS = 200_000;

const MAX_BRIEF_BODY_BYTES = MAX_BRIEF_CHARS * 4 + 4_096;
const MAX_ENTREGA_BODY_BYTES = MAX_ENTREGA_CHARS * 4 + 4_096;

/** El hash de una tarea sin entregar. */
const SIN_HASH = '0x0000000000000000000000000000000000000000000000000000000000000000';

// ---------------------------------------------------------------------------
// Rate limit por IP: mismo patrón que http.ts e indexer-http.ts.
// ---------------------------------------------------------------------------

const RATE_LIMIT_MAX = 60;
const RATE_LIMIT_WINDOW_MS = 60_000;
const hitsByIp = new Map<string, number[]>();

function rateLimitOk(ip: string): boolean {
  const now = Date.now();
  const hits = (hitsByIp.get(ip) ?? []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (hits.length >= RATE_LIMIT_MAX) {
    hitsByIp.set(ip, hits);
    return false;
  }
  hits.push(now);
  hitsByIp.set(ip, hits);
  return true;
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

/** Lee el body crudo de un POST (null si supera maxBytes o hay error). */
function readBody(req: IncomingMessage, maxBytes: number): Promise<string | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        resolve(null);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', () => resolve(null));
  });
}

/**
 * El nombre de un archivo, reducido a lo que puede ser un nombre.
 *
 * Lo escribe quien sube, así que aquí no se «arregla»: se recorta a lo que
 * vale y, si no queda nada, no vale. De este nombre NO sale ninguna ruta —los
 * bytes se guardan por su hash— pero sí sale lo que se enseña y lo que se
 * pide, y una barra dentro haría que la URL de descarga no fuera la que el
 * manifiesto anunció.
 */
export function sanearNombre(nombre: string): string {
  return nombre
    .replace(/[\\/\r\n\t\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

/** Lee el cuerpo binario de un POST (null si pasa de maxBytes o falla). */
function readBytes(req: IncomingMessage, maxBytes: number): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const trozos: Buffer[] = [];
    let size = 0;
    req.on('data', (trozo: Buffer) => {
      size += trozo.length;
      if (size > maxBytes) {
        resolve(null);
        req.destroy();
        return;
      }
      trozos.push(trozo);
    });
    req.on('end', () => resolve(Buffer.concat(trozos)));
    req.on('error', () => resolve(null));
  });
}

/** Credenciales de una petición firmada: en cabeceras, o en la query. */
function credenciales(req: IncomingMessage, url: URL): {
  address: string;
  signature: string;
  expira: string | null;
} {
  const cabecera = (n: string): string | null => {
    const v = req.headers[n];
    return typeof v === 'string' ? v : Array.isArray(v) ? (v[0] ?? null) : null;
  };
  return {
    address: cabecera('x-panal-address') ?? url.searchParams.get('address') ?? '',
    signature: cabecera('x-panal-signature') ?? url.searchParams.get('signature') ?? '',
    expira: cabecera('x-panal-expira') ?? url.searchParams.get('expira'),
  };
}

/**
 * Comprueba una firma con caducidad dentro.
 *
 * La caducidad va DENTRO del mensaje firmado: cambiarla invalida la firma, así
 * que el número que llega al lado no se puede tocar por el camino.
 */
async function firmaVigente(
  address: Address,
  signature: Hex,
  expiraCrudo: string | null,
  mensaje: (expira: number) => string,
): Promise<boolean> {
  const expira = Number(expiraCrudo);
  const ahora = Math.floor(Date.now() / 1000);
  if (!Number.isInteger(expira) || expira <= ahora || expira > ahora + MAX_VENTANA_S) return false;
  try {
    return await verifyMessage({ address, message: mensaje(expira), signature });
  } catch {
    return false;
  }
}

export interface BuzonDeps {
  store: BuzonStore;
  /** Lectura de la tarea on-chain (inyectable en las pruebas). */
  fetchTask: (taskId: bigint) => Promise<Task>;
  /** Lectura de la ficha del agente en el registro (inyectable). */
  fetchAgent: (agente: Address) => Promise<RegistryAgent>;
  /** Direcciones de los contratos, para la ficha. */
  contratos: { escrow: Address; registry: Address; token: Address };
  /** La URL pública del buzón, sin barra final. Para `endpoints.base`. */
  urlPublica?: string;
  /** El símbolo de la moneda de un agente, para la ficha. */
  simboloDe: (currency: Address) => string;
  /** La API del índice, que la ficha anuncia igual que la del bot. */
  indexer: string;
  allowLocalhostOrigin: boolean;
  maxUrlLength?: number;
}

/**
 * Qué agente y qué ruta pide una URL.
 *
 * Se acepta con y sin el prefijo `/buzon` para que dé igual si el proxy de
 * delante lo quita: un despliegue que lo estuviera quitando devolvería 404 en
 * todo, y el agente afectado se enteraría con un encargo pagado en la mano.
 */
function partes(pathname: string): { agente: Address; resto: string } | null {
  const m = /^(?:\/buzon)?\/(0x[0-9a-fA-F]{40})\/(.*)$/.exec(pathname);
  if (!m) return null;
  return { agente: getAddress(m[1]!), resto: m[2]! };
}

export function createBuzonServer(deps: BuzonDeps): Server {
  const maxUrlLength = deps.maxUrlLength ?? 2_048;

  /**
   * La tarea, comprobando que es de ESTE agente.
   *
   * Sin esta comprobación el buzón sería un disco duro para cualquiera: se
   * podría dejar texto bajo la dirección de otro. Además es lo que ata cada
   * archivo guardado a una tarea real, y una tarea real cuesta dinero.
   */
  const tareaDe = async (
    agente: Address,
    taskId: bigint,
    res: ServerResponse,
  ): Promise<Task | null> => {
    let task: Task;
    try {
      task = await deps.fetchTask(taskId);
    } catch (err) {
      console.warn(
        `[buzon] no se pudo leer tasks(${taskId}): ${err instanceof Error ? err.message.split('\n')[0] : err}`,
      );
      json(res, 502, { error: 'rpc error' });
      return null;
    }
    if (task.worker.toLowerCase() !== agente.toLowerCase()) {
      json(res, 404, { error: 'not this agent' });
      return null;
    }
    return task;
  };

  // ---- POST /brief/:taskId — el cliente deja el encargo ---------------------
  const dejarBrief = async (
    agente: Address,
    taskId: bigint,
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> => {
    const raw = await readBody(req, MAX_BRIEF_BODY_BYTES);
    if (raw === null) {
      json(res, 413, { error: 'body too large' });
      return;
    }
    let brief = '';
    let addressParam = '';
    let signatureParam = '';
    try {
      const body = JSON.parse(raw || '{}') as Record<string, unknown>;
      if (typeof body.brief === 'string') brief = body.brief;
      if (typeof body.address === 'string') addressParam = body.address;
      if (typeof body.signature === 'string') signatureParam = body.signature;
    } catch {
      json(res, 400, { error: 'bad json' });
      return;
    }
    if (brief.trim().length === 0 || brief.length > MAX_BRIEF_CHARS) {
      json(res, 400, { error: `brief requerido, máx. ${MAX_BRIEF_CHARS} caracteres` });
      return;
    }
    if (!isAddress(addressParam)) {
      json(res, 400, { error: 'bad address' });
      return;
    }
    if (!isHex(signatureParam)) {
      json(res, 400, { error: 'bad signature' });
      return;
    }
    const address = getAddress(addressParam);

    const task = await tareaDe(agente, taskId, res);
    if (!task) return;

    let firmaOk = false;
    try {
      firmaOk = await verifyMessage({
        address,
        message: briefSignMessage(taskId),
        signature: signatureParam as Hex,
      });
    } catch {
      firmaOk = false;
    }
    if (!firmaOk || address.toLowerCase() !== task.client.toLowerCase()) {
      json(res, 403, { error: 'not client' });
      return;
    }
    if (task.status === TaskStatus.Completed || task.status === TaskStatus.Cancelled) {
      json(res, 409, { error: 'task closed' });
      return;
    }

    /**
     * Y que sea EL encargo que se pagó, no otro.
     *
     * El servidor del bot no comprueba esto porque su agente lo comprueba
     * después, antes de ponerse a trabajar. Aquí no hay nadie detrás que lo
     * haga: el que lee es una persona, y una persona se pone a trabajar en lo
     * que ve. Sin esta línea, el cliente podría dejar aquí un texto distinto
     * del que hasheó al pagar y luego disputar la entrega diciendo que no era
     * lo que pidió.
     */
    if (keccak256(toBytes(brief)).toLowerCase() !== task.taskHash.toLowerCase()) {
      json(res, 409, { error: 'brief hash mismatch' });
      return;
    }

    if (!deps.store.guardarBrief(agente, taskId, brief)) {
      json(res, 400, { error: 'bad key' });
      return;
    }
    console.log(`[buzon] encargo #${taskId} para ${agente} (${brief.length} chars)`);
    json(res, 200, { ok: true });
  };

  // ---- GET /result/:taskId — el cliente se lleva la entrega -----------------
  const darResultado = async (
    agente: Address,
    taskId: bigint,
    url: URL,
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> => {
    const { address: addressParam, signature: signatureParam, expira } = credenciales(req, url);
    if (!isAddress(addressParam)) {
      json(res, 400, { error: 'bad address' });
      return;
    }
    if (!isHex(signatureParam)) {
      json(res, 400, { error: 'bad signature' });
      return;
    }
    const address = getAddress(addressParam);
    const signature = signatureParam as Hex;

    const task = await tareaDe(agente, taskId, res);
    if (!task) return;

    // Los dos formatos, igual que el bot: con caducidad (lo que manda la web)
    // y sin ella (clientes ya publicados que firman así).
    let firmaOk = false;
    if (expira !== null) {
      firmaOk = await firmaVigente(address, signature, expira, (e) =>
        resultSignMessageConCaducidad(taskId, e),
      );
    } else {
      try {
        firmaOk = await verifyMessage({ address, message: resultSignMessage(taskId), signature });
      } catch {
        firmaOk = false;
      }
    }
    if (!firmaOk || address.toLowerCase() !== task.client.toLowerCase()) {
      json(res, 403, { error: 'not client' });
      return;
    }

    const encargo = deps.store.leer(agente, taskId);
    if (!encargo?.entrega) {
      json(res, 404, { error: 'not delivered yet' });
      return;
    }
    // El hash se RECALCULA aquí y el cliente lo vuelve a comprobar contra el de
    // la cadena. Devolver el guardado sería devolver la palabra del buzón.
    json(res, 200, {
      taskId: taskId.toString(),
      resultText: encargo.entrega,
      resultHash: keccak256(toBytes(encargo.entrega)),
    });
  };

  // ---- GET /encargo/:taskId — el TRABAJADOR lee lo que le han pedido --------
  const darEncargo = async (
    agente: Address,
    taskId: bigint,
    url: URL,
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> => {
    const { address: addressParam, signature: signatureParam, expira } = credenciales(req, url);
    if (!isAddress(addressParam) || !isHex(signatureParam)) {
      json(res, 400, { error: 'bad credentials' });
      return;
    }
    const address = getAddress(addressParam);

    const task = await tareaDe(agente, taskId, res);
    if (!task) return;

    const firmaOk = await firmaVigente(address, signatureParam as Hex, expira, (e) =>
      encargoSignMessage(taskId, e),
    );
    if (!firmaOk || address.toLowerCase() !== task.worker.toLowerCase()) {
      json(res, 403, { error: 'not worker' });
      return;
    }

    const encargo = deps.store.leer(agente, taskId);
    if (!encargo?.brief) {
      // No es un error del buzón: el cliente puede no haberlo mandado todavía.
      // Se dice con el `taskHash` delante para que quien pregunte sepa QUÉ le
      // falta y pueda pedírselo.
      json(res, 404, { error: 'brief not here', taskHash: task.taskHash });
      return;
    }
    json(res, 200, {
      taskId: taskId.toString(),
      brief: encargo.brief,
      taskHash: task.taskHash,
      recibido: encargo.briefTs ?? null,
    });
  };

  // ---- POST /entrega/:taskId — el TRABAJADOR deja lo que ha hecho ----------
  const recibirEntrega = async (
    agente: Address,
    taskId: bigint,
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> => {
    const raw = await readBody(req, MAX_ENTREGA_BODY_BYTES);
    if (raw === null) {
      json(res, 413, { error: 'body too large' });
      return;
    }
    let entrega = '';
    let addressParam = '';
    let signatureParam = '';
    let expira: string | null = null;
    try {
      const body = JSON.parse(raw || '{}') as Record<string, unknown>;
      if (typeof body.entrega === 'string') entrega = body.entrega;
      if (typeof body.address === 'string') addressParam = body.address;
      if (typeof body.signature === 'string') signatureParam = body.signature;
      if (typeof body.expira === 'number' || typeof body.expira === 'string') {
        expira = String(body.expira);
      }
    } catch {
      json(res, 400, { error: 'bad json' });
      return;
    }
    if (entrega.trim().length === 0 || entrega.length > MAX_ENTREGA_CHARS) {
      json(res, 400, { error: `entrega requerida, máx. ${MAX_ENTREGA_CHARS} caracteres` });
      return;
    }
    if (!isAddress(addressParam) || !isHex(signatureParam)) {
      json(res, 400, { error: 'bad credentials' });
      return;
    }
    const address = getAddress(addressParam);

    const task = await tareaDe(agente, taskId, res);
    if (!task) return;

    const firmaOk = await firmaVigente(address, signatureParam as Hex, expira, (e) =>
      entregaSignMessage(taskId, e),
    );
    if (!firmaOk || address.toLowerCase() !== task.worker.toLowerCase()) {
      json(res, 403, { error: 'not worker' });
      return;
    }
    if (task.status === TaskStatus.Cancelled) {
      json(res, 409, { error: 'task closed' });
      return;
    }

    /**
     * Si ya hay entrega anclada, los bytes tienen que dar ESE hash.
     *
     * Es lo que impide que una entrega cambie después de haberse firmado. El
     * orden bueno es dejarla aquí y anclarla luego: si se ancla primero y esto
     * falla, el cliente ve una entrega que no puede descargar. Repetir la misma
     * entrega no molesta —sale el mismo hash— y así un reintento es seguro.
     */
    if (task.resultHash.toLowerCase() !== SIN_HASH) {
      if (keccak256(toBytes(entrega)).toLowerCase() !== task.resultHash.toLowerCase()) {
        json(res, 409, { error: 'delivery hash mismatch', resultHash: task.resultHash });
        return;
      }
    }

    if (!deps.store.guardarEntrega(agente, taskId, entrega)) {
      json(res, 400, { error: 'bad key' });
      return;
    }
    console.log(`[buzon] entrega #${taskId} de ${agente} (${entrega.length} chars)`);
    json(res, 200, { ok: true, resultHash: keccak256(toBytes(entrega)) });
  };

  // ---- POST /upload/:taskId y /entrega-archivo/:taskId — los bytes ---------
  //
  // El cliente sube lo que adjunta a su encargo; el trabajador, lo que entrega.
  // Los dos mandan los bytes en crudo con el nombre en una cabecera, que es lo
  // que ya hace la web con los agentes que tienen servidor propio.
  //
  // El buzón NO comprueba que el archivo estuviera anunciado en ningún
  // manifiesto, y no hace falta que lo haga: lo que sostiene una entrega es que
  // su texto —con el hash de cada archivo dentro— es el que está anclado en la
  // cadena, y quien lo descarga vuelve a comprobar los bytes contra ese hash.
  // Un archivo que nadie anunció no se puede colar en una entrega; solo ocupa
  // sitio, y para eso están los topes.
  const recibirArchivo = async (
    agente: Address,
    taskId: bigint,
    de: 'cliente' | 'trabajador',
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const { address: addressParam, signature: signatureParam, expira } = credenciales(req, url);
    const nombreCrudo = (req.headers['x-panal-filename'] as string | undefined) ?? '';
    if (!isAddress(addressParam) || !isHex(signatureParam)) {
      json(res, 400, { error: 'bad credentials' });
      return;
    }
    let nombre = '';
    try {
      nombre = sanearNombre(decodeURIComponent(nombreCrudo));
    } catch {
      nombre = '';
    }
    if (!nombre) {
      json(res, 400, { error: 'bad filename' });
      return;
    }
    const address = getAddress(addressParam);

    const task = await tareaDe(agente, taskId, res);
    if (!task) return;

    // El cliente firma lo mismo que para dejar el encargo —es la misma
    // operación, en dos llamadas—; el trabajador, lo mismo que para entregar.
    let firmaOk = false;
    if (de === 'cliente') {
      try {
        firmaOk =
          (await verifyMessage({
            address,
            message: briefSignMessage(taskId),
            signature: signatureParam as Hex,
          })) && address.toLowerCase() === task.client.toLowerCase();
      } catch {
        firmaOk = false;
      }
    } else {
      firmaOk =
        (await firmaVigente(address, signatureParam as Hex, expira, (e) =>
          entregaSignMessage(taskId, e),
        )) && address.toLowerCase() === task.worker.toLowerCase();
    }
    if (!firmaOk) {
      json(res, 403, { error: de === 'cliente' ? 'not client' : 'not worker' });
      return;
    }
    if (task.status === TaskStatus.Completed || task.status === TaskStatus.Cancelled) {
      json(res, 409, { error: 'task closed' });
      return;
    }

    const bytes = await readBytes(req, MAX_ARCHIVO_BYTES);
    if (bytes === null) {
      json(res, 413, { error: 'file too large' });
      return;
    }
    if (bytes.byteLength === 0) {
      json(res, 400, { error: 'empty file' });
      return;
    }

    const mime = (req.headers['content-type'] as string | undefined) ?? undefined;
    const guardado = deps.store.guardarArchivo(
      agente,
      taskId,
      nombre,
      bytes,
      de,
      mime && mime !== 'application/octet-stream' ? mime : undefined,
    );
    if ('error' in guardado) {
      const codigo = guardado.error === 'grande' ? 413 : guardado.error === 'clave' ? 400 : 409;
      json(res, codigo, { error: guardado.error });
      return;
    }
    console.log(`[buzon] archivo «${nombre}» de ${de} en #${taskId} (${bytes.byteLength} B)`);
    json(res, 200, { ok: true, hash: guardado.hash });
  };

  // ---- GET /archivo/:taskId/:nombre — los bytes, a quien sea de la tarea ----
  const darArchivo = async (
    agente: Address,
    taskId: bigint,
    nombre: string,
    url: URL,
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> => {
    const { address: addressParam, signature: signatureParam, expira } = credenciales(req, url);
    if (!isAddress(addressParam) || !isHex(signatureParam)) {
      json(res, 400, { error: 'bad credentials' });
      return;
    }
    const address = getAddress(addressParam);
    const signature = signatureParam as Hex;

    const task = await tareaDe(agente, taskId, res);
    if (!task) return;

    /**
     * Las dos partes, cada una con la firma que ya usa.
     *
     * El cliente baja los archivos con la MISMA firma que la entrega —así lo
     * hace ya `downloadDeliveredFile`, que abre el texto y los archivos con
     * una sola—; el trabajador, con la de leer su encargo. Ninguna sirve para
     * la puerta del otro, y las dos caducan.
     */
    const esCliente =
      address.toLowerCase() === task.client.toLowerCase() &&
      (expira !== null
        ? await firmaVigente(address, signature, expira, (e) =>
            resultSignMessageConCaducidad(taskId, e),
          )
        : await verifyMessage({ address, message: resultSignMessage(taskId), signature }).catch(
            () => false,
          ));
    const esTrabajador =
      !esCliente &&
      address.toLowerCase() === task.worker.toLowerCase() &&
      (await firmaVigente(address, signature, expira, (e) => encargoSignMessage(taskId, e)));
    if (!esCliente && !esTrabajador) {
      json(res, 403, { error: 'not a party' });
      return;
    }

    const guardado = deps.store.leerArchivo(agente, taskId, nombre);
    if (!guardado) {
      json(res, 404, { error: 'file not here' });
      return;
    }
    res.writeHead(200, {
      'content-type': guardado.archivo.mime || 'application/octet-stream',
      'content-length': String(guardado.bytes.byteLength),
      // Se baja, no se pinta: el buzón sirve archivos de desconocidos y un HTML
      // abierto en su propio origen podría leer lo que ese origen guarde.
      'content-disposition': 'attachment',
      'x-content-type-options': 'nosniff',
    });
    res.end(guardado.bytes);
  };

  // ---- GET /agent.json — la ficha, leída de la cadena -----------------------
  //
  // Un agente de buzón no tiene código propio que la sirva, así que la sirve
  // esto a partir de lo único que hay: su ficha en el registro. Sin `?lang=`
  // útil (aquí no hay modelo que traduzca) y SIN adjuntos ni cobro por
  // llamada, que necesitan una máquina despierta. Se anuncia lo que hay.
  const darFicha = async (agente: Address, res: ServerResponse): Promise<void> => {
    let agent: RegistryAgent;
    try {
      agent = await deps.fetchAgent(agente);
    } catch (err) {
      console.warn(
        `[buzon] agent.json: no se pudo leer el registro: ${err instanceof Error ? err.message.split('\n')[0] : err}`,
      );
      json(res, 502, { error: 'rpc error' });
      return;
    }
    if (!agent.metadataURI) {
      json(res, 404, { error: 'not registered' });
      return;
    }
    const meta = parseMetadataURI(agent.metadataURI);
    const niveles = leerNivelesDeMetadata(agent.metadataURI);
    const base = deps.urlPublica ? `${deps.urlPublica.replace(/\/+$/, '')}/${agente}` : null;

    const ficha: AgentJson = {
      name: meta.name ?? `Agente Panal ${agente}`,
      description: meta.description ?? 'Agente del marketplace Panal (Monad).',
      ...(niveles.length > 0
        ? {
            tiers: niveles.map((n) => ({
              ...(n.name ? { name: n.name } : {}),
              ...(n.description ? { description: n.description } : {}),
              amountWei: n.wei.toString(),
              ...(n.maxBriefChars === null ? {} : { maxBriefChars: n.maxBriefChars }),
              ...(n.maxAttachChars === null ? {} : { maxAttachChars: n.maxAttachChars }),
              ...(n.maxAttachCharsTotal === null ? {} : { maxAttachCharsTotal: n.maxAttachCharsTotal }),
            })),
          }
        : {}),
      agent: agente,
      agentAddress: agente,
      protocol: 'panal',
      network: 'monad-mainnet',
      chainId: monad.id,
      contracts: deps.contratos,
      skills: meta.skills,
      links: meta.links,
      price: {
        amountWei: agent.pricePerTask.toString(),
        currency: agent.currency,
        symbol: deps.simboloDe(agent.currency),
      },
      active: agent.active,
      endpoints: {
        base,
        postBrief: {
          method: 'POST',
          path: '/brief/:taskId',
          signMessage: 'Panal brief #<taskId>  (EIP-191, firmado por el cliente de la tarea)',
          body: `{"brief": string (máx. ${MAX_BRIEF_CHARS} chars), "address": "0x…", "signature": "0x…"}`,
          maxBriefChars: MAX_BRIEF_CHARS,
        },
        getResult: {
          method: 'GET',
          path: '/result/:taskId?address&signature',
          signMessage: 'Panal resultado #<taskId> · <expira>  (EIP-191, firmado por el cliente)',
        },
        // Se anuncia, y por eso al cliente le sale el clip. Un agente de buzón
        // que no lo anunciara aceptaría el encargo igual y trabajaría sin la
        // foto: el manifiesto va DENTRO del brief, así que el hash cuadra y
        // nada falla — salvo el resultado.
        postAttachment: {
          method: 'POST',
          path: '/upload/:taskId',
          maxAttachmentBytes: MAX_ARCHIVO_BYTES,
        },
        indexer: deps.indexer,
      },
      howToHire: [
        'Este agente no tiene servidor propio: recibe y entrega por el buzón de Panal.',
        'El encargo y la entrega pasan en claro por api.panal.lat, que puede leerlos.',
        'No puede cambiarlos: el brief debe dar el taskHash y la entrega el resultHash de la cadena.',
        'Contrátalo desde panal.lat como a cualquier otro: el pago queda en PanalEscrow.',
      ],
    };
    json(res, 200, ficha);
  };

  // ---- Enrutado -------------------------------------------------------------
  const handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const origin = allowedOrigin(req.headers.origin, deps.allowLocalhostOrigin);
    if (origin) {
      res.setHeader('access-control-allow-origin', origin);
      res.setHeader('vary', 'Origin');
      res.setHeader('access-control-allow-headers', 'content-type, x-panal-address, x-panal-signature, x-panal-expira');
      res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    if (!rateLimitOk(clientIp(req))) {
      json(res, 429, { error: 'rate limited' });
      return;
    }

    const rawUrl = req.url ?? '/';
    if (rawUrl.length > maxUrlLength) {
      json(res, 414, { error: 'uri too long' });
      return;
    }
    const url = new URL(rawUrl, 'http://localhost');
    const p = partes(url.pathname);
    if (!p) {
      json(res, 404, { error: 'not found' });
      return;
    }
    const { agente, resto } = p;

    if (resto === 'agent.json' && req.method === 'GET') {
      await darFicha(agente, res);
      return;
    }
    // Los bytes de un archivo: `archivo/<tarea>/<nombre>`. El nombre viaja
    // percent-encoded —una cabecera HTTP no admite «recibo ñ.png»— y se saca de
    // la URL sin tocar el disco: los bytes se guardan por su hash.
    const deArchivo = /^archivo\/(\d{1,20})\/(.+)$/.exec(resto);
    if (deArchivo && req.method === 'GET') {
      let nombre = '';
      try {
        nombre = sanearNombre(decodeURIComponent(deArchivo[2]!));
      } catch {
        nombre = '';
      }
      if (!nombre) {
        json(res, 400, { error: 'bad filename' });
        return;
      }
      await darArchivo(agente, BigInt(deArchivo[1]!), nombre, url, req, res);
      return;
    }

    const ruta = /^(brief|result|encargo|entrega|upload|entrega-archivo)\/(\d{1,20})$/.exec(resto);
    if (!ruta) {
      json(res, 404, { error: 'not found' });
      return;
    }
    const taskId = BigInt(ruta[2]!);
    switch (`${req.method} ${ruta[1]}`) {
      case 'POST brief':
        await dejarBrief(agente, taskId, req, res);
        return;
      case 'GET result':
        await darResultado(agente, taskId, url, req, res);
        return;
      case 'GET encargo':
        await darEncargo(agente, taskId, url, req, res);
        return;
      case 'POST entrega':
        await recibirEntrega(agente, taskId, req, res);
        return;
      case 'POST upload':
        await recibirArchivo(agente, taskId, 'cliente', req, res);
        return;
      case 'POST entrega-archivo':
        await recibirArchivo(agente, taskId, 'trabajador', req, res);
        return;
      default:
        json(res, 405, { error: 'method not allowed' });
    }
  };

  return createServer((req, res) => {
    handler(req, res).catch((err) => {
      console.error(`[buzon] error interno: ${err instanceof Error ? err.message : err}`);
      if (!res.headersSent) json(res, 500, { error: 'internal error' });
      else res.end();
    });
  });
}

/** Arranca el buzón con los clientes y el store de verdad. */
export function startBuzonServer(cfg: BotConfig, clients: ChainClients, store: BuzonStore): Server {
  const server = createBuzonServer({
    store,
    fetchTask: (taskId) => getTask(clients, cfg, taskId),
    fetchAgent: (agente) => getRegistryAgent(clients, cfg, agente),
    contratos: {
      escrow: cfg.escrowAddress,
      registry: cfg.registryAddress,
      token: cfg.panalTokenAddress,
    },
    urlPublica: cfg.buzonPublicUrl,
    simboloDe: (currency) => currencySymbol(currency, cfg),
    indexer: cfg.indexerPublicUrl,
    allowLocalhostOrigin: process.env.NODE_ENV !== 'production',
  });
  server.listen(cfg.buzonHttpPort, () => {
    console.log(`   Buzón: http://localhost:${cfg.buzonHttpPort}/buzon/<agente>/{agent.json,brief,result,encargo,entrega}`);
  });
  return server;
}
