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
  cifrarArchivo,
  claveDesdeFirma,
  comprobarClavePublicada,
  concederAcceso,
  descifrarArchivo,
  descifrarTexto,
  esArchivoCifrado,
  esTextoCifrado,
  mensajeParaDerivarClave,
  mensajeParaPublicarClave,
  puedeAbrir,
  tablonAccesoSignMessage,
  type Acceso,
  type ArchivoParaSubir,
  type ClaveDeCifrado,
  type Destinatario,
} from '@panal/sdk';
import { getAddress, keccak256, parseAbi, type Address, type Hex } from 'viem';
import { BUZON_BASE, accesoSignMessage, expiraEn } from '@/lib/botEndpoint';
import { PANAL_ESCROW_V2_ADDRESS, publicClient } from '@/contracts/config';

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
export function abrirArchivo(bytes: Uint8Array, cuenta: Address, clave: ClaveDeCifrado, accesos: Acceso[] = []): Uint8Array {
  return esArchivoCifrado(bytes) ? descifrarArchivo(bytes, cuenta, clave.secreta, accesos) : bytes;
}

/**
 * Lo que dice un texto: tal cual si va en claro, abierto si va cifrado. Si va
 * cifrado y esta cuenta todavía no puede abrirlo —nadie le ha dado acceso—,
 * `legible` es null, y eso no pide ninguna firma.
 */
export async function abrirTexto(
  texto: string,
  cuenta: Address,
  firmar: Firmar,
  accesos: Acceso[] = [],
): Promise<{ legible: string | null; cifrado: boolean }> {
  if (!esTextoCifrado(texto)) return { legible: texto, cifrado: false };
  if (!puedeAbrir(texto, cuenta, accesos)) return { legible: null, cifrado: true };
  const clave = await miClave(cuenta, firmar);
  return { legible: descifrarTexto(texto, cuenta, clave.secreta, accesos), cifrado: true };
}

/** Los bytes de un archivo, abiertos si van cifrados. */
export async function abrirBytes(bytes: Uint8Array, cuenta: Address, firmar: Firmar, accesos: Acceso[] = []): Promise<Uint8Array> {
  if (!esArchivoCifrado(bytes)) return bytes;
  return abrirArchivo(bytes, cuenta, await miClave(cuenta, firmar), accesos);
}

/**
 * Cifra unos archivos para unos destinatarios. `anunciar` lleva el nombre de
 * verdad y los bytes cifrados —es lo que va al manifiesto, dentro del texto
 * cifrado—; `subir`, los mismos bytes con el nombre opaco que verá el buzón.
 */
export function cifrarArchivos(archivos: ArchivoParaSubir[], para: Destinatario[]): { anunciar: ArchivoParaSubir[]; subir: ArchivoParaSubir[] } {
  const anunciar = archivos.map((a) => ({ ...a, bytes: new Uint8Array(cifrarArchivo(a.bytes, para)) }));
  const subir = anunciar.map((a) => ({ name: nombreEnBuzon(keccak256(a.bytes)), bytes: a.bytes }));
  return { anunciar, subir };
}

/**
 * Deja accesos en el buzón: el de un agente (`base` = su URL de buzón) o el
 * del tablón. Una firma para todos; van en trozos porque el buzón no acepta
 * más de 40 por petición.
 */
export async function darAccesos(
  base: string,
  id: bigint,
  esTablon: boolean,
  accesos: Acceso[],
  cuenta: Address,
  firmar: Firmar,
): Promise<void> {
  if (accesos.length === 0) return;
  const expira = expiraEn();
  const firma = await firmar(esTablon ? tablonAccesoSignMessage(id, expira) : accesoSignMessage(id, expira));
  for (let i = 0; i < accesos.length; i += 40) {
    const res = await fetch(`${base.replace(/\/+$/, '')}/acceso/${id.toString()}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accesos: accesos.slice(i, i + 40), address: cuenta, signature: firma, expira }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  }
}

/**
 * Quiénes deciden las disputas: los firmantes de la multisig que es el
 * `arbitrator` del escrow. Si el arbitrator fuera una cuenta y no una
 * multisig, es él.
 */
export async function leerArbitros(): Promise<Address[]> {
  const arbitrator = (await publicClient.readContract({
    address: PANAL_ESCROW_V2_ADDRESS,
    abi: parseAbi(['function arbitrator() view returns (address)']),
    functionName: 'arbitrator',
  })) as Address;
  const firmantes: Address[] = [];
  for (let i = 0; i < 10; i++) {
    try {
      firmantes.push(
        (await publicClient.readContract({
          address: arbitrator,
          abi: parseAbi(['function owners(uint256) view returns (address)']),
          functionName: 'owners',
          args: [BigInt(i)],
        })) as Address,
      );
    } catch {
      break;
    }
  }
  return firmantes.length > 0 ? firmantes : [arbitrator];
}

/**
 * Da acceso a quien decide la disputa a todo lo cifrado que esta cuenta puede
 * abrir de su encargo: los textos y los archivos que se le pasen. Lo que va en
 * claro se salta. Devuelve a cuántos árbitros se les dio y quiénes aún no han
 * publicado su clave (a esos no se les puede dar todavía).
 */
export async function darAccesoALosArbitros(o: {
  base: string;
  id: bigint;
  esTablon: boolean;
  objetos: (string | Uint8Array)[];
  accesos: Acceso[];
  cuenta: Address;
  firmar: Firmar;
}): Promise<{ arbitros: number; sinClave: Address[]; objetos: number }> {
  const cifrados = o.objetos.filter((x) => (typeof x === 'string' ? esTextoCifrado(x) : esArchivoCifrado(x)));
  if (cifrados.length === 0) return { arbitros: 0, sinClave: [], objetos: 0 };
  const conClave: Destinatario[] = [];
  const sinClave: Address[] = [];
  for (const a of await leerArbitros()) {
    const clave = await clavePublicaDe(a);
    if (clave) conClave.push({ cuenta: a, clave });
    else sinClave.push(a);
  }
  if (conClave.length === 0) return { arbitros: 0, sinClave, objetos: cifrados.length };
  const clave = await miClave(o.cuenta, o.firmar);
  const nuevos: Acceso[] = [];
  for (const objeto of cifrados) {
    for (const d of conClave) {
      // Lo que esta cuenta no puede abrir no lo puede compartir: se salta.
      try {
        nuevos.push(concederAcceso(objeto, o.cuenta, clave.secreta, d, o.accesos));
      } catch {
        /* no es de los suyos */
      }
    }
  }
  await darAccesos(o.base, o.id, o.esTablon, nuevos, o.cuenta, o.firmar);
  return { arbitros: conClave.length, sinClave, objetos: cifrados.length };
}
