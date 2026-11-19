/**
 * Test LOCAL de las pruebas de una disputa en el buzón — sin RPC y sin red.
 *
 * El expediente que la cadena no guarda: el motivo, lo que aporta cada parte y
 * su respuesta. Lo que tiene que quedar demostrado:
 *   - escriben las dos partes y, desde la v2, los jueces (mientras dure la
 *     disputa); leen los mismos, y nadie más;
 *   - v2: nada en claro, y cada pieza cifrada para TODOS los del expediente
 *     que tengan clave, su autor incluido: no se le puede esconder nada a
 *     nadie;
 *   - v2: archivos, solo del agente (los anclados); el cliente y los jueces
 *     no suben ninguno;
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
import { accesoSignMessage, contenidoDePieza, createBuzonServer, piezaSignMessage, pruebasSignMessage } from '../src/buzon.js';
import { BuzonStore } from '../src/buzon-store.js';
import { NATIVE_CURRENCY, TaskStatus, type Task, type TrabajoTablon } from '../src/chain.js';

/** Una pieza como la sirve el buzón (`PiezaDeDisputa` en el SDK). */
interface Pieza {
  de: 'cliente' | 'trabajador' | 'juez';
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
/** Un segundo juez, que todavía no ha publicado su clave. */
const juez2 = privateKeyToAccount('0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a');
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
/**
 * El tablón con reglas: en el escrow, el cliente de sus tareas es el contrato.
 * El de verdad está en el encargo, y la tarea #10 es la del encargo #4.
 */
const PANAL_TABLON = getAddress('0x7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a');
const ENCARGOS: Record<string, TrabajoTablon> = {
  '4': { client: cliente.address, state: 1, agent: AGENTE, taskHash: keccak256(toBytes('el encargo')), advertHash: keccak256(toBytes('el anuncio')), escrowTaskId: 10n },
  // Otro encargo, de otra tarea: no sirve para la #10.
  '5': { client: intruso.address, state: 1, agent: AGENTE, taskHash: keccak256(toBytes('otro')), advertHash: keccak256(toBytes('otro')), escrowTaskId: 99n },
};
/** #1 en disputa desde ayer; #2 en disputa desde hace ocho días; #3 entregada; #10 la del tablón, en disputa. */
const TAREAS: Record<string, Task> = {
  '1': tarea(TaskStatus.Disputed),
  '2': tarea(TaskStatus.Disputed),
  '3': tarea(TaskStatus.Delivered),
  '10': { ...tarea(TaskStatus.Disputed), client: PANAL_TABLON },
};
const ABIERTA: Record<string, bigint> = { '1': ahora - 86_400n, '2': ahora - 8n * 86_400n, '3': 0n, '10': ahora - 3_600n };

let fallos = 0;
const check = (nombre: string, ok: boolean, detalle = '') => {
  console.log(`${ok ? '✅' : '❌'} ${nombre}${detalle ? ` — ${detalle}` : ''}`);
  if (!ok) fallos++;
};

/**
 * Un sobre cifrado con la forma de verdad (`sdk/src/cifrado.ts`): el buzón no
 * lo abre, solo mira su forma y para quién va.
 */
const sobre = (para: { address: Address }[], relleno = 'contenido cifrado') =>
  JSON.stringify({ v: 'panal-cifrado-1', e: 'efimera', n: 'nonce', para: para.map((x) => ({ a: x.address.toLowerCase(), k: 'envuelta' })), c: relleno });

async function main() {
  const store = new BuzonStore(mkdtempSync(join(tmpdir(), 'panal-pruebas-test-')));
  // Las claves publicadas: las dos partes y el primer juez. El segundo, aún no.
  for (const c of [cliente, persona, juez]) store.guardarClave(c.address, `clave-de-${c.address}`, '0x00');
  const server = createBuzonServer({
    store,
    fetchTask: async (taskId) => {
      const t = TAREAS[taskId.toString()];
      if (!t) throw new Error('no existe');
      return t;
    },
    fetchDisputedAt: async (taskId) => ABIERTA[taskId.toString()] ?? 0n,
    fetchArbitros: async () => [juez.address, juez2.address],
    tablon: PANAL_TABLON,
    fetchJob: async (jobId) => {
      const j = ENCARGOS[jobId.toString()];
      if (!j) throw new Error('execution reverted: InvalidJob()');
      return j;
    },
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
  /** Los del expediente con clave: el cliente, quien trabaja y el primer juez. */
  const todos = [cliente, persona, juez];
  const motivo = sobre(todos, 'La entrega no es lo que pedí: el contrato está en inglés y lo pedí en francés.');
  const r1 = await aportar(cliente, 1n, motivo);
  check('el cliente escribe el motivo, cifrado para todos', r1.status === 200, String(r1.status));
  check('la misma pieza dos veces no entra', (await aportar(cliente, 1n, motivo)).status === 409);
  check('firmada por otra cuenta, no', (await aportar(cliente, 1n, sobre(todos, 'otra pieza'), { firmante: intruso })).status === 403);
  check('con el texto cambiado después de firmar, no', (await aportar(cliente, 1n, sobre(todos, 'lo firmado'), { textoEnviado: sobre(todos, 'lo cambiado') })).status === 403);
  check('con una fecha de hace veinte minutos, no', (await aportar(cliente, 1n, sobre(todos, 'antedatada'), { fecha: new Date(Date.now() - 20 * 60_000).toISOString() })).status === 400);
  check('ni con una fecha que no es una fecha', (await aportar(cliente, 1n, sobre(todos, 'sin fecha'), { fecha: 'ayer' })).status === 400);
  check('un tercero no aporta', (await aportar(intruso, 1n, sobre([...todos, intruso], 'hola'))).status === 403);

  console.log('\n─── v2: todo cifrado, y para todos ───');
  check('en claro no entra', (await aportar(cliente, 1n, 'Esto va en claro.')).status === 400);
  check('ni vacía', (await aportar(cliente, 1n, '   ')).status === 400);
  const sinLaOtraParte = await aportar(cliente, 1n, sobre([cliente, juez], 'que no lo vea el agente'));
  const faltan = (await sinLaOtraParte.json()) as { error: string; faltan?: string[] };
  check('escondida a la otra parte, no entra', sinLaOtraParte.status === 409 && faltan.error === 'missing recipients');
  check('y dice a quién le falta', JSON.stringify(faltan.faltan) === JSON.stringify([persona.address.toLowerCase()]));
  check('escondida a un juez con clave, tampoco', (await aportar(cliente, 1n, sobre([cliente, persona], 'que no lo vea el juez'))).status === 409);
  check('sin su autor entre los destinatarios, tampoco', (await aportar(cliente, 1n, sobre([persona, juez], 'ni yo la leo'))).status === 400);
  check('al juez que no tiene clave no hace falta incluirlo (ya le darán acceso)', (await aportar(persona, 1n, sobre(todos, 'mi respuesta'))).status === 200);
  check('pero incluirlo de más no estorba', (await aportar(persona, 1n, sobre([...todos, juez2], 'con el segundo juez'))).status === 200);
  check('el texto exacto de una entrega larga cabe (64 000 caracteres, escapados)', (await aportar(persona, 1n, sobre(todos, 'A'.repeat(64_000 * 6)))).status === 200);
  check('lo que no cabe ni así, no', (await aportar(persona, 1n, sobre(todos, 'A'.repeat(530_000)))).status === 400);
  // Un cuerpo que pasa del tope ni se lee: 413, o la conexión cortada.
  const enorme = await aportar(persona, 1n, sobre(todos, 'A'.repeat(700_000))).then((r) => r.status, () => 413);
  check('y uno enorme ni se lee', enorme === 413, String(enorme));

  console.log('\n─── v2: los jueces escriben ───');
  check('un juez pregunta o pide, cifrado para todos', (await aportar(juez, 1n, sobre(todos, '¿Qué idioma pedía el encargo?'))).status === 200);
  check('el juez sin clave también puede, si cifra para los que la tienen y para él', (await aportar(juez2, 1n, sobre([...todos, juez2], 'Y yo pido la entrega.'))).status === 200);
  check('pero no en una tarea que no está en disputa', (await aportar(juez, 3n, sobre(todos, 'sin disputa'))).status === 403);

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
  check('quien trabaja sube un archivo anclado para su pieza', subida.status === 200 && hash === keccak256(captura));
  check('un juez no sube archivos', (await subir(juez, 1n)).status === 403);
  check('v2: el cliente tampoco (solo comparte su encargo, en texto)', (await subir(cliente, 1n)).status === 403);
  const respuesta = sobre(todos, 'La entrega, con su archivo anclado.');
  check('y la aporta nombrándolo', (await aportar(persona, 1n, respuesta, { archivos: [{ hash, size: captura.byteLength }] })).status === 200);
  check('una pieza no puede nombrar un archivo que no se subió', (await aportar(persona, 1n, sobre(todos, 'con fantasma'), { archivos: [{ hash: keccak256(toBytes('nada')), size: 4 }] })).status === 409);
  check('v2: el cliente no puede nombrar archivos en su pieza', (await aportar(cliente, 1n, sobre(todos, 'con el del agente'), { archivos: [{ hash, size: captura.byteLength }] })).status === 403);
  const bajada = await fetch(`${base}/pruebas-archivo/1/${hash}`, { headers: cabeceras(await cred(juez, 1n)) });
  check('el juez se lo baja, tal cual', bajada.status === 200 && keccak256(new Uint8Array(await bajada.arrayBuffer())) === hash);
  const conIndice = (await (await leer(cliente, 1n)).json()) as { archivos: { hash: string; name: string; de: string }[] };
  check('el expediente trae el índice de los archivos, con su nombre', conIndice.archivos.some((x) => x.hash === hash && x.name === 'captura ñ.txt' && x.de === 'trabajador'));
  check('un tercero no', (await fetch(`${base}/pruebas-archivo/1/${hash}`, { headers: cabeceras(await cred(intruso, 1n)) })).status === 403);

  console.log('\n─── el plazo ───');
  check('a los ocho días ya no se aporta nada', (await aportar(cliente, 2n, sobre(todos, 'tarde'))).status === 409);
  check('ni un juez pregunta', (await aportar(juez, 2n, sobre(todos, 'tarde'))).status === 409);
  check('ni se suben archivos', (await subir(persona, 2n)).status === 409);
  const tarde = (await (await leer(cliente, 2n)).json()) as { abierto: boolean };
  check('pero el expediente se sigue leyendo, cerrado', tarde.abierto === false);
  check('sin disputa no hay pruebas que aportar', (await aportar(cliente, 3n, sobre(todos, 'sin disputa'))).status === 409);

  console.log('\n─── lo que ve el juez ───');
  const visto = (await (await leer(juez, 1n)).json()) as { piezas: Pieza[] };
  check(
    'las piezas, en el orden en que llegaron',
    visto.piezas.map((p) => p.de).join(',') === 'cliente,trabajador,trabajador,trabajador,juez,juez,trabajador',
    visto.piezas.map((p) => p.de).join(','),
  );
  check('con su autor', visto.piezas[0]!.autor === cliente.address && visto.piezas[4]!.autor === juez.address && visto.piezas[5]!.autor === juez2.address);
  let todasBien = true;
  for (const p of visto.piezas) todasBien &&= await verificarPieza(1n, p);
  check('el juez comprueba cada firma, sin fiarse del buzón', todasBien);
  const tocada = { ...visto.piezas[0]!, texto: sobre(todos, 'El buzón cambió el motivo.') };
  check('y una pieza cambiada después no pasa', !(await verificarPieza(1n, tocada)));
  check('ni la de otra tarea', !(await verificarPieza(2n, visto.piezas[0]!)));

  console.log('\n─── una disputa del tablón con reglas ───');
  // Su cliente en el escrow es PanalTablon; el de verdad lo dice el encargo.
  const conJob = (job?: string) => (job === undefined ? '' : `?job=${job}`);
  const leerT = async (quien: typeof cliente, job?: string) =>
    fetch(`${base}/pruebas/10${conJob(job)}`, { headers: cabeceras(await cred(quien, 10n)) });
  const aportarT = async (quien: typeof cliente, enClaro: string, job?: string) => {
    const texto = sobre(todos, enClaro);
    const fecha = new Date().toISOString();
    const firma = await quien.signMessage({ message: piezaSignMessage(10n, contenidoDePieza(texto, []), fecha) });
    return fetch(`${base}/pruebas/10${conJob(job)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ address: quien.address, texto, archivos: [], fecha, firma }),
    });
  };
  check('el cliente del encargo lee, diciendo cuál es', (await leerT(cliente, '4')).status === 200);
  check('sin decirlo, no es parte', (await leerT(cliente)).status === 403);
  check('con el encargo de otra tarea, tampoco', (await leerT(cliente, '5')).status === 403);
  check('ni con uno que no existe (y no es un fallo de la cadena)', (await leerT(cliente, '77')).status === 403);
  check('ni con basura en el número', (await leerT(cliente, 'x')).status === 403);
  check('el cliente de otro encargo no lee este', (await leerT(intruso, '5')).status === 403);
  check('el cliente aporta el motivo', (await aportarT(cliente, 'No entregó lo que pedí en el tablón.', '4')).status === 200);
  check('sin decir el encargo, no', (await aportarT(cliente, 'otra', undefined)).status === 403);
  check('quien lo cogió aporta sin más: ya es el trabajador del escrow', (await aportarT(persona, 'Sí lo entregué.')).status === 200);
  check('el juez lee sin decir el encargo', (await leerT(juez)).status === 200);
  const delTablon = (await (await leerT(juez)).json()) as { piezas: Pieza[] };
  check('dos piezas, una de cada parte', delTablon.piezas.map((p) => p.de).join(',') === 'cliente,trabajador');
  check('la del cliente lleva su cuenta, no la del contrato', delTablon.piezas[0]!.autor === cliente.address);
  let firmasT = true;
  for (const p of delTablon.piezas) firmasT &&= await verificarPieza(10n, p);
  check('y las firmas se comprueban con la tarea del escrow', firmasT);

  // Dar acceso a los jueces: el cliente del encargo también puede.
  const acceso = {
    o: `0x${'ab'.repeat(32)}`,
    a: juez.address.toLowerCase(),
    e: 'ZWZpbWVyYQ',
    n: 'bm9uY2U',
    k: 'Y2xhdmU',
  };
  const darAcceso = async (quien: typeof cliente, job?: string) => {
    const expira = Math.floor(Date.now() / 1000) + 300;
    const signature = await quien.signMessage({ message: accesoSignMessage(10n, expira) });
    return fetch(`${base}/access/10${conJob(job)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accesos: [acceso], address: quien.address, signature, expira }),
    });
  };
  check('el cliente del encargo da acceso a un juez', (await darAcceso(cliente, '4')).status === 200);
  check('sin decir el encargo, no puede', (await darAcceso(cliente)).status === 403);
  const accesosDelJuez = (await (await leerT(juez)).json()) as { accesos: { a: string }[] };
  check('y el juez lo ve en su expediente', accesosDelJuez.accesos.some((x) => x.a === juez.address.toLowerCase()));

  console.log('\n─── v2: un juez también da acceso, en disputa ───');
  const darAccesoEn = async (quien: typeof cliente, id: bigint, para: string) => {
    const expira = Math.floor(Date.now() / 1000) + 300;
    const signature = await quien.signMessage({ message: accesoSignMessage(id, expira) });
    return fetch(`${base}/access/${id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accesos: [{ ...acceso, a: para.toLowerCase() }], address: quien.address, signature, expira }),
    });
  };
  check('a una parte que activó su clave tarde', (await darAccesoEn(juez, 1n, cliente.address)).status === 200);
  check('pero no en una tarea que no está en disputa', (await darAccesoEn(juez, 3n, cliente.address)).status === 403);
  check('ni a alguien de fuera', (await darAccesoEn(juez, 1n, intruso.address)).status === 400);
  check('y un tercero sigue sin poder', (await darAccesoEn(intruso, 1n, cliente.address)).status === 403);

  server.close();
  console.log(fallos === 0 ? '\n✅ Las pruebas de una disputa: firmadas, con plazo y solo para quien toca\n' : `\n❌ ${fallos} comprobación(es) fallidas\n`);
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
