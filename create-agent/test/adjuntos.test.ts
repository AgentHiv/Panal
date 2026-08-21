/**
 * Abrir lo que manda un cliente.
 *
 *     npx tsx test/adjuntos.test.ts     (o: npm test)
 *
 * Los archivos de abajo son de verdad. El .docx y el .zip los escribio la
 * `zipfile` de Python y el PNG es el icono de la app, asi que ninguno de los
 * tres lo genero este codigo: un lector probado contra lo que escribe su
 * propio autor comparte con el cualquier malentendido sobre el formato.
 *
 * EL PDF ES LA EXCEPCION Y CONVIENE DECIRLO: lo genero un agente de Panal,
 * porque en esta maquina no habia ninguno hecho por Word ni por Chrome. La
 * extraccion se apoya en pdf.js, que es lo que resuelve las codificaciones de
 * fuente donde se atraganta un extractor casero, pero eso NO queda comprobado
 * aqui. Hace falta un PDF ajeno para cerrar ese hueco.
 */

import { comoTexto, leerAdjuntos, textoDeDocx, tipoDe } from '../template/src/adjuntos.js';

let fallos = 0;
const check = (nombre: string, ok: boolean, detalle = ''): void => {
  console.log(`${ok ? '✅' : '❌'} ${nombre}${ok ? '' : ` — ${detalle}`}`);
  if (!ok) fallos++;
};

const deB64 = (s: string): Uint8Array => Uint8Array.from(Buffer.from(s, 'base64'));
const bytes = (s: string): Uint8Array => new TextEncoder().encode(s);

