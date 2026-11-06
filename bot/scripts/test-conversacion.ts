/**
 * Test LOCAL de la conversación del encargo en el buzón — sin RPC y sin red.
 *
 * La conversación solo existe entre las dos partes de una tarea con el dinero
 * ya bloqueado: lo contrario de un chat donde cualquiera escribe gratis antes
 * de pagar. Lo que tiene que quedar demostrado:
 *   - leen y escriben el cliente y quien trabaja, con su firma, y nadie más;
 *   - una firma caducada o de otro encargo no vale;
 *   - los archivos se suben antes y el mensaje solo nombra los que están;
 *   - en un encargo cerrado se lee lo que hubo, pero ya no se escribe.
 *
 * Aparte de test-buzon.ts porque el buzón limita las peticiones por IP: con
 * las dos en el mismo proceso, esta se quedaba sin cupo.
 *
 * Uso:  npx tsx scripts/test-conversacion.ts   (exit 0 si todo pasa)
 */

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getAddress, keccak256, toBytes, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { conversacionSignMessage, createBuzonServer } from '../src/buzon.js';
import { BuzonStore } from '../src/buzon-store.js';
import { NATIVE_CURRENCY, TaskStatus, type Task } from '../src/chain.js';

const cliente = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');
const persona = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d');
const intruso = privateKeyToAccount('0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a');
const AGENTE = persona.address;
const OTRO_AGENTE = getAddress('0x0000000000000000000000000000000000000042');

function tarea(status: TaskStatus): Task {
  return {
    client: cliente.address,
    worker: AGENTE,
    amount: 10n ** 18n,
    taskHash: keccak256(toBytes('el encargo')),
    resultHash: ('0x' + '00'.repeat(32)) as Hex,
    deadline: 1_900_000_000n,
    createdAt: 1_899_000_000n,
    status,
    currency: NATIVE_CURRENCY,
  };
}
/** #1 abierta, #2 entregada, #3 cancelada. */
const TAREAS: Record<string, Task> = { '1': tarea(TaskStatus.Open), '2': tarea(TaskStatus.Delivered), '3': tarea(TaskStatus.Cancelled) };

let fallos = 0;
const check = (nombre: string, ok: boolean, detalle = '') => {
  console.log(`${ok ? '✅' : '❌'} ${nombre}${detalle ? ` — ${detalle}` : ''}`);
  if (!ok) fallos++;
};

