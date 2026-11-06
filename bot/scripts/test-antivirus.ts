/**
 * Test LOCAL del antivirus del buzón (bot/src/antivirus.ts) — sin ClamAV de
 * verdad y sin red.
 *
 * Un clamd de mentira habla el mismo protocolo (INSTREAM y PING) por un socket
 * Unix, y «encuentra» malware cuando los bytes llevan la marca del archivo de
 * prueba EICAR. Solo la marca, no el archivo entero: con el de verdad en el
 * repo, el antivirus de quien lo clone saltaría con el código.
 *
 * Lo que tiene que quedar demostrado:
 *   - el cliente habla INSTREAM bien (también por trozos) y entiende OK, FOUND
 *     y lo demás;
 *   - el buzón NO GUARDA lo que el antivirus encuentra, y contesta 422 con la
 *     firma;
 *   - lo limpio se guarda, y lo cifrado ni se le pregunta (no lo puede ver);
 *   - si ClamAV no contesta, el archivo se guarda igual: un antivirus caído no
 *     tumba los encargos de nadie.
 *
 * Uso:  npx tsx scripts/test-antivirus.ts   (exit 0 si todo pasa)
 */

import { createServer as crearServidorRed, type Server as ServidorRed } from 'node:net';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getAddress, keccak256, toBytes, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { antivirusDeClamd, comprobarClamd, interpretar, type Antivirus } from '../src/antivirus.js';
import { briefSignMessage, createBuzonServer } from '../src/buzon.js';
import { BuzonStore } from '../src/buzon-store.js';
import { NATIVE_CURRENCY, TaskStatus, type Task } from '../src/chain.js';

const MARCA = 'EICAR-STANDARD-ANTIVIRUS-TEST-FILE';
const cliente = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');
const persona = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d');
const AGENTE = persona.address;

let fallos = 0;
const check = (nombre: string, ok: boolean, detalle = '') => {
  console.log(`${ok ? '✅' : '❌'} ${nombre}${detalle ? ` — ${detalle}` : ''}`);
  if (!ok) fallos++;
};

/** Un clamd de mentira. `mudo` no contesta nunca, para probar el plazo. */
function clamdDeMentira(ruta: string, mudo = false): { servidor: ServidorRed; preguntas: () => number } {
  let preguntas = 0;
  const servidor = crearServidorRed((s) => {
    let datos = Buffer.alloc(0);
    s.on('data', (d: Buffer) => {
      datos = Buffer.concat([datos, d]);
      if (mudo) return;
      if (datos.toString('latin1').startsWith('zPING\0')) {
        s.end('PONG\0');
        return;
      }
      if (!datos.toString('latin1').startsWith('zINSTREAM\0')) return;
      // Trozos con su longitud delante, hasta uno de longitud cero.
      let p = 'zINSTREAM\0'.length;
      const cuerpo: Buffer[] = [];
      for (;;) {
        if (p + 4 > datos.length) return;
        const largo = datos.readUInt32BE(p);
        if (largo === 0) break;
        if (p + 4 + largo > datos.length) return;
        cuerpo.push(datos.subarray(p + 4, p + 4 + largo));
        p += 4 + largo;
      }
      preguntas++;
      s.end(Buffer.concat(cuerpo).toString('latin1').includes(MARCA) ? 'stream: Eicar-Test-Signature FOUND\0' : 'stream: OK\0');
    });
  });
  servidor.listen(ruta);
  return { servidor, preguntas: () => preguntas };
}

