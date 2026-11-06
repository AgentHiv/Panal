/**
 * Test LOCAL de las pruebas de una disputa en el buzón — sin RPC y sin red.
 *
 * El expediente que la cadena no guarda: el motivo, lo que aporta cada parte y
 * su respuesta. Lo que tiene que quedar demostrado:
 *   - aportan las dos partes y nadie más; leen las dos partes y los jueces, y
 *     los jueces solo mientras dure la disputa;
 *   - cada pieza lleva la firma de su autor sobre SU contenido y SU fecha: otra
 *     firma, un texto cambiado o una fecha vieja no entran, y un juez puede
 *     volver a comprobarla sin fiarse del buzón;
 *   - solo con la tarea en disputa y dentro de los siete días desde que se
 *     abrió;
 *   - los archivos se suben antes y la pieza solo nombra los que están.
 *
 * Aparte de los demás tests del buzón porque el buzón limita las peticiones
 * por IP.
 *
 * Uso:  npx tsx scripts/test-pruebas.ts   (exit 0 si todo pasa)
 */

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getAddress, keccak256, toBytes, verifyMessage, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { contenidoDePieza, createBuzonServer, piezaSignMessage, pruebasSignMessage } from '../src/buzon.js';
import { BuzonStore } from '../src/buzon-store.js';
import { NATIVE_CURRENCY, TaskStatus, type Task } from '../src/chain.js';

/** Una pieza como la sirve el buzón (`PiezaDeDisputa` en el SDK). */
interface Pieza {
  de: 'cliente' | 'trabajador';
  autor: Address;
  texto: string;
  archivos: { hash: string; size: number }[];
  fecha: string;
  firma: Hex;
}

/**
 * Lo que hará un juez: rehacer el contenido y comprobar la firma, sin fiarse
 * del buzón. Con las funciones del buzón y no las del SDK porque este test
 * corre con las dependencias del bot solas; que las dos copias coinciden lo
 * comprueba `scripts/test-pruebas-formato.ts` en la raíz.
 */
async function verificarPieza(taskId: bigint, p: Pieza): Promise<boolean> {
  try {
    return await verifyMessage({ address: p.autor, message: piezaSignMessage(taskId, contenidoDePieza(p.texto, p.archivos), p.fecha), signature: p.firma });
  } catch {
    return false;
  }
}

const cliente = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');
const persona = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d');
const juez = privateKeyToAccount('0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6');
const intruso = privateKeyToAccount('0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a');
const AGENTE = persona.address;
const ahora = BigInt(Math.floor(Date.now() / 1000));

function tarea(status: TaskStatus): Task {
  return {
    client: cliente.address,
    worker: AGENTE,
    amount: 10n ** 18n,
    taskHash: keccak256(toBytes('el encargo')),
    resultHash: keccak256(toBytes('la entrega')),
    deadline: 1_900_000_000n,
    createdAt: 1_899_000_000n,
    status,
    currency: NATIVE_CURRENCY,
  };
}
/** #1 en disputa desde ayer; #2 en disputa desde hace ocho días; #3 entregada. */
const TAREAS: Record<string, Task> = { '1': tarea(TaskStatus.Disputed), '2': tarea(TaskStatus.Disputed), '3': tarea(TaskStatus.Delivered) };
const ABIERTA: Record<string, bigint> = { '1': ahora - 86_400n, '2': ahora - 8n * 86_400n, '3': 0n };

let fallos = 0;
const check = (nombre: string, ok: boolean, detalle = '') => {
  console.log(`${ok ? '✅' : '❌'} ${nombre}${detalle ? ` — ${detalle}` : ''}`);
  if (!ok) fallos++;
};

