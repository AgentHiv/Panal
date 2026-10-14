/**
 * Un ZIP sin comprimir, en el navegador y sin dependencias.
 *
 * Para mandar una CARPETA por el tablón: el buzón guarda archivos sueltos, y
 * una carpeta entera viaja como un solo `.zip`, con su hash anunciado como el
 * de cualquier otro archivo. Sin comprimir (método 0, «stored»): lo que se
 * manda suele ser PDF, imágenes o vídeo, que ya van comprimidos, y así no hace
 * falta ninguna librería. La plantilla de los agentes lo abre (`leerZip`
 * acepta los métodos 0 y 8).
 *
 * Nombres en UTF-8 (bit 11 de los flags) y con `/` como separador, que es lo
 * que dice el formato. Sin ZIP64: el tope de un archivo del tablón son 25 MB.
 */

/** La tabla del CRC-32 (polinomio 0xEDB88320), calculada una vez. */
const TABLA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = TABLA_CRC[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** 1 de enero de 1980, la primera fecha que admite el formato: sin fecha, sale un día 0 que no existe. */
const FECHA_DOS = (0 << 9) | (1 << 5) | 1;

export interface EntradaParaZip {
  /** La ruta dentro del ZIP, con `/`. */
  nombre: string;
  bytes: Uint8Array;
}

/** Una ruta limpia para dentro del ZIP: sin `..`, sin raíz, con `/`. */
function rutaLimpia(nombre: string): string {
  return nombre
    .replace(/\\/g, '/')
    .split('/')
    .filter((t) => t && t !== '.' && t !== '..')
    .join('/');
}

export function crearZip(entradas: EntradaParaZip[]): Uint8Array {
  const codificar = new TextEncoder();
  const locales: Uint8Array[] = [];
  const centrales: Uint8Array[] = [];
  let desplazamiento = 0;

  for (const e of entradas) {
    const nombre = codificar.encode(rutaLimpia(e.nombre));
    if (nombre.length === 0) continue;
    const crc = crc32(e.bytes);
    const tam = e.bytes.length;

    const local = new Uint8Array(30 + nombre.length);
    const l = new DataView(local.buffer);
    l.setUint32(0, 0x04034b50, true); // firma de la cabecera local
    l.setUint16(4, 20, true); // versión necesaria
    l.setUint16(6, 0x0800, true); // UTF-8
    l.setUint16(8, 0, true); // sin comprimir
    l.setUint16(12, FECHA_DOS, true);
    l.setUint32(14, crc, true);
    l.setUint32(18, tam, true);
    l.setUint32(22, tam, true);
    l.setUint16(26, nombre.length, true);
    local.set(nombre, 30);

    const central = new Uint8Array(46 + nombre.length);
    const c = new DataView(central.buffer);
    c.setUint32(0, 0x02014b50, true); // firma del directorio central
    c.setUint16(4, 20, true);
    c.setUint16(6, 20, true);
    c.setUint16(8, 0x0800, true);
    c.setUint16(10, 0, true);
    c.setUint16(14, FECHA_DOS, true);
    c.setUint32(16, crc, true);
    c.setUint32(20, tam, true);
    c.setUint32(24, tam, true);
    c.setUint16(28, nombre.length, true);
    c.setUint32(42, desplazamiento, true);
    central.set(nombre, 46);

    locales.push(local, e.bytes);
    centrales.push(central);
    desplazamiento += local.length + tam;
  }

  const tamCentral = centrales.reduce((n, b) => n + b.length, 0);
  const fin = new Uint8Array(22);
  const f = new DataView(fin.buffer);
  f.setUint32(0, 0x06054b50, true); // fin del directorio central
  f.setUint16(8, centrales.length, true);
  f.setUint16(10, centrales.length, true);
  f.setUint32(12, tamCentral, true);
  f.setUint32(16, desplazamiento, true);

  const total = desplazamiento + tamCentral + fin.length;
  const out = new Uint8Array(total);
  let i = 0;
  for (const b of [...locales, ...centrales, fin]) {
    out.set(b, i);
    i += b.length;
  }
  return out;
}
