/**
 * Un agente autónomo en su disputa, de punta a punta: el expediente del SDK
 * (`sdk/src/expediente.ts`) y el módulo de la plantilla
 * (`create-agent/template/src/disputas.ts`) contra el buzón de verdad
 * (`bot/src/buzon.ts`), en el mismo proceso, sin cadena y con un modelo de
 * mentira.
 *
 *   npx tsx scripts/test-expediente-agente.ts
 *
 * Lo que tiene que pasar:
 *   - un juez pregunta al agente y le pide el encargo; el cliente escribe;
 *   - el ping solo lo acepta de un juez;
 *   - el agente aporta solo el encargo y la entrega, con su texto exacto
 *     (coinciden con la cadena) y solo sus archivos anclados;
 *   - su IA contesta al juez, marcada como automática, y a la petición le dice
 *     dónde está; al cliente no le contesta; al dueño le avisa de todo;
 *   - no contesta dos veces lo mismo;
 *   - el juez que activa su clave tarde recibe acceso del agente y lo abre;
 *   - todo lo que se lee lleva la firma de su autor.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getAddress, keccak256, toBytes, verifyMessage, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  appendAttachmentsManifest,
  appendFilesManifest,
  attachmentFrom,
  claveDesdeFirma,
  darAccesosDelExpediente,
  escribirEnExpediente,
  esCredencialDeJuez,
  leerExpediente,
  mensajeParaDerivarClave,
  pruebasSignMessage,
  type ClaveDeCifrado,
  type DepsDelExpediente,
  type PanalClient,
  type PiezaAbierta,
  type TareaDelExpediente,
} from '@panal/sdk';
import { createBuzonServer } from '../bot/src/buzon';
import { BuzonStore } from '../bot/src/buzon-store';
import { NATIVE_CURRENCY, TaskStatus, type Task } from '../bot/src/chain';

let fallos = 0;
const check = (nombre: string, ok: boolean, detalle = ''): void => {
  console.log(`${ok ? '✅' : '❌'} ${nombre}${ok ? '' : ` — ${detalle}`}`);
  if (!ok) fallos++;
};

const cliente = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');
const agente = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d');
const juezA = privateKeyToAccount('0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6');
const juezB = privateKeyToAccount('0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a');
type Cuenta = typeof cliente;
const cuentas = [cliente, agente, juezA, juezB];
const jueces = [juezA.address, juezB.address];

const claves = new Map<string, ClaveDeCifrado>();
async function claveDe(c: Cuenta): Promise<ClaveDeCifrado> {
  const k = c.address.toLowerCase();
  if (!claves.has(k)) claves.set(k, claveDesdeFirma(c.address, (await c.signMessage({ message: mensajeParaDerivarClave(c.address) })) as Hex));
  return claves.get(k)!;
}

// Lo que se pidió y se entregó, y lo que se ancló.
const PLANO = new TextEncoder().encode('el plano del piso');
const ENCARGO = appendAttachmentsManifest('Tradúceme el contrato al francés.', [attachmentFrom('plano.pdf', PLANO)]);
const CONTRATO = new TextEncoder().encode('Le contrat, en français.');
const AJENO = new TextEncoder().encode('un archivo que nunca se ancló');
const ENTREGA = appendFilesManifest('Aquí está la traducción.', [
  { name: 'contrat.txt', size: CONTRATO.byteLength, hash: keccak256(CONTRATO), path: 'contrat.txt' },
]);
const HUELLAS = { taskHash: keccak256(toBytes(ENCARGO)), resultHash: keccak256(toBytes(ENTREGA)) };
const TAREA: Task = {
  client: cliente.address,
  worker: agente.address,
  amount: 10n ** 18n,
  ...HUELLAS,
  deadline: 1_900_000_000n,
  createdAt: 1_899_000_000n,
  status: TaskStatus.Disputed,
  currency: NATIVE_CURRENCY,
};
const EXP: TareaDelExpediente = { id: 1n, cliente: cliente.address, trabajador: agente.address, ...HUELLAS, jueces };

// El buzón, con las claves de todos menos el juez B.
const store = new BuzonStore(mkdtempSync(join(tmpdir(), 'panal-expediente-')));
const publicadas = new Set<string>();
const publicar = async (c: Cuenta) => {
  publicadas.add(c.address.toLowerCase());
  store.guardarClave(c.address, (await claveDe(c)).publica, '0x00');
};
for (const c of [cliente, agente, juezA]) await publicar(c);

const ahora = BigInt(Math.floor(Date.now() / 1000));
const buzon = createBuzonServer({
  store,
  fetchTask: async (id) => {
    if (id !== 1n) throw new Error('no existe');
    return TAREA;
  },
  fetchDisputedAt: async () => ahora - 3_600n,
  fetchArbitros: async () => jueces,
  fetchAgent: async () => ({ owner: agente.address, metadataURI: 'Agente', pricePerTask: 1n, active: true }) as never,
  contratos: {
    escrow: getAddress('0xe138A9A492CFe27A13f8b7A6D312DA831791bCe9'),
    registry: getAddress('0x89a812BFb1c35fc814ef25a3E6Ca75068B16Ac51'),
    token: getAddress('0x2e2e44e7fa6178822d4397299f719e89d1a67777'),
  },
  simboloDe: () => 'MON',
  indexer: 'https://api.panal.lat',
  allowLocalhostOrigin: true,
});

/** Un servidor de prueba que contesta con `responder` y apunta lo que recibe. */
async function servidor(responder: (ruta: string, cuerpo: string) => unknown): Promise<{ url: string; recibido: string[]; s: Server }> {
  const recibido: string[] = [];
  const s = createServer((req, res) => {
    let cuerpo = '';
    req.on('data', (d) => (cuerpo += d));
    req.on('end', () => {
      recibido.push(cuerpo);
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(responder(req.url ?? '', cuerpo)));
    });
  });
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  const a = s.address();
  if (!a || typeof a === 'string') throw new Error('sin puerto');
  return { url: `http://127.0.0.1:${a.port}`, recibido, s };
}

