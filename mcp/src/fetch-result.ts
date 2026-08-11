/**
 * panal-mcp — recogida del resultado desde el endpoint del agente.
 *
 * El resultado NO viaja on-chain: en la cadena solo queda su keccak256. El
 * texto se le pide al endpoint que el agente publica en su metadata, firmando
 * como cliente con EIP-191 (sin gas), y se comprueba que el hash de lo que
 * llega coincide con el anclado. Si no coincide, el agente entregó una cosa y
 * te está enseñando otra.
 *
 * La URL sale del metadata on-chain, o sea que la escribe un desconocido: se
 * valida antes de pedirle nada, y la respuesta se lee con un tope de tamaño.
 */

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/** Tope de la respuesta. Sin esto, un endpoint hostil tumba el proceso. */
const MAX_BYTES = 512 * 1024;
const TIMEOUT_MS = 20_000;

/** El mensaje que firma el cliente. Debe coincidir con el bot y el frontend. */
export function resultSignMessage(taskId: bigint): string {
  return `Panal resultado #${taskId.toString()}`;
}

/** El mensaje que firma el cliente para MANDAR el encargo. Mismo pacto. */
export function briefSignMessage(taskId: bigint): string {
  return `Panal brief #${taskId.toString()}`;
}

/**
 * Le entrega el encargo al agente: POST /brief/<taskId>, firmado.
 *
 * Existe porque contratar sin esto deja la tarea a medias. On-chain solo queda
 * el hash del encargo; el texto tiene que llegarle al agente por su endpoint o
 * el agente se queda mirando una tarea pagada sin saber qué se le pide. Antes
 * el MCP contrataba y le decía al usuario "ahora hazle llegar el texto tú",
 * que en una conversación con un modelo no lo hace nadie.
 *
 * Devuelve null si fue bien, o el motivo si no. No lanza: cuando esto falla el
 * pago YA está bloqueado, así que lo útil es contarlo, no romper.
 */
export async function pushBrief(
  botUrl: string,
  taskId: bigint,
  brief: string,
  client: string,
  signature: string,
): Promise<string | null> {
  let url: URL;
  try {
    const base = await assertPublicUrl(botUrl);
    url = new URL(`/brief/${taskId}`, base);
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ brief, address: client, signature }),
      signal: controller.signal,
      redirect: 'error',
    });
    if (res.ok) return null;
    // El cuerpo del error dice cuál de las comprobaciones del agente falló
    // —firma, estado, o que el texto no cuadra con el hash—, y eso es
    // exactamente lo que hay que enseñar para poder arreglarlo.
    const detalle = (await res.text().catch(() => '')).slice(0, 300);
    return `el agente respondió ${res.status}${detalle ? `: ${detalle}` : ''}`;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return `el endpoint no respondió en ${TIMEOUT_MS / 1000} s`;
    }
    return err instanceof Error ? err.message : String(err);
  } finally {
    clearTimeout(timer);
  }
}

/** ¿Esta IP apunta dentro de nuestra propia red? */
function isPrivateIp(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v6 = ip.toLowerCase();
    if (v6 === '::1' || v6 === '::') return true;
    if (/^f[cd]/.test(v6) || v6.startsWith('fe80')) return true;
    // IPv4 mapeada: ::ffff:10.0.0.1
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v6);
    return mapped ? isPrivateIp(mapped[1]!) : false;
  }
  const [a = 0, b = 0] = ip.split('.').map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) || // metadatos de la nube: credenciales
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    a >= 224
  );
}

/**
 * Rechaza una URL que apunte a algo que no sea internet pública.
 *
 * Sin esto, cualquiera puede registrar un agente cuyo endpoint sea
 * `http://169.254.169.254/latest/meta-data/` y usar este servidor para leer las
 * credenciales de la máquina donde corre.
 *
 * Queda una ventana de DNS rebinding: se resuelve aquí y `fetch` vuelve a
 * resolver por su cuenta. Cerrarla del todo exige un agente HTTP a medida; el
 * riesgo residual es aceptable porque la respuesta solo se compara contra un
 * hash y nunca se ejecuta.
 */
export async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`El endpoint del agente no es una URL válida: ${raw}`);
  }
  if (url.protocol !== 'https:') {
    // La petición lleva una firma del cliente en la query: en claro la lee cualquiera.
    throw new Error(`El endpoint del agente tiene que ser https, y es ${url.protocol}//`);
  }
  if (url.username || url.password) throw new Error('El endpoint lleva credenciales embebidas: se rechaza.');

  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (/^(localhost|.*\.local|.*\.internal)$/i.test(host)) {
    throw new Error(`El endpoint apunta a un nombre local (${host}): se rechaza.`);
  }
  const ips = isIP(host) ? [host] : (await lookup(host, { all: true })).map((r) => r.address);
  if (!ips.length) throw new Error(`No se pudo resolver ${host}.`);
  for (const ip of ips) {
    if (isPrivateIp(ip)) throw new Error(`El endpoint apunta a una dirección interna (${ip}): se rechaza.`);
  }
  return url;
}

/** Descarga acotada: se corta en cuanto se pasa del tope. */
export async function fetchResultText(
  botUrl: string,
  taskId: bigint,
  client: string,
  signature: string,
): Promise<string> {
  const base = await assertPublicUrl(botUrl);
  const url = new URL(`/result/${taskId}`, base);
  url.searchParams.set('address', client);
  url.searchParams.set('signature', signature);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { accept: 'application/json' } });
    if (!res.ok) {
      throw new Error(`El endpoint del agente respondió ${res.status}. ¿Sigue en pie y la firma es la del cliente?`);
    }
    const reader = res.body?.getReader();
    if (!reader) throw new Error('El endpoint del agente respondió sin cuerpo.');

    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BYTES) {
        await reader.cancel();
        throw new Error(`El resultado pasa de ${MAX_BYTES / 1024} KB: se corta por seguridad.`);
      }
      chunks.push(value);
    }
    const body = Buffer.concat(chunks).toString('utf8');
    const parsed = JSON.parse(body) as { resultText?: string };
    if (typeof parsed.resultText !== 'string') throw new Error('La respuesta del agente no trae `resultText`.');
    return parsed.resultText;
  } finally {
    clearTimeout(timer);
  }
}
