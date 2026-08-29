/**
 * Panal Bot — servidor HTTP mínimo (node:http, sin frameworks) para la
 * operación 100% headless del agente: recepción de briefs máquina-a-máquina
 * y entrega PRIVADA y VERIFICABLE de resultados al cliente.
 *
 * On-chain solo viaja `taskHash = keccak256(brief)` y, al entregar,
 * `resultHash = keccak256(texto)`; los contenidos viven en el store local.
 * El CLIENTE de la tarea demuestra su identidad firmando (EIP-191, gratis,
 * sin gas) un mensaje que incluye el taskId (anti-replay entre tareas):
 *
 *     Panal brief #<taskId>       (POST /brief)
 *     Panal resultado #<taskId>   (GET /result)
 *
 * Rutas:
 *   POST /brief/:taskId   body {"brief","address","signature"}
 *     1. Valida el body (brief no vacío, máx. MAX_BRIEF_CHARS; 400 si no).
 *     2. Lee `tasks(taskId)` del escrow v2 (con el retry/backoff de chain.ts).
 *     3. verifyMessage() de viem contra task.client → 403 {"error":"not client"}.
 *     4. Rechaza tareas cerradas (Completed/Cancelled) → 409 {"error":"task closed"}.
 *     5. Guarda el brief con store.setBrief() (lo lee el worker) → 200 {"ok":true}.
 *   GET /result/:taskId?address=0x…&signature=0x…
 *     1. Lee `tasks(taskId)` del escrow v2 (con el retry/backoff de chain.ts).
 *     2. Recupera el firmante con verifyMessage() de viem; si no coincide con
 *        task.client → 403 {"error":"not client"}.
 *     3. Devuelve 200 {taskId, resultText, resultHash} con resultHash
 *        RECOMPUTADO como keccak256(toBytes(resultText)) para que el cliente
 *        lo compare con el anclado on-chain.
 *   GET /agent.json
 *     Descriptor público máquina-legible del agente (identidad, contratos,
 *     skills/precio leídos del registry, endpoints y pasos para contratarlo).
 *   Cualquier otra ruta → 404 genérico {"error":"not found"}.
 *
 * Protecciones:
 *   - CORS restringido a https://panal.lat (y http://localhost:* fuera de
 *     producción, para desarrollo).
 *   - Rate limit por IP: 30 peticiones/minuto → 429.
 *   - Body de POST limitado a 16 KiB.
 *
 * El servidor arranca junto al worker cuando BOT_HTTP_PORT > 0 (ver index.ts).
 * Para pruebas, `createResultServer` acepta `fetchTask` y `fetchAgentJson`
 * inyectables (bot/scripts/test-http.ts los usa con datos simulados).
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { esTokenDeMarca, leerMarca } from './marca.js';
import { esTokenDeNivel, leerNivelesDeMetadata } from './niveles.js';
import { normalizarIdioma, traducirFrases, type Idioma } from './traduccion.js';
import { allowedOrigin, clientIp } from './net.js';
import { generateResult } from './llm.js';
import {
  buildQuote,
  parsePaymentHeader,
  permitNonce,
  readPermitDomain,
  SCHEME,
  verifyAndSettle,
  type PermitDomain,
  type SettleResult,
  type X402Payment,
} from './x402.js';
import {
  getAddress,
  isAddress,
  isHex,
  keccak256,
  toBytes,
  verifyMessage,
  type Address,
  type Hex,
} from 'viem';
import type { BotConfig } from './config.js';
import {
  currencySymbol,
  getRegistryAgent,
  getTask,
  monad,
  TaskStatus,
  type ChainClients,
  type RegistryAgent,
  type Task,
} from './chain.js';
import type { Store } from './store.js';

/**
 * Mensaje que firma el cliente para descargar, formato ANTIGUO: sin caducidad.
 *
 * Una firma sin caducidad es un pase permanente. Se sigue aceptando para no
 * romper a los clientes ya publicados que firman así —el propio bot, en mcp.ts
 * y a2a.ts—, pero lo nuevo debe usar `resultSignMessageConCaducidad`.
 */
export function resultSignMessage(taskId: bigint): string {
  return `Panal resultado #${taskId.toString()}`;
}

/**
 * Mensaje que firma el cliente para descargar, con caducidad dentro.
 *
 * Este es el que manda `panal-mcp`, y el que la plantilla de agentes ya
 * aceptaba. Sin él, LexPanal era inalcanzable desde el MCP: la firma no
 * cuadraba, y como además las credenciales viajan en cabeceras y aquí solo se
 * leían de la query, ni siquiera llegaba a compararse. El resultado de una
 * tarea pagada quedaba ilegible para el cliente que la pagó.
 */