const PNG = deB64(
  'iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAABaUlEQVR42mMQEpD8P5Qxw6gHRj0w6oFRD4x6YNQDI9YDMVEp' +
  '/z+9/0URBpkxIB7Q0jD6f/PaQ4o9ADIDZBbdPdDXPQ3sABA9kGYwkBv6sBCkJPSoYQ5ZHjiw9wTY0tLiWoozIcgMkFkgM+ni' +
  'AWdHb3japVZJAstLILNp7gFKLKNFoDDQM7ppkSwZ6J1xqW0+Az2LPFrYwUBqGiU2dDZXa/5/NEsPA7fGqBBVORKbxxhokT7z' +
  'fJWwOh6GNeWlqZbPGIht7xBbQoAcd6pLG68H5uSoE1XSEdNOYqB2sQlKIvgcD8MOerJUKVap6gFQ6BPjeBAGxRJdPEBqEiKU' +
  'fIjJzFRNQqRm4nA7BaI8gCsjUz0Tk1OM4ipCYRhUStG1GCW1kgFlUHLSPs0qMnKqelAog4pLdAxKYgPSlBjyjblh0ZweFh2a' +
  'Id+lHBad+iE/rDIsBraG/NDi6Oj0qAdGPTDqgVEPjHpg1ANUwABavkjfU0JsNQAAAABJRU5ErkJggg==',
);
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
const ZIP = deB64(
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
const PDF = deB64(
  'JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5' +
  'cGUgL1BhZ2VzIC9LaWRzIFs0IDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL0ZvbnQgL1N1YnR5' +
  'cGUgL1R5cGUxIC9CYXNlRm9udCAvQ291cmllciAvRW5jb2RpbmcgL1dpbkFuc2lFbmNvZGluZyA+PgplbmRvYmoKNCAwIG9i' +
  'ago8PCAvVHlwZSAvUGFnZSAvUGFyZW50IDIgMCBSIC9NZWRpYUJveCBbMCAwIDU5NSA4NDJdIC9SZXNvdXJjZXMgPDwgL0Zv' +
  'bnQgPDwgL0YxIDMgMCBSID4+ID4+IC9Db250ZW50cyA1IDAgUiA+PgplbmRvYmoKNSAwIG9iago8PCAvTGVuZ3RoIDc1MCA+' +
  'PgpzdHJlYW0KQlQKL0YxIDkuNSBUZgoxMi41IFRMCjUwIDc5MiBUZAooUGFuYWwgtyBpbmZvcm1lIGVzdHJ1Y3R1cmFkbyAj' +
  'MzIpIFRqIFQqCigpIFRqIFQqCih7KSBUaiBUKgooICAicHVlcnRvcyI6IFspIFRqIFQqCiggICAgeykgVGogVCoKKCAgICAg' +
  'ICJhZ2VudGUiOiAibGludCIsKSBUaiBUKgooICAgICAgInB1ZXJ0byI6IDg3ODksKSBUaiBUKgooICAgICAgImNvc3RvIjog' +
  'IjAuMDMgTU9OIikgVGogVCoKKCAgICB9LCkgVGogVCoKKCAgICB7KSBUaiBUKgooICAgICAgImFnZW50ZSI6ICJwYXJzZSIs' +
  'KSBUaiBUKgooICAgICAgInB1ZXJ0byI6IDg3OTAsKSBUaiBUKgooICAgICAgImNvc3RvIjogIjAuMDEgTU9OIikgVGogVCoK' +
  'KCAgICB9LCkgVGogVCoKKCAgICB7KSBUaiBUKgooICAgICAgImFnZW50ZSI6ICJzcGVjIiwpIFRqIFQqCiggICAgICAicHVl' +
  'cnRvIjogODc5MSwpIFRqIFQqCiggICAgICAiY29zdG8iOiAiMTAwIFBBTkFMIikgVGogVCoKKCAgICB9KSBUaiBUKgooICBd' +
  'LCkgVGogVCoKKCAgIl9ub3RhcyI6ICJFbCB1c3VhcmlvIHRhbWJp6W4gcGlkafMgdW4gaW5mb3JtZSBlbiBQREYsIHBlcm8g' +
  'bm8gc2UgcHJvcG9yY2lvbvMgbeFzIGluKSBUaiBUKgooICBmb3JtYWNp824gc29icmUgc3UgZXN0cnVjdHVyYSBvIGNvbnRl' +
  'bmlkbywgcG9yIGxvIHF1ZSBubyBwdWVkbyBnZW5lcmFybG8uIFNlIGRldnVlbHYpIFRqIFQqCiggIGUgc29sbyBsYSBlc3Ry' +
  'dWN0dXJhIHNvbGljaXRhZGEuIikgVGogVCoKKH0pIFRqIFQqCkVUCmVuZHN0cmVhbQplbmRvYmoKeHJlZgowIDYKMDAwMDAw' +
  'MDAwMCA2NTUzNSBmIAowMDAwMDAwMDA5IDAwMDAwIG4gCjAwMDAwMDAwNTggMDAwMDAgbiAKMDAwMDAwMDExNSAwMDAwMCBu' +
  'IAowMDAwMDAwMjEwIDAwMDAwIG4gCjAwMDAwMDAzMzYgMDAwMDAgbiAKdHJhaWxlcgo8PCAvU2l6ZSA2IC9Sb290IDEgMCBS' +
  'ID4+CnN0YXJ0eHJlZgoxMTM3CiUlRU9GCg==',
);

console.log('\n── Reconocer por los BYTES, no por el nombre ──\n');

check('un PNG es un PNG', tipoDe(PNG) === 'png');
check('un PDF es un PDF', tipoDe(PDF) === 'pdf', tipoDe(PDF));
check('un .docx se ve como ZIP', tipoDe(DOCX) === 'zip');
check('el texto suelto no es nada de eso', tipoDe(bytes('hola mundo')) === 'otro');

console.log('\n── Imagenes: se ENSEnAN, no se describen ──\n');

const conImagen = await leerAdjuntos([{ name: 'logo.png', mime: 'image/png', bytes: PNG }]);
check('la imagen sale aparte, para el modelo', conImagen.imagenes.length === 1);
check('con su mime correcto', conImagen.imagenes[0]?.mime === 'image/png');
check('y en el texto se avisa de que va adjunta', conImagen.texto.includes('logo.png'));

console.log('\n── Word ──\n');

const docx = textoDeDocx(DOCX);
check('se saca el texto de un .docx', !!docx && docx.includes('Contrato de servicios'), String(docx));
check('y las cifras que trae', !!docx && docx.includes('500'));
check('una frase partida por Word no se rompe', !!docx && docx.includes('contratante'), String(docx));
check('los parrafos siguen siendo parrafos', !!docx && docx.split('\n').filter(Boolean).length >= 3);

console.log('\n── Carpetas ──\n');

const zip = await leerAdjuntos([{ name: 'proyecto.zip', bytes: ZIP }]);
check('se leen los archivos de texto de dentro', zip.texto.includes('8789'), zip.texto.slice(0, 120));
check('con su ruta, para saber cual es cual', zip.texto.includes('src/util/fecha.ts'));
check('el binario de dentro se NOMBRA en vez de colarse', zip.texto.includes('logo.bin'));

console.log('\n── PDF ──\n');

const pdf = await leerAdjuntos([{ name: 'informe.pdf', bytes: PDF }]);
check('se extrae el texto de un PDF', pdf.texto.includes('lint'), pdf.texto.slice(0, 140));
check('y no queda como ilegible', !pdf.texto.includes('no se pudo sacar texto'));

console.log('\n── Lo que NO se puede abrir se dice ──\n');

const raro = await leerAdjuntos([{ name: 'algo.bin', mime: 'application/x-cosa', bytes: new Uint8Array([0, 1, 2, 3, 200, 201]) }]);
check('un binario cualquiera no se ignora', raro.texto.includes('algo.bin'));
check('se dice que no se pudo abrir', raro.texto.includes('no puede abrirlo'), raro.texto);
check('y se pide que lo diga en la respuesta', raro.texto.includes('en vez de ignorarlo'));

const pdfRoto = await leerAdjuntos([{ name: 'roto.pdf', bytes: bytes('%PDF-1.4 y aqui basura') }]);
check('un PDF ilegible se declara ilegible', pdfRoto.texto.includes('no se pudo sacar texto'), pdfRoto.texto);

console.log('\n── Texto normal, que es el caso de siempre ──\n');

const txt = await leerAdjuntos([{ name: 'notas.md', bytes: bytes('# Notas\n\nnada raro') }]);
check('se lee tal cual', txt.texto.includes('nada raro'));
check('un binario que decodifica como UTF-8 se rechaza igual', comoTexto(new Uint8Array([0x01, 0x02])) === null);
check('sin adjuntos, texto vacio', (await leerAdjuntos([])).texto === '');

console.log('\n── El coste, que lo paga el agente ──\n');

const gordo = await leerAdjuntos([
  { name: 'a.txt', bytes: bytes('a'.repeat(50_000)) },
  { name: 'b.txt', bytes: bytes('b'.repeat(50_000)) },
  { name: 'c.txt', bytes: bytes('c'.repeat(50_000)) },
]);
check('el total se acota', gordo.texto.length < 30_000, `${gordo.texto.length} caracteres`);
check('y se avisa de que se recorto', gordo.texto.includes('recortado'));

console.log(
  fallos === 0
    ? '\n✅ Imagenes, Word, PDF y carpetas entran; y lo que no se puede abrir se dice\n'
    : `\n❌ ${fallos} comprobacion(es) fallidas\n`,
);
process.exit(fallos === 0 ? 0 : 1);
