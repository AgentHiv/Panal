/**
 * El Worker de panal.lat pone la vista previa de cada agente en su ficha.
 *
 *   pnpm exec vite build && pnpm exec tsx scripts/test-vista-previa-web.ts
 *
 * Usa el `dist/index.html` del build, que es lo que reescribe el Worker en
 * producción: si alguien cambia o quita una etiqueta de `index.html`, la
 * vista previa saldría a medias sin que nadie lo notara. El indexador y el
 * almacén de Cloudflare se simulan; la imagen la prueba el bot
 * (`bot/scripts/test-vista-previa.ts`).
 */

import { existsSync, readFileSync } from 'node:fs';
import worker from '../worker/index';
import { CABECERAS } from '../worker/cabeceras';
import { ETIQUETAS, cantidad, direccionDeId, metaDeAgente, reescribirHtml, type RespuestaDelIndice } from '../worker/vista-previa';

let fallos = 0;
const check = (nombre: string, ok: boolean, detalle = ''): void => {
  console.log(`${ok ? '✅' : '❌'} ${nombre}${ok ? '' : ` — ${detalle}`}`);
  if (!ok) fallos++;
};

const AGENTE = '0x8a672775121deb778e19158425b34ee4f85f8539';
const ID = `onchain-${AGENTE}`;
const indice = (cambios: Partial<RespuestaDelIndice['agent']> = {}): RespuestaDelIndice => ({
  agent: {
    address: AGENTE,
    name: 'LexPanal',
    description: 'Resume contratos',
    idiomas: { en: 'Summarizes contracts and legal documents into plain language' },
    pricePerTask: '1000000000000000000',
    coin: 'MON',
    active: true,
    stats: { completed: 37, avgRating: 4.8333, ratingCount: 12 },
    ...cambios,
  },
  preview: { image: `/index/preview/${AGENTE}.png?v=abcdef012345` },
});

const html = existsSync('dist/index.html')
  ? readFileSync('dist/index.html', 'utf8')
  : readFileSync('index.html', 'utf8').replaceAll('%SITE_URL%', 'https://panal.lat');
if (!existsSync('dist/index.html')) console.log('(sin dist/: se usa index.html; en el CI va después del build)');

console.log('\n─── las cabeceras son las de _headers ───');
{
  const texto = readFileSync('public/_headers', 'utf8').split('\n');
  const desde = texto.indexOf('/*');
  const bloque: Record<string, string> = {};
  for (const linea of texto.slice(desde + 1)) {
    if (!linea.trim()) break;
    const i = linea.indexOf(':');
    bloque[linea.slice(0, i).trim()] = linea.slice(i + 1).trim();
  }
  check('el bloque /* existe', desde >= 0 && Object.keys(bloque).length > 0);
  check(
    'worker/cabeceras.ts dice lo mismo que public/_headers',
    JSON.stringify(Object.entries(bloque).sort()) === JSON.stringify(Object.entries(CABECERAS).sort()),
    'si se cambia una, hay que cambiar la otra',
  );
}

console.log('\n─── el id y las cifras ───');
check('el id de una ficha da su dirección', direccionDeId(`onchain-${AGENTE.toUpperCase().replace('0X', '0x')}`) === AGENTE);
check('lo demás, no', [AGENTE, 'onchain-0x123', 'onchain-0xzz2775121deb778e19158425b34ee4f85f8539', ''].every((s) => direccionDeId(s) === null));
for (const [wei, esperado] of [
  ['1000000000000000000', '1'],
  ['50000000000000000', '0.05'],
  ['1234567890123456789', '1.234567'],
  ['100000000000', '<0.000001'],
  ['0', '0'],
  ['nada', '?'],
] as const) {
  check(`${wei} → ${esperado}`, cantidad(wei) === esperado, cantidad(wei));
}

console.log('\n─── lo que dice la vista previa ───');
{
  const m = metaDeAgente(indice(), ID);
  check('el título lleva su nombre', m.titulo === 'LexPanal — Panal', m.titulo);
  check(
    'la descripción, a qué se dedica y sus cifras',
    m.descripcion === 'Summarizes contracts and legal documents into plain language · 1 MON per task · ★ 4.8 (12 ratings) · 37 jobs completed',
    m.descripcion,
  );
  check('la URL, la de su ficha', m.url === `https://panal.lat/agente/${ID}`, m.url);
  check('la imagen, en el indexador', m.imagen === `https://api.panal.lat/index/preview/${AGENTE}.png?v=abcdef012345`, String(m.imagen));
  const nuevo = metaDeAgente(indice({ stats: null, active: false, idiomas: {} }), ID);
  check('en pausa y sin votos, lo dice', nuevo.descripcion === 'Paused · Resume contratos · 1 MON per task · no ratings yet · 0 jobs completed', nuevo.descripcion);
  const raro = metaDeAgente({ ...indice(), preview: { image: 'https://evil.example/x.png' } }, ID);
  check('una imagen que no es del indexador no se pone', raro.imagen === null);
  const largo = metaDeAgente(indice({ idiomas: { en: 'palabra '.repeat(100) } }), ID);
  check('una descripción larga se corta', largo.descripcion.length < 300 && largo.descripcion.includes('… · 1 MON'), largo.descripcion);
}

/**
 * Los bloques de script de un HTML, tal cual. La CSP deja correr el de arranque
 * por su huella: si la reescritura lo tocara, en producción no arrancaría.
 * Sin expresión regular a propósito: aquí solo se comparan, no se filtra nada.
 */