export function resultSignMessageConCaducidad(taskId: bigint, expira: number): string {
  return `Panal resultado #${taskId.toString()} · ${expira}`;
}

/** Lo máximo que puede durar una firma de descarga: abre toda la entrega. */
const MAX_VENTANA_S = 15 * 60;

/**
 * Mensaje que firma el cliente para entregar el brief (POST /brief).
 * Análogo al de /result; incluye el taskId para evitar replay entre tareas.
 * Debe coincidir con briefSignMessage() de src/lib/botEndpoint.ts (frontend).
 */
export function briefSignMessage(taskId: bigint): string {
  return `Panal brief #${taskId.toString()}`;
}

// ---------------------------------------------------------------------------
// Rate limit por IP: ventana deslizante de 1 minuto, 30 peticiones máximo.
// ---------------------------------------------------------------------------

const RATE_LIMIT_MAX = 30;
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

// ---------------------------------------------------------------------------
// CORS: solo el dashboard oficial (y localhost en desarrollo).
// ---------------------------------------------------------------------------

// (allowedOrigin vive en net.ts: lo comparten este servidor y el del índice)

// ---------------------------------------------------------------------------
// Descriptor del agente (GET /agent.json): identidad, contratos, skills y
// precio (leídos del registry on-chain) y pasos para contratarlo M2M.
// ---------------------------------------------------------------------------

/**
 * Límite del brief aceptado por POST /brief (chars).
 *
 * 4.000 se quedaba corto para lo que la gente manda de verdad: un contrato o
 * un fichero de código pasan de ahí sin esfuerzo, y el cliente solo se entera
 * DESPUÉS de bloquear el pago, porque el encargo se entrega cuando la tarea ya
 * está en la cadena. 32.000 son ~8k tokens, holgados para el contexto del LLM.
 */
export const MAX_BRIEF_CHARS = 32_000;

/**
 * Tope del body de POST /brief (bytes), DERIVADO del límite de chars y no
 * elegido aparte.
 *
 * Un char no es un byte: el brief viaja dentro de un JSON, y entre UTF-8
 * (hasta 4 bytes por char) y el escapado (`\n`, `\"`) el cuerpo crece sobre el
 * texto. Cuando los dos topes se eligen a mano, el más bajo manda en silencio
 * y rechaza por un motivo que no es el que se anuncia: con 4.000 chars y 16 KB
 * no se notaba, pero subir uno solo deja al otro cortando por su cuenta.
 */
const MAX_BRIEF_BODY_BYTES = MAX_BRIEF_CHARS * 4 + 4_096;

/**
 * Tope del body de POST /x402/ask. Va aparte a propósito: ahí se cobra una
 * tarifa fija por pregunta, así que un prompt enorme lo acaba pagando el
 * agente en tokens. Compartir constante con /brief ataba dos límites que
 * responden a economías distintas, y subir el de los encargos habría subido
 * este sin que nadie lo decidiera.
 */
const MAX_ASK_BODY_BYTES = 16_384;

/**
 * La ficha de `GET /agent.json`.
 *
 * La forma canónica y los lectores que perdonan la antigua viven en
 * `@panal/sdk` (`AgentCard`, `leerX402`, `leerMaxBriefChars`). Este tipo se
 * mantiene aquí porque el bot no depende del SDK a propósito —solo viem y
 * dotenv—, pero es el MISMO formato: si diverge, manda el del SDK.
 */
