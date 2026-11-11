/**
 * La reputación que no se puede comprar: con cuántos clientes distintos
 * trabaja cada agente y su nota contando a cada uno una vez
 * (`contrapartes()` en `src/indexer-store.ts`).
 *
 *   npx tsx scripts/test-clientes.ts
 *
 * HERMÉTICO: sin red ni cadena. Los eventos se escriben a mano.
 *
 * El caso que lo motivó (noviembre de 2026): un agente nuevo con veinte
 * encargos de 0,01 MON, uno cada ocho minutos, casi todos de la misma wallet, y
 * cinco estrellas en cada uno. La media de la cadena decía 5,0; lo que no decía
 * es que eso lo había pagado una sola cuenta.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IndexStore, type IndexedEvent } from '../src/indexer-store.js';

let fallos = 0;
const check = (nombre: string, ok: boolean, detalle = ''): void => {
  console.log(`${ok ? '✅' : '❌'} ${nombre}${ok ? '' : ` — ${detalle}`}`);
  if (!ok) fallos++;
};

const PANAL = '0x2e2e44e7fa6178822d4397299f719e89d1a67777';
const NATIVO = '0x0000000000000000000000000000000000000000';
const TABLON = '0x7ab1000000000000000000000000000000000007';
const AGENTE = '0xAAaA00000000000000000000000000000000000a';
const OTRO_AGENTE = '0xBbbB00000000000000000000000000000000000b';
const MISMA = '0xC100000000000000000000000000000000000001';
const SEGUNDA = '0xC200000000000000000000000000000000000002';
const TERCERA = '0xC300000000000000000000000000000000000003';
const DEL_TABLON = '0xC400000000000000000000000000000000000004';

let n = 0;
const ev = (event: string, args: Record<string, string | number>, contract = 'escrow'): IndexedEvent => {
  n += 1;
  const h = `0x${n.toString(16).padStart(64, '0')}`;
  return { id: `${h}-0`, contract, event, blockNumber: n, logIndex: 0, txHash: h, ts: 1_790_000_000 + n * 60, args };
};
let tarea = 0;
/** Un encargo completo: creado, entregado y aprobado con su nota (o sin nota). */
function encargo(cliente: string, agente: string, nota?: number): IndexedEvent[] {
  tarea += 1;
  const id = String(tarea);
  return [
    ev('TaskCreated', { taskId: id, client: cliente, worker: agente, amount: '10000000000000000', currency: NATIVO }),
    ev('TaskDelivered', { taskId: id, resultHash: `0x${'ab'.repeat(32)}` }),
    ev('TaskCompleted', {
      taskId: id,
      worker: agente,
      workerPaid: '9750000000000000',
      fee: '250000000000000',
      ...(nota !== undefined ? { rating: nota } : {}),
    }),
  ];
}

