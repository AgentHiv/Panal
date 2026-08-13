/**
 * Pruebas del índice de tareas por dirección (`src/indexer-store.ts`).
 *
 *   npx tsx scripts/test-indexer-tasks.ts     (o: pnpm test:indexer-tasks)
 *
 * HERMÉTICO: sin red, sin cadena. Los eventos se escriben a mano aquí.
 *
 * Por qué existe esto. El panel buscaba las tareas de una persona escaneando
 * las 200 últimas del escrow y filtrando en el navegador. Con 200 tareas en
 * total funcionaba; a partir de ahí, quien contrató ayer deja de ver la suya
 * y no puede aprobarla, disputarla ni descargarse su resultado — y a las 72 h
 * el pago se libera solo sin que se haya enterado. Por eso el índice inverso.
 *
 * Lo que se comprueba es que una tarea es lo que queda DESPUÉS de aplicarle
 * sus eventos por orden, que es donde está la dificultad: el estado no viene
 * en ninguno de ellos, se deduce de la secuencia.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IndexStore, type IndexedEvent } from '../src/indexer-store.js';

let failures = 0;

function check(label: string, condition: boolean, detail = ''): void {
  if (condition) console.log(`✅ ${label}${detail ? `: ${detail}` : ''}`);
  else {
    failures += 1;
    console.error(`❌ ${label}${detail ? `: ${detail}` : ''}`);
  }
}

const PANAL = '0x2e2e44e7fa6178822d4397299f719e89d1a67777';
const NATIVO = '0x0000000000000000000000000000000000000000';
const CLIENTE = '0xAAaA000000000000000000000000000000000001';
const AGENTE = '0xBbbb000000000000000000000000000000000002';
const OTRO = '0xCccc000000000000000000000000000000000003';

let n = 0;
function ev(event: string, args: Record<string, string | number>, ts = 1_780_000_000): IndexedEvent {
  n += 1;
  return {
    id: `0x${n.toString(16).padStart(64, '0')}-0`,
    contract: 'escrow',
    event,
    blockNumber: n,
    logIndex: 0,
    txHash: `0x${n.toString(16).padStart(64, '0')}`,
    ts: ts + n,
    args,
  };
}

const dir = mkdtempSync(join(tmpdir(), 'panal-idx-'));
const store = new IndexStore(dir, PANAL);

console.log('── El ciclo normal: se crea, se entrega, se aprueba ──');

store.append([
  ev('TaskCreated', { taskId: '1', client: CLIENTE, worker: AGENTE, amount: '10000000000000000', currency: NATIVO }),
]);
let t = store.task('1')!;
check('nace abierta', t.status === 'open', t.status);
check('con su cliente y su trabajador', t.client === CLIENTE.toLowerCase() && t.worker === AGENTE.toLowerCase());
check('la moneda se traduce', t.coin === 'MON', t.coin);

store.append([ev('TaskDelivered', { taskId: '1', resultHash: '0xdead' })]);
check('entregada pasa a delivered', store.task('1')!.status === 'delivered');
check('y guarda el hash del resultado', store.task('1')!.resultHash === '0xdead');

store.append([ev('TaskCompleted', { taskId: '1', worker: AGENTE, workerPaid: '9750000000000000', fee: '250000000000000', rating: 5 })]);
check('aprobada pasa a completed', store.task('1')!.status === 'completed');
check('con su nota', store.task('1')!.rating === 5);

console.log('\n── Aparece para las DOS partes ──');

check('el cliente la encuentra', store.tasksOf(CLIENTE).length === 1);
check('el trabajador también', store.tasksOf(AGENTE).length === 1);
check('un tercero no', store.tasksOf(OTRO).length === 0);
check('filtrando por rol de cliente', store.tasksOf(CLIENTE, { role: 'client' }).length === 1);
check('el cliente no sale como trabajador', store.tasksOf(CLIENTE, { role: 'worker' }).length === 0);

console.log('\n── Los caminos que no acaban bien ──');

store.append([
  ev('TaskCreated', { taskId: '2', client: CLIENTE, worker: AGENTE, amount: '1000000000000000000', currency: PANAL }),
  ev('TaskDelivered', { taskId: '2', resultHash: '0xbeef' }),
  ev('TaskDisputed', { taskId: '2', openedBy: CLIENTE }),
]);
check('una disputa se ve como disputed', store.task('2')!.status === 'disputed');
check('y la moneda del token también se traduce', store.task('2')!.coin === '$PANAL', store.task('2')!.coin);

// Una entrega DESPUÉS de disputar no puede devolverla a "entregada": si lo
// hiciera, el panel dejaría de ofrecer la disputa que ya está abierta.
store.append([ev('TaskDelivered', { taskId: '2', resultHash: '0xbeef2' })]);
check('una entrega posterior no deshace la disputa', store.task('2')!.status === 'disputed');

store.append([
  ev('TaskCreated', { taskId: '3', client: CLIENTE, worker: AGENTE, amount: '10000000000000000', currency: NATIVO }),
  ev('TaskCancelled', { taskId: '3' }),
]);
check('una cancelada se ve como cancelled', store.task('3')!.status === 'cancelled');

console.log('\n── Una tarea abierta a cualquiera ──');

// worker = address(0) al nacer, y alguien la reclama después. Si el reclamo no
// atara al trabajador, la tarea no aparecería nunca en SUS tareas.
store.append([
  ev('TaskCreated', { taskId: '4', client: CLIENTE, worker: NATIVO, amount: '10000000000000000', currency: NATIVO }),
]);
check('sin trabajador, el agente todavía no la ve', store.tasksOf(AGENTE).length === 3);
store.append([ev('TaskClaimed', { taskId: '4', worker: AGENTE })]);
check('al reclamarla ya la ve', store.tasksOf(AGENTE).length === 4);
check('y queda anotado como su trabajador', store.task('4')!.worker === AGENTE.toLowerCase());

console.log('\n── El orden y el tope ──');

const todas = store.tasksOf(CLIENTE);
check('llegan de la más reciente a la más antigua', todas[0]!.taskId === '4' && todas[todas.length - 1]!.taskId === '1', todas.map((x) => x.taskId).join(' > '));
check('el tope recorta', store.tasksOf(CLIENTE, { limit: 2 }).length === 2);

console.log('\n── Sobrevive a un reinicio ──');

// El almacén se reconstruye rejugando events.jsonl. Si el índice de tareas no
// se rehiciera ahí, el panel se quedaría vacío cada vez que el proceso
// arranca, que es justo cuando más falta hace.
const store2 = new IndexStore(dir, PANAL);
check('las tareas se rehacen al releer el log', store2.tasksOf(CLIENTE).length === 4, `${store2.tasksOf(CLIENTE).length}`);
check('con su estado', store2.task('2')?.status === 'disputed');

console.log('\n── El catalogo: paginado y buscable ──');

// Las fichas NO salen de los eventos (AgentRegistered no lleva el metadata),
// asi que aqui se meten a mano, que es lo que hace `refrescarFichas` tras
// leerlas del registry.
const ficha = (n: number, name: string, skills: string[], active = true) => ({
  address: `0xdddd${String(n).padStart(36, '0')}`,
  owner: `0xdddd${String(n).padStart(36, '0')}`,
  name,
  description: `Hace ${name} muy bien`,
  skills,
  botUrl: `https://${name.toLowerCase()}.example`,
  pricePerTask: '10000000000000000',
  currency: NATIVO,
  coin: 'MON',
  active,
  registeredAt: 1_700_000_000 + n,
  fetchedTs: 1_700_000_100,
});
store.upsertProfile(ficha(1, 'Lint', ['code', 'review', 'seguridad']));
store.upsertProfile(ficha(2, 'Parse', ['json', 'datos', 'extraccion']));
store.upsertProfile(ficha(3, 'LexPanal', ['legal', 'contratos']));
store.upsertProfile(ficha(4, 'Viejo', ['legal'], false));

check('el catalogo excluye a los dados de baja', store.catalogo().total === 3, `${store.catalogo().total}`);
check('salvo que se pidan', store.catalogo({ includeInactive: true }).total === 4);

check('buscar por skill encuentra', store.catalogo({ skill: 'legal' }).total === 1);
check('y no se cuela por la descripcion', store.catalogo({ skill: 'muy bien' }).total === 0);
check('la busqueda libre SI mira la descripcion', store.catalogo({ q: 'muy bien' }).total === 3);
check('con dos palabras tienen que estar las dos', store.catalogo({ q: 'json datos' }).total === 1);
check('y si una no esta, no sale', store.catalogo({ q: 'json legal' }).total === 0);

const p1 = store.catalogo({ limit: 2, offset: 0 });
const p2 = store.catalogo({ limit: 2, offset: 2 });
check('pagina 1 trae 2', p1.agents.length === 2);
check('pagina 2 trae el resto', p2.agents.length === 1);
check('el total es el mismo en las dos', p1.total === 3 && p2.total === 3);
check(
  'y ninguna se repite entre paginas',
  new Set([...p1.agents, ...p2.agents].map((a) => a.address)).size === 3,
);

check(
  'cada ficha viene con sus stats si las tiene',
  store.catalogo({ q: 'Lint' }).agents[0]!.stats === null,
  'sin actividad todavia: null, no un cero inventado',
);

rmSync(dir, { recursive: true, force: true });

console.log(
  failures === 0
    ? '\n✅ El indice encuentra las tareas de una direccion sin recorrerlas todas'
    : `\n❌ ${failures} comprobacion(es) fallaron`,
);
process.exit(failures === 0 ? 0 : 1);
