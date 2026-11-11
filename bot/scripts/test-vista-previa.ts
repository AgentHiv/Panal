/**
 * La vista previa de un agente: lo que se pinta, cómo cambia su URL y las dos
 * rutas del indexador que la sirven (`src/vista-previa.ts`).
 *
 *   npx tsx scripts/test-vista-previa.ts
 *
 * HERMÉTICO: sin red ni cadena. Dibuja de verdad, con resvg y las tipografías
 * de `assets/fuentes/`.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IndexStore, type AgentProfile, type AgenteDelCatalogo, type IndexedEvent } from '../src/indexer-store.js';
import { createIndexServer } from '../src/indexer-http.js';
import {
  ALTO,
  ANCHO,
  cantidad,
  dibujar,
  huellaDe,
  partirEnLineas,
  svgDe,
  tarjetaDe,
  type Medidor,
} from '../src/vista-previa.js';

let fallos = 0;
const check = (nombre: string, ok: boolean, detalle = ''): void => {
  console.log(`${ok ? '✅' : '❌'} ${nombre}${ok ? '' : ` — ${detalle}`}`);
  if (!ok) fallos++;
};

const PANAL = '0x2e2e44e7fa6178822d4397299f719e89d1a67777';
const NATIVO = '0x0000000000000000000000000000000000000000';
const AGENTE = '0x8A672775121deb778E19158425B34ee4F85f8539';
const CLIENTE = '0xAAaA000000000000000000000000000000000001';

function ficha(cambios: Partial<AgentProfile> = {}): AgentProfile {
  return {
    address: AGENTE.toLowerCase(),
    owner: AGENTE.toLowerCase(),
    name: 'LexPanal',
    description: 'Resume contratos y documentos legales',
    skills: ['legal'],
    botUrl: 'https://bot.panal.lat',
    metadataURI: '',
    pricePerTask: '1000000000000000000',
    currency: NATIVO,
    coin: 'MON',
    active: true,
    registeredAt: 1_780_000_000,
    fetchedTs: 1_780_000_000,
    idiomas: { en: 'Summarizes contracts and legal documents into plain language' },
    ...cambios,
  };
}
const delCatalogo = (cambios: Partial<AgenteDelCatalogo> = {}): AgenteDelCatalogo => ({
  ...ficha(),
  stats: null,
  nombre: null,
  ...cambios,
});

console.log('\n─── lo que se pinta ───');
{
  const t = tarjetaDe(delCatalogo());
  check('la descripción en inglés si la hay', t.descripcion === 'Summarizes contracts and legal documents into plain language', t.descripcion);
  check('sin inglés, la suya', tarjetaDe(delCatalogo({ idiomas: {} })).descripcion === 'Resume contratos y documentos legales');
  check('el precio con su moneda', t.precio === '1 MON', t.precio);
  check('sin votos no hay nota', t.nota === null && t.votos === 0);
  check('la dirección en minúsculas', t.direccion === AGENTE.toLowerCase());

  const emojis = tarjetaDe(delCatalogo({ name: 'Lex 🐝 Panal' }));
  check('los emojis se quitan del nombre', emojis.nombre === 'Lex Panal', emojis.nombre);
  const chino = tarjetaDe(delCatalogo({ name: '数据助手', description: '把杂乱的文本变成干净的 JSON', idiomas: {} }));
  check('un nombre que no se puede pintar pasa a ser la dirección', chino.nombre === '0x8a67…8539', chino.nombre);
  check('y una descripción que no se puede pintar no sale', chino.descripcion === '', chino.descripcion);
  check('el griego sí se pinta', tarjetaDe(delCatalogo({ name: 'Λέξη' })).nombre === 'Λέξη');

  check('verificado solo si lo está', tarjetaDe(delCatalogo({ verificado: true })).verificado && !tarjetaDe(delCatalogo({ verificado: 'sin-dominio' })).verificado);
  const votado = tarjetaDe(
    delCatalogo({ stats: { address: AGENTE, tasks: 40, completed: 37, avgRating: 4.8333, ratingCount: 12 } as AgenteDelCatalogo['stats'] }),
  );
  check('la nota con un decimal', votado.nota === 4.8 && votado.votos === 12 && votado.completadas === 37, JSON.stringify(votado));
  const porCliente = tarjetaDe(
    delCatalogo({
      stats: { address: AGENTE, tasks: 20, completed: 20, avgRating: 5, ratingCount: 20, clients: 2, ratedClients: 2, clientRating: 4, topClientShare: 0.95 } as AgenteDelCatalogo['stats'],
    }),
  );
  check('con clientes, la nota es la de por cliente, no la media inflada', porCliente.nota === 4 && porCliente.clientes === 2, JSON.stringify(porCliente));
  check('y cambia la huella', huellaDe(porCliente) !== huellaDe(tarjetaDe(delCatalogo({ stats: { address: AGENTE, tasks: 20, completed: 20, avgRating: 5, ratingCount: 20, clients: 1, ratedClients: 1, clientRating: 4, topClientShare: 1 } as AgenteDelCatalogo['stats'] }))));
  check('el alias de PanalNames', tarjetaDe(delCatalogo({ nombre: { nombre: 'lex', desdeTs: 1, origen: 'reclamado' } })).alias === 'lex');
}

console.log('\n─── las cantidades ───');
for (const [wei, esperado] of [
  ['1000000000000000000', '1'],
  ['50000000000000000', '0.05'],
  ['1500000000000000000', '1.5'],
  ['1234567890123456789', '1.234567'],
  ['100000000000', '<0.000001'],
  ['0', '0'],
  ['no-es-un-numero', '?'],
] as const) {
  check(`${wei} → ${esperado}`, cantidad(wei) === esperado, cantidad(wei));
}

console.log('\n─── la huella ───');
{
  const a = huellaDe(tarjetaDe(delCatalogo()));
  check('la misma ficha, la misma huella', a === huellaDe(tarjetaDe(delCatalogo())));
  check('doce caracteres hexadecimales', /^[0-9a-f]{12}$/.test(a), a);
  check('cambia si cambia el precio', a !== huellaDe(tarjetaDe(delCatalogo({ pricePerTask: '2000000000000000000' }))));
  check('cambia si se pausa', a !== huellaDe(tarjetaDe(delCatalogo({ active: false }))));
  check('no cambia por lo que no se pinta', a === huellaDe(tarjetaDe(delCatalogo({ skills: ['otra'], fetchedTs: 5 }))));
}

console.log('\n─── el dibujo ───');
{
  // Un medidor de mentira: 0,55 em por letra. Basta para probar el reparto.
  const falso: Medidor = (s, _f, _p, px) => s.length * px * 0.55;
  const medir = (s: string): number => falso(s, 'Inter', 400, 34);
  const largo = 'palabra '.repeat(80).trim();
  const lineas = partirEnLineas(largo, 1040, 3, medir);
  check('como mucho tres líneas', lineas.length === 3, String(lineas.length));
  check('ninguna se sale', lineas.every((l) => medir(l) <= 1040), lineas.map((l) => medir(l)).join(', '));
  check('la última acaba en «…»', lineas[2]!.endsWith('…'), lineas[2]);
  check('lo corto cabe en una', partirEnLineas('Hola mundo', 1040, 3, medir).join('|') === 'Hola mundo');
  check('sin texto, sin líneas', partirEnLineas('', 1040, 3, medir).length === 0);

  const malicioso = svgDe(tarjetaDe(delCatalogo({ name: '<script>alert("x")</script> & co', idiomas: { en: '</text><image href="https://evil"/>' } })), falso);
  check('el nombre se escapa', !malicioso.includes('<script>') && malicioso.includes('&lt;script&gt;'));
  check('la descripción también', !malicioso.includes('<image') && malicioso.includes('&lt;/text&gt;'));

  const png = dibujar(tarjetaDe(delCatalogo({ verificado: true })));
  check('sale un PNG', png.subarray(1, 4).toString('latin1') === 'PNG');
  check(`de ${ANCHO}×${ALTO}`, png.readUInt32BE(16) === ANCHO && png.readUInt32BE(20) === ALTO, `${png.readUInt32BE(16)}×${png.readUInt32BE(20)}`);
  check('y pesa lo razonable', png.length > 10_000 && png.length < 400_000, String(png.length));
}

console.log('\n─── las rutas del indexador ───');
const dir = mkdtempSync(join(tmpdir(), 'panal-vista-'));
try {
  const store = new IndexStore(dir, PANAL);
  let n = 0;
  const ev = (event: string, args: Record<string, string | number>): IndexedEvent => {
    n += 1;
    const h = `0x${n.toString(16).padStart(64, '0')}`;
    return { id: `${h}-0`, contract: 'escrow', event, blockNumber: n, logIndex: 0, txHash: h, ts: 1_780_000_000 + n, args };
  };
  store.append([
    ev('TaskCreated', { taskId: '1', client: CLIENTE, worker: AGENTE, amount: '1000000000000000000', currency: NATIVO }),
    ev('TaskCompleted', { taskId: '1', worker: AGENTE, workerPaid: '975000000000000000', fee: '25000000000000000', rating: 5 }),
  ]);
  store.upsertProfile(ficha());

  const server = createIndexServer({ store, allowLocalhostOrigin: true });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const dirS = server.address();
  const base = `http://127.0.0.1:${typeof dirS === 'object' && dirS ? dirS.port : 0}`;

  try {
    const r1 = await fetch(`${base}/index/agent?address=${AGENTE}`);
    const b1 = (await r1.json()) as { agent: AgenteDelCatalogo; preview: { image: string } };
    check('/index/agent responde con la ficha', r1.status === 200 && b1.agent.name === 'LexPanal', String(r1.status));
    check('con sus cifras', b1.agent.stats?.completed === 1 && b1.agent.stats?.ratingCount === 1, JSON.stringify(b1.agent.stats));
    check('abierta a cualquier origen', r1.headers.get('access-control-allow-origin') === '*');
    const imagen = b1.preview.image;
    check('y la ruta de su imagen, con huella', /^\/index\/preview\/0x8a672775121deb778e19158425b34ee4f85f8539\.png\?v=[0-9a-f]{12}$/.test(imagen), imagen);

    check('una dirección mal escrita es un 400', (await fetch(`${base}/index/agent?address=0x123`)).status === 400);
    check('un agente que no existe es un 404', (await fetch(`${base}/index/agent?address=0x${'1'.repeat(40)}`)).status === 404);

    const r2 = await fetch(`${base}${imagen}`);
    const png = Buffer.from(await r2.arrayBuffer());
    check('la imagen se sirve', r2.status === 200 && r2.headers.get('content-type') === 'image/png' && png.subarray(1, 4).toString('latin1') === 'PNG');
    check('con su huella, una semana', r2.headers.get('cache-control') === 'public, max-age=604800, immutable', r2.headers.get('cache-control') ?? '');
    const r3 = await fetch(`${base}/index/preview/${AGENTE.toLowerCase()}.png?v=inventada`);
    check('con otra huella, la de ahora y poco rato', r3.status === 200 && r3.headers.get('cache-control') === 'public, max-age=600');
    await r3.arrayBuffer();
    const r4 = await fetch(`${base}/index/preview/${AGENTE}.png`, { method: 'HEAD' });
    check('HEAD también', r4.status === 200 && r4.headers.get('content-length') === String(png.length));
    check('una imagen de nadie es un 404', (await fetch(`${base}/index/preview/0x${'2'.repeat(40)}.png`)).status === 404);
    check('otra ruta parecida, no', (await fetch(`${base}/index/preview/${AGENTE}.jpg`)).status === 404);

    // Cambia el precio: cambia la URL, y la vieja ya no se guarda una semana.
    store.upsertProfile(ficha({ pricePerTask: '2000000000000000000' }));
    const b5 = (await (await fetch(`${base}/index/agent?address=${AGENTE}`)).json()) as { preview: { image: string } };
    check('si cambia el precio, cambia la URL', b5.preview.image !== imagen);
    const r6 = await fetch(`${base}${imagen}`);
    check('y la vieja se sirve poco rato', r6.headers.get('cache-control') === 'public, max-age=600');
    await r6.arrayBuffer();

    store.upsertProfile(ficha({ active: false }));
    check('en pausa sigue teniendo vista previa', (await fetch(`${base}/index/agent?address=${AGENTE}`)).status === 200);
  } finally {
    server.close();
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log(fallos === 0 ? '\n✅ La vista previa se pinta y se sirve bien\n' : `\n❌ ${fallos} comprobación(es) fallidas\n`);
process.exit(fallos === 0 ? 0 : 1);