const dir = mkdtempSync(join(tmpdir(), 'panal-clientes-'));
try {
  const store = new IndexStore(dir, PANAL, TABLON);

  console.log('\n─── el caso de noviembre: casi todo de una misma wallet ───');
  // Diez encargos de la misma wallet con cinco estrellas, y uno de otra con un tres.
  for (let i = 0; i < 10; i++) store.append(encargo(MISMA, AGENTE, 5));
  store.append(encargo(SEGUNDA, AGENTE, 3));
  const a = store.agentStats().find((s) => s.address === AGENTE.toLowerCase())!;
  check('la media de la cadena sigue siendo la de siempre', Math.abs(a.avgRating! - 53 / 11) < 1e-9, String(a.avgRating));
  check('dos clientes distintos', a.clients === 2, String(a.clients));
  check('los dos dejaron nota', a.ratedClients === 2);
  check('la nota por cliente cuenta a cada uno una vez: (5 + 3) / 2', a.clientRating === 4, String(a.clientRating));
  check('y el cliente principal pagó 10 de 11', Math.abs(a.topClientShare! - 10 / 11) < 1e-9, String(a.topClientShare));

  console.log('\n─── lo que no cuenta ───');
  // Una completada sin nota (liberada sin que el cliente puntuara) suma cliente, no nota.
  store.append(encargo(TERCERA, AGENTE));
  const b = store.agentStats().find((s) => s.address === AGENTE.toLowerCase())!;
  check('una completada sin nota suma un cliente', b.clients === 3 && b.ratedClients === 2);
  check('pero no mueve la nota por cliente', b.clientRating === 4);
  // Una tarea creada y no completada no es un cliente que haya pagado.
  store.append([ev('TaskCreated', { taskId: '999', client: TERCERA, worker: OTRO_AGENTE, amount: '10000000000000000', currency: NATIVO })]);
  const otro = store.agentStats().find((s) => s.address === OTRO_AGENTE.toLowerCase())!;
  check('sin completadas, cero clientes y sin nota', otro.clients === 0 && otro.clientRating === null && otro.topClientShare === null);

  console.log('\n─── el tablón: el cliente es el del encargo ───');
  // En el escrow, el cliente de una tarea del tablón es el contrato; el de
  // verdad está en el encargo, y el índice lo ata DESPUÉS (JobAssigned).
  tarea += 1;
  const idT = String(tarea);
  store.append([
    ev('JobPosted', { jobId: '0', client: DEL_TABLON, category: 2, currency: NATIVO, amount: '10000000000000000', mode: 0, campaignId: `0x${'0'.repeat(64)}` }, 'tablon'),
    ev('TaskCreated', { taskId: idT, client: TABLON, worker: AGENTE, amount: '10000000000000000', currency: NATIVO }),
    ev('JobAssigned', { jobId: '0', agent: AGENTE, escrowTaskId: idT, price: '10000000000000000', byClient: false }, 'tablon'),
    ev('TaskDelivered', { taskId: idT, resultHash: `0x${'cd'.repeat(32)}` }),
    ev('TaskCompleted', { taskId: idT, worker: AGENTE, workerPaid: '9750000000000000', fee: '250000000000000', rating: 4 }),
  ]);
  const c = store.agentStats().find((s) => s.address === AGENTE.toLowerCase())!;
  check('cuenta al cliente del encargo, no al contrato', c.clients === 4 && c.ratedClients === 3, `${c.clients}/${c.ratedClients}`);
  check('y su nota entra en la media por cliente: (5 + 3 + 4) / 3', c.clientRating === 4, String(c.clientRating));

  console.log('\n─── las mismas cifras por todas las puertas ───');
  store.upsertProfile({
    address: AGENTE.toLowerCase(),
    owner: AGENTE.toLowerCase(),
    name: 'Agente',
    description: 'Prueba',
    skills: [],
    botUrl: null,
    metadataURI: '',
    pricePerTask: '10000000000000000',
    currency: NATIVO,
    coin: 'MON',
    active: true,
    registeredAt: 1,
    fetchedTs: 1,
  });
  const suelto = store.agente(AGENTE)!;
  check('/index/agent trae las mismas', suelto.stats?.clients === 4 && suelto.stats?.clientRating === 4);
  const enCatalogo = store.catalogo({}).agents.find((x) => x.address === AGENTE.toLowerCase())!;
  check('y el catálogo también', enCatalogo.stats?.clients === 4 && enCatalogo.stats?.topClientShare === c.topClientShare);

  console.log('\n─── tras reiniciar ───');
  const otraVez = new IndexStore(dir, PANAL, TABLON);
  const r = otraVez.agentStats().find((s) => s.address === AGENTE.toLowerCase())!;
  check('se rehacen igual al releer el registro de eventos', r.clients === 4 && r.clientRating === 4);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log(fallos === 0 ? '\n✅ La reputación cuenta clientes, no solo estrellas\n' : `\n❌ ${fallos} comprobación(es) fallidas\n`);
process.exit(fallos === 0 ? 0 : 1);
