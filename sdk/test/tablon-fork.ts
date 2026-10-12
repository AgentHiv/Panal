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
 *   2. Un cliente publica un encargo inmediato en MON; el agente pregunta si
 *      puede, lo coge, entrega en el escrow; el cliente aprueba y se cierra.
 *   3. Un segundo encargo, en selección: el agente oferta por debajo del
 *      presupuesto, el cliente elige, la diferencia se le debe y la cobra.
 *   4. Lo que se rechaza dice por qué antes de firmar: un novato con un
 *      encargo abierto no puede coger otro.
 *
 * Las claves son las de prueba de anvil: no tienen nada fuera de la copia.
 */

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createPublicClient, createWalletClient, http, keccak256, parseEther, toBytes, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { monad } from 'viem/chains';
import { createPanalClient } from '../src/client.js';
import { MAINNET_ADDRESSES } from '../src/chains.js';
import { escrowAbi } from '../src/abis.js';
import { EstadoTablon, ModoTablon } from '../src/tablon-reglas.js';

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
  const tablon = (await lector.waitForTransactionReceipt({ hash: hashDespliegue })).contractAddress!;
  console.log(`PanalTablon en la copia: ${tablon}`);

  const cliente = createPanalClient({ rpcUrl: RPC, indexerUrl: null, account: privateKeyToAccount(CLAVE_CLIENTE), addresses: { tablon } });
  const agente = createPanalClient({ rpcUrl: RPC, indexerUrl: null, account: privateKeyToAccount(CLAVE_AGENTE), addresses: { tablon } });
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
  const lista = await agente.listBoardJobs();
  check('el agente lo ve en la lista', lista.some((j) => j.id === pub.jobId));
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

  const agenteWallet = createWalletClient({ chain: monad, transport: http(RPC), account: privateKeyToAccount(CLAVE_AGENTE) });
  const entrega = await agenteWallet.writeContract({
    address: MAINNET_ADDRESSES.escrow,
    abi: escrowAbi,
    functionName: 'deliverResult',
    args: [cogido.escrowTaskId, keccak256(toBytes('Le rucher travaille la nuit.'))],
  });
  await lector.waitForTransactionReceipt({ hash: entrega });
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
