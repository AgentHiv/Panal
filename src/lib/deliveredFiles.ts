/**
 * Panal — los archivos que vienen dentro de una entrega.
 *
 * Un agente no puede meter un PDF en la cadena, así que mete SU HASH en el
 * texto de la entrega, y ese texto sí queda anclado. El bloque va al final:
 *
 *     [panal-files/1]
 *     name: informe.pdf
 *     size: 184320
 *     mime: application/pdf
 *     hash: 0x8f3a…
 *     path: /files/32/informe.pdf
 *
 * Con eso la custodia queda cerrada de punta a punta:
 *
 *     resultHash on-chain → texto de la entrega → hash del archivo → bytes
 *
 * El servidor que sirve el archivo deja de importar: si los bytes no dan el
 * hash, no es el archivo que se entregó y el cliente tiene con qué disputarlo.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * El formato lo define `sdk/src/files.ts`, que es la fuente de la verdad. Aquí
 * se reimplementa la parte de lectura en vez de importar @panal/sdk, por lo
 * mismo que `src/contracts/abis.ts` reimplementa los ABIs: el SDK trae cliente,
 * cadenas y un `import('node:dns')` que no pintan nada en un navegador, y esto
 * son cuarenta líneas. Si cambias el formato, cámbialo en los dos sitios.
 * ─────────────────────────────────────────────────────────────────────────
 */

import { keccak256 } from 'viem';

/** Cabecera del bloque. Lleva versión porque el formato se ancla en la cadena. */
export const FILES_BLOCK = '[panal-files/1]';

/** Tope de una descarga: 25 MB, el mismo que el SDK. */
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

export interface DeliveredFile {
  name: string;
  size: number;
  mime?: string;
  hash: string;
  path?: string;
  url?: string;
}

/**
 * Limpia un nombre para que no pueda salirse de su carpeta.
 *
 * El nombre lo escribe el agente y aquí acaba en una URL y en un `download=`.
 * Un `../../algo` no debe llegar a ninguno de los dos.
 */
export function sanitizeFileName(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? '';
  const limpio = base
    // Los caracteres de control son justo lo que hay que quitar aquí, así
    // que la regla que avisa de ellos no aplica.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/^\.+/, '')
    .trim();
  return limpio.slice(0, 120);
}

/**
 * Lee los archivos que anuncia una entrega.
 *
 * Un bloque mal formado se descarta solo, sin llevarse la entrega por delante:
 * el cliente ya pagó y tiene derecho a leer al menos la parte escrita.
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
    const limpio = sanitizeFileName(name);
    if (!limpio) continue;

    out.push({
      name: limpio,
      size: bytes,
      hash: hash.toLowerCase(),
      ...(mime ? { mime } : {}),
      ...(path ? { path } : {}),
      ...(url ? { url } : {}),
    });
  }
  return out;
}

/** El texto sin los bloques: lo que se le enseña a una persona. */
export function stripFilesManifest(text: string): string {
  const fuera: string[] = [];
  let dentro = false;

  for (const linea of text.split(/\r?\n/)) {
    if (linea.trim() === FILES_BLOCK) {
      dentro = true;
      continue;
    }
    if (dentro) {
      if (linea.trim() && linea.includes(':')) continue;
      dentro = false;
    }
    fuera.push(linea);
  }
  return fuera.join('\n').trimEnd();
}

/**
 * De dónde se baja.
 *
 * La ruta relativa se resuelve contra el endpoint que el agente publica EN EL
 * REGISTRY, no contra nada que venga en el texto: si el agente pudiera elegir
 * el host, uno comprometido mandaría a su cliente donde quisiera.
 */
export function fileUrl(file: DeliveredFile, botUrl: string): string {
  if (file.url) return file.url;
  return new URL(file.path!, botUrl.endsWith('/') ? botUrl : `${botUrl}/`).toString();
}

/** Tamaño legible: 1321 → "1,3 KB". */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1).replace('.', ',')} KB`;
  return `${(n / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}

export class FileVerificationError extends Error {}

/**
 * Baja un archivo y comprueba sus bytes contra el hash que respalda la cadena.
 *
 * Lanza en vez de devolver bytes que no cuadran: si los devolviera "avisando",
 * quien llama acabaría guardándolos igual.
 */
export async function downloadDeliveredFile(
  file: DeliveredFile,
  botUrl: string,
  address: string,
  signature: string,
): Promise<Blob> {
  const destino = new URL(fileUrl(file, botUrl));
  destino.searchParams.set('address', address);
  destino.searchParams.set('signature', signature);

  const res = await fetch(destino.toString(), { redirect: 'error' });
  if (!res.ok) throw new FileVerificationError(`HTTP ${res.status}`);

  const bytes = new Uint8Array(await res.arrayBuffer());
  // El tamaño se mira antes: es la comprobación barata, y si no cuadra el hash
  // tampoco lo va a hacer.
  if (bytes.byteLength !== file.size || bytes.byteLength > MAX_FILE_BYTES) {
    throw new FileVerificationError('size');
  }
  if (keccak256(bytes).toLowerCase() !== file.hash) throw new FileVerificationError('hash');

  return new Blob([bytes as BlobPart], { type: file.mime || 'application/octet-stream' });
}
