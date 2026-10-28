/**
 * Panal — archivos en un mensaje del chat (x402).
 *
 * Un mensaje pagado es texto. Para mandarle al agente una foto, un audio o un
 * PDF, los bytes van al buzón de Panal a nombre del agente, y con el mensaje
 * solo viaja la lista con su hash (ver `sdk/src/consultas.ts`). El agente los
 * baja y los comprueba ANTES de cobrar: si no le llegan, no se paga.
 *
 * A la vuelta, igual al revés: lo que devuelve el agente queda en el buzón a
 * nombre de quien preguntó, siete días, y se baja al tocarlo.
 *
 * Aparte de `chat.ts` a propósito: aquello decide sobre dinero y se prueba en
 * Node; esto habla con el buzón y con el cifrado, que viven del navegador.
 * Compartido con la app por el alias `@`, como `chat.ts`.
 */

import {
  MAX_CONSULTA_FILES,
  MAX_FILE_BYTES,
  cifrarArchivo,
  downloadConsultaFile,
  sanitizeFileName,
  uploadConsultaFile,
  type HashedFile,
  type X402Accept,
} from '@panal/sdk';
import { getAddress, keccak256, type Address, type Hex } from 'viem';
import { BUZON_BASE } from '@/lib/botEndpoint';
import { abrirBytes, clavePublicaDe, nombreEnBuzon, type Firmar } from '@/lib/cifrado';

/** Un archivo elegido para mandar, antes de subirlo. */
export interface Adjunto {
  name: string;
  bytes: Uint8Array;
  mime?: string;
}

/** Los mismos topes que el SDK: no tiene sentido elegir lo que no se va a poder mandar. */
export const MAX_ADJUNTOS = MAX_CONSULTA_FILES;
export const MAX_BYTES_ADJUNTO = MAX_FILE_BYTES;

/** Por qué estos archivos no van con este mensaje. Cada pantalla lo dice en su idioma. */
export type ProblemaConAdjuntos =
  | { tipo: 'noAcepta' }
  | { tipo: 'demasiados'; max: number }
  | { tipo: 'grande'; nombre: string; maxBytes: number };

/**
 * Si la cotización admite estos archivos. Se mira ANTES de subir nada ni de
 * enseñar la hoja de firmar: el SDK tampoco firmaría, pero a esas alturas ya
 * se habrían subido los archivos y pedido firmas para nada.
 */
export function problemaConAdjuntos(cotizacion: X402Accept, adjuntos: Adjunto[]): ProblemaConAdjuntos | null {
  if (adjuntos.length === 0) return null;
  const acepta = cotizacion.files;
  if (!acepta) return { tipo: 'noAcepta' };
  const max = Math.min(acepta.max, MAX_ADJUNTOS);
  if (adjuntos.length > max) return { tipo: 'demasiados', max };
  const maxBytes = Math.min(acepta.maxBytes, MAX_BYTES_ADJUNTO);
  const grande = adjuntos.find((a) => a.bytes.byteLength > maxBytes);
  return grande ? { tipo: 'grande', nombre: grande.name, maxBytes } : null;
}

/**
 * Deja los archivos en el buzón para el agente. Si publicó su clave, van
 * cifrados para él y con un nombre opaco: el buzón no ve ni el contenido ni
 * cómo se llaman. Una firma por archivo, sin gas.
 *
 * Devuelve lo que se anuncia con el mensaje: el nombre de verdad y el hash de
 * los bytes subidos, que es lo que el agente comprueba al bajarlos.
 */
export async function subirAdjuntos(o: {
  agente: Address;
  yo: Address;
  adjuntos: Adjunto[];
  firmar: Firmar;
}): Promise<HashedFile[]> {
  const suClave = await clavePublicaDe(o.agente);
  const sign = (mensaje: string) => o.firmar(mensaje) as Promise<Hex>;
  const out: HashedFile[] = [];
  for (const a of o.adjuntos) {
    const bytes = suClave
      ? new Uint8Array(cifrarArchivo(a.bytes, [{ cuenta: getAddress(o.agente), clave: suClave }]))
      : a.bytes;
    const subido = await uploadConsultaFile({
      buzonUrl: BUZON_BASE,
      para: o.agente,
      de: o.yo,
      file: suClave
        ? { name: nombreEnBuzon(keccak256(bytes)), bytes }
        : { name: a.name, bytes, ...(a.mime ? { mime: a.mime } : {}) },
      sign,
    });
    out.push({ ...subido, name: sanitizeFileName(a.name), ...(a.mime ? { mime: a.mime } : {}) });
  }
  return out;
}

/**
 * Baja un archivo que dejó el agente en la respuesta: comprobado contra el
 * hash que anunció y abierto si iba cifrado. Lanza `FileVerificationError` si
 * los bytes no cuadran; un archivo cambiado no se guarda.
 */
export async function bajarAdjunto(o: { yo: Address; archivo: HashedFile; firmar: Firmar }): Promise<Uint8Array> {
  const crudo = await downloadConsultaFile({
    buzonUrl: BUZON_BASE,
    para: o.yo,
    lector: o.yo,
    file: o.archivo,
    sign: (mensaje) => o.firmar(mensaje) as Promise<Hex>,
  });
  return abrirBytes(crudo, o.yo, o.firmar);
}