export interface AgentJson {
  name: string;
  description: string;
  /**
   * El idioma de `description` y `tiers`, si se pidió con `?lang=` y se pudo
   * traducir. AUSENTE NO ES «está en inglés»: es que va en el idioma en que su
   * dueño lo escribió, aunque hayas pedido otro.
   */
  lang?: string;
  /**
   * Los niveles que vende, de menor a mayor. Ausente = no vende niveles, y
   * quien lea NO debe inventárselos a partir del precio.
   */
  tiers?: {
    name?: string;
    description?: string;
    amountWei: string;
    maxBriefChars?: number;
    maxAttachChars?: number;
    maxAttachCharsTotal?: number;
  }[];
  /**
   * La dirección del agente, con el nombre que usa todo el mundo menos este
   * bot. Los agentes de la plantilla publican `agent`, este publicaba solo
   * `agentAddress`, y el verificador de dominios lleva desde entonces un
   * `card.agent ?? card.agentAddress` para tragarse las dos formas. Se
   * publican ambas: la nueva para no obligar a nadie a conocer la historia,
   * la vieja porque quitarla rompería a quien ya la lee.
   */
  agent: Address;
  /** @deprecated Usa `agent`. Se mantiene por compatibilidad. */
  agentAddress: Address;
  protocol: 'panal';
  network: string;
  chainId: number;
  contracts: { escrow: Address; registry: Address; token: Address };
  skills: string[];
  /**
   * Logo y enlaces que el creador publicó en su ficha del registro.
   *
   * Se repiten aquí, en la tarjeta, para que un cliente que ya está hablando
   * con el bot no tenga que ir a leer la cadena solo para saber de quién es.
   * Sólo salen los que estén: un agente sin marca sirve la tarjeta de siempre.
   */
  links: Record<string, string>;
  price: { amountWei: string; currency: Address; symbol: string } | null;
  active: boolean | null;
  endpoints: {
    /** URL pública base del bot (BOT_HTTP_PUBLIC_URL), null si no se publicó. */
    base: string | null;
    postBrief: {
      method: 'POST';
      path: '/brief/:taskId';
      signMessage: string;
      body: string;
      /**
       * El tope real, en un campo y no dentro de la frase de `body`.
       *
       * Estaba solo ahí, en prosa y con el número escrito a mano, así que
       * ningún cliente podía leerlo: se enteraba del límite cuando el agente
       * le devolvía un 400 —y para entonces el pago ya estaba bloqueado en el
       * escrow, porque el encargo se entrega después de crear la tarea.
       */
      maxBriefChars: number;
    };
    getResult: { method: 'GET'; path: '/result/:taskId?address&signature'; signMessage: string };
    /**
     * Cobro por llamada (x402). Presente solo si el agente lo tiene activado.
     *
     * Sin esto el endpoint existe pero es indescubrible: estuvo semanas vivo
     * respondiendo cotizaciones a nadie, porque ningun cliente podia saber que
     * estaba ahi. Es lo que permite que otro agente pregunte el precio y pague
     * sin intervencion humana.
     */
    x402Ask?: {
      method: 'POST';
      path: '/x402/ask';
      url: string;
      scheme: string;
      asset: string;
      assetSymbol: string;
      amount: string;
      payTo: string;
      howTo: string;
    };
    /** API pública del indexador Panal (agentes, tareas y eventos). */
    indexer: string;
  };
  howToHire: string[];
}

/**
 * Parsea el metadataURI "Nombre · descripción · skill1, skill2 · bot:<url>".
 *
 * Los tokens `bot:`, los de marca y los de nivel salen fuera antes de repartir
 * posiciones: si se quedaran, el `logo:https://…` de un agente saldría
 * anunciado como skill suya en su propia tarjeta.
 */
function parseMetadataURI(uri: string): {
  name?: string;
  description?: string;
  skills: string[];
  links: Record<string, string>;
} {
  const parts = uri
    .split('·')
    .map((p) => p.trim())
    .filter((p) => p && !p.toLowerCase().startsWith('bot:') && !esTokenDeMarca(p) && !esTokenDeNivel(p));
  const links = leerMarca(uri);
  return {
    name: parts[0],
    description: parts[1],
    skills: parts[2] ? parts[2].split(',').map((s) => s.trim()).filter(Boolean).slice(0, 8) : [],
    links,
  };
}

/**
 * Lee el sobre de una llamada entre agentes (cabeceras X-Panal-*).
 *
 * Se implementa aquí en vez de importar el SDK porque el bot no depende de él
 * —tiene su propio lockfile y su propio ciclo—, y son quince líneas. El formato
 * es el mismo: ver `envelope.ts` del SDK, que es la referencia.
 */
function parseCallEnvelope(
  headers: IncomingMessage['headers'],
): { trace: string; depth: number; path: string[] } | null {
  const one = (name: string): string | undefined => {
    const raw = headers[name];
    return Array.isArray(raw) ? raw[0] : raw;
  };
  const trace = one('x-panal-trace')?.trim();
  if (!trace) return null;
  const depth = Number.parseInt(one('x-panal-depth') ?? '0', 10);
  const path = (one('x-panal-path') ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => /^0x[0-9a-f]{40}$/.test(s))
    .slice(0, 16);
  return { trace: trace.slice(0, 128), depth: Number.isFinite(depth) ? depth : 0, path };
}

/**
 * Construye el descriptor de GET /agent.json. Lee el registry on-chain (nombre,
 * skills, precio, active); si el RPC falla, sirve el descriptor con lo
 * estático de la config (mejor degradado que un 502).
 */
