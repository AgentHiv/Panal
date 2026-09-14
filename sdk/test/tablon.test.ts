/**
 * Pruebas del tablón en el SDK.
 *
 *   npx tsx test/tablon.test.ts
 *
 * HERMÉTICO: no toca la red. El buzón y la cadena se sustituyen por dobles.
 *
 * Lo que se protege:
 *   1. Que los mensajes de firma sean los del buzón BYTE A BYTE. Si difieren en
 *      un solo carácter, toda firma sale inválida y nada dice por qué.
 *   2. Que `listBoard` no se crea al buzón: un anuncio con firma que no cuadra,
 *      una tarea que ya cogió otro, cancelada o vencida, no se ofrecen.
 *   3. Que `claimTask` diga POR QUÉ no se puede coger, antes de gastar gas.
 *   4. Que `deliverBoardResult` no ancle nada si el buzón rechaza la entrega.
 */

import { keccak256, toBytes, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { createPanalClient } from '../src/client.js';
import { TaskStatus, type Task } from '../src/types.js';
import { TABLON, encargoSignMessage, entregaSignMessage, ofertaSignMessage } from '../src/tablon.js';

let fallos = 0;
const check = (nombre: string, ok: boolean, detalle = ''): void => {
  console.log(`${ok ? '✅' : '❌'} ${nombre}${ok ? '' : ` — ${detalle}`}`);
  if (!ok) fallos++;
};
const lanza = async (fn: () => Promise<unknown>): Promise<string> => {
  try {
    await fn();
    return '';
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
};

// Claves de prueba conocidas (las de Hardhat/Anvil). Nunca tienen fondos reales.
const cliente = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');
const yo = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d');
const otro = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC' as Address;
const ahora = BigInt(Math.floor(Date.now() / 1000));

console.log('\nlos mensajes de firma, idénticos a los del buzón');
check('encargo', encargoSignMessage(7n, 1700000000) === 'Panal encargo #7 · 1700000000');
check('entrega', entregaSignMessage(7n, 1700000000) === 'Panal entrega #7 · 1700000000');
check(
  'oferta: lleva el hash del anuncio, no el anuncio',
  ofertaSignMessage(7n, 'Traducir 3 cadenas') === `Panal tablón #7 · ${keccak256(toBytes('Traducir 3 cadenas'))}`,
);

/** Un cliente con la cadena y el buzón de mentira. */
function montar(tareas: Record<string, Partial<Task>>, activo = true) {
  const panal = createPanalClient({ account: yo, buzonUrl: 'https://buzon.prueba/buzon' });
  const escrituras: string[] = [];
  const peticiones: string[] = [];
  const base: Task = {
    id: 0n,
    client: cliente.address,
    worker: TABLON,
    amount: 10n ** 17n,
    currency: TABLON,
    taskHash: keccak256(toBytes('el encargo')),
    resultHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
    status: TaskStatus.Open,
    deadline: ahora + 3600n,
    createdAt: ahora,
  };
  const p = panal as unknown as Record<string, unknown>;
  p.getTask = async (id: bigint) => {
    const t = tareas[id.toString()];
    if (!t) throw new Error('no existe');
    return { ...base, id, ...t };
  };
  p.leerAgente = async () => ({ active: activo });
  p.deliverResult = async (id: bigint, texto: string) => {
    escrituras.push(`deliverResult #${id}`);
    return { txHash: '0xabc' as Hex, resultHash: keccak256(toBytes(texto)) };
  };
  (p.walletClient as Record<string, unknown>).writeContract = async (args: { functionName: string; args: bigint[] }) => {
    escrituras.push(`${args.functionName} #${args.args[0]}`);
    return '0xdef' as Hex;
  };
  (p.publicClient as Record<string, unknown>).waitForTransactionReceipt = async () => ({ status: 'success' });
  return { panal, escrituras, peticiones };
}

/** Sustituye fetch por un buzón de mentira que responde según la ruta. */
function buzon(rutas: Record<string, (init?: RequestInit) => { status: number; body: unknown }>, peticiones: string[]) {
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    peticiones.push(`${init?.method ?? 'GET'} ${u}`);
    const ruta = Object.keys(rutas).find((r) => u.endsWith(r));
    const r = ruta ? rutas[ruta]!(init) : { status: 404, body: { error: 'no' } };
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
}

const anuncio = async (taskId: bigint, publico: string, quien = cliente) => ({
  taskId: taskId.toString(),
  publico,
  cliente: quien.address,
  firma: await quien.signMessage({ message: ofertaSignMessage(taskId, publico) }),
  publicada: Date.now(),
});

console.log('\nlistBoard no se cree al buzón');
{
  const { panal, peticiones } = montar({
    '1': {},
    '2': { worker: otro },
    '3': { status: TaskStatus.Cancelled },
    '4': { deadline: ahora - 10n },
    '5': {},
    '6': {},
  });
  const buena = await anuncio(1n, 'Traducir 3 cadenas');
  const cogida = await anuncio(2n, 'Ya la cogió otro');
  const cancelada = await anuncio(3n, 'Cancelada');
  const vencida = await anuncio(4n, 'Vencida');
  const retocada = { ...(await anuncio(5n, 'Texto original')), publico: 'Texto cambiado por el buzón' };
  const ajena = await anuncio(6n, 'Firmada por quien no pagó', yo);
  buzon(
    { '/lista': () => ({ status: 200, body: { ofertas: [buena, cogida, cancelada, vencida, retocada, ajena] } }) },
    peticiones,
  );
  const lista = await panal.listBoard();
  check('solo queda la que se puede coger', lista.length === 1 && lista[0]!.taskId === 1n, JSON.stringify(lista.map((e) => e.taskId.toString())));
  check('trae el anuncio y el hash de la cadena', lista[0]?.anuncio === 'Traducir 3 cadenas' && lista[0]?.taskHash === keccak256(toBytes('el encargo')));
  check('pide la lista a la dirección cero del buzón', peticiones[0] === `GET https://buzon.prueba/buzon/${TABLON}/lista`, peticiones[0]);
}

console.log('\nclaimTask dice por qué antes de gastar gas');
{
  const { panal, escrituras } = montar({
    '1': {},
    '2': { worker: otro },
    '3': { client: yo.address },
    '4': { deadline: ahora - 10n },
  });
  check('ya cogida', (await lanza(() => panal.claimTask(2n))).includes('ya la cogió'));
  check('propia', (await lanza(() => panal.claimTask(3n))).includes('la publicaste tú'));
  check('vencida', (await lanza(() => panal.claimTask(4n))).includes('venció'));
  check('ninguna de las tres escribió en la cadena', escrituras.length === 0, escrituras.join(', '));
  await panal.claimTask(1n);
  check('la buena sí se coge', escrituras.join() === 'claimTask #1', escrituras.join(', '));
}
{
  const { panal, escrituras } = montar({ '1': {} }, false);
  const msg = await lanza(() => panal.claimTask(1n));
  check('sin ser agente activo no se intenta', msg.includes('no es un agente activo') && escrituras.length === 0, msg);
}

console.log('\nreadBoardBrief solo devuelve lo que cuadra con la cadena');
{
  const { panal, peticiones } = montar({ '1': { worker: yo.address }, '2': {}, '3': { worker: yo.address } });
  buzon(
    {
      '/encargo/1': () => ({ status: 200, body: { brief: 'el encargo' } }),
      '/encargo/3': () => ({ status: 200, body: { brief: 'otro texto' } }),
    },
    peticiones,
  );
  check('el bueno se lee', (await panal.readBoardBrief(1n)) === 'el encargo');
  check('sin cogerla, se dice', (await lanza(() => panal.readBoardBrief(2n))).includes('todavía no la has cogido'));
  check('si no cuadra con el taskHash, no se devuelve', (await lanza(() => panal.readBoardBrief(3n))).includes('no cuadra'));
}

console.log('\ndeliverBoardResult: primero el buzón, luego la cadena');
{
  const { panal, escrituras, peticiones } = montar({ '1': { worker: yo.address }, '2': { worker: yo.address } });
  let cuerpo: Record<string, unknown> = {};
  buzon(
    {
      '/entrega/1': (init) => {
        cuerpo = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return { status: 200, body: { ok: true } };
      },
      '/entrega/2': () => ({ status: 403, body: { error: 'not worker' } }),
    },
    peticiones,
  );
  await panal.deliverBoardResult(1n, 'hecho');
  check('deja el texto con la firma de entrega', cuerpo.entrega === 'hecho' && cuerpo.address === yo.address && typeof cuerpo.signature === 'string');
  check('y después ancla', escrituras.join() === 'deliverResult #1', escrituras.join(', '));
  const msg = await lanza(() => panal.deliverBoardResult(2n, 'hecho'));
  check('si el buzón la rechaza, no se ancla nada', msg.includes('No se ha anclado nada') && escrituras.length === 1, msg);
}

console.log(fallos === 0 ? '\n✅ tablón: todo bien' : `\n❌ tablón: ${fallos} fallo(s)`);
process.exit(fallos === 0 ? 0 : 1);