async function main() {
  const server = createBuzonServer({
    store: new BuzonStore(mkdtempSync(join(tmpdir(), 'panal-conversacion-test-'))),
    fetchTask: async (taskId) => {
      const t = TAREAS[taskId.toString()];
      if (!t) throw new Error('no existe');
      return t;
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
  const base = `http://127.0.0.1:${dir.port}/buzon/${AGENTE}`;
  const otroBase = `http://127.0.0.1:${dir.port}/buzon/${OTRO_AGENTE}`;

  console.log('\nla conversación del encargo');
    const cred = async (quien: typeof cliente, id: bigint) => {
      const expira = Math.floor(Date.now() / 1000) + 300;
      return { address: quien.address, signature: await quien.signMessage({ message: conversacionSignMessage(id, expira) }), expira };
    };
    const cabeceras = (c: { address: string; signature: string; expira: number }) => ({
      'x-panal-address': c.address,
      'x-panal-signature': c.signature,
      'x-panal-expira': String(c.expira),
    });
    const leer = async (quien: typeof cliente, id: bigint) =>
      fetch(`${base}/conversacion/${id}`, { headers: cabeceras(await cred(quien, id)) });
    const escribir = async (quien: typeof cliente, id: bigint, texto: string, archivos?: { hash: string }[]) =>
      fetch(`${base}/conversacion/${id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ texto, ...(archivos ? { archivos } : {}), ...(await cred(quien, id)) }),
      });

    const vacia = await leer(cliente, 1n);
    const cv = (await vacia.json()) as { mensajes: unknown[]; abierta: boolean };
    check('el cliente abre la conversación de su encargo, vacía y abierta', vacia.status === 200 && cv.mensajes.length === 0 && cv.abierta);
    check('un tercero no la puede leer', (await leer(intruso, 1n)).status === 403);
    const caducada = { address: cliente.address, signature: await cliente.signMessage({ message: conversacionSignMessage(1n, 1) }), expira: 1 };
    check('ni con una firma caducada', (await fetch(`${base}/conversacion/1`, { headers: cabeceras(caducada) })).status === 403);
    check('ni con la firma de otro encargo', (await fetch(`${base}/conversacion/1`, { headers: cabeceras(await cred(cliente, 2n)) })).status === 403);

    check('el cliente escribe', (await escribir(cliente, 1n, '¿Puedes usar el glosario que te mando?')).status === 200);
    check('quien trabaja contesta', (await escribir(persona, 1n, 'Sí, mándamelo.')).status === 200);
    check('un tercero no puede escribir', (await escribir(intruso, 1n, 'hola')).status === 403);
    check('un mensaje vacío no entra', (await escribir(cliente, 1n, '   ')).status === 400);
    check('ni uno de más de 4000 caracteres', (await escribir(cliente, 1n, 'x'.repeat(4001))).status === 400);

    // Un archivo: primero los bytes, luego el mensaje que lo nombra.
    const glosario = new TextEncoder().encode('término,traducción\ncontratante,contractant\n');
    const subida = await fetch(`${base}/conversacion-archivo/1`, {
      method: 'POST',
      headers: { 'content-type': 'text/csv', 'x-panal-filename': encodeURIComponent('glosario ñ.csv'), ...cabeceras(await cred(cliente, 1n)) },
      body: glosario,
    });
    const { hash } = (await subida.json()) as { hash: string };
    check('el cliente sube un archivo para la conversación', subida.status === 200 && hash === keccak256(glosario));
    check('y lo nombra en un mensaje', (await escribir(cliente, 1n, 'Aquí lo tienes.', [{ hash }])).status === 200);
    check('un archivo que no se subió no se puede nombrar', (await escribir(cliente, 1n, 'Y este', [{ hash: '0x' + 'ab'.repeat(32) }])).status === 409);
    const bajada = await fetch(`${base}/conversacion-archivo/1/${hash}`, { headers: cabeceras(await cred(persona, 1n)) });
    check('quien trabaja se lo baja tal cual', bajada.status === 200 && keccak256(new Uint8Array(await bajada.arrayBuffer())) === hash);
    check('un tercero no', (await fetch(`${base}/conversacion-archivo/1/${hash}`, { headers: cabeceras(await cred(intruso, 1n)) })).status === 403);

    const todo = (await (await leer(persona, 1n)).json()) as { mensajes: { de: string; texto: string; archivos?: { name: string }[] }[] };
    check(
      'los dos ven la conversación entera, en orden y con quién dijo qué',
      todo.mensajes.map((m) => m.de).join() === 'cliente,trabajador,cliente' && todo.mensajes[2]?.archivos?.[0]?.name === 'glosario ñ.csv',
      JSON.stringify(todo.mensajes.map((m) => [m.de, m.texto.slice(0, 12)])),
    );

    // Un encargo cancelado: se lee lo que hubo, pero ya no se escribe.
    const cancelada = await leer(cliente, 3n);
    check('la de un encargo cancelado se puede leer', cancelada.status === 200 && ((await cancelada.json()) as { abierta: boolean }).abierta === false);
    check('pero ya no se escribe en ella', (await escribir(cliente, 3n, 'hola')).status === 409);
    check('la de un encargo de otro agente no existe aquí', (await fetch(`${otroBase}/conversacion/1`, { headers: cabeceras(await cred(cliente, 1n)) })).status === 404);

  server.close();
  console.log(fallos === 0 ? '\n✅ La conversación es solo de las dos partes, y solo con el encargo vivo\n' : `\n❌ ${fallos} comprobación(es) fallidas\n`);
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('❌ Error en el test:', err);
  process.exit(1);
});
