/**
 * Las pruebas de una disputa, de punta a punta: la librería de la web
 * (`src/lib/pruebas.ts`) contra el buzón de verdad (`bot/src/buzon.ts`), en el
 * mismo proceso y sin red.
 *
 *   npx tsx scripts/test-pruebas-web.ts
 *
 * Con cuatro cuentas: el cliente, quien trabaja y dos jueces, uno con su clave
 * de cifrado publicada y otro sin ella. Lo que tiene que pasar:
 *   - con las dos partes con clave, cada pieza va cifrada para ellas y para el
 *     juez que tiene clave; el buzón guarda sobres;
 *   - la otra parte y ese juez la abren, con sus archivos y su nombre de
 *     verdad, y la firma de su autor se comprueba;
 *   - el juez sin clave no abre nada… hasta que la activa y una parte le da
 *     acceso; entonces sí;
 *   - si a una parte le falta la clave, la pieza va en claro.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getAddress, keccak256, toBytes, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  accesoSignMessage,
  claveDesdeFirma,
  concederAcceso,
  descifrarArchivo,
  descifrarTexto,
  esArchivoCifrado,
  esTextoCifrado,
  mensajeParaDerivarClave,
  puedeAbrir,
  type Acceso,
  type ClaveDeCifrado,
} from '@panal/sdk';
import { createBuzonServer } from '../bot/src/buzon';
import { BuzonStore } from '../bot/src/buzon-store';
import { NATIVE_CURRENCY, TaskStatus, type Task, type TrabajoTablon } from '../bot/src/chain';
import {
  abrirPieza,
  aportarPieza,
  bajarArchivoDePruebas,
  buzonDePruebas,
  credencialDePruebas,
  destinatariosDePruebas,
  leerPruebas,
  objetosParaDarAcceso,
  type PiezaLegible,
} from '../src/lib/pruebas';

let fallos = 0;
const check = (nombre: string, ok: boolean, detalle = ''): void => {
  console.log(`${ok ? '✅' : '❌'} ${nombre}${ok ? '' : ` — ${detalle}`}`);
  if (!ok) fallos++;
};

const cliente = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');
const persona = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d');
const juezA = privateKeyToAccount('0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6');
const juezB = privateKeyToAccount('0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a');
const sinClave = privateKeyToAccount('0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba');
type Cuenta = typeof cliente;
const firmarCon = (c: Cuenta) => (m: string) => c.signMessage({ message: m });

/** Las claves de cifrado, derivadas de una firma como en la web. */
const claves = new Map<string, ClaveDeCifrado>();
async function claveDe(c: Cuenta): Promise<ClaveDeCifrado> {
  const k = c.address.toLowerCase();
  if (!claves.has(k)) claves.set(k, claveDesdeFirma(c.address, (await c.signMessage({ message: mensajeParaDerivarClave(c.address) })) as Hex));
  return claves.get(k)!;
}
/** Quién tiene la clave publicada en el buzón. El juez B, de momento, no. */
const publicadas = new Set<string>([cliente.address, persona.address, juezA.address].map((a) => a.toLowerCase()));
const cuentas = [cliente, persona, juezA, juezB, sinClave];
const claveDePublicada = async (a: Address): Promise<string | null> => {
  const c = cuentas.find((x) => x.address.toLowerCase() === a.toLowerCase());
  return c && publicadas.has(a.toLowerCase()) ? (await claveDe(c)).publica : null;
};
/** Cómo abre cada uno: con su clave, o con un acceso que le dieron. */
const abrirTextoCon = (c: Cuenta) => async (sobre: string, accesos: Acceso[]) =>
  puedeAbrir(sobre, c.address, accesos) ? descifrarTexto(sobre, c.address, (await claveDe(c)).secreta, accesos) : null;
const abrirBytesCon = (c: Cuenta) => async (bytes: Uint8Array, accesos: Acceso[]) =>
  esArchivoCifrado(bytes) ? descifrarArchivo(bytes, c.address, (await claveDe(c)).secreta, accesos) : bytes;

