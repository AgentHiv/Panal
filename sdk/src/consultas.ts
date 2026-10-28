/**
 * Panal SDK — archivos en una pregunta pagada (x402) entre agentes.
 *
 * Una pregunta x402 es texto: 2.000 caracteres a la ida y una respuesta a la
 * vuelta. Para pedirle a otro agente que lea una foto, transcriba un audio o
 * resuma un PDF hacía falta poder mandarle el archivo, y que él pudiera
 * devolver los suyos.
 *
 * Los bytes NO viajan en la pregunta. Van al buzón de Panal, a nombre de quien
 * tiene que leerlos, y en la pregunta solo va la lista con su hash:
 *
 *     POST /x402/ask   { "prompt": "…", "files": [{ name, size, hash, mime }] }
 *
 * Quien recibe la lista baja cada archivo y comprueba sus bytes contra el hash
 * antes de hacer nada: lo que le llega es exactamente lo que le anunciaron, y
 * el buzón no puede cambiarlo por el camino. A la vuelta, igual al revés.
 *
 * En el buzón, cada archivo es de dos cuentas y de nadie más: quien lo dejó y
 * su destinatario. Subirlo pide la firma de quien lo deja (con el destinatario
 * y el hash dentro); bajarlo, la de una de las dos. Y si el destinatario tiene
 * clave de cifrado publicada, se cifra para él antes de subirlo: entonces ni el
 * buzón puede leerlo. Caduca como todo lo del buzón: es un relevo, no un archivo.
 *
 * Ningún mensaje lleva gas: son firmas EIP-191 con caducidad dentro.
 */

import { getAddress, isAddress, keccak256 } from 'viem';
import type { Address, Hex } from 'viem';
import { fetchBytesLimited, fetchLimited, sinBarraFinal } from './net.js';
import { MAX_FILE_BYTES, sanitizeFileName, verifyFileBytes, type HashedFile } from './files.js';

/** Cuántos archivos como mucho en una pregunta o en su respuesta. Como los adjuntos de un encargo. */
export const MAX_CONSULTA_FILES = 5;

/** Lo que dura una firma de subida o de lectura. */
const VENTANA_FIRMA_S = 10 * 60;

/** Lo que anuncia un agente en su cotización si acepta archivos: cuántos y de qué tamaño. */
export interface ConsultaFilesCapability {
  max: number;
  maxBytes: number;
}

/** La capacidad con la que cotiza un agente con el motor de Panal. */
export const CONSULTA_FILES_CAPABILITY: ConsultaFilesCapability = { max: MAX_CONSULTA_FILES, maxBytes: MAX_FILE_BYTES };

/** Un archivo para mandar: lo que se tiene antes de subirlo. */
export interface OutgoingFile {
  name: string;
  bytes: Uint8Array;
  mime?: string;
}

/** Un archivo recibido, ya comprobado contra su hash y abierto si iba cifrado. */
export interface ReceivedFile {
  name: string;
  mime?: string;
  size: number;
  bytes: Uint8Array;
}

/** Firma que autoriza a dejar ESTOS bytes para ESTE destinatario. */
export function consultaUploadMessage(para: Address, hash: Hex, expira: number): string {
  return `Panal: dejo un archivo para ${getAddress(para)}\nhash: ${hash.toLowerCase()}\nexpira: ${expira}`;
}

/** Firma que autoriza a leer un archivo, a su destinatario o a quien lo dejó. */
export function consultaReadMessage(hash: Hex, expira: number): string {
  return `Panal: leer el archivo ${hash.toLowerCase()}\nexpira: ${expira}`;
}

/** La ruta de un archivo de consulta en el buzón. */
export function consultaFileUrl(buzonUrl: string, para: Address, hash?: Hex): string {
  // `sinBarraFinal` y no una expresión regular: con una URL llena de `/` una
  // regex como /\/+$/ tarda en cuadrático (CodeQL js/polynomial-redos).
  const base = `${sinBarraFinal(buzonUrl)}/${getAddress(para)}/consulta-archivo`;
  return hash ? `${base}/${hash.toLowerCase()}` : base;
}

/**
 * Valida la lista de archivos que llega en una pregunta o en una respuesta.
 * Entrada no fiable: devuelve `null` si algo no cuadra, para rechazarla entera
 * —una pregunta con un archivo mal anunciado no se cobra a medias—.
 */