async function main() {
  const dir = mkdtempSync(join(tmpdir(), 'panal-antivirus-test-'));
  const sock = join(dir, 'clamd.sock');
  const clamd = clamdDeMentira(sock);
  const sockMudo = join(dir, 'mudo.sock');
  const mudo = clamdDeMentira(sockMudo, true);
  await new Promise((r) => setTimeout(r, 100));

  console.log('\nlo que contesta clamd');
  check('«stream: OK» es limpio', interpretar('stream: OK\0').estado === 'limpio');
  const f = interpretar('stream: Win.Trojan.Agent-123 FOUND\0');
  check('«… FOUND» es infectado, con su firma', f.estado === 'infectado' && f.firma === 'Win.Trojan.Agent-123');
  check('un error no es limpio', interpretar('INSTREAM size limit exceeded. ERROR\0').estado === 'sin-revisar');
  check('nada, tampoco', interpretar('').estado === 'sin-revisar');

  console.log('\nel cliente de clamd');
  const av = antivirusDeClamd(`unix:${sock}`);
  check('lo limpio sale limpio', (await av.revisar(new TextEncoder().encode('un informe cualquiera'))).estado === 'limpio');
  const r = await av.revisar(new TextEncoder().encode(`algo ${MARCA} algo`));
  check('lo que lleva la marca, infectado', r.estado === 'infectado' && r.firma === 'Eicar-Test-Signature');
  const grande = new Uint8Array(300 * 1024).fill(65);
  grande.set(new TextEncoder().encode(MARCA), 250 * 1024);
  check('por trozos también: la marca en el quinto trozo se encuentra', (await av.revisar(grande)).estado === 'infectado');
  const caido = await antivirusDeClamd(`unix:${join(dir, 'no-existe.sock')}`).revisar(new Uint8Array([1]));
  check('sin clamd, «sin revisar»', caido.estado === 'sin-revisar');
  const t0 = Date.now();
  const callado = await antivirusDeClamd(`unix:${sockMudo}`, 300).revisar(new Uint8Array([1]));
  check('si no contesta, se rinde en su plazo', callado.estado === 'sin-revisar' && Date.now() - t0 < 2000, `${Date.now() - t0} ms`);
  check('PING cuando está', await comprobarClamd(`unix:${sock}`));
  check('y cuando no', !(await comprobarClamd(`unix:${join(dir, 'no-existe.sock')}`)));

  console.log('\nel buzón con el antivirus delante');
  const tarea: Task = {
    client: cliente.address,
    worker: AGENTE,
    amount: 10n ** 18n,
    taskHash: keccak256(toBytes('el encargo')),
    resultHash: ('0x' + '00'.repeat(32)) as Hex,
    deadline: 1_900_000_000n,
    createdAt: 1_899_000_000n,
    status: TaskStatus.Open,
    currency: NATIVE_CURRENCY,
  };
  const montar = (antivirus: Antivirus) =>
    createBuzonServer({
      store: new BuzonStore(mkdtempSync(join(dir, 'store-'))),
      fetchTask: async () => tarea,
      fetchAgent: async () => ({ owner: persona.address, metadataURI: 'Marta', pricePerTask: 1n, active: true }) as never,
      contratos: {
        escrow: getAddress('0xe138A9A492CFe27A13f8b7A6D312DA831791bCe9'),
        registry: getAddress('0x89a812BFb1c35fc814ef25a3E6Ca75068B16Ac51'),
        token: getAddress('0x2e2e44e7fa6178822d4397299f719e89d1a67777'),
      },
      simboloDe: () => 'MON',
      indexer: 'https://api.panal.lat',
      allowLocalhostOrigin: true,
      antivirus,
    });
  const arrancar = async (antivirus: Antivirus) => {
    const s = montar(antivirus);
    await new Promise<void>((resolve) => s.listen(0, '127.0.0.1', resolve));
    const a = s.address();
    if (!a || typeof a === 'string') throw new Error('sin puerto');
    return { s, base: `http://127.0.0.1:${a.port}/buzon/${AGENTE}` };
  };
  const subir = async (base: string, nombre: string, bytes: Uint8Array) =>
    fetch(`${base}/upload/1`, {
      method: 'POST',
      headers: {
        'content-type': 'application/octet-stream',
        'x-panal-address': cliente.address,
        'x-panal-filename': encodeURIComponent(nombre),
        'x-panal-signature': await cliente.signMessage({ message: briefSignMessage(1n) }),
      },
      body: bytes as unknown as BodyInit,
    });

  const { s, base } = await arrancar(av);
  const antes = clamd.preguntas();
  const malo = await subir(base, 'factura.pdf', new TextEncoder().encode(`%PDF-1.4 ${MARCA}`));
  const cuerpo = (await malo.json()) as { error?: string; firma?: string };
  check('el malware no se guarda: 422 con la firma', malo.status === 422 && cuerpo.firma === 'Eicar-Test-Signature', `${malo.status} ${JSON.stringify(cuerpo)}`);
  const bueno = await subir(base, 'notas.txt', new TextEncoder().encode('notas de la reunión'));
  check('lo limpio se guarda', bueno.status === 200, String(bueno.status));
  const cifrado = new TextEncoder().encode(`panal-cifrado-1\n{"v":1}${MARCA}`);
  const preguntasAntes = clamd.preguntas();
  const sobre = await subir(base, 'secreto.bin', cifrado);
  check('lo cifrado ni se le pregunta: no lo puede ver', sobre.status === 200 && clamd.preguntas() === preguntasAntes, String(sobre.status));
  check('se le preguntó por los otros dos', clamd.preguntas() - antes === 2, String(clamd.preguntas() - antes));
  s.close();

  const sinClamd = await arrancar(antivirusDeClamd(`unix:${join(dir, 'no-existe.sock')}`));
  const igual = await subir(sinClamd.base, 'informe.pdf', new TextEncoder().encode(`%PDF ${MARCA}`));
  check('si ClamAV no contesta, se guarda igual: no tumba los encargos', igual.status === 200, String(igual.status));
  sinClamd.s.close();

  clamd.servidor.close();
  mudo.servidor.close();
  console.log(fallos === 0 ? '\n✅ El antivirus del buzón rechaza lo conocido y no tumba nada\n' : `\n❌ ${fallos} comprobación(es) fallidas\n`);
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('❌ Error en el test:', err);
  process.exit(1);
});
