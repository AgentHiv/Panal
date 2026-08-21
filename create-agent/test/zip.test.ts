/**
 * Leer un ZIP que ha escrito otro.
 *
 *     npx tsx test/zip.test.ts     (o: npm test)
 *
 * Los tres archivos de abajo NO los generó este código: los escribió la
 * `zipfile` de Python. Es a propósito. Un lector probado contra un ZIP que
 * escribe el mismo autor comparte con él cualquier malentendido sobre el
 * formato, y entonces el test pasa sin demostrar nada.
 *
 * Lo que más importa aquí no es leer bien: es NO leer lo que no se debe. Un
 * ZIP lo manda un cliente, y pagar no vuelve a nadie de fiar.
 */

import { esZip, leerZip, LIMITES_ZIP } from '../template/src/zip.js';

let fallos = 0;
const check = (nombre: string, ok: boolean, detalle = ''): void => {
  console.log(`${ok ? '\u2705' : '\u274c'} ${nombre}${ok ? '' : ` \u2014 ${detalle}`}`);
  if (!ok) fallos++;
};

const deB64 = (s: string): Uint8Array => Uint8Array.from(Buffer.from(s, 'base64'));
const texto = (b: Uint8Array): string => new TextDecoder().decode(b);

/** Un ZIP con carpetas, texto y un binario. Escrito por Python. */
const NORMAL = deB64(
  'UEsDBBQAAAAIAKe5FV3cldCDIwAAACEAAAAJAAAAUkVBRE1FLm1kU1YIKMqvTE0uyefiCs1TSCxKzsgsy1dISVUoSa0oydfj' +
  'AgBQSwMEFAAAAAgAp7kVXbIdW4YeAAAAHAAAAAsAAABzcmMvbWFpbi50c0utKMgvKlFIzs8rLlEoKE0tKslXsFWwMLewtOYC' +
  'AFBLAwQUAAAACACnuRVdPnyYNycAAAAlAAAAEQAAAHNyYy91dGlsL2ZlY2hhLnRzS60oyC8qUUjOzysuUcjIr1SwVdDQVLC1' +
  'U8hLLVdwSSxJ1dC05gIAUEsDBBQAAAAIAKe5FV0AAAAAAgAAAAAAAAAGAAAAdmFjaW8vAwBQSwMEFAAAAAgAp7kVXXOMBSkF' +
  'AQAAAAEAAAgAAABsb2dvLmJpbgEAAf/+AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8gISIjJCUmJygpKissLS4v' +
  'MDEyMzQ1Njc4OTo7PD0+P0BBQkNERUZHSElKS0xNTk9QUVJTVFVWV1hZWltcXV5fYGFiY2RlZmdoaWprbG1ub3BxcnN0dXZ3' +
  'eHl6e3x9fn+AgYKDhIWGh4iJiouMjY6PkJGSk5SVlpeYmZqbnJ2en6ChoqOkpaanqKmqq6ytrq+wsbKztLW2t7i5uru8vb6/' +
  'wMHCw8TFxsfIycrLzM3Oz9DR0tPU1dbX2Nna29zd3t/g4eLj5OXm5+jp6uvs7e7v8PHy8/T19vf4+fr7/P3+/1BLAwQUAAAA' +
  'CACnuRVdhgIv8g8AAAANAAAADAAAAGd1YXJkYWRvLnR4dCvOzFNIzs8tKMrMzSwCAFBLAQIUAxQAAAAIAKe5FV3cldCDIwAA' +
  'ACEAAAAJAAAAAAAAAAAAAACAAQAAAABSRUFETUUubWRQSwECFAMUAAAACACnuRVdsh1bhh4AAAAcAAAACwAAAAAAAAAAAAAA' +
  'gAFKAAAAc3JjL21haW4udHNQSwECFAMUAAAACACnuRVdPnyYNycAAAAlAAAAEQAAAAAAAAAAAAAAgAGRAAAAc3JjL3V0aWwv' +
  'ZmVjaGEudHNQSwECFAMUAAAACACnuRVdAAAAAAIAAAAAAAAABgAAAAAAAAAAABAA/UHnAAAAdmFjaW8vUEsBAhQDFAAAAAgA' +
  'p7kVXXOMBSkFAQAAAAEAAAgAAAAAAAAAAAAAAIABDQEAAGxvZ28uYmluUEsBAhQDFAAAAAgAp7kVXYYCL/IPAAAADQAAAAwA' +
  'AAAAAAAAAAAAAIABOAIAAGd1YXJkYWRvLnR4dFBLBQYAAAAABgAGAFMBAABxAgAAAAA=',
);