export async function buildAgentJson(
  cfg: BotConfig,
  clients: ChainClients,
  /** Si el agente cobra por llamada, se anuncia en la tarjeta. */
  x402?: X402Endpoint,
  /** El idioma pedido en `?lang=`, si se pidió alguno y se reconoce. */
  idioma?: Idioma | null,
  /** Dónde viven las traducciones ya hechas. */
  dirDatos?: string,
): Promise<AgentJson> {
  let agent: RegistryAgent | null = null;
  try {
    agent = await getRegistryAgent(clients, cfg, cfg.agentAddress);
  } catch (err) {
    console.warn(
      `[http] agent.json: no se pudo leer el registry: ${err instanceof Error ? err.message.split('\n')[0] : err}`,
    );
  }
  const meta = parseMetadataURI(agent?.metadataURI ?? '');
  const base = cfg.httpPublicUrl?.replace(/\/+$/, '') ?? null;
  const basePath = base ?? '<BOT_URL>';

  // Los niveles que este agente publica EN LA CADENA. Vacío es lo normal, y
  // significa que no vende niveles: quien lea esto NO debe fabricarle uno a
  // partir del precio. Se anuncian aquí para que su dueño pueda ponerlos desde
  // el panel sin tocar este código.
  const niveles = leerNivelesDeMetadata(agent?.metadataURI ?? '');

  /**
   * En qué idioma va lo que se sirve, y `null` si va en el original.
   *
   * Se DICE, no se deja adivinar: la traducción va por detrás, así que pedir
   * `?lang=fr` antes de que esté lista devuelve la ficha original con un 200
   * impecable, y quien la guarde se quedaría con el inglés creyendo que es el
   * francés.
   */
  let servidoEn: Idioma | null = null;
  let descripcion = meta.description ?? 'Agente autónomo del marketplace Panal (Monad).';
  let nombresNiveles = niveles.map((n) => ({ name: n.name, description: n.description }));
  if (idioma && dirDatos) {
    const traducido = traducirFrases(
      {
        description: descripcion,
        tiers: niveles.map((n) => ({ name: n.name, description: n.description ?? '' })),
      },
      idioma,
      cfg,
      dirDatos,
    );
    if (traducido) {
      servidoEn = idioma;
      descripcion = traducido.description;
      nombresNiveles = traducido.tiers.map((t, i) => ({
        // Solo se pisa lo que ya había: un nivel sin descripción no gana una
        // por pasar por el traductor.
        name: t.name || (niveles[i]?.name ?? ''),
        description: t.description || (niveles[i]?.description ?? null),
      }));
    }
  }

  return {
    name: meta.name ?? `Agente Panal ${cfg.agentAddress}`,
    description: descripcion,
    ...(servidoEn ? { lang: servidoEn } : {}),
    ...(niveles.length > 0
      ? {
          tiers: niveles.map((n, i) => ({
            ...(nombresNiveles[i]?.name ? { name: nombresNiveles[i]!.name } : {}),
            ...(nombresNiveles[i]?.description
              ? { description: nombresNiveles[i]!.description! }
              : {}),
            amountWei: n.wei.toString(),
            ...(n.maxBriefChars === null ? {} : { maxBriefChars: n.maxBriefChars }),
            ...(n.maxAttachChars === null ? {} : { maxAttachChars: n.maxAttachChars }),
            ...(n.maxAttachCharsTotal === null ? {} : { maxAttachCharsTotal: n.maxAttachCharsTotal }),
          })),
        }
      : {}),
    agent: cfg.agentAddress,
    agentAddress: cfg.agentAddress,
    // `protocol` y `network` los servía solo la plantilla, y son lo que deja
    // reconocer una ficha de Panal sin conocer de antemano el chainId.
    protocol: 'panal',
    network: 'monad-mainnet',
    chainId: monad.id,
    contracts: {
      escrow: cfg.escrowAddress,
      registry: cfg.registryAddress,
      token: cfg.panalTokenAddress,
    },
    skills: meta.skills,
    links: meta.links,
    price: agent
      ? {
          amountWei: agent.pricePerTask.toString(),
          currency: agent.currency,
          symbol: currencySymbol(agent.currency, cfg),
        }
      : null,
    active: agent ? agent.active : null,
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
        signMessage: 'Panal resultado #<taskId>  (EIP-191, firmado por el cliente de la tarea)',
      },
      ...(x402
        ? {
            x402Ask: {
              method: 'POST' as const,
              path: '/x402/ask' as const,
              url: `${basePath}/x402/ask`,
              scheme: SCHEME,
              asset: x402.token,
              assetSymbol: x402.tokenSymbol,
              amount: x402.priceWei.toString(),
              payTo: x402.payee,
              howTo:
                'POST sin cabecera devuelve 402 con la cotizacion (gratis). Firma el permit EIP-2612 ' +
                'que describe y repite con X-Payment: base64({scheme,payer,value,deadline,signature}). ' +
                'Se cobra y se responde en la misma llamada; el cliente no paga gas.',
            },
          }
        : {}),
      indexer: cfg.indexerPublicUrl,
    },
    howToHire: [
      `1. Lee este agente en el registry (${cfg.registryAddress}): getAgent(${cfg.agentAddress}) → pricePerTask y currency.`,
      `2. Crea la tarea en el escrow (${cfg.escrowAddress}, chainId ${monad.id}): createTask(worker=${cfg.agentAddress}, taskHash=keccak256(brief), deadline, currency, amount). MON nativo: msg.value=amount. $PANAL: approve(escrow, amount) previo y msg.value=0. El evento TaskCreated devuelve el taskId.`,
      `3. Firma EIP-191 "Panal brief #<taskId>" con la wallet cliente y haz POST ${basePath}/brief/<taskId> con {"brief","address","signature"} (sin firma también vale reenviar el brief al operador, pero el agente headless lo necesita aquí).`,
      '4. Espera la entrega: poll tasks(taskId) hasta status=1 (Delivered).',
      `5. Descarga el resultado: firma "Panal resultado #<taskId>" y GET ${basePath}/result/<taskId>?address&signature. Verifica keccak256(resultText) contra el resultHash on-chain.`,
      '6. Libera el pago: approveAndRelease(taskId, rating 1-5). Si no actúas, el auto-release lo hace a las 72 h de la entrega.',
    ],
  };
}

