/**
 * Archivos en una pregunta x402: subir, bajar, comprobar y no pagar a ciegas.
 *
 * Hermético: un buzón de mentira en localhost que comprueba las firmas igual
 * que el de verdad, y ninguna llamada a la red ni a la cadena.
 */

import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import test from 'node:test';
import { createWalletClient, http, keccak256, verifyMessage } from 'viem';
import type { Address, Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  CONSULTA_FILES_CAPABILITY,
  consultaReadMessage,
  consultaUploadMessage,
  downloadConsultaFile,
  parseConsultaFiles,
  uploadConsultaFile,
} from '../src/consultas.js';
import { FileVerificationError } from '../src/files.js';
import { X402Error, payAndAsk, type X402Accept } from '../src/x402.js';

const A = privateKeyToAccount(`0x${'11'.repeat(32)}`);
const B = privateKeyToAccount(`0x${'22'.repeat(32)}`);
const C = privateKeyToAccount(`0x${'33'.repeat(32)}`);
const firmaDe = (cuenta: typeof A) => (message: string) => cuenta.signMessage({ message });

/** Un buzón mínimo con las mismas reglas que el de verdad. */
function buzonFalso(): Promise<{ url: string; server: Server; trampa: { cambiar: boolean } }> {
  const guardados = new Map<string, { de: Address; bytes: Buffer }>();
  const trampa = { cambiar: false };
  const server = createServer(async (req, res) => {
    const partes = (req.url ?? '').split('/').filter(Boolean); // buzon, para, consulta-archivo, [hash]
    const para = partes[1] as Address;
    const address = req.headers['x-panal-address'] as Address;
    const signature = req.headers['x-panal-signature'] as Hex;
    const expira = Number(req.headers['x-panal-expira']);
    if (req.method === 'POST') {
      const trozos: Buffer[] = [];
      for await (const t of req) trozos.push(t as Buffer);
      const bytes = Buffer.concat(trozos);
      const hash = keccak256(bytes);
      const ok = await verifyMessage({ address, message: consultaUploadMessage(para, hash, expira), signature });
      if (!ok) return void res.writeHead(403).end('{"error":"bad signature"}');
      guardados.set(`${para.toLowerCase()}/${hash}`, { de: address, bytes });
      return void res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, hash }));
    }
    const hash = partes[3] as Hex;
    const g = guardados.get(`${para.toLowerCase()}/${hash}`);
    if (!g) return void res.writeHead(404).end();
    const firmaOk = await verifyMessage({ address, message: consultaReadMessage(hash, expira), signature });
    const suyo = [para.toLowerCase(), g.de.toLowerCase()].includes(address.toLowerCase());
    if (!firmaOk || !suyo) return void res.writeHead(403).end('{"error":"not yours"}');
    const salida = Buffer.from(g.bytes);
    if (trampa.cambiar) salida[0] = salida[0]! ^ 0xff;
    res.writeHead(200, { 'content-type': 'application/octet-stream' }).end(salida);
  });
  return new Promise((ok) =>
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      ok({ url: `http://127.0.0.1:${port}/buzon`, server, trampa });
    }),
  );
}

test('los mensajes llevan el destinatario, el hash y la caducidad', () => {
  const h = keccak256(new Uint8Array([1]));
  assert.match(consultaUploadMessage(B.address, h, 99), new RegExp(B.address));
  assert.match(consultaUploadMessage(B.address, h, 99), /expira: 99/);
  assert.equal(consultaReadMessage(h.toUpperCase().replace('0X', '0x') as Hex, 5), consultaReadMessage(h, 5));
});

