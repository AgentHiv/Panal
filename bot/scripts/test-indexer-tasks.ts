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
import { createIndexServer } from '../src/indexer-http.js';
import { TABLON_EVENTS } from '../src/indexer.js';
import { toEventSelector } from 'viem';
// El ABI generado del contrato, el mismo que usa el SDK: sin dependencias, se
// importa tal cual aunque el bot sea otro paquete.
import { panalTablonAbi } from '../../sdk/src/tablon-abi.js';

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
const t = store.task('1')!;
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

/* ── El tablón con reglas (PanalTablon) ─────────────────────────────────── */
{
  console.log('\n── El tablón con reglas: el encargo y su cliente de verdad ──');
  const TABLON = '0x7ab1000000000000000000000000000000000007';
  const W = '0xD000000000000000000000000000000000000004';
  const dirT = mkdtempSync(join(tmpdir(), 'panal-idx-tablon-'));
  const st = new IndexStore(dirT, PANAL, TABLON);
  const delTablon = (event: string, args: Record<string, string | number | boolean>, ts?: number): IndexedEvent => ({
    ...ev(event, args as Record<string, string | number>, ts),
    contract: 'tablon',
  });
  const DIEZ = '10000000000000000000';
  const OCHO = '8000000000000000000';

  st.append([
    delTablon('JobPosted', { jobId: '0', client: CLIENTE, category: 2, currency: NATIVO, amount: DIEZ, mode: 1, campaignId: `0x${'0'.repeat(64)}` }),
    delTablon('Applied', { jobId: '0', agent: AGENTE, level: 2, price: OCHO, workDuration: '3600' }),
    delTablon('Applied', { jobId: '0', agent: OTRO, level: 1, price: DIEZ, workDuration: '3600' }),
    delTablon('Applied', { jobId: '0', agent: AGENTE, level: 2, price: OCHO, workDuration: '1800' }),
    delTablon('OfferWithdrawn', { jobId: '0', agent: OTRO }),
  ]);
  let j = st.job('0')!;
  check('publicado, en selección, en su categoría', j.state === 'posted' && j.mode === 'selection' && j.category === 2);
  check('cambiar una oferta no cuenta dos; retirarla, resta', j.offers === 1, String(j.offers));
  check('sin campaña, null y no ceros', j.campaignId === null);

  // En la misma transacción, el escrow emite TaskCreated antes que el tablón JobAssigned.
  st.append([
    ev('TaskCreated', { taskId: '50', client: TABLON, worker: AGENTE, amount: OCHO, currency: NATIVO }),
    delTablon('JobAssigned', { jobId: '0', agent: AGENTE, escrowTaskId: '50', price: OCHO, byClient: true }),
  ]);
  j = st.job('0')!;
  check('asignado, al precio de la oferta', j.state === 'assigned' && j.amount === OCHO && j.budget === DIEZ && j.offers === 0);
  const tarea = st.task('50')!;
  check('la tarea del escrow sabe de qué encargo es y quién es su cliente', tarea.jobId === '0' && tarea.realClient === CLIENTE.toLowerCase());
  check('y el cliente de verdad la encuentra en «mis tareas»', st.tasksOf(CLIENTE, { role: 'client' }).some((t) => t.taskId === '50'));

  // Al revés: si el JobAssigned se ve antes que su TaskCreated (barrido), también.
  st.append([
    delTablon('JobPosted', { jobId: '1', client: CLIENTE, category: 2, currency: NATIVO, amount: DIEZ, mode: 0, campaignId: `0x${'0'.repeat(64)}` }),
    delTablon('JobAssigned', { jobId: '1', agent: AGENTE, escrowTaskId: '51', price: DIEZ, byClient: false }),
    ev('TaskCreated', { taskId: '51', client: TABLON, worker: AGENTE, amount: DIEZ, currency: NATIVO }),
  ]);
  check('en cualquier orden', st.task('51')!.realClient === CLIENTE.toLowerCase());

  // Una tarea cuyo cliente en el escrow NO es el tablón no se le atribuye a nadie.
  st.append([
    delTablon('JobPosted', { jobId: '9', client: OTRO, category: 2, currency: NATIVO, amount: DIEZ, mode: 0, campaignId: `0x${'0'.repeat(64)}` }),
    delTablon('JobAssigned', { jobId: '9', agent: AGENTE, escrowTaskId: '1', price: DIEZ, byClient: false }),
  ]);
  check('una tarea ajena al tablón no cambia de cliente', st.task('1') === null || st.task('1')!.realClient === undefined);

  console.log('\n── Cerrar, volver a publicar, retirar, caducar ──');
  st.append([
    delTablon('JobPosted', { jobId: '3', client: CLIENTE, category: 2, currency: NATIVO, amount: DIEZ, mode: 0, campaignId: `0x${'0'.repeat(64)}` }),
    ev('TaskCreated', { taskId: '53', client: TABLON, worker: AGENTE, amount: DIEZ, currency: NATIVO }),
    delTablon('JobAssigned', { jobId: '3', agent: AGENTE, escrowTaskId: '53', price: DIEZ, byClient: false }),
    ev('TaskCancelled', { taskId: '53' }),
    delTablon('JobSettled', { jobId: '3', refundToClient: '0', penalized: true }),
    delTablon('JobRelisted', { jobId: '3' }),
  ]);
  j = st.job('3')!;
  check('sin entrega y con republicar: otra vez publicado y sin agente', j.state === 'posted' && j.relisted === 1 && j.agent === undefined);
  check(
    'y sin nada de la ronda anterior: ni sanción, ni devolución, ni fecha de asignación',
    j.penalized === undefined && j.refund === undefined && j.assignedTs === undefined && j.amount === j.budget,
    JSON.stringify(j),
  );
  st.append([
    delTablon('JobPosted', { jobId: '4', client: CLIENTE, category: 5, currency: PANAL, amount: DIEZ, mode: 0, campaignId: `0x${'ab'.repeat(32)}` }),
    delTablon('JobWithdrawn', { jobId: '4' }),
  ]);
  check('retirado', st.job('4')!.state === 'withdrawn' && st.job('4')!.coin === '$PANAL' && st.job('4')!.campaignId !== null);
  check('los filtros: por estado y por categoría', st.jobs({ state: 'posted' }).length === 1 && st.jobs({ category: 5 }).length === 1);

  st.append([delTablon('CategoriesSet', { agent: AGENTE, categories: '[0,2]' })]);
  check('las categorías de un agente, de su JSON', st.categoriasDe(AGENTE).join() === '0,2', st.categoriasDe(AGENTE).join());

  console.log('\n── La vigilancia (TABLON-SECURITY.md) ──');
  const ahora = 1_780_000_000 + 30 * 86_400;
  // Disputa de la tarea 50: el árbitro da el 30 % al agente → al cliente, 5,6.
  st.append([
    ev('TaskDelivered', { taskId: '50', resultHash: '0x01' }),
    ev('TaskDisputed', { taskId: '50', openedBy: CLIENTE }, ahora - 9 * 86_400),
    ev('TaskDisputed', { taskId: '51', openedBy: CLIENTE }, ahora - 3 * 86_400),
  ]);
  let v = st.vigilancia(ahora);
  check('una disputa de 9 días salta; una de 3, no', v.disputasLargas.length === 1 && v.disputasLargas[0]!.taskId === '50', JSON.stringify(v.disputasLargas));
  check('y dice de qué encargo es', v.disputasLargas[0]?.jobId === '0');

  st.append([
    ev('DisputeResolved', { taskId: '50', workerPaid: '2340000000000000000', clientRefunded: '5600000000000000000', rating: 3 }),
    delTablon('ResolutionAttested', { jobId: '0', workerShareBps: '3000' }),
  ]);
  v = st.vigilancia(ahora);
  check('un reparto que cuadra con el escrow no salta', v.repartosDistintos.length === 0, JSON.stringify(v.repartosDistintos));
  check('y la disputa resuelta deja de contar', v.disputasLargas.length === 0);

  st.append([
    ev('TaskDelivered', { taskId: '51', resultHash: '0x02' }),
    ev('DisputeResolved', { taskId: '51', workerPaid: '9750000000000000000', clientRefunded: '0', rating: 4 }),
    delTablon('ResolutionAttested', { jobId: '1', workerShareBps: '0' }),
  ]);
  v = st.vigilancia(ahora);
  check(
    'uno que devuelve todo cuando el escrow no devolvió nada, salta',
    v.repartosDistintos.length === 1 && v.repartosDistintos[0]!.jobId === '1' && v.repartosDistintos[0]!.atestado === DIEZ,
    JSON.stringify(v.repartosDistintos),
  );

  // F7: diez completadas para W, nueve del mismo cliente.
  const lote: IndexedEvent[] = [];
  for (let i = 0; i < 10; i++) {
    const id = String(100 + i);
    lote.push(
      ev('TaskCreated', { taskId: id, client: i < 9 ? CLIENTE : OTRO, worker: W, amount: '1000000000000000', currency: NATIVO }),
      ev('TaskCompleted', { taskId: id, worker: W, workerPaid: '975000000000000', fee: '25000000000000', rating: 5 }),
    );
  }
  st.append(lote);
  v = st.vigilancia(ahora);
  const pareja = v.parejas.find((p) => p.agente === W.toLowerCase());
  check('un agente con el 90 % de un solo cliente, salta', !!pareja && pareja.parte === 0.9 && pareja.clientes === 2, JSON.stringify(v.parejas));
  check('uno con dos completadas no (hacen falta diez)', !v.parejas.some((p) => p.agente === AGENTE.toLowerCase()));

  console.log('\n── Los eventos que pide el indexador son los del contrato ──');
  // Si una firma no cuadra, getLogs no devuelve ese evento y nada falla: el
  // tablón simplemente no se indexaría. Se compara con el ABI real.
  const delContrato = new Set(
    panalTablonAbi.filter((x) => x.type === 'event').map((x) => toEventSelector(x as Parameters<typeof toEventSelector>[0])),
  );
  const fuera = TABLON_EVENTS.filter((e) => !delContrato.has(toEventSelector(e))).map((e) => e.name);
  check(
    `las ${TABLON_EVENTS.length} firmas existen en PanalTablon`,
    fuera.length === 0,
    fuera.join(', '),
  );
  const sinIndexar = panalTablonAbi
    .filter((x) => x.type === 'event' && x.name !== 'OwnershipTransferred')
    .filter((x) => !TABLON_EVENTS.some((e) => e.name === x.name))
    .map((x) => x.name);
  check('y no se deja ninguno del contrato', sinIndexar.length === 0, sinIndexar.join(', '));

  console.log('\n── La API ──');
  const server = createIndexServer({ store: st, allowLocalhostOrigin: true });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const dirS = server.address();
  const baseApi = `http://127.0.0.1:${typeof dirS === 'object' && dirS ? dirS.port : 0}`;
  const a1 = (await (await fetch(`${baseApi}/index/tablon/jobs?state=posted`)).json()) as { jobs: { jobId: string }[] };
  check('/index/tablon/jobs?state=posted', a1.jobs.length === 1 && a1.jobs[0]!.jobId === '3', JSON.stringify(a1));
  const a2 = (await (await fetch(`${baseApi}/index/tablon/job?id=0`)).json()) as { job: { state: string }; task: { taskId: string } | null };
  check('/index/tablon/job trae su tarea', a2.job.state === 'assigned' && a2.task?.taskId === '50');
  const a3 = await fetch(`${baseApi}/index/tablon/jobs?state=nada`);
  check('un estado que no existe es un 400', a3.status === 400);
  const a4 = (await (await fetch(`${baseApi}/index/tablon/vigilancia`)).json()) as { repartosDistintos: unknown[] };
  check('/index/tablon/vigilancia', a4.repartosDistintos.length === 1);
  server.close();
  rmSync(dirT, { recursive: true, force: true });
}

console.log(
  failures === 0
    ? '\n✅ El indice encuentra las tareas de una direccion sin recorrerlas todas'
    : `\n❌ ${failures} comprobacion(es) fallaron`,
);
process.exit(failures === 0 ? 0 : 1);
