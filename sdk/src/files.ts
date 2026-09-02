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
 *
 * La segunda mitad del archivo hace lo mismo en la otra dirección: los
 * adjuntos que el CLIENTE manda con su encargo —una foto, un PDF que hay que
 * revisar— anunciados dentro del brief con `[panal-attach/1]`, para que el
 * hash de la tarea los cubra desde el momento del pago.
 */

import { keccak256 } from 'viem';
import type { Hex } from 'viem';
import { assertPublicUrl, fetchBytesLimited, type UrlGuardOptions } from './net.js';

/** Cabecera del bloque. Lleva versión porque el formato se ancla en la cadena. */
export const FILES_BLOCK = '[panal-files/1]';

/** Tope por defecto de una descarga: 25 MB. */
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

/**
 * Lo que hace falta para reconocer unos bytes sin fiarse de quien los sirve.
 *
 * Es lo único que comparten las dos direcciones —el archivo que el agente
 * entrega y la foto que el cliente adjunta—, y por eso `verifyFileBytes` pide
 * esto y no un `DeliveredFile`: la comprobación es la misma en los dos
 * sentidos, y el sitio de descarga no pinta nada en ella.
 */
export interface HashedFile {
  /** Nombre del archivo, sin rutas. */
  name: string;
  /** Tamaño en bytes. Se comprueba junto al hash. */
  size: number;
  /** Tipo MIME, si quien lo mandó lo declaró. */
  mime?: string;
  /** keccak256 de los bytes. Es la garantía; todo lo demás es logística. */
  hash: Hex;
}

