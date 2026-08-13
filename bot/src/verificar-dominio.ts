/**
 * ¿El dominio que dice un agente es realmente suyo?
 *
 * El registry no tiene nombres: el identificador on-chain es la direccion, y el
 * nombre vive en la metadata, que escribe el propio agente. Nada impide que dos
 * se llamen igual, ni que uno se registre como "Lint" para quedarse con los
 * clientes del Lint de verdad. `PanalNames` reparte nombres unicos, pero por
 * orden de llegada: unico no es lo mismo que tuyo.
 *
 * Lo que si es de alguien es su dominio. Y el vinculo ya es demostrable: la
 * tarjeta que sirve el agente en `/agent.json` declara su direccion, asi que
 * basta con ir a buscarla y compararla. Eso es lo que hace esto.
 *
 * CUIDADO CON QUIEN PIDE Y A DONDE. La `botUrl` la escribe quien se registra,
 * y aqui la pide el servidor del indexador. Sin filtro, cualquiera puede
 * registrar un agente con `botUrl` apuntando a `http://127.0.0.1:8788` o a la
 * IP de metadatos del proveedor y usar el indexador de ariete contra su propia
 * red. Por eso se exige https, se resuelve el nombre antes de pedir nada y se
 * rechaza toda IP que no sea publica.
 */
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/** Lo que tarda como mucho en contestar una tarjeta. */
const TIMEOUT_MS = 8_000;

/** Tope de lo que se lee. Una tarjeta son cientos de bytes, no megas. */
const MAX_BYTES = 64 * 1024;

export interface Veredicto {
  /** Si el dominio declara la misma direccion que esta registrada. */
  ok: boolean;
  /** Por que no, para poder enseñarlo y para no depurar a ciegas. */
  motivo: string;
}

/**
 * Rangos que no se piden nunca.
 *
 * Loopback, redes privadas, link-local —incluida 169.254.169.254, la de
 * metadatos de casi todos los proveedores— y el resto de reservados.
 */
function esPublica(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v6 = ip.toLowerCase();
    if (v6 === '::1' || v6 === '::') return false;
    // Unique local (fc00::/7) y link-local (fe80::/10).
    if (/^f[cd]/.test(v6) || /^fe[89ab]/.test(v6)) return false;
    // IPv4 mapeada: se juzga por la parte v4.
    const mapeada = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapeada) return esPublica(mapeada[1]!);
    return true;
  }

  const o = ip.split('.').map(Number);
  if (o.length !== 4 || o.some((n) => Number.isNaN(n))) return false;
  const [a, b] = o as [number, number, number, number];

  if (a === 0 || a === 10 || a === 127) return false;
  if (a === 169 && b === 254) return false; // link-local y metadatos
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT
  if (a >= 224) return false; // multicast y reservados
  return true;
}

export async function verificarDominio(botUrl: string, address: string): Promise<Veredicto> {
  let url: URL;
  try {
    url = new URL('/agent.json', botUrl);
  } catch {
    return { ok: false, motivo: 'la URL no es valida' };
  }

  // Sin https no hay nada que verificar: en claro, cualquiera por el camino
  // puede responder por el agente.
  if (url.protocol !== 'https:') return { ok: false, motivo: 'el endpoint no es https' };

  let ips: string[];
  try {
    const res = await lookup(url.hostname, { all: true });
    ips = res.map((r) => r.address);
  } catch {
    return { ok: false, motivo: 'el dominio no resuelve' };
  }
  if (ips.length === 0) return { ok: false, motivo: 'el dominio no resuelve' };
  // Basta con que UNA apunte adentro para no pedirlo: si un nombre resuelve a
  // varias y una es interna, es justo el caso que se intenta evitar.
  if (!ips.every(esPublica)) return { ok: false, motivo: 'el dominio apunta a una IP interna' };

  let res: Response;
  try {
    res = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      // Sin seguir saltos: un https publico que redirige a un http interno
      // devolveria el filtro de arriba inutil.
      redirect: 'manual',
      headers: { accept: 'application/json' },
    });
  } catch {
    return { ok: false, motivo: 'el endpoint no responde' };
  }

  if (res.status >= 300 && res.status < 400) return { ok: false, motivo: 'el endpoint redirige' };
  if (!res.ok) return { ok: false, motivo: `el endpoint responde ${res.status}` };

  const largo = Number(res.headers.get('content-length') ?? 0);
  if (largo > MAX_BYTES) return { ok: false, motivo: 'la tarjeta es demasiado grande' };

  let texto: string;
  try {
    texto = (await res.text()).slice(0, MAX_BYTES);
  } catch {
    return { ok: false, motivo: 'no se pudo leer la tarjeta' };
  }

  let card: { agent?: unknown; agentAddress?: unknown };
  try {
    card = JSON.parse(texto) as { agent?: unknown; agentAddress?: unknown };
  } catch {
    return { ok: false, motivo: 'la tarjeta no es JSON' };
  }

  // Valen las dos formas. La plantilla de hoy escribe `agent`, pero los agentes
  // anteriores a ella —LexPanal, sin ir mas lejos— usan `agentAddress`, y
  // declaran exactamente lo mismo. Aceptar solo la nueva seria marcar como no
  // verificado a todo el que se construyo antes, que es acusar en falso.
  const declarada =
    typeof card.agent === 'string' ? card.agent : typeof card.agentAddress === 'string' ? card.agentAddress : '';
  if (!declarada) return { ok: false, motivo: 'la tarjeta no declara direccion' };

  if (declarada.toLowerCase() !== address.toLowerCase()) {
    return { ok: false, motivo: `la tarjeta dice ser ${declarada.slice(0, 12)}…` };
  }

  return { ok: true, motivo: '' };
}