await new Promise<void>((r) => buzon.listen(0, '127.0.0.1', r));
const dirBuzon = buzon.address();
if (!dirBuzon || typeof dirBuzon === 'string') throw new Error('sin puerto');
const buzonUrl = `http://127.0.0.1:${dirBuzon.port}/buzon`;

// El indexador dice que la #1 está en disputa; el modelo contesta siempre lo mismo; los avisos se apuntan.
const indexador = await servidor(() => ({ tasks: [{ taskId: '1', status: 'disputed' }] }));
const RESPUESTA_IA = 'El encargo pedía francés y la entrega está en francés, con el archivo contrat.txt.';
const modelo = await servidor(() => ({ choices: [{ message: { content: RESPUESTA_IA } }] }));
const avisos = await servidor(() => ({ ok: true }));

const depsDe = (c: Cuenta): DepsDelExpediente => ({
  buzonUrl,
  yo: c.address,
  firmar: (m) => c.signMessage({ message: m }),
  secreta: async () => (await claveDe(c)).secreta,
  claveDe: async (a: Address) => {
    const x = cuentas.find((y) => y.address.toLowerCase() === a.toLowerCase());
    return x && publicadas.has(a.toLowerCase()) ? (await claveDe(x)).publica : null;
  },
});

// ---- El SDK, a pelo -----------------------------------------------------------

const vacio = await leerExpediente(depsDe(juezA), EXP);
check('un juez abre el expediente vacío y abierto', vacio.piezas.length === 0 && vacio.abierto);

await escribirEnExpediente(depsDe(juezA), EXP, { texto: '¿En qué idioma pedía el cliente la traducción?', para: 'trabajador' });
await escribirEnExpediente(depsDe(juezA), EXP, { tipo: 'peticion', texto: 'Aporta el encargo, por favor.', para: 'trabajador', pide: 'encargo' });
await escribirEnExpediente(depsDe(cliente), EXP, { texto: 'La traducción no está completa.' });
check('el juez y el cliente escriben con el SDK', (await leerExpediente(depsDe(juezA), EXP)).piezas.length === 3);

let rechazo = '';
try {
  await escribirEnExpediente(depsDe(cliente), EXP, { texto: 'con un archivo mío', archivos: [{ name: 'x.txt', bytes: AJENO }] });
} catch (err) {
  rechazo = err instanceof Error ? err.message : String(err);
}
check('el SDK no le deja al cliente subir archivos (lo rechaza el buzón)', rechazo !== '', rechazo);

