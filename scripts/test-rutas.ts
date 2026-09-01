/**
 * Las rutas de un agente que NO vive en la raíz de su dominio.
 *
 *     npx tsx scripts/test-rutas.ts
 *
 * ───────────────────────────────────────────────────────────────────────────
 * LO QUE ESTABA ROTO
 *
 * Todos los agentes de Panal vivían en la raíz de un dominio suyo
 * —`https://bot.panal.lat`—, así que componer sus rutas con
 * `new URL('/brief/12', base)` funcionaba y nadie tenía por qué mirarlo.
 *
 * El buzón cambia eso: quien no tiene servidor propio recibe en
 * `https://api.panal.lat/buzon/0xSuDirección`, o sea en un SUBCAMINO. Y
 * `new URL()` con una ruta absoluta descarta el camino de la base, así que el
 * encargo se le mandaba a `https://api.panal.lat/brief/12`, que no es de
 * nadie.
 *
 * Lo que se rompe así no da la cara: el 404 se lee como «ese agente no
 * contesta» con el pago YA bloqueado, y a las 72 h se libera solo. El cliente
 * paga, no recibe, y el agente cobra sin haberse enterado de nada.
 *
 * Por eso la unión se hace en un sitio —`rutaDeAgente`, en el SDK— y esto
 * comprueba que las dos formas de agente salen bien por las cuatro capas que
 * componen rutas: el cliente del SDK, el MCP, la web y la plantilla.
 * ───────────────────────────────────────────────────────────────────────────
 */
import { fichaEnIdioma, fileUrl, rutaDeAgente, type DeliveredFile } from '@panal/sdk';
import {
  buildBriefUrl,
  buildResultUrl,
  buildUploadUrl,
  urlDeBuzon,
} from '../src/lib/botEndpoint.js';

let fallos = 0;
const check = (nombre: string, ok: boolean, detalle = ''): void => {
  console.log(`${ok ? '✅' : '❌'} ${nombre}${ok ? '' : ` — ${detalle}`}`);
  if (!ok) fallos++;
};

/** Un agente con su propia máquina, y otro que recibe en el buzón. */
const PROPIO = 'https://bot.panal.lat';
const BUZON = urlDeBuzon('0x1558cF6a5d9C4d6C0dE7b4b0a2b1D8a3f5E6c7B8');

console.log('\n── El de siempre sigue igual ──\n');

check('brief', rutaDeAgente(PROPIO, 'brief/12') === 'https://bot.panal.lat/brief/12');
check('con barra delante, lo mismo', rutaDeAgente(PROPIO, '/brief/12') === 'https://bot.panal.lat/brief/12');
check('y con barra al final de la base también', rutaDeAgente(`${PROPIO}/`, 'brief/12') === 'https://bot.panal.lat/brief/12');
check('agent.json', rutaDeAgente(PROPIO, 'agent.json') === 'https://bot.panal.lat/agent.json');

console.log('\n── Y el del buzón cuelga de SU sitio ──\n');

check(
  'brief',
  rutaDeAgente(BUZON, 'brief/12') ===
    'https://api.panal.lat/buzon/0x1558cF6a5d9C4d6C0dE7b4b0a2b1D8a3f5E6c7B8/brief/12',
  rutaDeAgente(BUZON, 'brief/12'),
);
check(
  'una ruta absoluta NO se lleva por delante el camino',
  rutaDeAgente(BUZON, '/result/12') ===
    'https://api.panal.lat/buzon/0x1558cF6a5d9C4d6C0dE7b4b0a2b1D8a3f5E6c7B8/result/12',
  rutaDeAgente(BUZON, '/result/12'),
);
// Esto es lo que hacía `new URL()` y por lo que hubo que cambiarlo.
check(
  'que es justo lo que new URL() hacía mal',
  new URL('/brief/12', BUZON).toString() === 'https://api.panal.lat/brief/12',
);

console.log('\n── Las cuatro capas componen igual ──\n');

for (const [nombre, base] of [
  ['con servidor propio', PROPIO],
  ['con buzón', BUZON],
] as const) {
  const raiz = base.replace(/\/+$/, '');
  check(`${nombre}: la web manda el brief a su sitio`, buildBriefUrl(base, 12n) === `${raiz}/brief/12`);
  check('  y pide el resultado a su sitio', buildResultUrl(base, 12n) === `${raiz}/result/12`);
  check('  y sube los adjuntos a su sitio', buildUploadUrl(base, 12n) === `${raiz}/upload/12`);
  check('  y la ficha, con idioma y todo', fichaEnIdioma(base, 'fr') === `${raiz}/agent.json?lang=fr`);
  check('  igual que el SDK y el MCP', rutaDeAgente(base, 'agent.json') === `${raiz}/agent.json`);
}

console.log('\n── Los archivos entregados, que traen su ruta escrita ──\n');

/**
 * Aquí la ruta la escribe QUIEN ENTREGA, dentro del manifiesto anclado, y hay
 * de las dos formas: los agentes de siempre anuncian `/files/…` y los del
 * buzón `archivo/…`. Las dos tienen que caer donde su agente sirve.
 */
const deSiempre: DeliveredFile = {
  name: 'informe.pdf',
  size: 10,
  hash: `0x${'11'.repeat(32)}`,
  path: '/files/12/informe.pdf',
};
const deBuzon: DeliveredFile = { ...deSiempre, path: 'archivo/12/informe.pdf' };

check(
  'el de siempre, en la raíz de su dominio',
  fileUrl(deSiempre, PROPIO) === 'https://bot.panal.lat/files/12/informe.pdf',
  fileUrl(deSiempre, PROPIO),
);
check(
  'el del buzón, dentro de su buzón',
  fileUrl(deBuzon, BUZON) ===
    'https://api.panal.lat/buzon/0x1558cF6a5d9C4d6C0dE7b4b0a2b1D8a3f5E6c7B8/archivo/12/informe.pdf',
  fileUrl(deBuzon, BUZON),
);

console.log(
  fallos === 0
    ? '\n✅ Un agente que vive en un subcamino recibe sus encargos donde vive\n'
    : `\n❌ ${fallos} comprobación(es) fallidas: alguna capa manda las peticiones a la raíz del dominio\n`,
);
process.exit(fallos === 0 ? 0 : 1);
