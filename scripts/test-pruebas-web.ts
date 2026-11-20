/**
 * Las pruebas de una disputa, de punta a punta: la librería de la web
 * (`src/lib/pruebas.ts`) contra el buzón de verdad (`bot/src/buzon.ts`), en el
 * mismo proceso y sin red.
 *
 *   npx tsx scripts/test-pruebas-web.ts
 *
 * Con cuatro cuentas: el cliente, quien trabaja y dos jueces, uno con su clave
 * de cifrado publicada y otro sin ella. Lo que tiene que pasar (v2):
 *   - cada pieza va cifrada para TODOS los que tienen clave; el buzón guarda
 *     sobres, y rechaza una a la que le falte alguno;
 *   - un juez le pide el encargo al cliente; el cliente lo comparte y el texto
 *     coincide con el `taskHash`; el agente comparte la entrega con su archivo,
 *     que cuenta como anclado; otro archivo suyo, no;
 *   - el juez sin clave no abre nada… hasta que la activa y alguien le da
 *     acceso; entonces sí. Si la otra parte no tiene clave, se la da un juez;
 *   - sin clave no se escribe.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getAddress, keccak256, toBytes, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  accesoSignMessage,
  appendAttachmentsManifest,
  appendFilesManifest,
  attachmentFrom,
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
  faltanPorAcceso,
  leerPruebas,
  marcarAnclados,
  objetosParaDarAcceso,
  puedeEscribir,
  type PiezaLegible,
} from '../src/lib/pruebas';
import { copiaLocalAnclada, puedeAportar, textoAncladoParaAportar } from '../src/lib/ancladoParaPruebas';
import { BUZON_BASE, urlDeBuzon } from '../src/lib/botEndpoint';
import { saveTaskBrief } from '../src/lib/taskBriefs';

// La copia del cliente vive en el localStorage del teléfono o del navegador.
const guardado = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => guardado.get(k) ?? null,
  setItem: (k: string, v: string) => void guardado.set(k, v),
  removeItem: (k: string) => void guardado.delete(k),
};

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
/** Lo que se pidió y lo que se entregó, con lo que se ancló en el escrow. */
const PLANO = new TextEncoder().encode('el plano del piso');
const ENCARGO = appendAttachmentsManifest('Tradúceme el contrato al francés.', [attachmentFrom('plano.pdf', PLANO)]);
const CONTRATO = new TextEncoder().encode('Le contrat, en français.');
const ENTREGA = appendFilesManifest('Aquí está la traducción.', [{ name: 'contrat.txt', size: CONTRATO.byteLength, hash: keccak256(CONTRATO), path: 'contrat.txt' }]);
const HUELLAS = { taskHash: keccak256(toBytes(ENCARGO)), resultHash: keccak256(toBytes(ENTREGA)) };
const tarea = (worker: Address): Task => ({
  client: cliente.address,
  worker,
  amount: 10n ** 18n,
  ...HUELLAS,
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

const store = new BuzonStore(mkdtempSync(join(tmpdir(), 'panal-pruebas-web-')));
/** Publicar una clave es dejarla en el buzón: él exige cifrar para quien la tiene. */
const publicar = async (c: Cuenta) => {
  publicadas.add(c.address.toLowerCase());
  store.guardarClave(c.address, (await claveDe(c)).publica, '0x00');
};
for (const c of [cliente, persona, juezA]) await publicar(c);

const server = createBuzonServer({
  store,
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
const jueces = [juezA.address, juezB.address];

/** Lo que ve una cuenta: el expediente abierto con lo suyo, con lo anclado marcado. */
async function verComo(c: Cuenta, id: bigint, b = base, jobId?: bigint): Promise<{ piezas: PiezaLegible[]; accesos: Acceso[] }> {
  const cred = await credencialDePruebas(id, c.address, firmarCon(c), jobId);
  const e = await leerPruebas(b, id, cred);
  const piezas = await Promise.all(e.piezas.map((p) => abrirPieza(id, p, e.archivos, e.accesos, abrirTextoCon(c), HUELLAS)));
  return { piezas: marcarAnclados(piezas), accesos: e.accesos };
}
/** Escribe como lo hará la web: para todos los que tienen clave ahora. */
async function escribir(
  c: Cuenta,
  id: bigint,
  o: { texto: string; tipo?: 'mensaje' | 'encargo' | 'entrega' | 'peticion'; dirigida?: 'cliente' | 'trabajador'; pide?: 'encargo' | 'entrega'; archivos?: { name: string; bytes: Uint8Array }[] },
  b = base,
  trabajador: Address = persona.address,
  jobId?: bigint,
  clienteReal: Address = cliente.address,
) {
  const { para } = await destinatariosDePruebas(clienteReal, trabajador, jueces, claveDePublicada);
  const cred = await credencialDePruebas(id, c.address, firmarCon(c), jobId);
  await aportarPieza({ base: b, taskId: id, texto: o.texto, archivos: o.archivos ?? [], para, cred, yo: c.address, firmar: firmarCon(c), tipo: o.tipo, dirigida: o.dirigida, pide: o.pide });
}

try {
  console.log('\n─── para quién se cifra ───');
  const { para, juecesSinClave, sinClave: faltanClave } = await destinatariosDePruebas(cliente.address, persona.address, jueces, claveDePublicada);
  check('todos los que tienen clave: las dos partes y el juez A', para.map((d) => d.cuenta).join(',') === [cliente.address, persona.address, juezA.address].join(','));
  check('y se sabe quién no la tiene', juecesSinClave.join() === juezB.address && faltanClave.join() === juezB.address);
  const otra = await destinatariosDePruebas(cliente.address, sinClave.address, jueces, claveDePublicada);
  check('si a la otra parte le falta, igual se cifra (para los demás)', otra.para.map((d) => d.cuenta).join(',') === [cliente.address, juezA.address].join(','));
  check('el cliente puede escribir; el juez B, aún no', puedeEscribir(para, cliente.address) && !puedeEscribir(para, juezB.address));

  console.log('\n─── el cliente abre la disputa ───');
  await escribir(cliente, 1n, { texto: 'Pedí el contrato en francés y me lo entregaron en inglés.' });
  const credCliente = await credencialDePruebas(1n, cliente.address, firmarCon(cliente));
  const crudo = await leerPruebas(base, 1n, credCliente);
  check('en el buzón hay un sobre, no el texto', crudo.piezas.length === 1 && esTextoCifrado(crudo.piezas[0]!.texto) && !crudo.piezas[0]!.texto.includes('francés'));
  const conArchivo = await escribir(cliente, 1n, { texto: 'con una captura', archivos: [{ name: 'captura.png', bytes: new Uint8Array([1, 2, 3]) }] }).then(
    () => 'entró',
    (e: Error) => e.message,
  );
  check('el cliente no puede subir archivos', /only the agent/.test(conArchivo), conArchivo);

  console.log('\n─── un juez pide, y el cliente comparte su encargo ───');
  await escribir(juezA, 1n, { texto: '¿Puedes compartir el encargo tal cual?', tipo: 'peticion', dirigida: 'cliente', pide: 'encargo' });
  const vistaCliente1 = await verComo(cliente, 1n);
  const peticion = vistaCliente1.piezas[1]!;
  check('el cliente ve la petición del juez', peticion.de === 'juez' && peticion.tipo === 'peticion' && peticion.dirigida === 'cliente' && peticion.pide === 'encargo' && peticion.firmaOk);
  await escribir(cliente, 1n, { texto: ENCARGO, tipo: 'encargo' });
  await escribir(cliente, 1n, { texto: ENCARGO.replace('francés', 'inglés'), tipo: 'encargo' });

  console.log('\n─── el agente comparte su entrega, con su archivo ───');
  await escribir(persona, 1n, {
    texto: ENTREGA,
    tipo: 'entrega',
    archivos: [
      { name: 'contrat.txt', bytes: CONTRATO },
      { name: 'otro.txt', bytes: new TextEncoder().encode('esto no se ancló') },
    ],
  });

  console.log('\n─── lo que ve el juez A ───');
  const vistaA = await verComo(juezA, 1n);
  check('cinco piezas, todas legibles y firmadas', vistaA.piezas.length === 5 && vistaA.piezas.every((p) => p.texto !== null && p.firmaOk));
  const [, , encargoBueno, encargoMalo, entrega] = vistaA.piezas;
  check('el encargo exacto coincide con la cadena', encargoBueno?.tipo === 'encargo' && encargoBueno.ancla === 'coincide');
  check('el retocado, no', encargoMalo?.tipo === 'encargo' && encargoMalo.ancla === 'no-coincide');
  check('la entrega coincide', entrega?.tipo === 'entrega' && entrega.ancla === 'coincide' && entrega.de === 'trabajador');
  check('su archivo de la entrega cuenta como anclado', entrega?.archivos.find((a) => a.name === 'contrat.txt')?.anclado === true);
  check('el otro, no', entrega?.archivos.find((a) => a.name === 'otro.txt')?.anclado === false);
  const credA = await credencialDePruebas(1n, juezA.address, firmarCon(juezA));
  const contrato = await bajarArchivoDePruebas({ base, taskId: 1n, archivo: entrega!.archivos[0]!, cred: credA, accesos: [], abrir: abrirBytesCon(juezA) });
  check('y el juez lo abre, idéntico', new TextDecoder().decode(contrato) === new TextDecoder().decode(CONTRATO));

  console.log('\n─── el juez B activa su clave ───');
  const vistaB = await verComo(juezB, 1n);
  check('sin clave ve que hay piezas, pero no las abre', vistaB.piezas.length === 5 && vistaB.piezas.every((p) => p.texto === null && p.cifrada));
  await publicar(juezB);
  const viejo = await aportarPieza({ base, taskId: 1n, texto: 'para los de antes', archivos: [], para, cred: credCliente, yo: cliente.address, firmar: firmarCon(cliente) }).then(
    () => 'entró',
    (e: Error) => e.message,
  );
  check('ahora una pieza que no lo incluya no entra', viejo === 'missing recipients', viejo);
  const conB = await destinatariosDePruebas(cliente.address, persona.address, jueces, claveDePublicada);
  const vistaCliente2 = await verComo(cliente, 1n);
  check('el cliente ve a quién le falta acceso', faltanPorAcceso(vistaCliente2.piezas, conB.para).map((d) => d.cuenta).join() === juezB.address);
  const objetos = await objetosParaDarAcceso({ base, taskId: 1n, piezas: vistaCliente2.piezas, cred: credCliente });
  const secretaCliente = (await claveDe(cliente)).secreta;
  const claveB = await claveDe(juezB);
  const accesos = objetos.flatMap((o) => {
    try {
      return [concederAcceso(o, cliente.address, secretaCliente, { cuenta: juezB.address, clave: claveB.publica }, [])];
    } catch {
      return [];
    }
  });
  const expira = Math.floor(Date.now() / 1000) + 300;
  const res = await fetch(`${base}/access/1`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ accesos, address: cliente.address, signature: await cliente.signMessage({ message: accesoSignMessage(1n, expira) }), expira }),
  });
  check('el buzón guarda los accesos', res.status === 200, String(res.status));
  const despues = await verComo(juezB, 1n);
  check('ahora el juez B lee las cinco', despues.piezas.every((p) => p.texto !== null), JSON.stringify(despues.piezas.map((p) => p.texto?.slice(0, 20))));
  check('y ve el encargo coincidir', despues.piezas[2]?.ancla === 'coincide');
  await escribir(juezB, 1n, { texto: 'Al agente: ¿por qué en francés?', dirigida: 'trabajador' });
  const ultimo = (await verComo(persona, 1n)).piezas.at(-1);
  check('y escribe; el agente lo lee como dirigido a él', ultimo?.de === 'juez' && ultimo.dirigida === 'trabajador' && ultimo.texto === 'Al agente: ¿por qué en francés?');

  console.log('\n─── la otra parte sin clave: le da acceso un juez ───');
  const baseOtra = buzonDePruebas(sinClave.address, raiz);
  await escribir(cliente, 2n, { texto: 'No entregó nada.' }, baseOtra, sinClave.address);
  await escribir(juezA, 2n, { texto: '¿El agente tiene algo que decir?', dirigida: 'trabajador' }, baseOtra, sinClave.address);
  check('el agente sin clave no las abre', (await verComo(sinClave, 2n, baseOtra)).piezas.every((p) => p.texto === null));
  await publicar(sinClave);
  const vistaJuez2 = await verComo(juezA, 2n, baseOtra);
  const todos2 = await destinatariosDePruebas(cliente.address, sinClave.address, jueces, claveDePublicada);
  const nuevo = faltanPorAcceso(vistaJuez2.piezas, todos2.para).find((d) => d.cuenta === sinClave.address)!;
  const credJ2 = await credencialDePruebas(2n, juezA.address, firmarCon(juezA));
  const objetos2 = await objetosParaDarAcceso({ base: baseOtra, taskId: 2n, piezas: vistaJuez2.piezas, cred: credJ2 });
  const secretaA = (await claveDe(juezA)).secreta;
  const accesos2 = objetos2.map((o) => concederAcceso(o, juezA.address, secretaA, nuevo, []));
  const expira2 = Math.floor(Date.now() / 1000) + 300;
  const res2 = await fetch(`${baseOtra}/access/2`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ accesos: accesos2, address: juezA.address, signature: await juezA.signMessage({ message: accesoSignMessage(2n, expira2) }), expira: expira2 }),
  });
  check('el juez le da acceso', res2.status === 200, String(res2.status));
  check('y el agente lo lee todo', (await verComo(sinClave, 2n, baseOtra)).piezas.every((p) => p.texto !== null));

  console.log('\n─── sin clave no se escribe ───');
  const nadie = await aportarPieza({ base, taskId: 1n, texto: 'hola', archivos: [], para: [], cred: credCliente, yo: cliente.address, firmar: firmarCon(cliente) }).then(
    () => 'entró',
    (e: Error) => e.message,
  );
  check('sin estar entre los destinatarios, ni se firma', nadie === 'sin-clave', nadie);

  console.log('\n─── una disputa del tablón con reglas ───');
  // Cifrada para el cliente DEL ENCARGO, no para el contrato del tablón.
  const delTablon = await destinatariosDePruebas(ENCARGO_8.client, persona.address, jueces, claveDePublicada);
  check('se cifra para el cliente del encargo', delTablon.para[0]?.cuenta === cliente.address);
  const credT = await credencialDePruebas(30n, cliente.address, firmarCon(cliente), 8n);
  check('la credencial lleva el encargo', credT.job === '8');
  await escribir(cliente, 30n, { texto: 'La traducción del tablón llegó a medias.' }, base, persona.address, 8n);
  const vistaT = await verComo(persona, 30n);
  check('quien lo cogió lo abre sin decir el encargo', vistaT.piezas[0]?.texto === 'La traducción del tablón llegó a medias.', String(vistaT.piezas[0]?.texto));
  check('como pieza del cliente, firmada por él', vistaT.piezas[0]?.de === 'cliente' && vistaT.piezas[0]?.autor === cliente.address && vistaT.piezas[0]?.firmaOk);
  await escribir(persona, 30n, { texto: 'Entregué lo que decía el anuncio.' });
  const vistaTC = await verComo(cliente, 30n, base, 8n);
  check('el cliente lee la respuesta, con su encargo', vistaTC.piezas.length === 2 && vistaTC.piezas[1]?.texto === 'Entregué lo que decía el anuncio.');
  const sinEncargo = await leerPruebas(base, 30n, await credencialDePruebas(30n, cliente.address, firmarCon(cliente))).catch((e: Error) => e);
  check('sin el encargo, el buzón no sabe que es el cliente', sinEncargo instanceof Error && sinEncargo.message === 'not a party', String(sinEncargo));
  const vistaTA = await verComo(juezA, 30n);
  check('los dos jueces leen las dos', vistaTA.piezas.every((p) => p.texto !== null && p.firmaOk) && (await verComo(juezB, 30n)).piezas.every((p) => p.texto !== null));

  console.log('\n─── la app: lo anclado, del teléfono o del buzón ───');
  store.guardarBrief(persona.address, 1n, ENCARGO);
  store.guardarEntrega(persona.address, 1n, ENTREGA);
  // El buzón de producción es este, el local: así `esBuzon` lo reconoce.
  const fetchDeVerdad = globalThis.fetch;
  globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) =>
    fetchDeVerdad(typeof url === 'string' && url.startsWith(BUZON_BASE) ? raiz + url.slice(BUZON_BASE.length) : url, init)) as typeof fetch;
  try {
    const comun = { taskId: 1n, huellas: HUELLAS, botUrl: urlDeBuzon(persona.address), delTablon: false };
    check('quien trabaja desde el buzón puede aportar el encargo y la entrega', puedeAportar({ ...comun, que: 'encargo', rol: 'trabajador' }) && puedeAportar({ ...comun, que: 'entrega', rol: 'trabajador' }));
    check('el cliente sin copia no puede aportar su encargo (el buzón no se lo enseña)', !puedeAportar({ ...comun, que: 'encargo', rol: 'cliente' }));
    check('pero sí la entrega, pidiéndola', puedeAportar({ ...comun, que: 'entrega', rol: 'cliente' }));
    check('en una del tablón no se pide nada a nadie', !puedeAportar({ ...comun, delTablon: true, que: 'entrega', rol: 'trabajador' }));
    const delBuzon = await textoAncladoParaAportar({ ...comun, que: 'encargo', rol: 'trabajador', yo: persona.address, firmar: firmarCon(persona) });
    check('quien trabaja saca su encargo del buzón, tal cual se ancló', delBuzon === ENCARGO);
    const suEntrega = await textoAncladoParaAportar({ ...comun, que: 'entrega', rol: 'trabajador', yo: persona.address, firmar: firmarCon(persona) });
    check('y su entrega', suEntrega === ENTREGA);
    const laEntrega = await textoAncladoParaAportar({ ...comun, que: 'entrega', rol: 'cliente', yo: cliente.address, firmar: firmarCon(cliente) });
    check('el cliente pide la entrega y cuadra con la cadena', laEntrega === ENTREGA);
    saveTaskBrief(HUELLAS.taskHash, 'un encargo que no es el anclado');
    check('una copia del teléfono que no cuadra no se ofrece', copiaLocalAnclada('encargo', 'cliente', 1n, HUELLAS) === null);
    saveTaskBrief(HUELLAS.taskHash, ENCARGO);
    check('la que cuadra, sí, sin firmar nada', copiaLocalAnclada('encargo', 'cliente', 1n, HUELLAS) === ENCARGO && puedeAportar({ ...comun, que: 'encargo', rol: 'cliente' }));
    await escribir(persona, 1n, { texto: delBuzon!, tipo: 'encargo' });
    const ultima = (await verComo(juezA, 1n)).piezas.at(-1);
    check('el juez ve el encargo que aportó quien trabaja: coincide con la cadena', ultima?.tipo === 'encargo' && ultima.de === 'trabajador' && ultima.ancla === 'coincide', JSON.stringify(ultima?.ancla));
  } finally {
    globalThis.fetch = fetchDeVerdad;
  }
} finally {
  server.close();
}

console.log(fallos === 0 ? '\n✅ La web aporta, abre y comparte las pruebas con quien toca\n' : `\n❌ ${fallos} comprobación(es) fallidas\n`);
process.exit(fallos === 0 ? 0 : 1);
