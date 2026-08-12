/**
 * Panal SDK — entregar archivos sin renunciar a la garantía de la cadena.
 *
 * El escrow ancla `keccak256(texto de la entrega)` y nada más. Eso funciona
 * para un informe escrito, pero no para un PDF, un audio o un vídeo: no caben
 * en un string y meterlos en la cadena costaría más que el trabajo.
 *
 * La salida fácil sería entregar un enlace. Es una trampa: el hash anclado
 * cubriría el enlace, no el archivo. Quien lo aloja puede cambiar el PDF
 * después de cobrar y el cliente no tiene con qué demostrar nada. Un enlace
 * pelado convierte el escrow en una promesa.
 *
 * Lo que se hace aquí es anclar el HASH DEL ARCHIVO dentro del texto:
 *
 *     Aquí tienes el informe que pediste.
 *
 *     [panal-files/1]
 *     name: informe.pdf
 *     size: 184320
 *     mime: application/pdf
 *     hash: 0x8f3a…
 *     path: /files/31/informe.pdf
 *
 * Ese texto entero es lo que se ancla. La cadena de custodia queda cerrada:
 *
 *     resultHash on-chain → texto de la entrega → hash del archivo → bytes
 *
 * Cada eslabón se comprueba sin fiarse de nadie. El servidor que sirve el
 * archivo deja de ser de confianza: puede ser el agente, un S3 o un CDN, y si
 * los bytes no dan el hash pactado, la descarga falla.
 *
 * `path` se resuelve contra el `botUrl` que el agente tiene REGISTRADO
 * on-chain, no contra algo que venga en el texto. Así un agente no puede
 * mandar a su cliente a un tercero. `url` absoluta existe para quien aloja
 * fuera, y es igual de segura porque la garantía la da el hash, no el sitio.
 */

import { keccak256 } from 'viem';
import type { Hex } from 'viem';
import { assertPublicUrl, fetchBytesLimited, type UrlGuardOptions } from './net.js';

/** Cabecera del bloque. Lleva versión porque el formato se ancla en la cadena. */
export const FILES_BLOCK = '[panal-files/1]';

/** Tope por defecto de una descarga: 25 MB. */
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

/** Un archivo anunciado en la entrega. */
export interface DeliveredFile {
  /** Nombre del archivo, sin rutas. */
  name: string;
  /** Tamaño en bytes. Se comprueba junto al hash. */
  size: number;
  /** Tipo MIME, si el agente lo declaró. */
  mime?: string;
  /** keccak256 de los bytes. Es la garantía; todo lo demás es logística. */
  hash: Hex;
  /** Ruta relativa, a resolver contra el botUrl registrado del agente. */
  path?: string;
  /** URL absoluta, para quien aloja fuera de su propio servidor. */
  url?: string;
}

export class FileVerificationError extends Error {
  constructor(
    message: string,
    readonly file: string,
  ) {
    super(message);
    this.name = 'FileVerificationError';
  }
}

/**
 * Limpia un nombre de archivo para que no pueda salirse de su carpeta.
 *
 * El nombre viaja en el texto de la entrega y acaba usado como ruta en disco y
 * en una URL. Sin esto, un `../../.env` como nombre convierte una entrega en
 * una lectura arbitraria del servidor del agente.
 */
export function sanitizeFileName(name: string): string {
  // Se corta por cualquier separador y se coge el último tramo: así `a/b/c.pdf`
  // y `..\\..\\c.pdf` acaban los dos en `c.pdf`.
  const base = name.split(/[/\\]/).pop() ?? '';
  const limpio = base
    .replace(/[\u0000-\u001f\u007f]/g, '') // caracteres de control
    .replace(/^\.+/, '') // nada de nombres que empiezan por punto: '..' incluido
    .trim();
  if (!limpio) throw new Error(`Nombre de archivo inservible: "${name}"`);
  return limpio.slice(0, 120);
}

/**
 * Construye el bloque del manifiesto.
 *
 * El orden de las claves es fijo y las líneas van con `\n`: este texto se
 * anclará en la cadena, así que dos ejecuciones con los mismos archivos tienen
 * que dar exactamente los mismos bytes.
 */
export function buildFilesManifest(files: DeliveredFile[]): string {
  return files
    .map((f) => {
      const lineas = [FILES_BLOCK, `name: ${sanitizeFileName(f.name)}`, `size: ${f.size}`];
      if (f.mime) lineas.push(`mime: ${f.mime}`);
      lineas.push(`hash: ${f.hash}`);
      if (f.path) lineas.push(`path: ${f.path}`);
      if (f.url) lineas.push(`url: ${f.url}`);
      return lineas.join('\n');
    })
    .join('\n\n');
}

/** El texto de la entrega con el manifiesto pegado al final. */
export function appendFilesManifest(text: string, files: DeliveredFile[]): string {
  if (files.length === 0) return text;
  const cuerpo = text.trimEnd();
  return `${cuerpo}\n\n${buildFilesManifest(files)}\n`;
}

/**
 * Lee los archivos anunciados en el texto de una entrega.
 *
 * Nunca lanza por un bloque mal formado: devuelve los que sí se entienden. Un
 * manifiesto roto no puede impedirle al cliente leer la parte escrita de su
 * entrega, que ya pagó.
 */
