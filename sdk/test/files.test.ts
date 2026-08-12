/**
 * Entrega de archivos: el manifiesto, el hash y los intentos de colarla.
 *
 * Hermético: no toca la red ni la cadena. Lo que se prueba aquí es que un
 * archivo cambiado después de cobrar no puede pasar por bueno, que es la única
 * razón por la que existe todo este mecanismo.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { keccak256, toBytes } from 'viem';
import {
  FILES_BLOCK,
  FileVerificationError,
  appendFilesManifest,
  buildFilesManifest,
  fileUrl,
  parseFilesManifest,
  sanitizeFileName,
  stripFilesManifest,
  verifyFileBytes,
  type DeliveredFile,
} from '../src/files.js';

const BYTES = new TextEncoder().encode('%PDF-1.7 informe falso pero con bytes de verdad');
const PDF: DeliveredFile = {
  name: 'informe.pdf',
  size: BYTES.byteLength,
  mime: 'application/pdf',
  hash: keccak256(BYTES),
  path: '/files/31/informe.pdf',
};

test('el manifiesto se construye igual byte a byte', () => {
  // Se ancla en la cadena: dos ejecuciones con lo mismo tienen que dar lo mismo.
  assert.equal(buildFilesManifest([PDF]), buildFilesManifest([PDF]));
  assert.ok(buildFilesManifest([PDF]).startsWith(FILES_BLOCK));
});

test('lo que se escribe es lo que se lee', () => {
  const texto = appendFilesManifest('Aquí tienes el informe.', [PDF]);
  const [leido] = parseFilesManifest(texto);
  assert.deepEqual(leido, PDF);
});

test('el texto para la persona no lleva el manifiesto', () => {
  const texto = appendFilesManifest('Aquí tienes el informe.', [PDF]);
  assert.equal(stripFilesManifest(texto), 'Aquí tienes el informe.');
});

test('varios archivos en una entrega', () => {
  const otro: DeliveredFile = { ...PDF, name: 'anexo.csv', mime: 'text/csv', path: '/files/31/anexo.csv' };
  const texto = appendFilesManifest('Dos cosas.', [PDF, otro]);
  const leidos = parseFilesManifest(texto);
  assert.equal(leidos.length, 2);
  assert.deepEqual(leidos.map((f) => f.name), ['informe.pdf', 'anexo.csv']);
});

test('sin archivos, el texto se queda intacto', () => {
  assert.equal(appendFilesManifest('Solo texto.', []), 'Solo texto.');
  assert.deepEqual(parseFilesManifest('Solo texto.'), []);
});

test('unos bytes que cuadran pasan', () => {
  assert.doesNotThrow(() => verifyFileBytes(PDF, BYTES));
});

test('un archivo cambiado después de cobrar NO pasa', () => {
  // El caso entero: el agente entrega, cobra, y luego sustituye el PDF.
  const cambiado = new TextEncoder().encode('%PDF-1.7 informe distinto, servido despues de cobrar');
  assert.throws(
    () => verifyFileBytes({ ...PDF, size: cambiado.byteLength }, cambiado),
    (err: unknown) => err instanceof FileVerificationError && /no es el archivo/.test((err as Error).message),
  );
});

test('un solo byte distinto tampoco pasa', () => {
  const casi = new Uint8Array(BYTES);
  casi[0] = casi[0]! ^ 0x01;
  assert.throws(() => verifyFileBytes(PDF, casi), FileVerificationError);
});

test('el tamaño se comprueba antes que el hash', () => {
  assert.throws(
    () => verifyFileBytes(PDF, BYTES.slice(0, 10)),
    (err: unknown) => err instanceof FileVerificationError && /mide 10 bytes/.test((err as Error).message),
  );
});

test('un nombre con ruta no puede salirse de su carpeta', () => {
  assert.equal(sanitizeFileName('../../.env'), 'env');
  assert.equal(sanitizeFileName('..\\..\\windows\\system32\\config'), 'config');
  assert.equal(sanitizeFileName('/etc/passwd'), 'passwd');
  assert.equal(sanitizeFileName('informe.pdf'), 'informe.pdf');
});

test('un nombre que se queda en nada se rechaza', () => {
  assert.throws(() => sanitizeFileName('../'));
  assert.throws(() => sanitizeFileName('...'));
  assert.throws(() => sanitizeFileName(''));
});

test('un manifiesto roto no se lleva por delante la entrega', () => {
  const texto = [
    'El informe va adjunto.',
    '',
    FILES_BLOCK,
    'name: roto.pdf',
    'size: no-es-un-numero',
    `hash: ${PDF.hash}`,
    'path: /files/31/roto.pdf',
    '',
    FILES_BLOCK,
    'name: bueno.pdf',
    `size: ${PDF.size}`,
    `hash: ${PDF.hash}`,
    'path: /files/31/bueno.pdf',
  ].join('\n');

  const leidos = parseFilesManifest(texto);
  assert.equal(leidos.length, 1, 'el bloque roto se descarta, el bueno se queda');
  assert.equal(leidos[0]!.name, 'bueno.pdf');
});

test('un bloque sin hash válido se descarta', () => {
  for (const hash of ['0x1234', 'no-es-hex', `${PDF.hash}ff`]) {
    const texto = [FILES_BLOCK, 'name: x.pdf', 'size: 10', `hash: ${hash}`, 'path: /f/x.pdf'].join('\n');
    assert.deepEqual(parseFilesManifest(texto), [], `deberia rechazar hash="${hash}"`);
  }
});

test('un bloque sin sitio de donde bajarlo se descarta', () => {
  const texto = [FILES_BLOCK, 'name: x.pdf', 'size: 10', `hash: ${PDF.hash}`].join('\n');
  assert.deepEqual(parseFilesManifest(texto), []);
});

test('la ruta se resuelve contra el endpoint REGISTRADO del agente', () => {
  assert.equal(fileUrl(PDF, 'https://lint.panal.lat'), 'https://lint.panal.lat/files/31/informe.pdf');
  // Con o sin barra final, el mismo resultado: es un error fácil de cometer.
  assert.equal(fileUrl(PDF, 'https://lint.panal.lat/'), 'https://lint.panal.lat/files/31/informe.pdf');
});

test('sin endpoint registrado, una ruta relativa no se resuelve a ciegas', () => {
  assert.throws(() => fileUrl(PDF, undefined), /no publica endpoint/);
});

test('una url absoluta manda sobre la ruta', () => {
  const externo: DeliveredFile = { ...PDF, url: 'https://cdn.ejemplo.com/a.pdf' };
  assert.equal(fileUrl(externo, 'https://lint.panal.lat'), 'https://cdn.ejemplo.com/a.pdf');
});

test('el hash del texto entero cambia si cambia el manifiesto', () => {
  // Por esto sirve de algo: el resultHash anclado cubre el manifiesto, así que
  // tocar el hash de un archivo rompe la entrega frente a la cadena.
  const bueno = appendFilesManifest('Informe.', [PDF]);
  const trucado = bueno.replace(PDF.hash, keccak256(toBytes('otra cosa')));
  assert.notEqual(keccak256(toBytes(bueno)), keccak256(toBytes(trucado)));
});
