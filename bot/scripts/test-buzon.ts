/**
 * Test LOCAL del buzón (bot/src/buzon.ts) — sin RPC y sin red.
 *
 * El buzón guarda el encargo de un cliente y la entrega de quien lo hace, para
 * agentes que no tienen servidor propio. Lo que hay que demostrar no es que
 * guarde: es que NO PUEDE MENTIR sobre lo que guarda, porque ve en claro el
 * trabajo de otros y porque el pago de una tarea depende de ello.
 *
 * Las dos comprobaciones que sostienen todo lo demás:
 *
 *   - un brief solo entra si `keccak256(brief)` es el `taskHash` que ya está
 *     en la cadena. Si no, quien pagó podría dejar aquí un encargo distinto
 *     del que firmó y luego disputar la entrega diciendo que no era eso;
 *   - una entrega solo entra si, habiendo `resultHash` anclado, sus bytes dan
 *     ese hash. Si no, una entrega firmada podría cambiar después de firmada.
 *
 * Y quién puede hacer qué: el cliente deja el encargo y se lleva la entrega;
 * el trabajador lee el encargo y deja la entrega. Ninguno de los dos puede
 * hacer lo del otro, y un tercero no puede hacer nada.
 *
 * Uso:  npx tsx scripts/test-buzon.ts   (exit 0 si todo pasa)
 */

import { mkdtempSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Address, Hex } from 'viem';
import { getAddress, keccak256, toBytes } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  briefSignMessage,
  createBuzonServer,
  encargoSignMessage,
  entregaSignMessage,
  resultSignMessageConCaducidad,
} from '../src/buzon.js';
import { BuzonStore } from '../src/buzon-store.js';
import { NATIVE_CURRENCY, TaskStatus, type RegistryAgent, type Task } from '../src/chain.js';

// Cuentas bien conocidas (Anvil/Hardhat), solo para este test.
const cliente = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');
const persona = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d');
const intruso = privateKeyToAccount('0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a');

const AGENTE = persona.address;
const OTRO_AGENTE = getAddress('0x0000000000000000000000000000000000000042');

const BRIEF = 'Tradúceme este contrato al francés, jurídico, para el martes.';
const ENTREGA = '# Traducción\n\nContrat de prestation de services…\n';
const OTRA_ENTREGA = '# Traducción\n\nOtra cosa que nadie firmó.\n';

/** #1 abierta y sin entregar. #2 ya entregada y anclada. #3 cancelada. */
const TAREAS: Record<string, Task> = {
  '1': tarea(TaskStatus.Open, ('0x' + '00'.repeat(32)) as Hex),
  '2': tarea(TaskStatus.Delivered, keccak256(toBytes(ENTREGA))),
  '3': tarea(TaskStatus.Cancelled, ('0x' + '00'.repeat(32)) as Hex),
};

function tarea(status: TaskStatus, resultHash: Hex): Task {
  return {
    client: cliente.address,
    worker: AGENTE,
    amount: 1_000_000_000_000_000_000n,
    taskHash: keccak256(toBytes(BRIEF)),
    resultHash,
    deadline: 1_900_000_000n,
    createdAt: 1_899_000_000n,
    status,
    currency: NATIVE_CURRENCY,
  };
}

const FICHA: RegistryAgent = {
  owner: persona.address,
  metadataURI:
    'Marta · Traduce contratos ES⇄FR · traducción, jurídico · ' +
    'bot:https://api.panal.lat/buzon/' + AGENTE + ' · ' +
    'nivel:5|Urgente|En 24 h|4000||',
  pricePerTask: 1_000_000_000_000_000_000n,
  active: true,
  registeredAt: 1_890_000_000n,
  currency: NATIVE_CURRENCY,
};

/** Un segundo de vida para la firma: lo justo para usarla en el acto. */
const enUnMinuto = (): number => Math.floor(Date.now() / 1000) + 60;