function scripts(h: string): string[] {
  const bajo = h.toLowerCase();
  const out: string[] = [];
  let i = bajo.indexOf('<script');
  while (i !== -1) {
    const fin = bajo.indexOf('</script', i);
    if (fin === -1) break;
    out.push(h.slice(i, fin));
    i = bajo.indexOf('<script', fin);
  }
  return out;
}

console.log('\n─── el HTML ───');
{
  const { html: nuevo, cambiadas } = reescribirHtml(html, metaDeAgente(indice(), ID));
  const faltan = ETIQUETAS.filter((e) => !cambiadas.includes(e));
  check('encuentra todas las etiquetas de index.html', faltan.length === 0, `faltan: ${faltan.join(', ')}`);
  check('el título', nuevo.includes('<title>LexPanal — Panal</title>'));
  check('og:title', nuevo.includes('<meta property="og:title" content="LexPanal — Panal" />'));
  check('og:image', nuevo.includes(`<meta property="og:image" content="https://api.panal.lat/index/preview/${AGENTE}.png?v=abcdef012345" />`));
  check('twitter:image', nuevo.includes(`<meta name="twitter:image" content="https://api.panal.lat/index/preview/${AGENTE}.png?v=abcdef012345" />`));
  check('las medidas de la imagen', nuevo.includes('<meta property="og:image:width" content="1200" />') && nuevo.includes('og:image:height" content="630"'));
  check('canonical', nuevo.includes(`<link rel="canonical" href="https://panal.lat/agente/${ID}" />`));
  check('ya no queda el título de la portada', !nuevo.includes('<meta property="og:title" content="Panal — AI agents'));
  check('los scripts siguen igual', JSON.stringify(scripts(html)) === JSON.stringify(scripts(nuevo)) && scripts(html).length > 0);

  const malo = reescribirHtml(html, metaDeAgente(indice({ name: '"><script>alert(1)</script>', idiomas: { en: '</title><img src=x onerror=alert(1)>' } }), ID)).html;
  check('un nombre con HTML se escapa', !malo.includes('<script>alert(1)') && malo.includes('&quot;&gt;&lt;script&gt;'));
  check('y una descripción también', !malo.includes('<img src=x'));
}

console.log('\n─── el Worker ───');
{
  type Fetch = typeof globalThis.fetch;
  const fetchOriginal: Fetch = globalThis.fetch;
  let pedidas: string[] = [];
  const conIndice = (responder: (url: string) => Response | Promise<Response>): void => {
    pedidas = [];
    globalThis.fetch = (async (entrada: RequestInfo | URL) => {
      const url = String(entrada instanceof Request ? entrada.url : entrada);
      pedidas.push(url);
      return responder(url);
    }) as Fetch;
  };
  const env = {
    ASSETS: {
      fetch: async (req: Request): Promise<Response> =>
        new Response(req.method === 'HEAD' ? null : html, {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8', etag: '"abc"', 'cache-control': 'public, max-age=0, must-revalidate' },
        }),
    },
  };
  const pedir = (ruta: string, method = 'GET'): Promise<Response> => worker.fetch(new Request(`https://panal.lat${ruta}`, { method }), env);

  try {
    conIndice(() => Response.json(indice()));
    const r1 = await pedir(`/agente/${ID}`);
    const t1 = await r1.text();
    check('la ficha sale con su vista previa', r1.status === 200 && t1.includes('<title>LexPanal — Panal</title>'));
    check('pregunta al indexador por esa dirección', pedidas[0] === `https://api.panal.lat/index/agent?address=${AGENTE}`, pedidas.join());
    check('con las cabeceras de seguridad', r1.headers.get('content-security-policy') === CABECERAS['Content-Security-Policy'] && r1.headers.get('x-frame-options') === 'DENY');
    check('sin la ETag del archivo', r1.headers.get('etag') === null);
    check('y como HTML', (r1.headers.get('content-type') ?? '').startsWith('text/html'));

    const r2 = await pedir(`/agente/${ID}`, 'HEAD');
    check('HEAD, sin cuerpo', r2.status === 200 && (await r2.text()) === '');

    conIndice(() => Response.json({ error: 'agent not found' }, { status: 404 }));
    const r3 = await pedir(`/agente/onchain-0x${'1'.repeat(40)}`);
    const t3 = await r3.text();
    check('un agente que no existe: la página de siempre', r3.status === 200 && t3 === html);
    check('también con sus cabeceras', r3.headers.get('content-security-policy') === CABECERAS['Content-Security-Policy']);

    conIndice(() => {
      throw new Error('timeout');
    });
    const r4 = await pedir(`/agente/${ID}`);
    check('si el indexador falla: la página de siempre', r4.status === 200 && (await r4.text()) === html);

    conIndice(() => new Response('<html>no es json</html>', { status: 200 }));
    const r5 = await pedir(`/agente/${ID}`);
    check('si responde otra cosa: la página de siempre', (await r5.text()) === html);

    conIndice(() => Response.json(indice()));
    const r6 = await pedir('/agente/lo-que-sea');
    check('un id que no es de agente no pregunta a nadie', pedidas.length === 0 && (await r6.text()) === html);
    const r7 = await pedir('/agente/%E0%A4%A');
    check('ni uno mal codificado', r7.status === 200 && pedidas.length === 0);
    await r7.text();
    const r8 = await pedir('/mercado');
    check('otra ruta pasa tal cual, con sus cabeceras', pedidas.length === 0 && r8.headers.get('x-frame-options') === 'DENY');
    await r8.text();
  } finally {
    globalThis.fetch = fetchOriginal;
  }
}

console.log(fallos === 0 ? '\n✅ La ficha de cada agente sale con su vista previa\n' : `\n❌ ${fallos} comprobación(es) fallidas\n`);
process.exit(fallos === 0 ? 0 : 1);
