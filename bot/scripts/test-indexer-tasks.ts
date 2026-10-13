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
import { IndexStore, claveDeCampana, type IndexedEvent } from '../src/indexer-store.js';
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
  const a1 = (await (await fetch(`${baseApi}/index/board/jobs?state=posted`)).json()) as { jobs: { jobId: string }[] };
  check('/index/board/jobs?state=posted', a1.jobs.length === 1 && a1.jobs[0]!.jobId === '3', JSON.stringify(a1));
  const a2 = (await (await fetch(`${baseApi}/index/board/job?id=0`)).json()) as { job: { state: string }; task: { taskId: string } | null };
  check('/index/board/job trae su tarea', a2.job.state === 'assigned' && a2.task?.taskId === '50');
  const a3 = await fetch(`${baseApi}/index/board/jobs?state=nada`);
  check('un estado que no existe es un 400', a3.status === 400);
  const a4 = (await (await fetch(`${baseApi}/index/board/monitoring`)).json()) as {
    mismatchedSplits: { attestedRefund: string; escrowRefund: string }[];
  };
  check(
    '/index/board/monitoring, en inglés',
    a4.mismatchedSplits.length === 1 && a4.mismatchedSplits[0]!.escrowRefund === '0',
    JSON.stringify(a4),
  );
  const a5 = await fetch(`${baseApi}/index/tablon/jobs`);
  check('las rutas en español ya no existen', a5.status === 404);
  server.close();
  rmSync(dirT, { recursive: true, force: true });
}