const ahora = BigInt(Math.floor(Date.now() / 1000));
const tarea = (worker: Address): Task => ({
  client: cliente.address,
  worker,
  amount: 10n ** 18n,
  taskHash: keccak256(toBytes('el encargo')),
  resultHash: keccak256(toBytes('la entrega')),
  deadline: 1_900_000_000n,
  createdAt: 1_899_000_000n,
  status: TaskStatus.Disputed,
  currency: NATIVE_CURRENCY,
});
/**
 * El tablón con reglas: la tarea #30 es la del encargo #8. En el escrow su
 * cliente es el contrato; el de verdad, el del encargo.
 */
const PANAL_TABLON = getAddress('0x7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a');
const ENCARGO_8: TrabajoTablon = {
  client: cliente.address,
  state: 1,
  agent: persona.address,
  taskHash: keccak256(toBytes('el encargo del tablón')),
  advertHash: keccak256(toBytes('el anuncio')),
  escrowTaskId: 30n,
};
/** #1 con Marta (tiene clave); #2 con una cuenta que no la tiene; #30 la del tablón. */
const TAREAS: Record<string, Task> = {
  '1': tarea(persona.address),
  '2': tarea(sinClave.address),
  '30': { ...tarea(persona.address), client: PANAL_TABLON },
};

