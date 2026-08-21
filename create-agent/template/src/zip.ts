/**
 * Leer un ZIP sin dependencias.
 *
 * Hace falta para DOS cosas que parecen distintas y son la misma: una carpeta
 * que el cliente comprimió, y un `.docx` —que es un ZIP con XML dentro—. Con
 * un lector se resuelven las dos.
 *
 * Node trae `zlib`, que es el 90% del trabajo. Lo que falta es entender la
 * estructura del archivo, y es poca cosa: se lee el directorio central del
 * final, no las cabeceras locales, porque el directorio central es el índice
 * fiable —las locales pueden traer los tamaños a cero y remitir a un
 * descriptor que va DETRÁS de los datos—.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * ESTO LO MANDA UN DESCONOCIDO Y HAY QUE TRATARLO COMO TAL.
 *
 * El ZIP llega de un cliente que pagó, pero pagar no vuelve a nadie de fiar.
 * Tres defensas, y las tres importan:
 *
 *   - Una bomba zip: 42 kB que se descomprimen en petabytes. Se mira el tamaño
 *     DECLARADO antes de descomprimir y se lleva un total acumulado, así que
 *     se corta antes de reservar la memoria, no después.
 *   - Rutas con `..` o absolutas: aquí nada se escribe en disco, pero el
 *     nombre viaja al modelo y acaba en logs. Se normaliza igual.
 *   - Un ZIP con cien mil entradas vacías, que no infla memoria pero sí tiempo.
 * ───────────────────────────────────────────────────────────────────────────
 */

import { inflateRawSync } from 'node:zlib';

/** Un archivo dentro del ZIP, ya descomprimido. */
export interface EntradaZip {
  /** La ruta dentro del ZIP, ya normalizada. */
  nombre: string;
  bytes: Uint8Array;
}

export interface LimitesZip {
  /** Cuántas entradas se miran como mucho. */
  maxEntradas: number;
  /** Tope del total descomprimido, sumando todas. */
  maxTotalBytes: number;
  /** Tope de una sola entrada. */
  maxEntradaBytes: number;
}

export const LIMITES_ZIP: LimitesZip = {
  maxEntradas: 200,
  maxTotalBytes: 32 * 1024 * 1024,
  maxEntradaBytes: 8 * 1024 * 1024,
};

/** Los cuatro bytes con los que empieza todo ZIP (y todo .docx, .xlsx, .odt). */
export function esZip(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

const u16 = (b: Uint8Array, i: number): number => b[i]! | (b[i + 1]! << 8);
const u32 = (b: Uint8Array, i: number): number =>
  (b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16) | (b[i + 3]! << 24)) >>> 0;

/**
 * Quita lo que haría daño de una ruta interna.
 *
 * No se escribe nada en disco, así que esto no evita un escape de directorio:
 * evita que un nombre inventado —`../../etc/passwd`— llegue al modelo y a los
 * logs como si fuera un archivo de verdad del cliente.
 */
function rutaLimpia(nombre: string): string {
  return nombre
    .replace(/\\/g, '/')
    .split('/')
    .filter((p) => p && p !== '.' && p !== '..')
    .join('/')
    .slice(0, 200);
}

/** Dónde empieza el directorio central. Se busca desde el final. */
function buscarDirectorio(b: Uint8Array): number | null {
  // El comentario final puede ocupar hasta 64 kB, así que no basta con mirar
  // los últimos 22 bytes.
  const desde = Math.max(0, b.length - 22 - 0xffff);
  for (let i = b.length - 22; i >= desde; i--) {
    if (u32(b, i) === 0x06054b50) return u32(b, i + 16);
  }
  return null;
}

/**
 * Los archivos de un ZIP, descomprimidos y acotados.
 *
 * Las carpetas y las entradas vacías se saltan solas: lo que interesa es el
 * contenido. Una entrada que no se puede descomprimir se OMITE en vez de
 * tumbar la lectura entera — un ZIP con un archivo roto sigue teniendo diez
 * buenos, y el cliente ya pagó por que se mire lo que sí se puede.
 */