export function parseConsultaFiles(value: unknown, max = MAX_CONSULTA_FILES): HashedFile[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > max) return null;
  const out: HashedFile[] = [];
  for (const v of value) {
    if (!v || typeof v !== 'object') return null;
    const { name, size, hash, mime } = v as Record<string, unknown>;
    if (typeof name !== 'string' || typeof hash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(hash)) return null;
    if (typeof size !== 'number' || !Number.isInteger(size) || size <= 0 || size > MAX_FILE_BYTES) return null;
    if (mime !== undefined && (typeof mime !== 'string' || mime.length > 120)) return null;
    let limpio = '';
    try {
      limpio = sanitizeFileName(name);
    } catch {
      return null;
    }
    if (!limpio) return null;
    out.push({ name: limpio, size, hash: hash.toLowerCase() as Hex, ...(mime ? { mime } : {}) });
  }
  return out;
}

/** Firma un mensaje con caducidad: lo que firma la cuenta que sube o que lee. */
export type SignMessage = (message: string) => Promise<Hex>;

/**
 * Deja un archivo en el buzón para `para`. Los bytes se suben tal cual
 * llegan: si hay que cifrarlos, se cifran ANTES (y el hash es el de lo
 * cifrado, que es lo que se guarda y se comprueba).
 */
export async function uploadConsultaFile(params: {
  buzonUrl: string;
  para: Address;
  de: Address;
  file: OutgoingFile;
  sign: SignMessage;
}): Promise<HashedFile> {
  const { file } = params;
  if (file.bytes.byteLength === 0) throw new Error(`"${file.name}" está vacío.`);
  if (file.bytes.byteLength > MAX_FILE_BYTES) {
    throw new Error(`"${file.name}" pasa de ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB.`);
  }
  const name = sanitizeFileName(file.name);
  if (!name) throw new Error('El archivo no tiene un nombre válido.');
  const hash = keccak256(file.bytes);
  const expira = Math.floor(Date.now() / 1000) + VENTANA_FIRMA_S;
  const signature = await params.sign(consultaUploadMessage(params.para, hash, expira));
  const { status, text } = await fetchLimited(consultaFileUrl(params.buzonUrl, params.para), {
    method: 'POST',
    headers: {
      'content-type': file.mime || 'application/octet-stream',
      'x-panal-address': getAddress(params.de),
      'x-panal-signature': signature,
      'x-panal-expira': String(expira),
      'x-panal-filename': encodeURIComponent(name),
    },
    body: file.bytes as unknown as RequestInit['body'],
    timeoutMs: 120_000,
    maxBytes: 10_000,
  });
  if (status !== 200) throw new Error(`El buzón no aceptó "${name}" (${status}: ${text.slice(0, 160)}).`);
  return { name, size: file.bytes.byteLength, hash, ...(file.mime ? { mime: file.mime } : {}) };
}

/**
 * Baja un archivo de consulta y comprueba sus bytes contra el hash anunciado.
 * Lanza si no cuadran: un archivo cambiado no se le pasa a nadie «avisando».
 */
export async function downloadConsultaFile(params: {
  buzonUrl: string;
  /** Su destinatario: en qué buzón está. */
  para: Address;
  /** Quien lo lee: el destinatario o quien lo dejó. */
  lector: Address;
  file: HashedFile;
  sign: SignMessage;
}): Promise<Uint8Array> {
  const { file } = params;
  if (!isAddress(params.para) || !isAddress(params.lector)) throw new Error('Dirección no válida.');
  const expira = Math.floor(Date.now() / 1000) + VENTANA_FIRMA_S;
  const signature = await params.sign(consultaReadMessage(file.hash, expira));
  const { status, bytes } = await fetchBytesLimited(consultaFileUrl(params.buzonUrl, params.para, file.hash), {
    headers: {
      'x-panal-address': getAddress(params.lector),
      'x-panal-signature': signature,
      'x-panal-expira': String(expira),
    },
    timeoutMs: 120_000,
    maxBytes: Math.min(MAX_FILE_BYTES, file.size) + 1024,
  });
  if (status !== 200) throw new Error(`El buzón no dio "${file.name}" (${status}).`);
  verifyFileBytes(file, bytes);
  return bytes;
}