async function main(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'panal-buzon-test-'));
  const store = new BuzonStore(dir);

  const server = createBuzonServer({
    store,
    fetchTask: async (taskId) => {
      const t = TAREAS[taskId.toString()];
      if (!t) throw new Error('no existe');
      return t;
    },
    fetchAgent: async () => FICHA,
    contratos: {
      escrow: getAddress('0xe138A9A492CFe27A13f8b7A6D312DA831791bCe9'),
      registry: getAddress('0x89a812BFb1c35fc814ef25a3E6Ca75068B16Ac51'),
      token: getAddress('0x2e2e44e7fa6178822d4397299f719e89d1a67777'),
    },
    urlPublica: 'https://api.panal.lat/buzon',
    simboloDe: () => 'MON',
    indexer: 'https://api.panal.lat',
    allowLocalhostOrigin: true,
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const dir_ = server.address();
  if (!dir_ || typeof dir_ === 'string') throw new Error('sin puerto');
  const base = `http://127.0.0.1:${dir_.port}/buzon/${AGENTE}`;

  let fallos = 0;
  const check = (nombre: string, ok: boolean, detalle = '') => {
    console.log(`${ok ? '✅' : '❌'} ${nombre}${detalle ? ` — ${detalle}` : ''}`);
    if (!ok) fallos++;
  };

  /* ── el cliente deja su encargo ───────────────────────────────────────── */
  console.log('\n── El encargo entra, y solo el que se pagó ──\n');

  const dejarBrief = (taskId: bigint, body: unknown, prefijo = base) =>
    fetch(`${prefijo}/brief/${taskId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://panal.lat' },
      body: JSON.stringify(body),
    });

  const firmaBrief = await cliente.signMessage({ message: briefSignMessage(1n) });
  const r1 = await dejarBrief(1n, { brief: BRIEF, address: cliente.address, signature: firmaBrief });
  check('200 el cliente deja su encargo', r1.status === 200, `status=${r1.status}`);
  check('CORS panal.lat', r1.headers.get('access-control-allow-origin') === 'https://panal.lat');
  check('y queda guardado', store.leer(AGENTE, 1n)?.brief === BRIEF);

  // EL QUE SE PAGÓ. Un texto distinto da otro keccak y no es el `taskHash`.
  const r2 = await dejarBrief(1n, {
    brief: BRIEF + ' Y además hazme una web.',
    address: cliente.address,
    signature: firmaBrief,
  });
  const b2 = (await r2.json()) as { error?: string };
  check(
    '409 otro encargo distinto del que se pagó',
    r2.status === 409 && b2.error === 'brief hash mismatch',
    `status=${r2.status} ${b2.error ?? ''}`,
  );
  check('y no ha pisado el bueno', store.leer(AGENTE, 1n)?.brief === BRIEF);

  const firmaIntruso = await intruso.signMessage({ message: briefSignMessage(1n) });
  const r3 = await dejarBrief(1n, { brief: BRIEF, address: intruso.address, signature: firmaIntruso });
  check('403 un tercero no encarga en su nombre', r3.status === 403, `status=${r3.status}`);

  const firmaCancelada = await cliente.signMessage({ message: briefSignMessage(3n) });
  const r4 = await dejarBrief(3n, { brief: BRIEF, address: cliente.address, signature: firmaCancelada });
  check('409 una tarea cancelada no recibe encargos', r4.status === 409, `status=${r4.status}`);

  // La tarea es de otro agente: el buzón no es un disco duro para cualquiera.
  const otroBase = `http://127.0.0.1:${dir_.port}/buzon/${OTRO_AGENTE}`;
  const r5 = await dejarBrief(1n, { brief: BRIEF, address: cliente.address, signature: firmaBrief }, otroBase);
  check('404 la tarea no es de ese agente', r5.status === 404, `status=${r5.status}`);

  /* ── el trabajador lo lee ─────────────────────────────────────────────── */
  console.log('\n── Lo lee quien tiene que hacerlo, y nadie más ──\n');

  const leerEncargo = async (taskId: bigint, quien: typeof persona, expira = enUnMinuto()) => {
    const firma = await quien.signMessage({ message: encargoSignMessage(taskId, expira) });
    return fetch(`${base}/encargo/${taskId}`, {
      headers: {
        'x-panal-address': quien.address,
        'x-panal-signature': firma,
        'x-panal-expira': String(expira),
      },
    });
  };

  const r6 = await leerEncargo(1n, persona);
  const b6 = (await r6.json()) as { brief?: string; taskHash?: string };
  check('200 el trabajador lee su encargo', r6.status === 200 && b6.brief === BRIEF, `status=${r6.status}`);
  check('y viene con el taskHash para poder comprobarlo', b6.taskHash === keccak256(toBytes(BRIEF)));

  const r7 = await leerEncargo(1n, cliente);
  check('403 el cliente no lee por la puerta del trabajador', r7.status === 403, `status=${r7.status}`);

  const r8 = await leerEncargo(1n, persona, Math.floor(Date.now() / 1000) - 10);
  check('403 una firma caducada no abre nada', r8.status === 403, `status=${r8.status}`);

  const r9 = await leerEncargo(1n, persona, Math.floor(Date.now() / 1000) + 86_400);
  check('403 ni una que dura un día', r9.status === 403, `status=${r9.status}`);

  /* ── la entrega ───────────────────────────────────────────────────────── */
  console.log('\n── La entrega no cambia después de firmada ──\n');

  const dejarEntrega = async (taskId: bigint, texto: string, quien: typeof persona) => {
    const expira = enUnMinuto();
    const firma = await quien.signMessage({ message: entregaSignMessage(taskId, expira) });
    return fetch(`${base}/entrega/${taskId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ entrega: texto, address: quien.address, signature: firma, expira }),
    });
  };

  // Tarea 1: aún sin anclar, así que se acepta y se puede corregir.
  const r10 = await dejarEntrega(1n, ENTREGA, persona);
  check('200 entrega antes de anclarla', r10.status === 200, `status=${r10.status}`);

  // Tarea 2: ya anclada. Solo entra el texto cuyo hash es el anclado.
  const r11 = await dejarEntrega(2n, OTRA_ENTREGA, persona);
  const b11 = (await r11.json()) as { error?: string };
  check(
    '409 otra entrega distinta de la anclada',
    r11.status === 409 && b11.error === 'delivery hash mismatch',
    `status=${r11.status} ${b11.error ?? ''}`,
  );
  const r12 = await dejarEntrega(2n, ENTREGA, persona);
  check('200 la anclada sí, y repetirla es inofensivo', r12.status === 200, `status=${r12.status}`);

  const r13 = await dejarEntrega(1n, ENTREGA, cliente);
  check('403 el cliente no entrega por su agente', r13.status === 403, `status=${r13.status}`);

  /* ── el cliente se la lleva ───────────────────────────────────────────── */
  console.log('\n── Y se la lleva quien la pagó ──\n');

  const bajarEntrega = async (taskId: bigint, quien: typeof cliente) => {
    const expira = enUnMinuto();
    const firma = await quien.signMessage({ message: resultSignMessageConCaducidad(taskId, expira) });
    return fetch(`${base}/result/${taskId}`, {
      headers: {
        'x-panal-address': quien.address,
        'x-panal-signature': firma,
        'x-panal-expira': String(expira),
      },
    });
  };

  const r14 = await bajarEntrega(2n, cliente);
  const b14 = (await r14.json()) as { resultText?: string; resultHash?: string };
  check('200 el cliente descarga', r14.status === 200 && b14.resultText === ENTREGA, `status=${r14.status}`);
  check(
    'y el hash se recalcula, no se copia',
    b14.resultHash === keccak256(toBytes(ENTREGA)) && b14.resultHash === TAREAS['2']!.resultHash,
  );

  const r15 = await bajarEntrega(2n, intruso);
  check('403 un tercero no descarga', r15.status === 403, `status=${r15.status}`);

  const r16 = await bajarEntrega(3n, cliente);
  check('404 lo que no está entregado no se descarga', r16.status === 404, `status=${r16.status}`);

  /* ── la ficha ─────────────────────────────────────────────────────────── */
  console.log('\n── La ficha sale de la cadena, y no promete lo que no hay ──\n');

  const r17 = await fetch(`${base}/agent.json`);
  const ficha = (await r17.json()) as Record<string, unknown> & {
    endpoints?: Record<string, unknown>;
    tiers?: { name?: string; amountWei?: string }[];
    skills?: string[];
  };
  check('200 agent.json', r17.status === 200, `status=${r17.status}`);
  check('nombre y skills de su metadata', ficha.name === 'Marta' && ficha.skills?.[0] === 'traducción');
  check('su nivel, con el precio en wei', ficha.tiers?.[0]?.name === 'Urgente' && ficha.tiers[0]?.amountWei === '5000000000000000000');
  check('sin cobro por llamada: no hay máquina despierta', ficha.endpoints?.x402Ask === undefined && ficha.x402Ask === undefined);
  check('sin adjuntos: el buzón no los guarda todavía', ficha.endpoints?.postAttachment === undefined);
  check('y dice quién es', ficha.agent === AGENTE);

  /* ── lo que no es una ruta ────────────────────────────────────────────── */
  console.log('\n── Lo que no tiene forma de encargo no toca el disco ──\n');

  for (const [nombre, ruta] of [
    ['sin agente', `/buzon/brief/1`],
    ['dirección inventada', `/buzon/0xnoesunadireccion/brief/1`],
    ['ruta desconocida', `/buzon/${AGENTE}/lo-que-sea`],
    ['tarea que no es un número', `/buzon/${AGENTE}/brief/abc`],
    ['travesía de directorios', `/buzon/${AGENTE}/brief/../../etc/passwd`],
  ] as const) {
    const r = await fetch(`http://127.0.0.1:${dir_.port}${ruta}`);
    check(`404 ${nombre}`, r.status === 404, `status=${r.status}`);
  }

  // Sin el prefijo /buzon también responde: si el proxy lo quita, el agente
  // afectado se enteraría con un encargo pagado en la mano.
  const r18 = await fetch(`http://127.0.0.1:${dir_.port}/${AGENTE}/agent.json`);
  check('200 también sin el prefijo /buzon', r18.status === 200, `status=${r18.status}`);

  /* ── la retención ─────────────────────────────────────────────────────── */
  console.log('\n── Es un relevo, no un archivo ──\n');

  const viejo = new Date(Date.now() - 31 * 86_400_000);
  utimesSync(join(dir, AGENTE.toLowerCase(), '1.json'), viejo, viejo);
  const borrados = store.limpiar();
  check('lo de hace 31 días se borra', borrados === 1 && store.leer(AGENTE, 1n) === null, `borrados=${borrados}`);
  check('lo de hoy se queda', store.leer(AGENTE, 2n)?.entrega === ENTREGA);

  server.close();
  console.log(
    fallos === 0
      ? '\n✅ El buzón traslada encargos y entregas, y no puede cambiar ni una coma de lo que las partes firmaron\n'
      : `\n❌ ${fallos} comprobación(es) fallidas\n`,
  );
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('❌ Error en el test:', err);
  process.exit(1);
});