// ---------------------------------------------------------------------------
// Helpers de respuesta.
// ---------------------------------------------------------------------------

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(payload);
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

// ---------------------------------------------------------------------------
// Servidor.
// ---------------------------------------------------------------------------

export interface ResultServerDeps {
  store: Store;
  /** Lectura de la task on-chain (inyectable en tests). */
  fetchTask: (taskId: bigint) => Promise<Task>;
  /** Descriptor de GET /agent.json (inyectable en tests; si falta → 404). */
  fetchAgentJson?: (idioma?: Idioma | null) => Promise<AgentJson>;
  /** Permitir orígenes http://localhost:* (desarrollo). */
  allowLocalhostOrigin: boolean;
  /** Límite de tamaño de URL aceptado (defensa ante URLs gigantes). */
  maxUrlLength?: number;
  /**
   * Cobro por llamada (x402). Si falta, `/x402/ask` responde 404 y el agente
   * sigue funcionando solo con encargos por escrow.
   */
  x402?: X402Endpoint;
}

/** Todo lo que necesita la ruta de pago por llamada. */
export interface X402Endpoint {
  priceWei: bigint;
  token: Address;
  tokenSymbol: string;
  /** Quién cobra: la wallet del agente, que también es el spender del permit. */
  payee: Address;
  /** Dominio EIP-712 del token. Perezoso: se lee de la cadena y se cachea. */
  getDomain: () => Promise<PermitDomain>;
  maxPromptChars: number;
  /** Nonce de permit del pagador, para incluirlo en el presupuesto. */
  nonceOf: (payer: Address) => Promise<bigint>;
  /** Verifica la firma y cobra on-chain. Sirve solo si sale bien. */
  settle: (payment: X402Payment, price: bigint) => Promise<SettleResult>;
  /** Genera la respuesta que se vende. */
  answer: (prompt: string) => Promise<string>;
}