let sinClave = '';
try {
  await escribirEnExpediente(depsDe(juezB), EXP, { texto: 'sin clave' });
} catch (err) {
  sinClave = err instanceof Error ? err.message : String(err);
}
check('sin clave publicada no se escribe, y lo dice', /clave/.test(sinClave), sinClave);

const credDe = async (c: Cuenta, id = 1n, enSegundos = 600) => {
  const expira = Math.floor(Date.now() / 1000) + enSegundos;
  return { address: c.address, firma: await c.signMessage({ message: pruebasSignMessage(id, expira) }), expira: String(expira) };
};
const verificar = (a: { address: Address; message: string; signature: Hex }) => verifyMessage(a);
check('esCredencialDeJuez: la de un juez vale', await esCredencialDeJuez({ ...(await credDe(juezA)), taskId: 1n }, jueces, verificar));
check('la del cliente, no', !(await esCredencialDeJuez({ ...(await credDe(cliente)), taskId: 1n }, jueces, verificar)));
check('la de otra tarea, no', !(await esCredencialDeJuez({ ...(await credDe(juezA, 2n)), taskId: 1n }, jueces, verificar)));
check('caducada, no', !(await esCredencialDeJuez({ ...(await credDe(juezA, 1n, -10)), taskId: 1n }, jueces, verificar)));
check('con más de 15 minutos por delante, no', !(await esCredencialDeJuez({ ...(await credDe(juezA, 1n, 3600)), taskId: 1n }, jueces, verificar)));

// ---- El agente de la plantilla ------------------------------------------------

process.env.LLM_BASE_URL = `${modelo.url}/v1`;
process.env.LLM_MODEL = 'de-mentira';
process.env.LLM_DIALECT = 'openai';
process.env.AVISOS_URL = avisos.url;
process.env.DISPUTAS_MINUTOS = '60';
const dataDir = mkdtempSync(join(tmpdir(), 'panal-agente-'));
writeFileSync(join(dataDir, 'brief-1.txt'), ENCARGO);
writeFileSync(join(dataDir, 'result-1.txt'), ENTREGA);

let lecturas = 0;
const panal = {
  indexerUrl: indexador.url,
  getArbitrators: async () => jueces,
  getTask: async () => TAREA,
  disputeFileOf: async () => EXP,
  publishEncryptionKey: async () => ({ publica: (await claveDe(agente)).publica, cambio: false }),
  readDisputeFile: async (_id: bigint, o: { tarea: TareaDelExpediente }) => {
    lecturas++;
    return leerExpediente(depsDe(agente), o.tarea);
  },
  writeToDisputeFile: (_id: bigint, p: Parameters<typeof escribirEnExpediente>[2], o: { tarea: TareaDelExpediente }) =>
    escribirEnExpediente(depsDe(agente), o.tarea, p),
  shareDisputeFileAccess: (_id: bigint, o: { tarea: TareaDelExpediente }) => darAccesosDelExpediente(depsDe(agente), o.tarea),
} as unknown as PanalClient;

const { arrancarDisputas } = await import('../create-agent/template/src/disputas');
const disputas = arrancarDisputas({
  panal,
  yo: agente.address,
  dataDir,
  briefGuardado: () => ENCARGO,
  resultadoGuardado: () => ENTREGA,
  adjuntosGuardados: () => [{ name: 'plano.pdf', bytes: PLANO }],
  // Uno anclado y otro que no: este último no tiene que salir.
  archivosEntregados: () => [
    { name: 'contrat.txt', bytes: CONTRATO, mime: 'text/plain' },
    { name: 'ajeno.txt', bytes: AJENO },
  ],
});

check('el ping de un cliente se rechaza', (await disputas.ping(1n, await credDe(cliente))) === 403);
check('el de un juez se acepta', (await disputas.ping(1n, await credDe(juezA))) === 202);