/* ── El resto del tablón: ofertas, faltas, cobros, configuración, campañas ── */
{
  console.log('\n── Ofertas con detalle, faltas, cobros, configuración y campañas ──');
  const TABLON = '0x7ab1000000000000000000000000000000000007';
  const dirR = mkdtempSync(join(tmpdir(), 'panal-idx-resto-'));
  const st = new IndexStore(dirR, PANAL, TABLON);
  const t = (event: string, args: Record<string, string | number | boolean>, ts?: number): IndexedEvent => ({
    ...ev(event, args as Record<string, string | number>, ts),
    contract: 'tablon',
  });
  const CERO32 = `0x${'0'.repeat(64)}`;
  const UNO = '1000000000000000000';

  // La configuración que emite el constructor al desplegar.
  st.append([
    t('LevelsChanged', { levels: JSON.stringify([{ minCompleted: 5, minRating: 400, dailyCap: 1 }, { minCompleted: 30, minRating: 420, dailyCap: 5 }]) }),
    t('NewcomerJobsChanged', { jobs: 2 }),
    t('CapsChanged', { currency: NATIVO, perJob: '500000000000000000000', total: '1000000000000000000000' }),
    t('CapsChanged', { currency: PANAL, perJob: '2066000000000000000000000', total: '4133000000000000000000000' }),
    t('PausedSet', { paused: true }),
  ]);
  const cfg = st.configTablon();
  check(
    'la configuración: niveles, novatos, topes por moneda y pausa',
    cfg.levels?.length === 2 && cfg.levels[1]!.dailyCap === 5 && cfg.newcomerJobs === 2 && cfg.caps[NATIVO]?.perJob === '500000000000000000000' && cfg.caps[PANAL] !== undefined && cfg.paused,
    JSON.stringify(cfg),
  );

  // Ofertas: dos, una cambia y la otra se retira; se asigna a la más cara.
  st.append([
    t('JobPosted', { jobId: '0', client: CLIENTE, category: 3, currency: NATIVO, amount: '2000000000000000000', mode: 1, campaignId: CERO32 }),
    t('Applied', { jobId: '0', agent: AGENTE, level: 2, price: '1500000000000000000', workDuration: '3600' }),
    t('Applied', { jobId: '0', agent: OTRO, level: 1, price: UNO, workDuration: '7200' }),
    t('Applied', { jobId: '0', agent: AGENTE, level: 2, price: '1800000000000000000', workDuration: '1800' }),
  ]);
  const ofertas = st.ofertasDe('0');
  check(
    'las ofertas, de la más barata a la más cara, con la última de cada agente',
    ofertas.length === 2 && ofertas[0]!.agent === OTRO.toLowerCase() && ofertas[1]!.price === '1800000000000000000' && ofertas[1]!.workDuration === 1800,
    JSON.stringify(ofertas),
  );
  st.append([
    ev('TaskCreated', { taskId: '70', client: TABLON, worker: AGENTE, amount: '1800000000000000000', currency: NATIVO }),
    t('JobAssigned', { jobId: '0', agent: AGENTE, escrowTaskId: '70', price: '1800000000000000000', byClient: true }),
  ]);
  const j0 = st.job('0')!;
  check('al asignar se apunta cuántas había y la más barata', j0.offersAtAssignment === 2 && j0.cheapestAtAssignment === UNO);
  check('y las ofertas dejan de estar en pie', st.ofertasDe('0').length === 0);

  // Faltas y cobros.
  st.append([
    t('Strike', { agent: OTRO, strikesIn90Days: 1, suspendedUntil: 1_780_000_000 + 7 * 86_400 }),
    t('Credited', { client: CLIENTE, currency: NATIVO, amount: '500000000000000000' }),
    t('Credited', { client: CLIENTE, currency: NATIVO, amount: '200000000000000000' }),
    t('Claimed', { client: CLIENTE, currency: NATIVO, amount: '500000000000000000' }),
  ]);
  const otro = st.agenteEnElTablon(OTRO);
  check('una falta, con su suspensión', otro.faltas === 1 && otro.faltasEn90Dias === 1 && otro.suspendidoHasta === 1_780_000_000 + 7 * 86_400);
  check('lo que se le debe al cliente: lo acreditado menos lo cobrado', st.porCobrarDe(CLIENTE)[NATIVO] === '200000000000000000', JSON.stringify(st.porCobrarDe(CLIENTE)));
  check('el agente cuenta su encargo asignado', st.agenteEnElTablon(AGENTE).asignados === 1);

  // Campañas: la clave es la del contrato, byte a byte (calculada con cast).
  const DUENO = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
  const ID = '0xc8e4e9c1a06629e509692479a42ee41d208595e66c42375387882931cbc01a4b';
  check(
    'la clave de campaña es la del contrato',
    claveDeCampana(DUENO, ID) === '0xff52237ba3f72d16fe17be8086faf362513d640be2eaef7a2189fbc9748b6323',
  );
  st.append([
    t('JobPosted', { jobId: '1', client: DUENO, category: 3, currency: NATIVO, amount: UNO, mode: 0, campaignId: ID }),
    t('JobPosted', { jobId: '2', client: DUENO, category: 3, currency: NATIVO, amount: UNO, mode: 0, campaignId: ID }),
    ev('TaskCreated', { taskId: '71', client: TABLON, worker: AGENTE, amount: UNO, currency: NATIVO }),
    t('JobAssigned', { jobId: '1', agent: AGENTE, escrowTaskId: '71', price: UNO, byClient: false }),
  ]);
  const clave = claveDeCampana(DUENO, ID);
  check('la campaña: dos encargos, uno cogido por el agente, tope aún sin leer', st.campana(clave)?.jobs === 2 && st.campana(clave)?.tomados[AGENTE.toLowerCase()] === 1 && st.campana(clave)?.cap === null);
  check('y el indexador sabe que tiene que leer su tope', st.campanasSinTope().includes(clave));
  st.marcarTopeDeCampana(clave, 2);
  check('una vez leído', st.campana(clave)?.cap === 2 && st.campanasSinTope().length === 0);

  console.log('\n── Las métricas del periodo (BOARD.md §10.1) ──');
  st.append([
    t('JobPosted', { jobId: '3', client: CLIENTE, category: 7, currency: PANAL, amount: '100000000000000000000', mode: 1, campaignId: CERO32 }),
    t('JobExpired', { jobId: '3' }),
    t('Strike', { agent: AGENTE, strikesIn90Days: 3, suspendedUntil: 1_780_000_000 + 30 * 86_400 }),
  ]);
  const m = st.metricasTablon(1_780_000_000, 1_780_000_000 + 86_400);
  check('publicados, asignados y caducados', m.volumen.publicados === 4 && m.volumen.asignados === 2 && m.volumen.caducados === 1, JSON.stringify(m.volumen));
  check('elegido por el cliente sin ser la más barata', m.eleccion.porElCliente === 1 && m.eleccion.automatica === 1 && m.eleccion.noLaMasBarata === 1, JSON.stringify(m.eleccion));
  check('la mitad de los de selección sin ninguna oferta', m.competencia.sinOfertaParte === 0.5 && m.competencia.medianaOfertas === 2, JSON.stringify(m.competencia));
  check('el precio elegido entre el presupuesto: 0,9', m.competencia.medianaPrecioSobrePresupuesto === 0.9);
  check('una suspensión de 7 días y otra de 30, de dos agentes', m.sanciones.suspensiones7 === 1 && m.sanciones.suspensiones30 === 1 && m.sanciones.agentes === 2, JSON.stringify(m.sanciones));
  const cat7 = m.porCategoria.find((c) => c.categoria === 7);
  check('por categoría: la 7 con un encargo sin oferta, en $PANAL', cat7?.encargos === 1 && cat7.sinOferta === 1 && cat7.medianaPorMoneda['$PANAL'] === '100000000000000000000', JSON.stringify(m.porCategoria));
  check('fuera del periodo, nada', st.metricasTablon(1_700_000_000, 1_700_000_001).volumen.publicados === 0);

  console.log('\n── La vigilancia: de ida y vuelta, y solo los últimos 90 días ──');
  const A = '0xA100000000000000000000000000000000000001';
  const B = '0xB200000000000000000000000000000000000002';
  const ahora = 1_780_000_000 + 30 * 86_400;
  const lote: IndexedEvent[] = [];
  for (let i = 0; i < 3; i++) {
    for (const [cliente, trabajador] of [[A, B], [B, A]] as const) {
      const id = `${cliente === A ? 300 : 400}${i}`;
      lote.push(
        ev('TaskCreated', { taskId: id, client: cliente, worker: trabajador, amount: UNO, currency: NATIVO }),
        ev('TaskCompleted', { taskId: id, worker: trabajador, workerPaid: '975000000000000000', fee: '25000000000000000', rating: 5 }),
      );
    }
  }
  st.append(lote);
  const v = st.vigilancia(ahora);
  check('A y B se contratan el uno al otro', v.cruzados.length === 1 && v.cruzados[0]!.aParaB === 3 && v.cruzados[0]!.bParaA === 3, JSON.stringify(v.cruzados));
  check('pasados 90 días ya no cuenta', st.vigilancia(ahora + 120 * 86_400).cruzados.length === 0);

  console.log('\n── Y su API ──');
  const server = createIndexServer({ store: st, allowLocalhostOrigin: true });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const dirS = server.address();
  const base = `http://127.0.0.1:${typeof dirS === 'object' && dirS ? dirS.port : 0}`;
  const pedir = async (ruta: string) => {
    const r = await fetch(`${base}${ruta}`);
    return { status: r.status, body: (await r.json()) as Record<string, unknown> };
  };
  const r1 = await pedir('/index/board/job?id=1');
  check('/job trae su campaña, con lo cogido en inglés', (r1.body.campaign as { key?: string; taken?: object } | null)?.key === clave && 'taken' in (r1.body.campaign as object));
  const r2 = await pedir(`/index/board/agent?address=${OTRO}`);
  check('/agent', r2.status === 200 && r2.body.strikes === 1 && r2.body.strikesIn90Days === 1 && 'suspendedUntil' in r2.body, JSON.stringify(r2.body));
  const r3 = await pedir(`/index/board/client?address=${CLIENTE}`);
  check('/client, con lo que se le debe', (r3.body.owed as Record<string, string>)[NATIVO] === '200000000000000000');
  const r4 = await pedir('/index/board/config');
  check('/config', r4.body.paused === true && r4.body.newcomerJobs === 2);
  const r5 = await pedir(`/index/board/campaigns?owner=${DUENO}`);
  check('/campaigns de un dueño', r5.body.count === 1 && Array.isArray(r5.body.campaigns));
  const r6 = await pedir(`/index/board/campaign?key=${clave}`);
  check('/campaign', r6.status === 200 && r6.body.cap === 2);
  const r7 = await pedir('/index/board/metrics?from=1780000000&to=1780086400');
  const vol = r7.body.volume as { posted: number; postedByCoin: Record<string, string> } | undefined;
  check('/metrics, en inglés', r7.status === 200 && vol?.posted === 4 && !!vol.postedByCoin && 'byCategory' in r7.body, JSON.stringify(r7.body).slice(0, 200));
  const r8 = await pedir('/index/board/metrics?from=5&to=1');
  check('/metrics con fechas al revés es un 400', r8.status === 400);
  server.close();
  rmSync(dirR, { recursive: true, force: true });
}

console.log(
  failures === 0
    ? '\n✅ El indice encuentra las tareas de una direccion sin recorrerlas todas'
    : `\n❌ ${failures} comprobacion(es) fallaron`,
);
process.exit(failures === 0 ? 0 : 1);
