/**
 * Panal Bot — utilidades de red compartidas por el servidor HTTP, la API del
 * indexador y el A2A.
 *
 * Resuelve tres problemas concretos, todos con la misma raíz: el bot confía en
 * datos que vienen de fuera (cabeceras HTTP, URLs escritas en el registry
 * on-chain, cuerpos de respuesta ajenos) y ninguno de los tres estaba acotado.
 *
 *   1. clientIp()        — la IP real del cliente detrás de un proxy inverso.
 *   2. assertPublicUrl() — impide que el bot llame a direcciones internas
 *                          (SSRF) cuando sigue una URL del registry.
 *   3. fetchJsonLimited() — lee respuestas ajenas con tope de bytes.
 */

import { promises as dns } from 'node:dns';
import { isIP } from 'node:net';
import type { IncomingMessage } from 'node:http';

// ---------------------------------------------------------------------------
// 1. IP real del cliente detrás de un proxy inverso.
// ---------------------------------------------------------------------------

/**
 * ¿La conexión entra por loopback? Solo entonces nos fiamos de X-Forwarded-For.
 *
 * En producción el bot escucha en 127.0.0.1 y Caddy hace de proxy delante (ver
 * deploy/Caddyfile), así que TODAS las peticiones llegan desde loopback y
 * `req.socket.remoteAddress` vale siempre 127.0.0.1. Usarla como clave del
 * rate limit convertía el tope "por IP" en un tope GLOBAL: un solo cliente
 * agotaba la cuota de todos, y de paso bastaba para negar el servicio a los
 * demás.
 */
function isLoopback(addr: string | undefined): boolean {
  if (!addr) return false;
  const a = normalizeIp(addr);
  return a === '127.0.0.1' || a === '::1' || a.startsWith('127.');
}

/** Quita el prefijo IPv4-mapeada (::ffff:1.2.3.4 -> 1.2.3.4) y espacios. */
function normalizeIp(addr: string): string {
  const a = addr.trim().toLowerCase();
  return a.startsWith('::ffff:') ? a.slice(7) : a;
}

/**
 * IP real del cliente para rate limiting.
 *
 * Solo se hace caso a X-Forwarded-For cuando la conexión entra por loopback,
 * es decir cuando quien la puso fue nuestro propio proxy. Si el puerto queda
 * expuesto directamente a internet, la cabecera llega de un desconocido y se
 * ignora: si no, cualquiera se saltaría el límite mandando una IP distinta en
 * cada petición.
 *
 * Se toma la ENTRADA MÁS A LA DERECHA de la cadena porque es la única que
 * escribió nuestro proxy; las de la izquierda las controla el cliente.
 */
export function clientIp(req: IncomingMessage): string {
  const socketAddr = req.socket.remoteAddress;
  if (!isLoopback(socketAddr)) return normalizeIp(socketAddr ?? 'unknown');

  const header = req.headers['x-forwarded-for'];
  const raw = Array.isArray(header) ? header[header.length - 1] : header;
  if (!raw) return normalizeIp(socketAddr ?? 'unknown');

  const parts = raw
    .split(',')
    .map((s) => normalizeIp(s))
    .filter(Boolean);
  const candidate = parts[parts.length - 1];
  if (!candidate || isIP(candidate) === 0) return normalizeIp(socketAddr ?? 'unknown');
  return candidate;
}

// ---------------------------------------------------------------------------
// 2. Guardia anti-SSRF para URLs que vienen del registry on-chain.
// ---------------------------------------------------------------------------

/**
 * Rangos que jamás deben alcanzarse siguiendo una URL escrita por un tercero.
 * Cualquiera puede registrar un agente en Panal y poner en su metadata
 * `bot:http://169.254.169.254/…` (el servicio de metadatos de la nube, que
 * sirve credenciales) o `bot:http://127.0.0.1:8787/…` (el propio bot). Como el
 * A2A firma la petición con la wallet del bot, además de alcanzar la red
 * interna se le estaría entregando una firma nuestra.
 */
function isPrivateIp(ip: string): boolean {
  const a = normalizeIp(ip);

  if (isIP(a) === 6) {
    if (a === '::' || a === '::1') return true;
    if (a.startsWith('fe80')) return true; // link-local
    const first = parseInt(a.slice(0, 2), 16);
    if (!Number.isNaN(first) && (first & 0xfe) === 0xfc) return true; // fc00::/7 únicas locales
    return false;
  }

  const o = a.split('.').map((n) => Number.parseInt(n, 10));
  if (o.length !== 4 || o.some((n) => !Number.isFinite(n))) return true; // ilegible: se bloquea

  const [p, q] = o as [number, number, number, number];
  if (p === 0) return true; // 0.0.0.0/8
  if (p === 10) return true; // privada
  if (p === 127) return true; // loopback
  if (p === 169 && q === 254) return true; // link-local + metadatos de nube
  if (p === 172 && q >= 16 && q <= 31) return true; // privada
  if (p === 192 && q === 168) return true; // privada
  if (p === 100 && q >= 64 && q <= 127) return true; // CGNAT
  if (p >= 224) return true; // multicast y reservadas
  return false;
}

