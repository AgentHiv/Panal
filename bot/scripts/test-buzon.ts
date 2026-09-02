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

import { existsSync, mkdtempSync, readdirSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Hex } from 'viem';
import { getAddress, keccak256, toBytes, verifyMessage } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  briefSignMessage,
  createBuzonServer,
  encargoSignMessage,
  entregaSignMessage,
  ofertaSignMessage,
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

const CERO = getAddress('0x0000000000000000000000000000000000000000');
const OFERTA = 'Traducir al francés un contrato de 12 páginas. Jurídico, para el martes.';

/**
 * #1 abierta y sin entregar. #2 ya entregada y anclada. #3 cancelada.
 * #4 en el tablón, sin dueño todavía. #5 en el tablón y ya cogida.
 */
const TAREAS: Record<string, Task> = {
  '1': tarea(TaskStatus.Open, ('0x' + '00'.repeat(32)) as Hex),
  '2': tarea(TaskStatus.Delivered, keccak256(toBytes(ENTREGA))),
  '3': tarea(TaskStatus.Cancelled, ('0x' + '00'.repeat(32)) as Hex),
  '4': { ...tarea(TaskStatus.Open, ('0x' + '00'.repeat(32)) as Hex), worker: CERO },
  '5': tarea(TaskStatus.Open, ('0x' + '00'.repeat(32)) as Hex),
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
  check(
    'sí adjuntos, y con su tope: si no lo anunciara, el cliente pagaría y su archivo no llegaría',
    (ficha.endpoints?.postAttachment as { path?: string; maxAttachmentBytes?: number } | undefined)
      ?.path === '/upload/:taskId',
  );
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

  /* ── los archivos ─────────────────────────────────────────────────────── */

  console.log('\n── Los archivos van y vienen, y solo entre las dos partes ──\n');

  const BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0x25]);
  const HASH = keccak256(BYTES);

  const subir = async (
    ruta: 'upload' | 'entrega-archivo',
    taskId: bigint,
    nombre: string,
    quien: typeof cliente,
    bytes: Uint8Array = BYTES,
  ) => {
    const cabeceras: Record<string, string> = {
      'content-type': 'application/octet-stream',
      'x-panal-address': quien.address,
      'x-panal-filename': encodeURIComponent(nombre),
    };
    if (ruta === 'upload') {
      // El cliente firma lo mismo que para dejar el encargo: es la misma
      // operación en dos llamadas.
      cabeceras['x-panal-signature'] = await quien.signMessage({ message: briefSignMessage(taskId) });
    } else {
      const expira = enUnMinuto();
      cabeceras['x-panal-signature'] = await quien.signMessage({
        message: entregaSignMessage(taskId, expira),
      });
      cabeceras['x-panal-expira'] = String(expira);
    }
    return fetch(`${base}/${ruta}/${taskId}`, { method: 'POST', headers: cabeceras, body: bytes });
  };

  const r19 = await subir('upload', 1n, 'contrato ñ.pdf', cliente);
  const b19 = (await r19.json()) as { hash?: string };
  check('200 el cliente adjunta un archivo a su encargo', r19.status === 200, `status=${r19.status}`);
  check('y el hash lo calcula el buzón, no la cabecera', b19.hash === HASH, `${b19.hash}`);

  const r20 = await subir('upload', 1n, 'contrato ñ.pdf', intruso);
  check('403 un tercero no adjunta nada', r20.status === 403, `status=${r20.status}`);

  const r21 = await subir('entrega-archivo', 1n, 'traducción.pdf', persona);
  check('200 el trabajador deja el archivo que entrega', r21.status === 200, `status=${r21.status}`);

  const r22 = await subir('entrega-archivo', 1n, 'traducción.pdf', cliente);
  check('403 y el cliente no entrega archivos por él', r22.status === 403, `status=${r22.status}`);

  // Los bytes se guardan por su HASH, así que un nombre con barras no lleva a
  // ninguna parte: la ruta no sale nunca de lo que escribe quien sube.
  const r23 = await subir('upload', 1n, '../../../etc/passwd', cliente);
  check(
    'un nombre con travesía se queda en el nombre',
    r23.status === 200 && !existsSync('/tmp/panal-no-deberia-existir'),
    `status=${r23.status}`,
  );
  const guardados = readdirSync(join(dir, AGENTE.toLowerCase(), '1.files'));
  check(
    'y en disco todo son hashes',
    guardados.every((f) => /^[0-9a-f]{64}\.bin$/.test(f)),
    guardados.join(' '),
  );

  const bajarArchivo = async (nombre: string, quien: typeof cliente, comoCliente: boolean) => {
    const expira = enUnMinuto();
    const mensaje = comoCliente
      ? resultSignMessageConCaducidad(1n, expira)
      : encargoSignMessage(1n, expira);
    const firma = await quien.signMessage({ message: mensaje });
    return fetch(`${base}/archivo/1/${encodeURIComponent(nombre)}`, {
      headers: {
        'x-panal-address': quien.address,
        'x-panal-signature': firma,
        'x-panal-expira': String(expira),
      },
    });
  };

  const r24 = await bajarArchivo('traducción.pdf', cliente, true);
  const bytes24 = new Uint8Array(await r24.arrayBuffer());
  check(
    '200 el cliente se baja lo entregado, con los mismos bytes',
    r24.status === 200 && keccak256(bytes24) === HASH,
    `status=${r24.status}`,
  );
  check('y se baja, no se pinta', r24.headers.get('content-disposition') === 'attachment');

  const r25 = await bajarArchivo('contrato ñ.pdf', persona, false);
  check('200 el trabajador se baja lo que le adjuntaron', r25.status === 200, `status=${r25.status}`);

  const r26 = await bajarArchivo('traducción.pdf', intruso, true);
  check('403 un tercero no se baja nada', r26.status === 403, `status=${r26.status}`);

  const r27 = await bajarArchivo('no-existe.pdf', cliente, true);
  check('404 lo que no está no se inventa', r27.status === 404, `status=${r27.status}`);

  // La firma del cliente no abre la puerta del trabajador ni al revés.
  const r28 = await bajarArchivo('contrato ñ.pdf', persona, true);
  check('403 la firma del cliente no le vale al trabajador', r28.status === 403, `status=${r28.status}`);

  const r29 = await subir('upload', 1n, '', cliente);
  check('400 un archivo sin nombre no entra', r29.status === 400, `status=${r29.status}`);

  const r30 = await subir('upload', 1n, 'vacio.txt', cliente, new Uint8Array(0));
  check('400 ni uno vacío', r30.status === 400, `status=${r30.status}`);

  const r31 = await subir('upload', 3n, 'tarde.pdf', cliente);
  check('409 ni uno para una tarea cancelada', r31.status === 409, `status=${r31.status}`);

  /* ── el tablón ────────────────────────────────────────────────────────── */

  console.log('\n── El tablón: lo que se lee sin cogerlo, y lo que no ──\n');

  const tablonBase = `http://127.0.0.1:${dir_.port}/buzon/${CERO}`;
  const publicar = async (taskId: bigint, publico: string, quien: typeof cliente) => {
    const firma = await quien.signMessage({ message: ofertaSignMessage(taskId, publico) });
    return fetch(`${tablonBase}/oferta/${taskId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ publico, address: quien.address, signature: firma }),
    });
  };

  const r32 = await publicar(4n, OFERTA, cliente);
  check('200 el cliente publica su encargo sin dueño', r32.status === 200, `status=${r32.status}`);

  const r33 = await fetch(`${tablonBase}/lista`);
  const b33 = (await r33.json()) as { ofertas?: { taskId: string; publico: string; firma: string }[] };
  check(
    '200 y el tablón se lee SIN firmar: si no, no sería un tablón',
    r33.status === 200 && b33.ofertas?.[0]?.publico === OFERTA,
    `status=${r33.status}`,
  );
  check(
    'y viene con la firma de su cliente, para poder comprobarlo',
    await verifyMessage({
      address: cliente.address,
      message: ofertaSignMessage(4n, OFERTA),
      signature: b33.ofertas![0]!.firma as `0x${string}`,
    }),
  );

  // Sin la firma del cliente, el buzón podría cambiar el texto de una oferta
  // ajena y quien la cogiera se encontraría otro encargo. No llega a guardarse.
  const firmaDeOtro = await intruso.signMessage({ message: ofertaSignMessage(4n, OFERTA) });
  const r34 = await fetch(`${tablonBase}/oferta/4`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ publico: OFERTA, address: cliente.address, signature: firmaDeOtro }),
  });
  check('403 una oferta firmada por otro no entra', r34.status === 403, `status=${r34.status}`);

  const firmaBuena = await cliente.signMessage({ message: ofertaSignMessage(4n, OFERTA) });
  const r35 = await fetch(`${tablonBase}/oferta/4`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      publico: 'Traducir DOS contratos, mismo precio.',
      address: cliente.address,
      signature: firmaBuena,
    }),
  });
  check('403 ni el mismo texto cambiado con la firma del anterior', r35.status === 403, `status=${r35.status}`);
  const r36 = await fetch(`${tablonBase}/lista`);
  const b36 = (await r36.json()) as { ofertas?: { publico: string }[] };
  check('y el tablón sigue diciendo lo que su cliente escribió', b36.ofertas?.[0]?.publico === OFERTA);

  const r37 = await publicar(5n, 'Ya la cogió alguien.', cliente);
  check('409 un encargo que ya tiene dueño no se anuncia', r37.status === 409, `status=${r37.status}`);

  const r38 = await publicar(3n, 'Cancelada.', cliente);
  check('409 ni uno cancelado', r38.status === 409, `status=${r38.status}`);

  // El encargo de verdad NO se lee sin cogerlo: lo que se publica es la oferta.
  const firmaTablon = await cliente.signMessage({ message: briefSignMessage(4n) });
  await fetch(`${tablonBase}/brief/4`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ brief: BRIEF, address: cliente.address, signature: firmaTablon }),
  });
  const expiraT = enUnMinuto();
  const r39 = await fetch(`${tablonBase}/encargo/4`, {
    headers: {
      'x-panal-address': persona.address,
      'x-panal-signature': await persona.signMessage({ message: encargoSignMessage(4n, expiraT) }),
      'x-panal-expira': String(expiraT),
    },
  });
  check(
    '403 quien no lo ha cogido no lee el encargo, solo la oferta',
    r39.status === 403,
    `status=${r39.status}`,
  );

  const r40 = await fetch(`${tablonBase}/encargo/4`, {
    headers: {
      'x-panal-address': cliente.address,
      'x-panal-signature': await cliente.signMessage({ message: encargoSignMessage(4n, expiraT) }),
      'x-panal-expira': String(expiraT),
    },
  });
  check('200 su cliente sí, que es quien lo escribió', r40.status === 200, `status=${r40.status}`);

  /* ── la retención ─────────────────────────────────────────────────────── */
  console.log('\n── Es un relevo, no un archivo ──\n');

  const viejo = new Date(Date.now() - 31 * 86_400_000);
  utimesSync(join(dir, AGENTE.toLowerCase(), '1.json'), viejo, viejo);
  const borrados = store.limpiar();
  check('lo de hace 31 días se borra', borrados === 1 && store.leer(AGENTE, 1n) === null, `borrados=${borrados}`);
  check(
    'y sus archivos con él, que si no se quedarían vivos meses',
    !existsSync(join(dir, AGENTE.toLowerCase(), '1.files')),
  );
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
