/**
 * Panal SDK — validación de las URLs de otros agentes.
 *
 * El endpoint de un agente sale de su metadata on-chain, así que lo escribe un
 * desconocido. Cualquiera puede registrarse con
 * `bot:http://169.254.169.254/latest/meta-data/` y usar tu agente para leer las
 * credenciales de la máquina donde corre. Por eso toda URL ajena pasa por aquí
 * antes de que se le pida nada.
 *
 * Funciona en Node y en el navegador. En Node resuelve el DNS para cazar un
 * dominio que apunte a una IP interna; en el navegador no hay DNS accesible, se
 * queda en la validación de la URL, y tampoco importa tanto: ahí el riesgo de
 * alcanzar la red privada de un servidor no existe.
 */

/** ¿Esta IP apunta dentro de una red privada o reservada? */
export function isPrivateIp(ip: string): boolean {
  const v6 = ip.toLowerCase();
  if (v6.includes(':')) {
    if (v6 === '::1' || v6 === '::') return true;
    if (/^f[cd]/.test(v6) || v6.startsWith('fe80')) return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v6);
    return mapped ? isPrivateIp(mapped[1]!) : false;
  }
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a = 0, b = 0] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) || // metadatos de la nube: credenciales
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    a >= 224 // multicast y reservadas
  );
}

const LOCAL_NAMES = /^(localhost|.*\.local|.*\.internal|.*\.localhost)$/i;

export interface UrlGuardOptions {
  /**
   * Permitir http:// y direcciones privadas. SOLO para desarrollo local: la
   * petición lleva una firma tuya, y en claro la lee cualquiera por el camino.
   */
  allowInsecure?: boolean;
}

/**
 * Devuelve la URL si es segura de visitar, o lanza explicando por qué no.
 *
 * Queda una ventana de DNS rebinding —se resuelve aquí y `fetch` vuelve a
 * resolver por su cuenta—. Cerrarla del todo exige un agente HTTP a medida; el
 * riesgo residual es aceptable porque la respuesta nunca se ejecuta.
 */
export async function assertPublicUrl(raw: string, options: UrlGuardOptions = {}): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`No es una URL válida: ${raw}`);
  }

  if (url.username || url.password) throw new Error('La URL lleva credenciales embebidas: se rechaza.');
  if (url.protocol !== 'https:' && !(options.allowInsecure && url.protocol === 'http:')) {
    throw new Error(`El endpoint tiene que ser https y es ${url.protocol}//`);
  }

  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (options.allowInsecure) return url;

  if (LOCAL_NAMES.test(host)) throw new Error(`La URL apunta a un nombre local (${host}): se rechaza.`);

  // Si el host YA es una IP, se comprueba directamente y no hace falta DNS.
  const isLiteralIp = /^[\d.]+$/.test(host) || host.includes(':');
  if (isLiteralIp) {
    if (isPrivateIp(host)) throw new Error(`La URL apunta a una dirección interna (${host}): se rechaza.`);
    return url;
  }

  // Resolución DNS solo donde exista. En el navegador se omite a propósito.
  const lookup = await loadDnsLookup();
  if (!lookup) return url;

  let addresses: string[];
  try {
    addresses = (await lookup(host, { all: true })).map((r) => r.address);
  } catch {
    throw new Error(`No se pudo resolver ${host}.`);
  }
  if (!addresses.length) throw new Error(`${host} no resuelve a ninguna dirección.`);
  for (const ip of addresses) {
    if (isPrivateIp(ip)) throw new Error(`${host} resuelve a una dirección interna (${ip}): se rechaza.`);
  }
  return url;
}

type Lookup = (host: string, opts: { all: true }) => Promise<{ address: string }[]>;

/** Carga node:dns si estamos en Node; devuelve null en el navegador. */
async function loadDnsLookup(): Promise<Lookup | null> {
  try {
    // El import va en una variable para que los empaquetadores de navegador no
    // intenten resolver 'node:dns' de forma estática y fallen al construir.
    const mod = 'node:dns/promises';
    const dns = (await import(/* @vite-ignore */ mod)) as { lookup: Lookup };
    return typeof dns.lookup === 'function' ? dns.lookup : null;
  } catch {
    return null;
  }
}

/**
 * `fetch` con tope de tamaño y de tiempo, devolviendo los bytes crudos.
 *
 * La respuesta viene de un servidor ajeno: sin tope, uno hostil se lleva por
 * delante el proceso. El tope se aplica MIENTRAS se lee, no al final, para que
 * un cuerpo infinito se corte en cuanto pasa del límite y no cuando ya no cabe.
 */
export async function fetchBytesLimited(
  url: URL | string,
  init: RequestInit & { maxBytes?: number; timeoutMs?: number } = {},
): Promise<{ status: number; headers: Headers; bytes: Uint8Array }> {
  const { maxBytes = 512 * 1024, timeoutMs = 30_000, ...rest } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...rest, signal: controller.signal });
    const reader = res.body?.getReader();
    if (!reader) return { status: res.status, headers: res.headers, bytes: new Uint8Array(0) };

    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error(`La respuesta pasa de ${Math.round(maxBytes / 1024)} KB: se corta.`);
      }
      chunks.push(value);
    }
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      merged.set(c, offset);
      offset += c.byteLength;
    }
    return { status: res.status, headers: res.headers, bytes: merged };
  } finally {
    clearTimeout(timer);
  }
}

/** Lo mismo, decodificando el cuerpo como texto UTF-8. */
export async function fetchLimited(
  url: URL | string,
  init: RequestInit & { maxBytes?: number; timeoutMs?: number } = {},
): Promise<{ status: number; headers: Headers; text: string }> {
  const { status, headers, bytes } = await fetchBytesLimited(url, init);
  return { status, headers, text: new TextDecoder().decode(bytes) };
}

/**
 * Una ruta del agente, colgando de DONDE está el agente.
 *
 * Parece una tontería y no lo es: `new URL('/brief/12', base)` descarta el
 * camino de la base. Con un agente que vive en la raíz de su dominio
 * —`https://bot.panal.lat`— da lo mismo y funcionó siempre; con uno que vive
 * en un subcamino —`https://api.panal.lat/buzon/0xAAA`, que es donde reciben
 * los que no tienen servidor propio— manda la petición a
 * `https://api.panal.lat/brief/12`, que no es de nadie.
 *
 * Y lo que se rompe así no avisa: el 404 se lee como «ese agente no contesta»
 * con el pago ya bloqueado, y a las 72 h se libera solo. Por eso la unión de
 * rutas se hace en un sitio y no a mano en cada llamada.
 */
export function rutaDeAgente(base: string, ruta: string): string {
  return `${base.replace(/\/+$/, '')}/${ruta.replace(/^\/+/, '')}`;
}