/** Un archivo anunciado en la entrega. */
export interface DeliveredFile extends HashedFile {
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
    // eslint-disable-next-line no-control-regex -- son justo los que hay que quitar
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
 * Lee los bloques `clave: valor` que van bajo una cabecera dada.
 *
 * Lo comparten el manifiesto de entrega y el de adjuntos: los dos se anclan en
 * la cadena y los dos tienen que leerse igual en todas partes. Un bloque
 * termina en la primera línea vacía o que ya no es `clave: valor`, y eso basta
 * para que dos manifiestos pegados no se contaminen: ninguna cabecera lleva
 * dos puntos.
 */
function parseBloques(text: string, tag: string): Record<string, string>[] {
  const out: Record<string, string>[] = [];
  const lineas = text.split(/\r?\n/);

  for (let i = 0; i < lineas.length; i++) {
    if (lineas[i]!.trim() !== tag) continue;

    const campos: Record<string, string> = {};
    for (let j = i + 1; j < lineas.length; j++) {
      const linea = lineas[j]!;
      if (!linea.trim()) break;
      const sep = linea.indexOf(':');
      if (sep === -1) break;
      campos[linea.slice(0, sep).trim().toLowerCase()] = linea.slice(sep + 1).trim();
    }
    out.push(campos);
  }
  return out;
}

/** Lo común a los dos manifiestos: un nombre limpio, un tamaño y un hash. */
function parseComun(campos: Record<string, string>): HashedFile | null {
  const { name, size, hash, mime } = campos;
  if (!name || !hash || !/^0x[0-9a-fA-F]{64}$/.test(hash)) return null;
  const bytes = Number(size);
  if (!Number.isInteger(bytes) || bytes < 0) return null;
  try {
    return {
      name: sanitizeFileName(name),
      size: bytes,
      hash: hash.toLowerCase() as Hex,
      ...(mime ? { mime } : {}),
    };
  } catch {
    // Nombre inservible: se descarta ese archivo, no el manifiesto entero.
    return null;
  }
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

  for (const campos of parseBloques(text, FILES_BLOCK)) {
    const comun = parseComun(campos);
    if (!comun) continue;
    // Sin `path` ni `url` el archivo no se puede bajar de ningún sitio, y
    // anunciarlo sólo serviría para prometer algo que no se puede cumplir.
    const { path, url } = campos;
    if (!path && !url) continue;
    out.push({ ...comun, ...(path ? { path } : {}), ...(url ? { url } : {}) });
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
    if (linea.trim() === FILES_BLOCK || linea.trim() === ATTACH_BLOCK) {
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
export function verifyFileBytes(file: HashedFile, bytes: Uint8Array): void {
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
  /** Firma de `Panal resultado #<taskId> · <expira>`, la misma que abre `/result/:id`. */
  signature?: string;
  /**
   * Segundo en el que caduca esa firma, tal y como se firmó.
   *
   * Va con la firma porque el agente la necesita para reconstruir el mensaje.
   * Mandarla en claro no regala nada: está DENTRO de lo firmado, así que
   * cambiarla invalida la firma.
   */
  expira?: number;
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

  // Las credenciales van en CABECERAS, no en la query.
  //
  // Esta firma abre el resultado y todos los archivos de la tarea, o sea que es
  // un pase de acceso. En la query acababa escrita en el log de accesos del
  // proxy y en el historial del navegador — se encontraron 23 en claro en un
  // log de producción. Una cabecera no se registra por defecto.
  const cabeceras: Record<string, string> = {};
  if (options.address) cabeceras['x-panal-address'] = options.address;
  if (options.signature) cabeceras['x-panal-signature'] = options.signature;
  if (options.expira !== undefined) cabeceras['x-panal-expira'] = String(options.expira);

  await assertPublicUrl(destino.toString(), options);

  // El tope se ata al tamaño ANUNCIADO, no al de por defecto: si el manifiesto
  // dice 2 MB, no hay razón para dejar que lleguen 25.
  const tope = Math.min(options.maxBytes ?? MAX_FILE_BYTES, Math.max(file.size, 1) + 1024);

  const { status, bytes } = await fetchBytesLimited(destino, {
    maxBytes: tope,
    timeoutMs: options.timeoutMs ?? 120_000,
    redirect: 'error',
    headers: cabeceras,
  });
  if (status !== 200) {
    throw new FileVerificationError(`El agente respondió ${status} al pedirle "${file.name}".`, file.name);
  }

  verifyFileBytes(file, bytes);
  return bytes;
}

// ---------------------------------------------------------------------------
// La otra dirección: lo que el CLIENTE adjunta a su encargo.
//
// El escrow ancla `keccak256(brief)` al contratar, y el agente rechaza el
// encargo si el texto que le llega no da exactamente ese hash. Eso deja el
// brief cerrado, que es justo lo que se quiere… y también significa que una
// foto no puede viajar dentro: no cabe en 32.000 caracteres, y meterla en
// base64 cambiaría el texto que ya se hasheó.
//
// Se hace lo mismo que en la entrega, en espejo. El navegador calcula el hash
// de la foto ANTES de pagar y lo anuncia dentro del brief; los bytes suben
// después, por su cuenta. La cadena de custodia queda cerrada igual:
//
//     taskHash on-chain → texto del brief → hash del adjunto → bytes
//
// Y hay una propiedad que sale gratis y es la que de verdad importa para el
// agente: puede RECHAZAR cualquier byte que no estuviera anunciado. Nadie le
// deja archivos en el disco; sólo entran los que el cliente pagó por anunciar.
//
// No lleva `path` ni `url`, y no es un olvido: el cliente es un navegador y no
// aloja nada. Por eso es un bloque aparte y no un `[panal-files/1]` sin ruta —
// un manifiesto de entrega sin sitio de descarga es una promesa rota, y ahí
// conviene seguir rechazándolo.
// ---------------------------------------------------------------------------

/** Cabecera del bloque de adjuntos. Versionada: se ancla en la cadena. */
export const ATTACH_BLOCK = '[panal-attach/1]';

/** Un archivo que el cliente adjunta al encargo. */
export type AttachedFile = HashedFile;

/**
 * Describe unos bytes para anunciarlos en el brief.
 *
 * El nombre se limpia aquí y no al recibirlo: lo que se anuncia tiene que ser
 * lo mismo que luego se busca, y un nombre saneado a medias haría que el
 * agente no reconociera su propio adjunto.
 */
export function attachmentFrom(name: string, bytes: Uint8Array, mime?: string): AttachedFile {
  return {
    name: sanitizeFileName(name),
    size: bytes.byteLength,
    hash: keccak256(bytes),
    ...(mime ? { mime } : {}),
  };
}

/**
 * Construye el bloque de adjuntos.
 *
 * Orden de claves fijo y `\n`, por lo mismo que en la entrega: este texto entra
 * en el brief, y el brief se hashea. Un espacio de más y el agente rechaza el
 * encargo con el pago ya bloqueado.
 */
export function buildAttachmentsManifest(files: AttachedFile[]): string {
  return files
    .map((f) => {
      const lineas = [ATTACH_BLOCK, `name: ${sanitizeFileName(f.name)}`, `size: ${f.size}`];
      if (f.mime) lineas.push(`mime: ${f.mime}`);
      lineas.push(`hash: ${f.hash}`);
      return lineas.join('\n');
    })
    .join('\n\n');
}

/** El encargo con los adjuntos anunciados al final. Esto es lo que se hashea. */
export function appendAttachmentsManifest(brief: string, files: AttachedFile[]): string {
  if (files.length === 0) return brief;
  return `${brief.trimEnd()}\n\n${buildAttachmentsManifest(files)}\n`;
}

/** Lee los adjuntos anunciados en un encargo. No lanza por un bloque roto. */
export function parseAttachmentsManifest(brief: string): AttachedFile[] {
  const out: AttachedFile[] = [];
  for (const campos of parseBloques(brief, ATTACH_BLOCK)) {
    const comun = parseComun(campos);
    if (comun) out.push(comun);
  }
  return out;
}

/**
 * ¿Estos bytes son alguno de los adjuntos anunciados?
 *
 * Es la guarda del agente al recibir una subida: se busca por HASH, no por
 * nombre, porque el nombre lo elige quien sube y el hash no. Devuelve el
 * adjunto tal y como se anunció —con su nombre ya limpio— o `null`, y un
 * `null` significa exactamente una cosa: esos bytes no se pagaron, no se
 * escriben.
 *
 * `name` sólo desempata cuando el mismo archivo se adjuntó dos veces con
 * nombres distintos; los bytes son los mismos, así que cualquiera valdría,
 * pero devolver el que pidieron evita guardarlo con el nombre del otro.
 */
export function matchAttachment(
  files: AttachedFile[],
  bytes: Uint8Array,
  name?: string,
): AttachedFile | null {
  const real = keccak256(bytes).toLowerCase();
  const iguales = files.filter((f) => f.hash.toLowerCase() === real && f.size === bytes.byteLength);
  if (iguales.length === 0) return null;
  if (name) {
    let limpio: string | null = null;
    try {
      limpio = sanitizeFileName(name);
    } catch {
      limpio = null;
    }
    const exacto = limpio ? iguales.find((f) => f.name === limpio) : undefined;
    if (exacto) return exacto;
  }
  return iguales[0]!;
}