async function main() {
  const server = createBuzonServer({
    store: new BuzonStore(mkdtempSync(join(tmpdir(), 'panal-pruebas-test-'))),
    fetchTask: async (taskId) => {
      const t = TAREAS[taskId.toString()];
      if (!t) throw new Error('no existe');
      return t;
    },
    fetchDisputedAt: async (taskId) => ABIERTA[taskId.toString()] ?? 0n,
    fetchArbitros: async () => [juez.address],
    fetchAgent: async () => ({ owner: persona.address, metadataURI: 'Marta', pricePerTask: 1n, active: true }) as never,
    contratos: {
      escrow: getAddress('0xe138A9A492CFe27A13f8b7A6D312DA831791bCe9'),
      registry: getAddress('0x89a812BFb1c35fc814ef25a3E6Ca75068B16Ac51'),
      token: getAddress('0x2e2e44e7fa6178822d4397299f719e89d1a67777'),
    },
    simboloDe: () => 'MON',
    indexer: 'https://api.panal.lat',
    allowLocalhostOrigin: true,
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const dir = server.address();
  if (!dir || typeof dir === 'string') throw new Error('sin puerto');
  const base = `http://127.0.0.1:${dir.port}/buzon/${AGENTE}`;

  const cred = async (quien: typeof cliente, id: bigint) => {
    const expira = Math.floor(Date.now() / 1000) + 300;
    return { address: quien.address, signature: await quien.signMessage({ message: pruebasSignMessage(id, expira) }), expira };
  };
  const cabeceras = (c: { address: string; signature: string; expira: number }) => ({
    'x-panal-address': c.address,
    'x-panal-signature': c.signature,
    'x-panal-expira': String(c.expira),
  });
  const leer = async (quien: typeof cliente, id: bigint) => fetch(`${base}/pruebas/${id}`, { headers: cabeceras(await cred(quien, id)) });

  /** Una pieza firmada como lo hará la web; `cambiar` estropea algo a propósito. */
  const aportar = async (
    quien: typeof cliente,
    id: bigint,
    texto: string,
    o: { archivos?: { hash: string; size: number }[]; firmante?: typeof cliente; fecha?: string; textoEnviado?: string } = {},
  ) => {
    const archivos = o.archivos ?? [];
    const fecha = o.fecha ?? new Date().toISOString();
    const firma = await (o.firmante ?? quien).signMessage({ message: piezaSignMessage(id, contenidoDePieza(texto, archivos), fecha) });
    return fetch(`${base}/pruebas/${id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ address: quien.address, texto: o.textoEnviado ?? texto, archivos: archivos.map((a) => ({ hash: a.hash })), fecha, firma }),
    });
  };

  console.log('\n─── quién lee ───');
  const vacio = await leer(cliente, 1n);
  const ev = (await vacio.json()) as { piezas: unknown[]; abierto: boolean; plazo: number };
  check('el cliente abre el expediente, vacío y abierto', vacio.status === 200 && ev.piezas.length === 0 && ev.abierto);
  check('el plazo son siete días desde que se abrió la disputa', ev.plazo === Number(ABIERTA['1']! + 7n * 86_400n), String(ev.plazo));
  check('quien trabaja también lo lee', (await leer(persona, 1n)).status === 200);
  check('un juez lo lee mientras dura la disputa', (await leer(juez, 1n)).status === 200);
  check('pero no el de una tarea que no está en disputa', (await leer(juez, 3n)).status === 403);
  check('un tercero no lo lee', (await leer(intruso, 1n)).status === 403);
  const caducada = { address: cliente.address, signature: await cliente.signMessage({ message: pruebasSignMessage(1n, 1) }), expira: 1 };
  check('ni con una firma caducada', (await fetch(`${base}/pruebas/1`, { headers: cabeceras(caducada) })).status === 403);
  check('ni con la firma de otra tarea', (await fetch(`${base}/pruebas/1`, { headers: cabeceras(await cred(cliente, 2n)) })).status === 403);

  console.log('\n─── quién aporta, y con qué firma ───');
  const motivo = 'La entrega no es lo que pedí: el contrato está en inglés y lo pedí en francés.';
  const r1 = await aportar(cliente, 1n, motivo);
  check('el cliente escribe el motivo', r1.status === 200, String(r1.status));
  check('la misma pieza dos veces no entra', (await aportar(cliente, 1n, motivo)).status === 409);
  check('firmada por otra cuenta, no', (await aportar(cliente, 1n, 'otra pieza', { firmante: intruso })).status === 403);
  check('con el texto cambiado después de firmar, no', (await aportar(cliente, 1n, 'lo firmado', { textoEnviado: 'lo cambiado' })).status === 403);
  check('con una fecha de hace veinte minutos, no', (await aportar(cliente, 1n, 'antedatada', { fecha: new Date(Date.now() - 20 * 60_000).toISOString() })).status === 400);
  check('ni con una fecha que no es una fecha', (await aportar(cliente, 1n, 'sin fecha', { fecha: 'ayer' })).status === 400);
  check('un juez no aporta', (await aportar(juez, 1n, 'opino que…')).status === 403);
  check('un tercero tampoco', (await aportar(intruso, 1n, 'hola')).status === 403);
  check('una pieza vacía no entra', (await aportar(cliente, 1n, '   ')).status === 400);
  check('ni una de más de 8000 caracteres', (await aportar(cliente, 1n, 'x'.repeat(8001))).status === 400);
  const sobre = JSON.stringify({ v: 'panal-cifrado-1', e: 'x', n: 'y', para: [], c: 'A'.repeat(20_000) });
  check('cifrada sí puede ser más larga: el sobre ocupa más que el texto', (await aportar(persona, 1n, sobre)).status === 200);

  console.log('\n─── los archivos ───');
  const captura = new TextEncoder().encode('captura del mensaje donde pidió el francés');
  const subir = async (quien: typeof cliente, id: bigint) =>
    fetch(`${base}/pruebas-archivo/${id}`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain', 'x-panal-filename': encodeURIComponent('captura ñ.txt'), ...cabeceras(await cred(quien, id)) },
      body: captura,
    });
  const subida = await subir(persona, 1n);
  const { hash } = (await subida.json()) as { hash: string };
  check('quien trabaja sube un archivo para su respuesta', subida.status === 200 && hash === keccak256(captura));
  check('un juez no sube archivos', (await subir(juez, 1n)).status === 403);
  const respuesta = 'Pidió «contrato en inglés» en el encargo; adjunto el mensaje.';
  check('y contesta nombrándolo', (await aportar(persona, 1n, respuesta, { archivos: [{ hash, size: captura.byteLength }] })).status === 200);
  check('una pieza no puede nombrar un archivo que no se subió', (await aportar(persona, 1n, 'con fantasma', { archivos: [{ hash: keccak256(toBytes('nada')), size: 4 }] })).status === 409);
  const bajada = await fetch(`${base}/pruebas-archivo/1/${hash}`, { headers: cabeceras(await cred(juez, 1n)) });
  check('el juez se lo baja, tal cual', bajada.status === 200 && keccak256(new Uint8Array(await bajada.arrayBuffer())) === hash);
  check('un tercero no', (await fetch(`${base}/pruebas-archivo/1/${hash}`, { headers: cabeceras(await cred(intruso, 1n)) })).status === 403);

  console.log('\n─── el plazo ───');
  check('a los ocho días ya no se aporta nada', (await aportar(cliente, 2n, 'tarde')).status === 409);
  check('ni se suben archivos', (await subir(cliente, 2n)).status === 409);
  const tarde = (await (await leer(cliente, 2n)).json()) as { abierto: boolean };
  check('pero el expediente se sigue leyendo, cerrado', tarde.abierto === false);
  check('sin disputa no hay pruebas que aportar', (await aportar(cliente, 3n, 'sin disputa')).status === 409);

  console.log('\n─── lo que ve el juez ───');
  const visto = (await (await leer(juez, 1n)).json()) as { piezas: Pieza[] };
  check('tres piezas, en el orden en que llegaron', visto.piezas.length === 3 && visto.piezas.map((p) => p.de).join(',') === 'cliente,trabajador,trabajador');
  check('con su autor', visto.piezas[0]!.autor === cliente.address && visto.piezas[2]!.autor === persona.address);
  let todasBien = true;
  for (const p of visto.piezas) todasBien &&= await verificarPieza(1n, p);
  check('el juez comprueba cada firma, sin fiarse del buzón', todasBien);
  const tocada = { ...visto.piezas[0]!, texto: 'El buzón cambió el motivo.' };
  check('y una pieza cambiada después no pasa', !(await verificarPieza(1n, tocada)));
  check('ni la de otra tarea', !(await verificarPieza(2n, visto.piezas[0]!)));

  server.close();
  console.log(fallos === 0 ? '\n✅ Las pruebas de una disputa: firmadas, con plazo y solo para quien toca\n' : `\n❌ ${fallos} comprobación(es) fallidas\n`);
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
