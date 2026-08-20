/**
 * Adjuntos del cliente: la foto que entra con el encargo.
 *
 * Hermético: no toca la red ni la cadena. Lo que se prueba es la propiedad por
 * la que existe el mecanismo — que unos bytes que nadie anunció no puedan
 * colarse en el disco del agente, y que los que sí se anunciaron queden
 * cubiertos por el hash de la tarea desde el momento del pago.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { keccak256, toBytes } from 'viem';
import {
  ATTACH_BLOCK,
  FILES_BLOCK,
  appendAttachmentsManifest,
  appendFilesManifest,
  attachmentFrom,
  buildAttachmentsManifest,
  matchAttachment,
  parseAttachmentsManifest,
  parseFilesManifest,
  stripFilesManifest,
  verifyFileBytes,
  type DeliveredFile,
} from '../src/files.js';

const FOTO = new TextEncoder().encode('\x89PNG\r\n\x1a\n no es un png de verdad, pero son bytes');
const ADJUNTO = attachmentFrom('recibo.png', FOTO, 'image/png');
const BRIEF = 'Léeme este recibo y dime cuánto suma.';

test('el manifiesto se construye igual byte a byte', () => {
  // Entra en el brief, y el brief se hashea al contratar: un espacio de más y
  // el agente rechaza el encargo con el pago ya bloqueado.
  assert.equal(buildAttachmentsManifest([ADJUNTO]), buildAttachmentsManifest([ADJUNTO]));
  assert.ok(buildAttachmentsManifest([ADJUNTO]).startsWith(ATTACH_BLOCK));
});

test('lo que se anuncia es lo que se lee', () => {
  const leidos = parseAttachmentsManifest(appendAttachmentsManifest(BRIEF, [ADJUNTO]));
  assert.deepEqual(leidos, [ADJUNTO]);
});

test('sin adjuntos el encargo no se toca', () => {
  assert.equal(appendAttachmentsManifest(BRIEF, []), BRIEF);
});

test('adjuntar cambia el hash del encargo', () => {
  // Es lo que hace que la foto esté cubierta por el escrow: el taskHash se
  // calcula sobre el texto CON el manifiesto dentro.
  const conFoto = appendAttachmentsManifest(BRIEF, [ADJUNTO]);
  assert.notEqual(keccak256(toBytes(conFoto)), keccak256(toBytes(BRIEF)));
});

test('unos bytes que nadie anunció NO se aceptan', () => {
  // La guarda entera del agente está aquí. Sin esto, cualquiera con el número
  // de una tarea le llena el disco de lo que quiera.
  const otros = new TextEncoder().encode('esto no lo pagó nadie');
  assert.equal(matchAttachment([ADJUNTO], otros), null);
});

test('un solo byte distinto tampoco pasa', () => {
  const tocada = new Uint8Array(FOTO);
  tocada[tocada.length - 1] ^= 0x01;
  assert.equal(matchAttachment([ADJUNTO], tocada), null);
});

test('los bytes anunciados se reconocen', () => {
  assert.deepEqual(matchAttachment([ADJUNTO], FOTO), ADJUNTO);
});

test('el mismo archivo dos veces se desempata por nombre', () => {
  const copia = attachmentFrom('copia.png', FOTO, 'image/png');
  assert.equal(matchAttachment([ADJUNTO, copia], FOTO, 'copia.png')!.name, 'copia.png');
  // Sin nombre cualquiera vale: los bytes son los mismos.
  assert.ok(matchAttachment([ADJUNTO, copia], FOTO));
});

test('un nombre con ruta se limpia ANTES de anunciarse', () => {
  // Si se limpiara al recibirlo, el agente no reconocería su propio adjunto:
  // lo anunciado y lo buscado tienen que ser el mismo nombre.
  const trampa = attachmentFrom('../../.env', FOTO);
  assert.equal(trampa.name, 'env');
  assert.deepEqual(parseAttachmentsManifest(appendAttachmentsManifest(BRIEF, [trampa])), [trampa]);
});

test('un bloque roto no se lleva por delante a los demás', () => {
  const roto = `${BRIEF}\n\n${ATTACH_BLOCK}\nname: sin-hash.png\nsize: 10\n\n${buildAttachmentsManifest([ADJUNTO])}`;
  assert.deepEqual(parseAttachmentsManifest(roto), [ADJUNTO]);
});

test('los dos manifiestos conviven sin contaminarse', () => {
  // Una entrega puede citar el adjunto que le mandaron. Los dos bloques van en
  // el mismo texto y cada lector tiene que ver sólo el suyo.
  const entregado: DeliveredFile = {
    name: 'resumen.pdf',
    size: 42,
    hash: keccak256(new TextEncoder().encode('resumen')),
    path: '/files/7/resumen.pdf',
  };
  const texto = appendFilesManifest(appendAttachmentsManifest(BRIEF, [ADJUNTO]), [entregado]);

  assert.deepEqual(parseAttachmentsManifest(texto), [ADJUNTO]);
  assert.deepEqual(parseFilesManifest(texto), [entregado]);
});

test('un adjunto no se cuela como archivo entregable', () => {
  // No dice de dónde bajarlo, porque el cliente no aloja nada. Aceptarlo como
  // entrega sería prometer una descarga que no existe.
  assert.deepEqual(parseFilesManifest(appendAttachmentsManifest(BRIEF, [ADJUNTO])), []);
});

test('el brief que ve una persona no lleva manifiesto', () => {
  const limpio = stripFilesManifest(appendAttachmentsManifest(BRIEF, [ADJUNTO]));
  assert.equal(limpio, BRIEF);
  assert.ok(!limpio.includes(ATTACH_BLOCK));
  assert.ok(!limpio.includes(FILES_BLOCK));
});

test('la verificación de bytes sirve para las dos direcciones', () => {
  verifyFileBytes(ADJUNTO, FOTO);
  assert.throws(() => verifyFileBytes(ADJUNTO, new TextEncoder().encode('otra cosa')));
});