export function parseFilesManifest(text: string): DeliveredFile[] {
  const out: DeliveredFile[] = [];
  const lineas = text.split(/\r?\n/);

  for (let i = 0; i < lineas.length; i++) {
    if (lineas[i]!.trim() !== FILES_BLOCK) continue;

    const campos: Record<string, string> = {};
    for (let j = i + 1; j < lineas.length; j++) {
      const linea = lineas[j]!;
      if (!linea.trim() || linea.trim() === FILES_BLOCK) break;
      const sep = linea.indexOf(':');
      if (sep === -1) break;
      campos[linea.slice(0, sep).trim().toLowerCase()] = linea.slice(sep + 1).trim();
    }

    const { name, size, hash, mime, path, url } = campos;
    if (!name || !hash || !/^0x[0-9a-fA-F]{64}$/.test(hash)) continue;
    const bytes = Number(size);
    if (!Number.isInteger(bytes) || bytes < 0) continue;
    if (!path && !url) continue;

    try {
      out.push({
        name: sanitizeFileName(name),
        size: bytes,
        hash: hash.toLowerCase() as Hex,
        ...(mime ? { mime } : {}),
        ...(path ? { path } : {}),
        ...(url ? { url } : {}),
      });
    } catch {
      // Nombre inservible: se descarta ese archivo, no la entrega entera.
    }
  }
  return out;
}

/**
 * El texto de la entrega sin los bloques del manifiesto.
 *
 * Para enseñárselo a una persona: el manifiesto es para la máquina, y en un
 * chat de Telegram no aporta más que ruido.
 */
export function stripFilesManifest(text: string): string {
  const lineas = text.split(/\r?\n/);
  const fuera: string[] = [];
  let dentro = false;

  for (const linea of lineas) {
    if (linea.trim() === FILES_BLOCK) {
      dentro = true;
      continue;
    }
    if (dentro) {
      // El bloque termina en la primera línea que ya no es `clave: valor`.
      if (linea.trim() && linea.includes(':')) continue;
      dentro = false;
    }
    fuera.push(linea);
  }
  return fuera.join('\n').trimEnd();
}

/** Comprueba unos bytes contra lo que el manifiesto prometía. Lanza si no cuadra. */
export function verifyFileBytes(file: DeliveredFile, bytes: Uint8Array): void {
  if (bytes.byteLength !== file.size) {
    throw new FileVerificationError(
      `"${file.name}" mide ${bytes.byteLength} bytes y la entrega anunciaba ${file.size}.`,
      file.name,
    );
  }
  const real = keccak256(bytes);
  if (real.toLowerCase() !== file.hash.toLowerCase()) {
    throw new FileVerificationError(
      `"${file.name}" no es el archivo que se entregó: su hash es ${real}, y el anclado en la cadena es ${file.hash}.`,
      file.name,
    );
  }
}

/**
 * De dónde se baja un archivo.
 *
 * `path` se resuelve contra el `botUrl` que el agente publica EN EL REGISTRY,
 * no contra nada que venga en el texto: si el agente pudiera elegir el host, un
 * agente comprometido mandaría a su cliente donde quisiera. La URL absoluta se
 * permite porque el hash la vigila igual, pero pasa por el guardia de SSRF.
 */
export function fileUrl(file: DeliveredFile, baseUrl: string | undefined): string {
  if (file.url) return file.url;
  if (!file.path) throw new Error(`La entrega anuncia "${file.name}" sin decir de dónde bajarlo.`);
  if (!baseUrl) {
    throw new Error(
      `"${file.name}" viene con una ruta relativa y el agente no publica endpoint en el registry: no hay contra qué resolverla.`,
    );
  }
  return new URL(file.path, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`).toString();
}

export interface DownloadOptions extends UrlGuardOptions {
  /** Base para las rutas relativas: el botUrl registrado del agente. */
  baseUrl?: string;
  /** Wallet del cliente; el agente solo entrega a quien pagó. */
  address?: string;
  /** Firma de `Panal resultado #<taskId>`, la misma que abre `/result/:id`. */
  signature?: string;
  maxBytes?: number;
  timeoutMs?: number;
}

/**
 * Baja un archivo de una entrega y lo verifica contra el hash anclado.
 *
 * Si los bytes no dan el hash, lanza en vez de devolverlos. Devolver un archivo
 * que no cuadra "avisando" no serviría de nada: quien llama lo guardaría igual.
 */
export async function downloadDeliveredFile(
  file: DeliveredFile,
  options: DownloadOptions = {},
): Promise<Uint8Array> {
  const destino = new URL(fileUrl(file, options.baseUrl));
  if (options.address) destino.searchParams.set('address', options.address);
  if (options.signature) destino.searchParams.set('signature', options.signature);

  await assertPublicUrl(destino.toString(), options);

  // El tope se ata al tamaño ANUNCIADO, no al de por defecto: si el manifiesto
  // dice 2 MB, no hay razón para dejar que lleguen 25.
  const tope = Math.min(options.maxBytes ?? MAX_FILE_BYTES, Math.max(file.size, 1) + 1024);

  const { status, bytes } = await fetchBytesLimited(destino, {
    maxBytes: tope,
    timeoutMs: options.timeoutMs ?? 120_000,
    redirect: 'error',
  });
  if (status !== 200) {
    throw new FileVerificationError(`El agente respondió ${status} al pedirle "${file.name}".`, file.name);
  }

  verifyFileBytes(file, bytes);
  return bytes;
}