const server = createBuzonServer({
  store: new BuzonStore(mkdtempSync(join(tmpdir(), 'panal-pruebas-web-'))),
  fetchTask: async (id) => {
    const t = TAREAS[id.toString()];
    if (!t) throw new Error('no existe');
    return t;
  },
  fetchDisputedAt: async () => ahora - 3_600n,
  fetchArbitros: async () => [juezA.address, juezB.address],
  tablon: PANAL_TABLON,
  fetchJob: async (id) => {
    if (id !== 8n) throw new Error('execution reverted: InvalidJob()');
    return ENCARGO_8;
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
const raiz = `http://127.0.0.1:${dir.port}/buzon`;
const base = buzonDePruebas(persona.address, raiz);

/** Lo que ve una cuenta: el expediente abierto con lo suyo. */
async function verComo(c: Cuenta, id: bigint, b = base, jobId?: bigint): Promise<{ piezas: PiezaLegible[]; accesos: Acceso[] }> {
  const cred = await credencialDePruebas(id, c.address, firmarCon(c), jobId);
  const e = await leerPruebas(b, id, cred);
  return { piezas: await Promise.all(e.piezas.map((p) => abrirPieza(id, p, e.archivos, e.accesos, abrirTextoCon(c)))), accesos: e.accesos };
}

try {
  console.log('\n─── para quién se cifra ───');
  const jueces = [juezA.address, juezB.address];
  const { para, juecesSinClave } = await destinatariosDePruebas(cliente.address, persona.address, jueces, claveDePublicada);
  check('las dos partes y el juez con clave', para?.map((d) => d.cuenta).join(',') === [cliente.address, persona.address, juezA.address].join(','));
  check('y se sabe qué juez no la tiene', juecesSinClave.length === 1 && juecesSinClave[0] === juezB.address);
  const otra = await destinatariosDePruebas(cliente.address, sinClave.address, jueces, claveDePublicada);
  check('si a una parte le falta la clave, va en claro', otra.para === null);

  console.log('\n─── el cliente aporta el motivo, cifrado y con un archivo ───');
  const captura = new TextEncoder().encode('Mensaje del 3 de noviembre: «tradúcelo al francés».');
  const credCliente = await credencialDePruebas(1n, cliente.address, firmarCon(cliente));
  await aportarPieza({
    base,
    taskId: 1n,
    texto: 'Pedí el contrato en francés y me lo entregaron en inglés.',
    archivos: [{ name: 'captura del chat.txt', bytes: captura, mime: 'text/plain' }],
    para,
    cred: credCliente,
    yo: cliente.address,
    firmar: firmarCon(cliente),
  });
  const crudo = await leerPruebas(base, 1n, credCliente);
  check('en el buzón hay un sobre, no el texto', crudo.piezas.length === 1 && esTextoCifrado(crudo.piezas[0]!.texto) && !crudo.piezas[0]!.texto.includes('francés'));
  check('y el archivo con nombre opaco', crudo.archivos.length === 1 && !crudo.archivos[0]!.name.includes('captura'));

  console.log('\n─── quien trabaja lo lee y contesta ───');
  const vistaPersona = await verComo(persona, 1n);
  const motivo = vistaPersona.piezas[0]!;
  check('lo abre', motivo.texto === 'Pedí el contrato en francés y me lo entregaron en inglés.', String(motivo.texto));
  check('con el nombre de verdad de su archivo', motivo.archivos[0]?.name === 'captura del chat.txt');
  check('y la firma del cliente comprobada', motivo.firmaOk && motivo.autor === cliente.address);
  const credPersona = await credencialDePruebas(1n, persona.address, firmarCon(persona));
  const bytes = await bajarArchivoDePruebas({ base, taskId: 1n, archivo: motivo.archivos[0]!, cred: credPersona, accesos: [], abrir: abrirBytesCon(persona) });
  check('se baja el archivo y se abre, idéntico', new TextDecoder().decode(bytes) === new TextDecoder().decode(captura));
  await aportarPieza({ base, taskId: 1n, texto: 'El encargo decía «en inglés».', archivos: [], para, cred: credPersona, yo: persona.address, firmar: firmarCon(persona) });

  console.log('\n─── los jueces ───');
  const vistaA = await verComo(juezA, 1n);
  check('el juez con clave lee las dos piezas', vistaA.piezas.length === 2 && vistaA.piezas.every((p) => p.texto !== null));
  check('y las dos firmas cuadran', vistaA.piezas.every((p) => p.firmaOk));
  const vistaB = await verComo(juezB, 1n);
  check('el juez sin clave ve que existen, pero no las abre', vistaB.piezas.length === 2 && vistaB.piezas.every((p) => p.texto === null && p.cifrada));

  console.log('\n─── el juez B activa su clave y el cliente le da acceso ───');
  publicadas.add(juezB.address.toLowerCase());
  const claveB = await claveDe(juezB);
  const vistaCliente = await verComo(cliente, 1n);
  const objetos = await objetosParaDarAcceso({ base, taskId: 1n, piezas: vistaCliente.piezas, cred: credCliente });
  check('el cliente reúne los sobres y los archivos que puede abrir', objetos.length === 3, String(objetos.length));
  const secretaCliente = (await claveDe(cliente)).secreta;
  const accesos = objetos.map((o) => concederAcceso(o, cliente.address, secretaCliente, { cuenta: juezB.address, clave: claveB.publica }, []));
  const expira = Math.floor(Date.now() / 1000) + 300;
  const res = await fetch(`${base}/access/1`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ accesos, address: cliente.address, signature: await cliente.signMessage({ message: accesoSignMessage(1n, expira) }), expira }),
  });
  check('el buzón guarda los accesos', res.status === 200, String(res.status));
  const despues = await verComo(juezB, 1n);
  check('ahora el juez B lee las dos piezas', despues.piezas.every((p) => p.texto !== null), JSON.stringify(despues.piezas.map((p) => p.texto)));
  const credB = await credencialDePruebas(1n, juezB.address, firmarCon(juezB));
  const archivoB = await bajarArchivoDePruebas({ base, taskId: 1n, archivo: despues.piezas[0]!.archivos[0]!, cred: credB, accesos: despues.accesos, abrir: abrirBytesCon(juezB) });
  check('y abre el archivo', new TextDecoder().decode(archivoB) === new TextDecoder().decode(captura));

  console.log('\n─── sin clave en una parte, en claro ───');
  const baseOtra = buzonDePruebas(sinClave.address, raiz);
  const credOtra = await credencialDePruebas(2n, cliente.address, firmarCon(cliente));
  await aportarPieza({
    base: baseOtra,
    taskId: 2n,
    texto: 'No entregó nada.',
    archivos: [{ name: 'factura.pdf', bytes: new TextEncoder().encode('%PDF-1.4 factura'), mime: 'application/pdf' }],
    para: null,
    cred: credOtra,
    yo: cliente.address,
    firmar: firmarCon(cliente),
  });
  const enClaro = await verComo(juezA, 2n, baseOtra);
  check('la pieza va en claro y se lee', enClaro.piezas[0]?.cifrada === false && enClaro.piezas[0]?.texto === 'No entregó nada.');
  check('con el nombre de su archivo, del índice del buzón', enClaro.piezas[0]?.archivos[0]?.name === 'factura.pdf');
  check('y su firma', enClaro.piezas[0]?.firmaOk === true);

  console.log('\n─── una disputa del tablón con reglas ───');
  // Cifrada para el cliente DEL ENCARGO, no para el contrato del tablón.
  const delTablon = await destinatariosDePruebas(ENCARGO_8.client, persona.address, [juezA.address, juezB.address], claveDePublicada);
  check('se cifra para el cliente del encargo', delTablon.para?.[0]?.cuenta === cliente.address);
  const credT = await credencialDePruebas(30n, cliente.address, firmarCon(cliente), 8n);
  check('la credencial lleva el encargo', credT.job === '8');
  await aportarPieza({
    base,
    taskId: 30n,
    texto: 'La traducción del tablón llegó a medias.',
    archivos: [{ name: 'lo que llegó.txt', bytes: new TextEncoder().encode('Capítulo 1 de 3'), mime: 'text/plain' }],
    para: delTablon.para,
    cred: credT,
    yo: cliente.address,
    firmar: firmarCon(cliente),
  });
  const vistaT = await verComo(persona, 30n);
  check('quien lo cogió lo abre sin decir el encargo', vistaT.piezas[0]?.texto === 'La traducción del tablón llegó a medias.', String(vistaT.piezas[0]?.texto));
  check('como pieza del cliente, firmada por él', vistaT.piezas[0]?.de === 'cliente' && vistaT.piezas[0]?.autor === cliente.address && vistaT.piezas[0]?.firmaOk);
  const credTP = await credencialDePruebas(30n, persona.address, firmarCon(persona));
  const archivoT = await bajarArchivoDePruebas({ base, taskId: 30n, archivo: vistaT.piezas[0]!.archivos[0]!, cred: credTP, accesos: [], abrir: abrirBytesCon(persona) });
  check('y su archivo', new TextDecoder().decode(archivoT) === 'Capítulo 1 de 3');
  await aportarPieza({ base, taskId: 30n, texto: 'Entregué lo que decía el anuncio.', archivos: [], para: delTablon.para, cred: credTP, yo: persona.address, firmar: firmarCon(persona) });
  const vistaTC = await verComo(cliente, 30n, base, 8n);
  check('el cliente lee la respuesta, con su encargo', vistaTC.piezas.length === 2 && vistaTC.piezas[1]?.texto === 'Entregué lo que decía el anuncio.');
  const sinEncargo = await leerPruebas(base, 30n, await credencialDePruebas(30n, cliente.address, firmarCon(cliente))).catch((e: Error) => e);
  check('sin el encargo, el buzón no sabe que es el cliente', sinEncargo instanceof Error && sinEncargo.message === 'not a party', String(sinEncargo));
  const vistaTA = await verComo(juezA, 30n);
  check('el juez con clave lee las dos', vistaTA.piezas.every((p) => p.texto !== null && p.firmaOk));
  // El juez B ya tiene clave (de antes): el cliente del encargo le da acceso.
  const objetosT = await objetosParaDarAcceso({ base, taskId: 30n, piezas: vistaTC.piezas, cred: credT });
  const accesosT = objetosT.map((o) => concederAcceso(o, cliente.address, secretaCliente, { cuenta: juezB.address, clave: claveB.publica }, []));
  const expiraT = Math.floor(Date.now() / 1000) + 300;
  const cuerpoT = JSON.stringify({ accesos: accesosT, address: cliente.address, signature: await cliente.signMessage({ message: accesoSignMessage(30n, expiraT) }), expira: expiraT });
  const sinJob = await fetch(`${base}/access/30`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: cuerpoT });
  check('dar acceso sin decir el encargo no vale', sinJob.status === 403, String(sinJob.status));
  const conJob = await fetch(`${base}/access/30?job=8`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: cuerpoT });
  check('diciéndolo, sí', conJob.status === 200, String(conJob.status));
  const vistaTB = await verComo(juezB, 30n);
  check('y el juez B lee las dos', vistaTB.piezas.every((p) => p.texto !== null), JSON.stringify(vistaTB.piezas.map((p) => p.texto)));
} finally {
  server.close();
}

console.log(fallos === 0 ? '\n✅ La web aporta, abre y comparte las pruebas con quien toca\n' : `\n❌ ${fallos} comprobación(es) fallidas\n`);
process.exit(fallos === 0 ? 0 : 1);