/** Un .docx con la estructura que produce Word. Escrito por Python. */
const DOCX = deB64(
  'UEsDBBQAAAAIAKe5FV3uR1hmHwAAAB0AAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbLOxr8jNUShLLSrOzM+zVTLUM1Cyt7MJ' +
  'qSxILda3AwBQSwMEFAAAAAgAp7kVXVTH5hzpAAAAlwEAABEAAAB3b3JkL2RvY3VtZW50LnhtbIVQzUoEMQy++xSh951WRZFh' +
  'pnuQ9eRBxH2A2MbZwrQpbd1xfXrb9QeUBS8fCcn3kwzrNz/DnlJ2HEZx3ikBFAxbF6ZRbJ/uVjcCcsFgceZAozhQFmt9Niy9' +
  'ZfPqKRSoCiH3yyh2pcReymx25DF3HCnU2Qsnj6W2aZILJxsTG8q5GvhZXih1LT26IHSVfGZ7OGrH1qUGRd9yKAkLgyXIlPbO' +
  'OM6DbKOG6YjxL62l6nNEUzPHRI1IQt8jREyF4Bf/x8p8WmEodHqhsieEK6Vgs33s/g2hH2Z85x4uFVhXP3KKIL/ObsX3S/UH' +
  'UEsBAhQDFAAAAAgAp7kVXe5HWGYfAAAAHQAAABMAAAAAAAAAAAAAAIABAAAAAFtDb250ZW50X1R5cGVzXS54bWxQSwECFAMU' +
  'AAAACACnuRVdVMfmHOkAAACXAQAAEQAAAAAAAAAAAAAAgAFQAAAAd29yZC9kb2N1bWVudC54bWxQSwUGAAAAAAIAAgCAAAAA' +
  'aAEAAAAA',
);

/** Nombres que intentan salirse: `../../etc/passwd` y `/absoluto.txt`. */
const HOSTIL = deB64(
  'UEsDBBQAAAAIAKe5FV3Mqc5XDAAAAAoAAAAQAAAALi4vLi4vZXRjL3Bhc3N3ZCvKzy+xqrAysDIAAFBLAwQUAAAACACnuRVd' +
  'SJ8KRgoAAAAIAAAADQAAAC9hYnNvbHV0by50eHRLTCrOzyktyQcAUEsBAhQDFAAAAAgAp7kVXcypzlcMAAAACgAAABAAAAAA' +
  'AAAAAAAAAIABAAAAAC4uLy4uL2V0Yy9wYXNzd2RQSwECFAMUAAAACACnuRVdSJ8KRgoAAAAIAAAADQAAAAAAAAAAAAAAgAE6' +
  'AAAAL2Fic29sdXRvLnR4dFBLBQYAAAAAAgACAHkAAABvAAAAAAA=',
);

console.log('\n\u2500\u2500 Reconocerlo \u2500\u2500\n');

check('un ZIP se reconoce por su firma', esZip(NORMAL));
check('un .docx tambien es un ZIP', esZip(DOCX));
check('un texto suelto no lo es', !esZip(new TextEncoder().encode('esto no es un zip')));

console.log('\n\u2500\u2500 Leerlo \u2500\u2500\n');

const entradas = leerZip(NORMAL);
const porNombre = new Map(entradas.map((e) => [e.nombre, e]));

check('salen los archivos, no las carpetas', entradas.length === 5, `${entradas.length}: ${entradas.map((e) => e.nombre).join(', ')}`);
check('el contenido es el que se guardo', texto(porNombre.get('README.md')!.bytes).startsWith('# Proyecto'));
check('las rutas anidadas se conservan', porNombre.has('src/util/fecha.ts'));
check('y su contenido tambien', texto(porNombre.get('src/main.ts')!.bytes).includes('8789'));
check('un binario sale intacto', porNombre.get('logo.bin')!.bytes.length === 256);
check('una carpeta vacia no cuenta como archivo', !porNombre.has('vacio/'));

console.log('\n\u2500\u2500 Lo que hace que un .docx sea legible \u2500\u2500\n');

const doc = leerZip(DOCX).find((e) => e.nombre === 'word/document.xml');
check('se encuentra word/document.xml', !!doc);
check('con el texto del documento dentro', texto(doc!.bytes).includes('Contrato de servicios'));

console.log('\n\u2500\u2500 Lo que manda un desconocido \u2500\u2500\n');

const hostiles = leerZip(HOSTIL).map((e) => e.nombre);
check('`../` se limpia de la ruta', hostiles.includes('etc/passwd'), hostiles.join(', '));
check('una ruta absoluta deja de serlo', hostiles.includes('absoluto.txt'), hostiles.join(', '));
check('y ninguna conserva `..`', hostiles.every((n) => !n.includes('..')));

console.log('\n\u2500\u2500 Los topes, que son la defensa contra una bomba \u2500\u2500\n');

const conTope = leerZip(NORMAL, { ...LIMITES_ZIP, maxTotalBytes: 40 });
check(
  'el total descomprimido corta la lectura',
  conTope.reduce((n, e) => n + e.bytes.length, 0) <= 40,
  `${conTope.reduce((n, e) => n + e.bytes.length, 0)} bytes`,
);
check('un tope de entradas se respeta', leerZip(NORMAL, { ...LIMITES_ZIP, maxEntradas: 2 }).length <= 2);
check(
  'una entrada mas grande que su tope se omite entera',
  leerZip(NORMAL, { ...LIMITES_ZIP, maxEntradaBytes: 10 }).every((e) => e.bytes.length <= 10),
);

console.log('\n\u2500\u2500 Basura \u2500\u2500\n');

check('un archivo que no es ZIP da lista vacia', leerZip(new TextEncoder().encode('hola')).length === 0);
check('vacio tambien', leerZip(new Uint8Array(0)).length === 0);
check(
  'un ZIP truncado no revienta',
  leerZip(NORMAL.subarray(0, Math.floor(NORMAL.length / 2))).length >= 0,
);

console.log(
  fallos === 0
    ? '\n\u2705 Se lee un ZIP ajeno, y una bomba o una ruta con `..` no pasan\n'
    : `\n\u274c ${fallos} comprobacion(es) fallidas\n`,
);
process.exit(fallos === 0 ? 0 : 1);