const esperar = async (cond: () => Promise<boolean>, ms = 20_000): Promise<boolean> => {
  const hasta = Date.now() + ms;
  while (Date.now() < hasta) {
    if (await cond()) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
};
const verComo = async (c: Cuenta) => (await leerExpediente(depsDe(c), EXP)).piezas;
const delAgente = (ps: PiezaAbierta[]) => ps.filter((p) => p.autor.toLowerCase() === agente.address.toLowerCase());

const listo = await esperar(async () => delAgente(await verComo(juezA)).length >= 4);
const piezas = await verComo(juezA);
const suyas = delAgente(piezas);
check('el agente escribe solo tras el ping', listo, `${suyas.length} piezas suyas`);

const encargo = suyas.find((p) => p.tipo === 'encargo');
check('aporta el encargo, y coincide con la cadena', encargo?.ancla === 'coincide' && encargo.texto === ENCARGO);
check('con su adjunto anclado', encargo?.archivos.length === 1 && encargo.archivos[0]!.name === 'plano.pdf');
const entrega = suyas.find((p) => p.tipo === 'entrega');
check('aporta la entrega, y coincide con la cadena', entrega?.ancla === 'coincide' && entrega.texto === ENTREGA);
check('solo con el archivo anclado (el otro no sale)', entrega?.archivos.map((a) => a.name).join() === 'contrat.txt', entrega?.archivos.map((a) => a.name).join());
check('sus mensajes van marcados como automáticos', suyas.filter((p) => p.tipo === 'mensaje').every((p) => p.auto));
check('el encargo y la entrega no: son el texto anclado', !encargo?.auto && !entrega?.auto);
check('su IA contesta la pregunta del juez', suyas.some((p) => p.tipo === 'mensaje' && p.texto === RESPUESTA_IA));
check('y a la petición le dice dónde está el encargo', suyas.some((p) => p.tipo === 'mensaje' && /ya está en el expediente/.test(p.texto ?? '')));
check('al cliente no le contesta: 4 piezas, ni una más', suyas.length === 4, String(suyas.length));
check('todas firmadas por su autor', piezas.every((p) => p.firmaOk));
check('el cliente lo lee todo', (await verComo(cliente)).every((p) => p.texto !== null));

// El aviso de lo que dijo el cliente sale después de la última pieza del agente: se espera.
const tiposDeAviso = () => avisos.recibido.map((x) => (JSON.parse(x) as { tipo?: string }).tipo);
await esperar(async () => ['disputa', 'pregunta', 'peticion', 'cliente'].every((t) => tiposDeAviso().includes(t)), 10_000);
const llegados = tiposDeAviso();
check('avisa al dueño: disputa, pregunta, petición y lo que dijo el cliente', ['disputa', 'pregunta', 'peticion', 'cliente'].every((t) => llegados.includes(t)), llegados.join());
const pregunta = modelo.recibido.map((x) => JSON.parse(x) as { messages?: { content: unknown }[] })[0];
const alModelo = JSON.stringify(pregunta?.messages ?? []);
check('al modelo le llegan el encargo, la entrega y la pregunta', alModelo.includes('Tradúceme') && alModelo.includes('Aquí está la traducción') && alModelo.includes('¿En qué idioma'));

// Otro ping sin nada nuevo: no contesta dos veces.
await new Promise((r) => setTimeout(r, 21_000));
const antes = lecturas;
check('otro ping del juez', (await disputas.ping(1n, await credDe(juezA))) === 202);
await esperar(async () => lecturas > antes, 10_000);
await new Promise((r) => setTimeout(r, 1500));
check('no contesta dos veces lo mismo', delAgente(await verComo(juezA)).length === 4);

// El juez B activa su clave: el agente le da acceso en su próxima vuelta.
check('el juez B, sin clave, no abre nada', (await verComo(juezB)).every((p) => p.texto === null));
await publicar(juezB);
await escribirEnExpediente(depsDe(juezB), EXP, { texto: 'Ya tengo clave. ¿Qué archivos entregaste?', para: 'trabajador' });
await new Promise((r) => setTimeout(r, 21_000));
check('ping del juez B', (await disputas.ping(1n, await credDe(juezB))) === 202);
const abre = await esperar(async () => {
  const ps = await verComo(juezB);
  return ps.find((p) => p.tipo === 'encargo')?.texto === ENCARGO;
});
check('el agente le dio acceso y el juez B abre el encargo', abre);
check('y la entrega, que coincide con la cadena', (await verComo(juezB)).find((p) => p.tipo === 'entrega')?.ancla === 'coincide');
check('y su pregunta también tiene respuesta', delAgente(await verComo(juezB)).length === 5);

disputas.parar();
for (const s of [buzon, indexador.s, modelo.s, avisos.s]) s.close();
console.log(fallos === 0 ? '\n✅ El agente se defiende solo en su disputa' : `\n❌ ${fallos} fallo(s)`);
process.exit(fallos === 0 ? 0 : 1);