test('la lista que manda otro agente se valida entera', () => {
  const bien = { name: 'foto.jpg', size: 10, hash: keccak256(new Uint8Array([1])), mime: 'image/jpeg' };
  assert.deepEqual(parseConsultaFiles(undefined), []);
  assert.equal(parseConsultaFiles([bien])!.length, 1);
  assert.equal(parseConsultaFiles([{ ...bien, name: '../../etc/passwd' }])![0]!.name, 'passwd');
  assert.equal(parseConsultaFiles('nada'), null);
  assert.equal(parseConsultaFiles([{ ...bien, hash: '0x12' }]), null);
  assert.equal(parseConsultaFiles([{ ...bien, size: 0 }]), null);
  assert.equal(parseConsultaFiles([{ ...bien, size: 26 * 1024 * 1024 }]), null);
  assert.equal(parseConsultaFiles(Array(6).fill(bien)), null);
});

test('subir y bajar: el destinatario y quien lo dejó lo leen; un tercero no', async () => {
  const { url, server } = await buzonFalso();
  try {
    const bytes = new TextEncoder().encode('%PDF-1.7 un contrato que revisar');
    const anunciado = await uploadConsultaFile({
      buzonUrl: url,
      para: B.address,
      de: A.address,
      file: { name: 'contrato.pdf', bytes, mime: 'application/pdf' },
      sign: firmaDe(A),
    });
    assert.equal(anunciado.hash, keccak256(bytes));
    assert.equal(anunciado.size, bytes.byteLength);

    const leidoPorB = await downloadConsultaFile({ buzonUrl: url, para: B.address, lector: B.address, file: anunciado, sign: firmaDe(B) });
    assert.deepEqual(leidoPorB, bytes);
    const leidoPorA = await downloadConsultaFile({ buzonUrl: url, para: B.address, lector: A.address, file: anunciado, sign: firmaDe(A) });
    assert.deepEqual(leidoPorA, bytes);
    await assert.rejects(
      downloadConsultaFile({ buzonUrl: url, para: B.address, lector: C.address, file: anunciado, sign: firmaDe(C) }),
      /403/,
    );
  } finally {
    server.close();
  }
});

test('un byte cambiado por el camino no pasa', async () => {
  const { url, server, trampa } = await buzonFalso();
  try {
    const bytes = new Uint8Array([7, 7, 7, 7]);
    const anunciado = await uploadConsultaFile({ buzonUrl: url, para: B.address, de: A.address, file: { name: 'a.bin', bytes }, sign: firmaDe(A) });
    trampa.cambiar = true;
    await assert.rejects(
      downloadConsultaFile({ buzonUrl: url, para: B.address, lector: B.address, file: anunciado, sign: firmaDe(B) }),
      FileVerificationError,
    );
  } finally {
    server.close();
  }
});

test('payAndAsk no firma si el agente no dice que acepta archivos', async () => {
  const wallet = createWalletClient({ account: A, transport: http('http://127.0.0.1:1') });
  const quote: X402Accept = {
    scheme: 'eip2612-permit',
    chainId: 143,
    asset: '0x2E2e44E7FA6178822D4397299F719e89d1a67777',
    amount: '1',
    payTo: B.address,
    deadline: Math.floor(Date.now() / 1000) + 60,
  };
  const archivo = { name: 'foto.jpg', size: 3, hash: keccak256(new Uint8Array([1, 2, 3])) };
  const opciones = { maxSpend: 10n, chainId: 143, quote, files: [archivo], allowInsecure: true };
  await assert.rejects(payAndAsk(wallet, A, 'http://127.0.0.1:1/x402/ask', 'mira esto', opciones), (e: unknown) => {
    assert.ok(e instanceof X402Error);
    assert.match((e as Error).message, /no acepta archivos/);
    return true;
  });
  // Y con la capacidad pero más archivos de los que acepta, tampoco.
  const conTope = { ...opciones, quote: { ...quote, files: { ...CONSULTA_FILES_CAPABILITY, max: 0 } } };
  await assert.rejects(payAndAsk(wallet, A, 'http://127.0.0.1:1/x402/ask', 'mira esto', conTope), /acepta 0 archivo/);
});
