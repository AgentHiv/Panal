/**
 * El tablón con reglas de punta a punta, con el SDK, contra una copia de
 * mainnet.
 *
 *   cd contracts && forge build && cd ../sdk && npx tsx test/tablon-fork.ts
 *
 * NECESITA ANVIL (Foundry), y por eso no va en `npm test`: arranca uno con una
 * copia de Monad mainnet, despliega PanalTablon delante del escrow v2 REAL con
 * el bytecode que compila Foundry, y hace el circuito entero solo con los
 * métodos del cliente:
 *
 *   1. Un agente nuevo se registra en el registry real y declara su categoría.
 *   2. Un cliente publica un encargo inmediato en MON, y su anuncio y su
 *      encargo quedan en el BUZÓN de verdad (bot/src/buzon.ts, arrancado aquí
 *      mismo). El agente lo ve en la lista con su anuncio, pregunta si puede,
 *      lo coge, lee el encargo y entrega; el cliente se descarga la entrega,
 *      aunque en el escrow su cliente sea el contrato, y aprueba.
 *   3. Un segundo encargo, en selección: el agente oferta por debajo del
 *      presupuesto, el cliente elige, la diferencia se le debe y la cobra.
 *   4. Lo que se rechaza dice por qué antes de firmar: un novato con un
 *      encargo abierto no puede coger otro.
 *   5. El INDEXADOR de verdad (bot/src/indexer.ts) recorre los bloques desde
 *      el despliegue y monta cada encargo, ata cada tarea del escrow a su
 *      cliente de verdad y lee las categorías del agente.
 *   6. La FOTO DEL MES (scripts/foto-del-mes.ts) del mes en curso, adelantando
 *      el reloj al siguiente: la tabla del tablón sale de ese indexador, con
 *      los dólares del bloque del corte, y las tareas del tablón cuentan para
 *      su cliente de verdad y no para el contrato.
 *
 * Las claves son las de prueba de anvil: no tienen nada fuera de la copia.
 */