export function leerZip(datos: Uint8Array, limites: LimitesZip = LIMITES_ZIP): EntradaZip[] {
  const inicio = buscarDirectorio(datos);
  if (inicio === null || inicio >= datos.length) return [];

  const salida: EntradaZip[] = [];
  let total = 0;
  let cursor = inicio;

  while (cursor + 46 <= datos.length && u32(datos, cursor) === 0x02014b50) {
    const metodo = u16(datos, cursor + 10);
    const comprimido = u32(datos, cursor + 20);
    const sinComprimir = u32(datos, cursor + 24);
    const nLargo = u16(datos, cursor + 28);
    const extraLargo = u16(datos, cursor + 30);
    const comentarioLargo = u16(datos, cursor + 32);
    const offsetLocal = u32(datos, cursor + 42);
    const nombre = rutaLimpia(new TextDecoder().decode(datos.subarray(cursor + 46, cursor + 46 + nLargo)));

    cursor += 46 + nLargo + extraLargo + comentarioLargo;

    if (salida.length >= limites.maxEntradas) break;
    // El tamaño se comprueba ANTES de descomprimir: es lo único que separa
    // esto de reservar los petabytes que la bomba pide.
    if (!nombre || sinComprimir === 0) continue;
    if (sinComprimir > limites.maxEntradaBytes) continue;
    if (total + sinComprimir > limites.maxTotalBytes) break;

    // Ahora sí hay que mirar la cabecera local, sólo para saber dónde
    // empiezan los datos: su longitud de extra puede ser distinta de la del
    // directorio central, y darlo por hecho desplaza la lectura.
    if (offsetLocal + 30 > datos.length || u32(datos, offsetLocal) !== 0x04034b50) continue;
    const datosEn = offsetLocal + 30 + u16(datos, offsetLocal + 26) + u16(datos, offsetLocal + 28);
    if (datosEn + comprimido > datos.length) continue;
    const crudo = datos.subarray(datosEn, datosEn + comprimido);

    try {
      const bytes = metodo === 0 ? crudo : metodo === 8 ? new Uint8Array(inflateRawSync(crudo)) : null;
      if (!bytes) continue;
      total += bytes.length;
      salida.push({ nombre, bytes });
    } catch {
      // Entrada corrupta o cifrada: se omite y se sigue con las demás.
      continue;
    }
  }

  return salida;
}

/* ══════════════════════════════════════════════════════════════════════════
 * ESCRIBIR
 *
 * Hace falta para devolver un `.docx`, que es un ZIP con XML dentro. El mismo
 * formato que se lee arriba, al revés.
 * ══════════════════════════════════════════════════════════════════════════ */

import { deflateRawSync } from 'node:zlib';

/** CRC-32, que el ZIP exige por entrada. Tabla al vuelo: son 256 valores. */
function crc32(bytes: Uint8Array): number {
  let c: number;
  const tabla: number[] = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    tabla[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const b of bytes) crc = tabla[(crc ^ b) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function escribirU16(v: number): number[] {
  return [v & 0xff, (v >>> 8) & 0xff];
}
function escribirU32(v: number): number[] {
  return [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
}

/**
 * Monta un ZIP.
 *
 * Se comprime todo con deflate. Sin fecha real —se pone la del epoch de MS-DOS
 * y ya— porque un archivo que cambia de bytes cada vez que se genera rompe una
 * propiedad que aquí importa: el hash de la entrega se ancla en la cadena, y
 * generar dos veces lo mismo tiene que dar exactamente lo mismo.
 */
export function escribirZip(entradas: { nombre: string; bytes: Uint8Array }[]): Uint8Array {
  const local: number[] = [];
  const central: number[] = [];
  let offset = 0;

  for (const e of entradas) {
    const nombre = [...new TextEncoder().encode(e.nombre)];
    const comprimido = [...new Uint8Array(deflateRawSync(e.bytes))];
    const crc = crc32(e.bytes);

    const cabecera = [
      ...escribirU32(0x04034b50),
      ...escribirU16(20), // versión mínima
      ...escribirU16(0),
      ...escribirU16(8), // deflate
      ...escribirU16(0), // hora
      ...escribirU16(0x21), // fecha: 1980-01-01
      ...escribirU32(crc),
      ...escribirU32(comprimido.length),
      ...escribirU32(e.bytes.length),
      ...escribirU16(nombre.length),
      ...escribirU16(0),
      ...nombre,
    ];
    local.push(...cabecera, ...comprimido);

    central.push(
      ...escribirU32(0x02014b50),
      ...escribirU16(20), // versión que lo creó
      ...escribirU16(20),
      ...escribirU16(0),
      ...escribirU16(8),
      ...escribirU16(0),
      ...escribirU16(0x21),
      ...escribirU32(crc),
      ...escribirU32(comprimido.length),
      ...escribirU32(e.bytes.length),
      ...escribirU16(nombre.length),
      ...escribirU16(0),
      ...escribirU16(0), // comentario
      ...escribirU16(0), // disco
      ...escribirU16(0), // atributos internos
      ...escribirU32(0), // atributos externos
      ...escribirU32(offset),
      ...nombre,
    );
    offset += cabecera.length + comprimido.length;
  }

  const fin = [
    ...escribirU32(0x06054b50),
    ...escribirU16(0),
    ...escribirU16(0),
    ...escribirU16(entradas.length),
    ...escribirU16(entradas.length),
    ...escribirU32(central.length),
    ...escribirU32(local.length),
    ...escribirU16(0),
  ];

  return new Uint8Array([...local, ...central, ...fin]);
}