/** Nombres que resuelven a la propia máquina sin pasar por DNS público. */
function isLocalHostname(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, '');
  return h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal');
}

export interface UrlGuardOptions {
  /** Exigir https. El A2A manda una firma en la query: en claro es legible por cualquier intermediario. */
  requireHttps?: boolean;
  /**
   * Permitir destinos internos (loopback, redes privadas). SOLO para desarrollo
   * y pruebas, donde el agente "hijo" corre en la misma máquina.
   *
   * Nunca debe activarse en producción: es justo la puerta que cierra esta
   * guardia. Por eso el A2A lo ata a DRY_RUN, que ya implica que no se firma
   * ni se mueve nada real.
   */
  allowPrivate?: boolean;
}

/**
 * Comprueba que una URL de tercero apunta a un destino público antes de
 * llamarla. Lanza con un motivo legible si no.
 *
 * LIMITACIÓN CONOCIDA (DNS rebinding): se resuelve el nombre y se validan las
 * IPs, pero entre esa comprobación y el `fetch` el atacante puede cambiar el
 * registro DNS para que apunte a una dirección interna. Cerrarlo del todo
 * exige fijar la IP validada y conectarse a ella con un agente propio.
 * Esta guardia corta el caso realista —URLs internas escritas directamente— y
 * deja documentado el que no.
 */
export async function assertPublicUrl(rawUrl: string, opts: UrlGuardOptions = {}): Promise<URL> {
  const requireHttps = opts.requireHttps ?? true;

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`URL inválida: ${rawUrl.slice(0, 120)}`);
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`protocolo no permitido: ${url.protocol}`);
  }
  if (requireHttps && url.protocol !== 'https:') {
    throw new Error('se exige https (la petición lleva una firma del bot en la query)');
  }
  if (url.username || url.password) {
    throw new Error('la URL no puede llevar credenciales embebidas');
  }

  const host = url.hostname.replace(/^\[|\]$/g, '');
  const allowPrivate = opts.allowPrivate ?? false;
  if (allowPrivate) return url;

  if (isLocalHostname(host)) throw new Error(`host local no permitido: ${host}`);

  // IP literal: se valida directamente, sin DNS.
  if (isIP(host) !== 0) {
    if (isPrivateIp(host)) throw new Error(`dirección interna no permitida: ${host}`);
    return url;
  }

  let resolved: { address: string }[];
  try {
    resolved = await dns.lookup(host, { all: true });
  } catch (err) {
    throw new Error(`no se pudo resolver ${host}: ${err instanceof Error ? err.message : err}`);
  }
  if (resolved.length === 0) throw new Error(`${host} no resuelve a ninguna dirección`);

  // Basta con que UNA resuelva a interna para descartar: un atacante puede
  // devolver varias y forzar la que le convenga.
  const bad = resolved.find((r) => isPrivateIp(r.address));
  if (bad) throw new Error(`${host} resuelve a una dirección interna (${bad.address})`);

  return url;
}

// ---------------------------------------------------------------------------
// 3. Lectura acotada de respuestas ajenas.
// ---------------------------------------------------------------------------

export interface FetchLimitedOptions {
  maxBytes?: number;
  timeoutMs?: number;
  headers?: Record<string, string>;
  method?: 'GET' | 'POST';
  body?: string;
}

/** Tope por defecto: un resultado de agente legítimo cabe de sobra en 2 MiB. */
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * `fetch` + `res.json()` con tope de bytes.
 *
 * `res.json()` a secas lee hasta el final: un endpoint hostil (o simplemente
 * roto) que sirva un flujo infinito tumba el proceso por memoria. Aquí se lee
 * en trozos y se aborta al pasar del tope.
 */
export async function fetchJsonLimited<T>(
  url: string | URL,
  opts: FetchLimitedOptions = {},
): Promise<{ ok: true; status: number; data: T } | { ok: false; status: number; error: string }> {
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const res = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: opts.headers,
    method: opts.method ?? 'GET',
    body: opts.body,
  });
  if (!res.ok) return { ok: false, status: res.status, error: `HTTP ${res.status}` };

  // Atajo: si el servidor declara un tamaño y ya se pasa, ni se lee.
  const declared = Number(res.headers.get('content-length') ?? Number.NaN);
  if (Number.isFinite(declared) && declared > maxBytes) {
    return { ok: false, status: res.status, error: `respuesta demasiado grande (${declared} bytes)` };
  }

  if (!res.body) return { ok: false, status: res.status, error: 'respuesta sin cuerpo' };

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return { ok: false, status: res.status, error: `respuesta supera el tope de ${maxBytes} bytes` };
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock?.();
  }

  const buf = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    buf.set(c, offset);
    offset += c.byteLength;
  }

  try {
    return { ok: true, status: res.status, data: JSON.parse(new TextDecoder().decode(buf)) as T };
  } catch {
    return { ok: false, status: res.status, error: 'la respuesta no es JSON válido' };
  }
}