import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync, writeFileSync } from 'node:fs';
import { createPublicClient, createWalletClient, http, keccak256, parseEther, toBytes, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { monad } from 'viem/chains';
import { createPanalClient } from '../src/client.js';
import { MAINNET_ADDRESSES } from '../src/chains.js';
import { escrowAbi } from '../src/abis.js';
import { EstadoTablon, ModoTablon } from '../src/tablon-reglas.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBuzonServer } from '../../bot/src/buzon.js';
import { BuzonStore } from '../../bot/src/buzon-store.js';
import { createClients } from '../../bot/src/chain.js';
import type { BotConfig } from '../../bot/src/config.js';
import { runIndexer } from '../../bot/src/indexer.js';
import { IndexStore } from '../../bot/src/indexer-store.js';
import { createIndexServer } from '../../bot/src/indexer-http.js';

let fallos = 0;
const check = (nombre: string, ok: boolean, detalle = ''): void => {
  console.log(`${ok ? '✅' : '❌'} ${nombre}${ok ? '' : ` — ${detalle}`}`);
  if (!ok) fallos++;
};

const PUERTO = 8547;
const RPC = `http://127.0.0.1:${PUERTO}`;
const CLAVE_CLIENTE = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as Hex;
const CLAVE_AGENTE = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as Hex;
const MULTISIG = '0xc384C1F5D6716571DA84329BeAaE6F064C6b1Fe0' as Address;

const anvil = spawn('anvil', ['--fork-url', 'https://rpc.monad.xyz', '--port', String(PUERTO), '--silent'], {
  stdio: 'ignore',
});
const acabar = (codigo: number): never => {
  anvil.kill();
  process.exit(codigo);
};

try {
  const lector = createPublicClient({ chain: monad, transport: http(RPC) });
  for (let i = 0; ; i++) {
    try {
      await lector.getBlockNumber();
      break;
    } catch {
      if (i > 60) throw new Error('anvil no arranca');
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  const tiempo = async (segundos: number) => {
    await lector.request({ method: 'evm_increaseTime' as never, params: [segundos] as never });
    await lector.request({ method: 'evm_mine' as never, params: [] as never });
  };

  // ── Desplegar PanalTablon con el bytecode de Foundry ────────────────────
  const compilado = JSON.parse(readFileSync('../contracts/out/PanalTablon.sol/PanalTablon.json', 'utf8'));
  const deployer = createWalletClient({ chain: monad, transport: http(RPC), account: privateKeyToAccount(CLAVE_CLIENTE) });
  const hashDespliegue = await deployer.deployContract({
    abi: compilado.abi,
    bytecode: compilado.bytecode.object as Hex,
    args: [
      MAINNET_ADDRESSES.escrow,
      MULTISIG,
      [
        { minCompleted: 5, minRating: 400, dailyCap: 1 },
        { minCompleted: 30, minRating: 420, dailyCap: 5 },
        { minCompleted: 100, minRating: 440, dailyCap: 15 },
        { minCompleted: 300, minRating: 450, dailyCap: 40 },
        { minCompleted: 1000, minRating: 460, dailyCap: 100 },
      ],
      2,
      { perJob: parseEther('500'), total: parseEther('1000') },
      { perJob: parseEther('2066000'), total: parseEther('4133000') },
    ],
  });
  const reciboDespliegue = await lector.waitForTransactionReceipt({ hash: hashDespliegue });
  const tablon = reciboDespliegue.contractAddress!;
  console.log(`PanalTablon en la copia: ${tablon}`);

  // El buzón de verdad, leyendo de la copia.
  const lectorSdk = createPanalClient({ rpcUrl: RPC, indexerUrl: null, addresses: { tablon } });
  const buzon = createBuzonServer({
    store: new BuzonStore(mkdtempSync(join(tmpdir(), 'panal-tablon-fork-'))),
    fetchTask: async (id) => {
      const t = await lectorSdk.getTask(id);
      return { ...t, status: t.status } as never;
    },
    fetchAgent: async () => {
      throw new Error('no hace falta');
    },
    contratos: { escrow: MAINNET_ADDRESSES.escrow, registry: MAINNET_ADDRESSES.registry, token: MAINNET_ADDRESSES.panalToken },
    simboloDe: () => 'MON',
    indexer: '',
    allowLocalhostOrigin: true,
    tablon,
    fetchJob: async (id) => {
      const j = await lectorSdk.getBoardJob(id);
      return { client: j.cliente, state: j.estado, agent: j.agente, taskHash: j.taskHash, advertHash: j.advertHash, escrowTaskId: j.escrowTaskId };
    },
  });
  await new Promise<void>((r) => buzon.listen(PUERTO + 1, '127.0.0.1', r));
  const buzonUrl = `http://127.0.0.1:${PUERTO + 1}/buzon`;
  process.on('exit', () => buzon.close());

  const cliente = createPanalClient({ rpcUrl: RPC, indexerUrl: null, buzonUrl, account: privateKeyToAccount(CLAVE_CLIENTE), addresses: { tablon } });
  const agente = createPanalClient({ rpcUrl: RPC, indexerUrl: null, buzonUrl, account: privateKeyToAccount(CLAVE_AGENTE), addresses: { tablon } });
  const yo = agente.account!.address;

  // ── 1. Un agente nuevo ─────────────────────────────────────────────────
  console.log('\nun agente nuevo');
  await agente.registerAgent({
    metadata: { name: 'Prueba', description: 'Agente de prueba en una copia', skills: ['traduccion'], botUrl: null },
    pricePerTask: parseEther('0.5'),
  });
  await agente.setBoardCategories([2]);
  let s = await agente.boardStanding(yo);
  check('nivel 0, con sus dos de novato', s.nivel === 0 && s.novatoLibres === 2, JSON.stringify(s));
  check('y su categoría', s.categorias.join() === '2', s.categorias.join());

  // ── 2. Inmediato en MON ────────────────────────────────────────────────
  console.log('\ninmediato en MON');
  const brief = 'Traduce al francés: «El panal trabaja de noche.»';
  const pub = await cliente.postBoardJob({
    encargo: brief,
    anuncio: 'Traducción ES→FR, una frase',
    categoria: 2,
    importe: parseEther('1'),
    plazoEntregaS: 2 * 3600,
    caducaEnS: 24 * 3600,
    modo: ModoTablon.Inmediato,
  });
  check('publicado, con el hash del encargo en la cadena', pub.taskHash === keccak256(toBytes(brief)));
  check('y sus textos en el buzón', pub.textosGuardados, pub.error ?? '');
  const lista = await agente.listBoardJobAdverts();
  check(
    'el agente lo ve en la lista, con su anuncio comprobado',
    lista.some((j) => j.id === pub.jobId && j.anuncio === 'Traducción ES→FR, una frase'),
  );
  check('canTake dice que sí', (await agente.canTakeBoardJob(yo, pub.jobId)).ok);

  const cogido = await agente.takeBoardJob(pub.jobId);
  const tarea = (await lector.readContract({ address: MAINNET_ADDRESSES.escrow, abi: escrowAbi, functionName: 'tasks', args: [cogido.escrowTaskId] })) as { client: Address; worker: Address };
  check(
    'en el escrow real, el cliente es el tablón y el agente ya está',
    tarea.client.toLowerCase() === tablon.toLowerCase() && tarea.worker.toLowerCase() === yo.toLowerCase(),
    `${tarea.client} · ${tarea.worker}`,
  );

  s = await agente.boardStanding(yo);
  check('un novato con uno abierto no puede coger más', s.hoyLibres === 0 && s.abiertos === 1);

  const otro = await cliente.postBoardJob({
    encargo: 'otro',
    anuncio: 'Otra traducción',
    categoria: 2,
    importe: parseEther('1'),
    plazoEntregaS: 3600,
    caducaEnS: 3 * 24 * 3600,
    modo: ModoTablon.Inmediato,
  });
  let motivo = '';
  try {
    await agente.takeBoardJob(otro.jobId);
  } catch (e) {
    motivo = e instanceof Error ? e.message : String(e);
  }
  check('y lo dice antes de firmar', motivo.includes('newcomer job in progress'), motivo);

  check('el agente lee el encargo del buzón', (await agente.readBoardJobBrief(pub.jobId)) === brief);
  const traduccion = 'Le rucher travaille la nuit.';
  await agente.deliverBoardJob(pub.jobId, traduccion);
  check(
    'el cliente de verdad se descarga la entrega, comprobada contra el escrow',
    (await cliente.readBoardJobResult(pub.jobId)) === traduccion,
  );
  let ajeno = '';
  try {
    await agente.readBoardJobResult(pub.jobId);
  } catch (e) {
    ajeno = e instanceof Error ? e.message : String(e);
  }
  check('y nadie más', ajeno.includes('solo la descarga su cliente'), ajeno);
  await cliente.approveBoardJob(pub.jobId, 5);
  check('aprobado y cerrado', (await cliente.getBoardJob(pub.jobId)).estado === EstadoTablon.Cerrado);
  const cobra = await cliente.getPendingWithdrawal(yo);
  check('el agente cobra el 97,5 % en el escrow', cobra === parseEther('0.975'), String(cobra));

  // ── 3. Selección con una oferta más barata ─────────────────────────────
  console.log('\nselección, con una oferta más barata');
  await cliente.withdrawBoardJob(otro.jobId); // libera el sitio y se debe
  const sel = await cliente.postBoardJob({
    encargo: 'Traduce un párrafo',
    anuncio: 'Un párrafo ES→FR',
    categoria: 2,
    importe: parseEther('2'),
    plazoEntregaS: 3600,
    caducaEnS: 2 * 24 * 3600,
    modo: ModoTablon.Seleccion,
    ventanaOfertasS: 2 * 3600,
    ventanaEleccionS: 24 * 3600,
  });
  await agente.offerOnBoardJob(sel.jobId, parseEther('1.5'), 1800);
  const ofertas = await cliente.getBoardOffers(sel.jobId);
  check('la oferta está, con su precio y su plazo', ofertas.length === 1 && ofertas[0]!.precio === parseEther('1.5') && ofertas[0]!.plazoEntregaS === 1800);

  await tiempo(2 * 3600 + 1);
  await cliente.chooseBoardOffer(sel.jobId, yo);
  const debe = await cliente.getBoardRefund(cliente.account!.address);
  check('la diferencia y el retirado se le deben al cliente: 0,5 + 1', debe === parseEther('1.5'), String(debe));
  const antes = await lector.getBalance({ address: cliente.account!.address });
  const cobro = await cliente.claimBoardRefund();
  const despues = await lector.getBalance({ address: cliente.account!.address });
  check('y lo cobra', cobro.importe === parseEther('1.5') && despues > antes + parseEther('1.49'), `${antes} → ${despues}`);

  // ── 4. Sin entregar: el cierre lo cancela y lo sanciona ────────────────
  console.log('\nsin entregar');
  await tiempo(1800 + 1);
  await cliente.settleBoardJob(sel.jobId);
  s = await agente.boardStanding(yo);
  check('7 días fuera', s.suspendidoHasta > 0, JSON.stringify(s));
  check('y el cliente vuelve a tener su 1,5', (await cliente.getBoardRefund(cliente.account!.address)) === parseEther('1.5'));

  // ── 5. El indexador ──────────────────────────────────────────────────────
  console.log('\nel indexador');
  const cfgIdx = {
    rpcUrl: RPC,
    registryAddress: MAINNET_ADDRESSES.registry,
    escrowAddress: MAINNET_ADDRESSES.escrow,
    panalTokenAddress: MAINNET_ADDRESSES.panalToken,
    namesAddress: null,
    tablonAddress: tablon,
    tablonDesdeBloque: null,
    indexPollIntervalMs: 500,
    indexSweepWindowsPerDay: 0,
  } as unknown as BotConfig;
  const indice = new IndexStore(mkdtempSync(join(tmpdir(), 'panal-idx-fork-')), MAINNET_ADDRESSES.panalToken, tablon);
  indice.setLastBlock(Number(reciboDespliegue.blockNumber) - 1);
  indice.setSweepFloor(0);
  const cabeza = Number(await lector.getBlockNumber());
  const parar = { stopped: false };
  const vuelta = runIndexer(cfgIdx, createClients(cfgIdx), indice, parar);
  for (let i = 0; i < 120 && indice.lastBlock < cabeza; i++) await new Promise((r) => setTimeout(r, 250));
  parar.stopped = true;
  await vuelta;
  const trabajos = indice.jobs();
  check('ve los tres encargos', trabajos.length === 3, String(trabajos.length));
  const primero = indice.job(pub.jobId.toString());
  check('el primero, cerrado, con su agente y su tarea', primero?.state === 'closed' && primero.agent === yo.toLowerCase() && primero.escrowTaskId === cogido.escrowTaskId.toString());
  const tareaIdx = indice.task(cogido.escrowTaskId.toString());
  check('su tarea del escrow, atada a su cliente de verdad', tareaIdx?.realClient === cliente.account!.address.toLowerCase() && tareaIdx.jobId === pub.jobId.toString());
  check(
    'y el cliente la encuentra entre las suyas',
    indice.tasksOf(cliente.account!.address, { role: 'client' }).some((t) => t.taskId === cogido.escrowTaskId.toString()),
  );
  check('el retirado, retirado', indice.job(otro.jobId.toString())?.state === 'withdrawn');
  check('el de selección, cerrado tras su oferta', indice.job(sel.jobId.toString())?.state === 'closed' && indice.job(sel.jobId.toString())?.mode === 'selection');
  check('las categorías del agente, del evento', indice.categoriasDe(yo).join() === '2', indice.categoriasDe(yo).join());

  // ── 6. La foto del mes ───────────────────────────────────────────────────
  console.log('\nla foto del mes');
  const servidorIdx = createIndexServer({ store: indice, allowLocalhostOrigin: true });
  await new Promise<void>((r) => servidorIdx.listen(PUERTO + 2, '127.0.0.1', r));
  process.on('exit', () => servidorIdx.close());
  const ahoraBloque = await lector.getBlock();
  const fecha = new Date(Number(ahoraBloque.timestamp) * 1000);
  const mesActual = fecha.toISOString().slice(0, 7);
  // Al día 2 del mes siguiente: el mes en curso ya ha terminado.
  await tiempo(Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth() + 1, 2) / 1000 - Number(ahoraBloque.timestamp));
  const wallets = join(mkdtempSync(join(tmpdir(), 'panal-foto-')), 'wallets.json');
  writeFileSync(wallets, JSON.stringify({ team: [{ address: cliente.account!.address, label: 'el cliente de esta prueba' }] }));
  // Asíncrono a propósito: el indexador al que pregunta la foto lo sirve ESTE
  // proceso, y con execFileSync se quedaría parado esperándola.
  const { stdout: salida } = await promisify(execFile)(
    'pnpm',
    ['exec', 'tsx', '../scripts/foto-del-mes.ts', '--seco', '--mes', mesActual],
    {
      env: { ...process.env, RPC_URL: RPC, INDEXER_URL: `http://127.0.0.1:${PUERTO + 2}`, PANAL_TABLON_ADDRESS: tablon, WALLETS_FILE: wallets },
      encoding: 'utf8',
      maxBuffer: 10_000_000,
    },
  );
  const foto = JSON.parse(salida.slice(salida.indexOf('{'))) as {
    paidBy: { team: { created: number } };
    board?: {
      volume: { posted: number; assigned: number; withdrawn: number; postedUsd: number | null };
      agents: { tookJobs: number; atLevelOneOrMoreAtCut: number };
      prices: { mon: { usd: number } | null };
    };
  };
  check('la foto trae el tablón: tres publicados, dos asignados, uno retirado', foto.board?.volume.posted === 3 && foto.board.volume.assigned === 2 && foto.board.volume.withdrawn === 1, JSON.stringify(foto.board?.volume));
  check('con el precio de MON del bloque del corte', (foto.board?.prices.mon?.usd ?? 0) > 0 && (foto.board?.volume.postedUsd ?? 0) > 0);
  check('un agente cogió encargos, todavía en nivel 0 al corte', foto.board?.agents.tookJobs === 1 && foto.board.agents.atLevelOneOrMoreAtCut === 0);
  check('y las dos tareas del tablón cuentan para su cliente de verdad, no para el contrato', foto.paidBy.team.created === 2, String(foto.paidBy.team.created));
} catch (e) {
  console.error(e);
  fallos++;
}

if (fallos) {
  console.error(`\n❌ tablón en la copia: ${fallos} fallo(s)`);
  acabar(1);
}
console.log('\n✅ tablón en la copia: todo bien');
acabar(0);