export function createResultServer(deps: ResultServerDeps): Server {
  const maxUrlLength = deps.maxUrlLength ?? 2_048;

  // ---- GET /result/:taskId  (credenciales en cabeceras, o en la query) ------
  const handleGetResult = async (
    taskId: bigint,
    url: URL,
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> => {
    // Las cabeceras van PRIMERO y la query es el respaldo. La query acaba en el
    // log del proxy, y una firma en un log es una credencial escrita en un
    // fichero de texto. Leer solo de la query era además incompatible con
    // panal-mcp, que solo manda cabeceras: no fallaba la firma, es que no
    // llegaba a haberla.
    const cabecera = (n: string): string | null => {
      const v = req.headers[n];
      return typeof v === 'string' ? v : Array.isArray(v) ? (v[0] ?? null) : null;
    };
    const addressParam = cabecera('x-panal-address') ?? url.searchParams.get('address') ?? '';
    const signatureParam = cabecera('x-panal-signature') ?? url.searchParams.get('signature') ?? '';
    const expiraCrudo = cabecera('x-panal-expira') ?? url.searchParams.get('expira');
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

    // Lee la task on-chain (con retry/backoff vía fetchTask)
    let task: Task;
    try {
      task = await deps.fetchTask(taskId);
    } catch (err) {
      console.warn(
        `[http] no se pudo leer tasks(${taskId}): ${err instanceof Error ? err.message.split('\n')[0] : err}`,
      );
      json(res, 502, { error: 'rpc error' });
      return;
    }

    // Verifica la firma EIP-191 contra el cliente de la task. Se aceptan los
    // dos formatos: con caducidad (el que manda panal-mcp y el que usa la
    // plantilla de agentes) y el antiguo sin ella, que siguen firmando los
    // clientes ya publicados. Con caducidad se comprueba la ventana, porque un
    // plazo que no se mira no es un plazo.
    let signerOk = false;
    try {
      if (expiraCrudo !== null) {
        const expira = Number(expiraCrudo);
        const ahora = Math.floor(Date.now() / 1000);
        signerOk =
          Number.isInteger(expira) &&
          expira > ahora &&
          expira <= ahora + MAX_VENTANA_S &&
          (await verifyMessage({ address, message: resultSignMessageConCaducidad(taskId, expira), signature }));
      } else {
        signerOk = await verifyMessage({ address, message: resultSignMessage(taskId), signature });
      }
    } catch {
      signerOk = false;
    }
    if (!signerOk || address.toLowerCase() !== task.client.toLowerCase()) {
      json(res, 403, { error: 'not client' });
      return;
    }

    // Sirve el resultado + hash recomputado
    const resultText = deps.store.getResult(taskId);
    if (resultText === null) {
      json(res, 404, { error: 'not found' });
      return;
    }
    json(res, 200, {
      taskId: taskId.toString(),
      resultText,
      resultHash: keccak256(toBytes(resultText)),
    });
  };

  // ---- POST /brief/:taskId  {"brief","address","signature"} -----------------
  const handlePostBrief = async (taskId: bigint, req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const raw = await readBody(req, MAX_BRIEF_BODY_BYTES);
    if (raw === null) {
      json(res, 413, { error: 'body too large' });
      return;
    }
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      json(res, 400, { error: 'bad json' });
      return;
    }
    const { brief, address: addressParam, signature: signatureParam } = (body ?? {}) as Record<string, unknown>;
    if (typeof brief !== 'string' || brief.trim().length === 0 || brief.length > MAX_BRIEF_CHARS) {
      json(res, 400, { error: `bad brief (string no vacío, máx. ${MAX_BRIEF_CHARS} chars)` });
      return;
    }
    if (typeof addressParam !== 'string' || !isAddress(addressParam)) {
      json(res, 400, { error: 'bad address' });
      return;
    }
    if (typeof signatureParam !== 'string' || !isHex(signatureParam)) {
      json(res, 400, { error: 'bad signature' });
      return;
    }
    const address = getAddress(addressParam);
    const signature = signatureParam as Hex;

    // Lee la task on-chain (con retry/backoff vía fetchTask)
    let task: Task;
    try {
      task = await deps.fetchTask(taskId);
    } catch (err) {
      console.warn(
        `[http] no se pudo leer tasks(${taskId}): ${err instanceof Error ? err.message.split('\n')[0] : err}`,
      );
      json(res, 502, { error: 'rpc error' });
      return;
    }

    // Verifica la firma EIP-191 contra el cliente de la task
    let signerOk = false;
    try {
      signerOk = await verifyMessage({
        address,
        message: briefSignMessage(taskId),
        signature,
      });
    } catch {
      signerOk = false;
    }
    if (!signerOk || address.toLowerCase() !== task.client.toLowerCase()) {
      json(res, 403, { error: 'not client' });
      return;
    }

    // Solo tareas vivas: Completed/Cancelled ya no aceptan brief.
    if (task.status === TaskStatus.Completed || task.status === TaskStatus.Cancelled) {
      json(res, 409, { error: 'task closed' });
      return;
    }

    deps.store.setBrief(taskId, brief);
    console.log(`[http] brief recibido para la tarea #${taskId} (${brief.length} chars, cliente ${address})`);
    json(res, 200, { ok: true });
  };

  // ---- POST /x402/ask  {"prompt"} -------------------------------------------
  //
  // Sin cabecera X-Payment se responde 402 con el presupuesto; con ella se
  // cobra y se sirve en la misma llamada. Se COBRA ANTES DE RESPONDER: al
  // revés, un cobro fallido habría regalado el trabajo.
  const handleX402Ask = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const x = deps.x402;
    if (!x) {
      json(res, 404, { error: 'este agente no cobra por llamada (x402 deshabilitado)' });
      return;
    }

    const raw = await readBody(req, MAX_ASK_BODY_BYTES);
    if (raw === null) {
      json(res, 413, { error: 'body too large' });
      return;
    }
    let prompt = '';
    try {
      const body = JSON.parse(raw || '{}') as { prompt?: unknown };
      if (typeof body.prompt === 'string') prompt = body.prompt.trim();
    } catch {
      json(res, 400, { error: 'bad json' });
      return;
    }
    if (prompt.length === 0 || prompt.length > x.maxPromptChars) {
      json(res, 400, { error: `prompt requerido, máx. ${x.maxPromptChars} caracteres` });
      return;
    }

    // Ciclo: si este agente ya atendió esta cadena, la llamada ha dado la
    // vuelta. Se corta ANTES de cotizar o trabajar, porque cada vuelta de un
    // bucle la paga alguien de verdad. 508 es el código correcto de HTTP.
    const sobre = parseCallEnvelope(req.headers);
    if (sobre && sobre.path.includes(x.payee.toLowerCase())) {
      json(res, 508, {
        error: `ciclo detectado: este agente ya atendió la cadena ${sobre.trace}`,
        trace: sobre.trace,
        path: sobre.path,
      });
      return;
    }

    const header = req.headers['x-payment'];
    const paymentHeader = Array.isArray(header) ? header[0] : header;

    if (!paymentHeader) {
      // 402 con el presupuesto. Si el cliente se identifica con X-Payment-Payer
      // se le devuelve además su nonce, para que no tenga que leerlo él.
      const payerHeader = req.headers['x-payment-payer'];
      const payerRaw = Array.isArray(payerHeader) ? payerHeader[0] : payerHeader;
      let payerNonce: bigint | undefined;
      if (typeof payerRaw === 'string' && isAddress(payerRaw)) {
        payerNonce = await x.nonceOf(getAddress(payerRaw)).catch(() => undefined);
      }
      const domain = await x.getDomain();
      const quote = buildQuote({
        asset: x.token,
        assetSymbol: x.tokenSymbol,
        amount: x.priceWei,
        payTo: x.payee,
        resource: '/x402/ask',
        description: 'Una consulta al agente, respondida al momento.',
        domain,
        payerNonce,
      });
      res.writeHead(402, {
        'content-type': 'application/json; charset=utf-8',
        // Cabecera estándar de HTTP para que un cliente genérico sepa qué hacer.
        'www-authenticate': `${SCHEME} realm="panal", chain="${domain.chainId}"`,
      });
      res.end(JSON.stringify(quote));
      return;
    }

    const parsed = parsePaymentHeader(paymentHeader);
    if (!parsed.ok) {
      json(res, 402, { error: parsed.error });
      return;
    }

    const settled = await x.settle(parsed.payment, x.priceWei);
    if (!settled.ok) {
      json(res, settled.status, { error: settled.error });
      return;
    }

    let answer: string;
    try {
      answer = await x.answer(prompt);
    } catch (err) {
      // El cobro ya está hecho: es dinero del cliente, así que el fallo se
      // reporta con el hash para que pueda reclamar con prueba en la mano.
      console.error(`[x402] cobrado ${settled.txHash} pero la respuesta falló: ${err instanceof Error ? err.message : err}`);
      json(res, 502, {
        error: 'el pago se cobró pero la respuesta falló',
        paymentTx: settled.txHash,
      });
      return;
    }

    console.log(`[x402] ${parsed.payment.payer} pagó ${settled.amount} por /x402/ask · tx ${settled.txHash}`);
    res.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'x-payment-response': Buffer.from(
        JSON.stringify({ settled: true, txHash: settled.txHash, amount: settled.amount.toString() }),
      ).toString('base64'),
    });
    res.end(JSON.stringify({ answer, payment: { txHash: settled.txHash, amount: settled.amount.toString() } }));
  };

  // ---- GET /agent.json -------------------------------------------------------
  const handleAgentJson = async (res: ServerResponse, idioma: Idioma | null): Promise<void> => {
    if (!deps.fetchAgentJson) {
      json(res, 404, { error: 'not found' });
      return;
    }
    try {
      json(res, 200, await deps.fetchAgentJson(idioma));
    } catch (err) {
      console.warn(`[http] agent.json falló: ${err instanceof Error ? err.message.split('\n')[0] : err}`);
      json(res, 502, { error: 'rpc error' });
    }
  };

  const handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    // ---- CORS (incluye preflight OPTIONS) ----------------------------------
    const origin = allowedOrigin(req.headers.origin, deps.allowLocalhostOrigin);
    if (origin) {
      res.setHeader('access-control-allow-origin', origin);
      res.setHeader('vary', 'origin');
    }
    if (req.method === 'OPTIONS') {
      res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
      res.setHeader('access-control-allow-headers', 'content-type');
      res.setHeader('access-control-max-age', '600');
      res.writeHead(204);
      res.end();
      return;
    }

    // ---- Rate limit por IP ---------------------------------------------------
    // clientIp() y no req.socket.remoteAddress: detrás de Caddy todas las
    // peticiones entran por loopback, así que la IP del socket es siempre
    // 127.0.0.1 y el tope "por IP" se comportaba como un tope GLOBAL —un solo
    // cliente agotaba la cuota de todos. Ver net.ts para por qué solo se hace
    // caso a X-Forwarded-For cuando la conexión viene de loopback.
    const ip = clientIp(req);
    if (!rateLimitOk(ip)) {
      json(res, 429, { error: 'rate limited' });
      return;
    }

    // ---- Enrutado ------------------------------------------------------------
    const rawUrl = req.url ?? '/';
    if (rawUrl.length > maxUrlLength) {
      json(res, 414, { error: 'uri too long' });
      return;
    }
    const url = new URL(rawUrl, 'http://localhost');
    const resultMatch = /^\/result\/(\d{1,20})$/.exec(url.pathname);
    const briefMatch = /^\/brief\/(\d{1,20})$/.exec(url.pathname);

    if (resultMatch && req.method === 'GET') {
      await handleGetResult(BigInt(resultMatch[1]!), url, req, res);
      return;
    }
    if (briefMatch && req.method === 'POST') {
      await handlePostBrief(BigInt(briefMatch[1]!), req, res);
      return;
    }
    if (url.pathname === '/agent.json' && req.method === 'GET') {
      await handleAgentJson(res, normalizarIdioma(url.searchParams.get('lang')));
      return;
    }
    if (url.pathname === '/x402/ask' && req.method === 'POST') {
      await handleX402Ask(req, res);
      return;
    }
    json(res, 404, { error: 'not found' });
  };

  return createServer((req, res) => {
    handler(req, res).catch((err) => {
      console.error(`[http] error interno: ${err instanceof Error ? err.message : err}`);
      if (!res.headersSent) json(res, 500, { error: 'internal error' });
      else res.end();
    });
  });
}

