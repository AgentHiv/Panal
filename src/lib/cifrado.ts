/**
 * Encargos cifrados en la web y en la app: la clave de cada cuenta, su
 * publicación en el buzón y los archivos que viajan cifrados.
 *
 * Las piezas criptográficas son del SDK (`sdk/src/cifrado.ts`); aquí está lo
 * que depende de una wallet que firma y de la red. Compartido con la app por
 * el alias `@`, igual que `botEndpoint.ts`.
 *
 * CUÁNDO SE CIFRA
 *
 * Solo con quien recibe en el buzón de Panal —una persona sin servidor— y solo
 * si esa persona publicó su clave. Un agente con servidor propio recibe en SU
 * máquina: cifrarle sería cifrar para el mismo que lo va a leer, y su
 * plantilla todavía no sabe abrirlo.
 */

import {
  claveDesdeFirma,
  comprobarClavePublicada,
  descifrarArchivo,
  esArchivoCifrado,
  mensajeParaDerivarClave,
  mensajeParaPublicarClave,
  type ClaveDeCifrado,
} from '@panal/sdk';
import { getAddress, type Address, type Hex } from 'viem';
import { BUZON_BASE } from '@/lib/botEndpoint';

export type Firmar = (mensaje: string) => Promise<string>;

/**
 * La clave secreta, solo en memoria y solo mientras dure la pestaña. No se
 * guarda en el navegador: quien abriera el almacenamiento local se la llevaría.
 * Volver a sacarla es una firma.
 */
const secretas = new Map<string, ClaveDeCifrado>();

/** La clave de esta cuenta. La primera vez de cada sesión pide una firma. */
export async function miClave(cuenta: Address, firmar: Firmar): Promise<ClaveDeCifrado> {
  const k = cuenta.toLowerCase();
  const ya = secretas.get(k);
  if (ya) return ya;
  const firma = (await firmar(mensajeParaDerivarClave(cuenta))) as Hex;
  const clave = claveDesdeFirma(cuenta, firma);
  secretas.set(k, clave);
  return clave;
}

/**
 * La clave pública de una cuenta, ya comprobada contra su firma. `null` si no
 * la ha publicado, o si lo que sirve el buzón no es de esa cuenta: en los dos
 * casos no hay a quién cifrar, y cifrar para una clave falsa sería entregarle
 * el encargo a quien la puso.
 */
export async function clavePublicaDe(cuenta: Address, timeoutMs = 8_000): Promise<string | null> {
  try {
    const res = await fetch(`${BUZON_BASE}/${getAddress(cuenta)}/clave`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    const body = (await res.json()) as { clave?: unknown; firma?: unknown };
    if (typeof body.clave !== 'string' || typeof body.firma !== 'string') return null;
    const publicada = { cuenta, clave: body.clave, firma: body.firma as Hex };
    return (await comprobarClavePublicada(publicada)) ? body.clave : null;
  } catch {
    return null;
  }
}

/**
 * Deja publicada la clave de esta cuenta y la devuelve.
 *
 * Si ya estaba publicada la misma, no firma nada más. Si había OTRA —la wallet
 * dio una firma distinta, o se publicó desde otra cuenta de contrato—, se
 * sustituye y `cambio` lo dice: lo cifrado para la de antes ya no se podrá
 * abrir con esta, y quien llama tiene que avisarlo.
 */
export async function publicarMiClave(
  cuenta: Address,
  firmar: Firmar,
): Promise<{ clave: ClaveDeCifrado; cambio: boolean }> {
  const clave = await miClave(cuenta, firmar);
  const publicada = await clavePublicaDe(cuenta);
  if (publicada === clave.publica) return { clave, cambio: false };
  const firma = await firmar(mensajeParaPublicarClave(cuenta, clave.publica));
  const res = await fetch(`${BUZON_BASE}/${getAddress(cuenta)}/clave`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ clave: clave.publica, firma }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return { clave, cambio: publicada !== null };
}

/**
 * Con qué nombre se guarda un archivo cifrado en el buzón. El de verdad va
 * dentro del texto cifrado; en la URL, que el buzón ve, solo va su hash.
 */
export function nombreEnBuzon(hash: string): string {
  return `cifrado-${hash.toLowerCase().replace(/^0x/, '').slice(0, 16)}.bin`;
}

/**
 * Abre un archivo bajado del buzón, si va cifrado. Los bytes ya vienen
 * comprobados contra el hash anunciado: eso es lo que garantiza la cadena, y
 * esto, que solo lo lea su destinatario.
 */
export function abrirArchivo(bytes: Uint8Array, cuenta: Address, clave: ClaveDeCifrado): Uint8Array {
  return esArchivoCifrado(bytes) ? descifrarArchivo(bytes, cuenta, clave.secreta) : bytes;
}