/**
 * Arranca el servidor de resultados junto al worker. Lee las tasks del escrow
 * v2 configurado (con el retry/backoff de chain.ts). Devuelve el Server para
 * poder cerrarlo en el apagado.
 */
export function startResultServer(cfg: BotConfig, clients: ChainClients, store: Store): Server {
  // x402 solo tiene sentido con wallet: sin ella no se puede ejecutar el cobro,
  // y servir sin cobrar sería regalar el trabajo.
  let x402: X402Endpoint | undefined;
  if (cfg.x402.enabled && clients.walletClient && clients.botAddress) {
    let domainCache: Promise<PermitDomain> | undefined;
    x402 = {
      priceWei: cfg.x402.priceWei,
      token: cfg.panalTokenAddress,
      tokenSymbol: '$PANAL',
      payee: clients.botAddress,
      maxPromptChars: cfg.x402.maxPromptChars,
      getDomain: () => (domainCache ??= readPermitDomain(clients, cfg.panalTokenAddress)),
      nonceOf: (payer) => permitNonce(clients, cfg.panalTokenAddress, payer),
      settle: async (payment, price) =>
        verifyAndSettle(
          {
            clients,
            cfg,
            token: cfg.panalTokenAddress,
            domain: await (domainCache ??= readPermitDomain(clients, cfg.panalTokenAddress)),
            payee: clients.botAddress!,
          },
          payment,
          price,
        ),
      answer: (prompt) => generateResult(cfg, prompt),
    };
  } else if (cfg.x402.enabled) {
    console.warn('   ⚠ X402_ENABLED pero sin wallet del bot: el cobro por llamada queda deshabilitado.');
  }

  const server = createResultServer({
    store,
    x402,
    fetchTask: (taskId) => getTask(clients, cfg, taskId),
    fetchAgentJson: (idioma) => buildAgentJson(cfg, clients, x402, idioma, cfg.storeDir),
    // En producción (NODE_ENV=production) solo panal.lat; en dev también localhost.
    allowLocalhostOrigin: cfg.dryRun || process.env.NODE_ENV !== 'production',
  });
  server.listen(cfg.httpPort, () => {
    console.log(`   Endpoint HTTP: http://localhost:${cfg.httpPort}  (POST /brief/:taskId · GET /result/:taskId · GET /agent.json)`);
    if (cfg.httpPublicUrl) {
      console.log(`   URL pública (metadata del agente → "bot:${cfg.httpPublicUrl}")`);
    } else {
      console.log('   ⚠ BOT_HTTP_PUBLIC_URL vacío: publica "bot:<url>" en el metadata de tu agente');
    }
  });
  return server;
}
