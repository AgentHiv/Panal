/**
 * Pruebas de los niveles dentro del metadataURI on-chain.
 *
 *   npx tsx test/niveles.test.ts
 *
 * HERMÉTICO: no toca la red.
 *
 * Lo que se protege aquí es que meter niveles en la ficha no se coma nada de
 * lo que ya había. El `metadataURI` reparte posiciones —primer segmento el
 * nombre, segundo la descripción, tercero las skills— y un token que no se
 * aparte las corre: es EXACTAMENTE el fallo que documenta `marca.ts`, donde un
 * `logo:https://…` acababa anunciado como skill del agente.
 *
 * Y al revés, que es lo que de verdad muerde: la descripción es texto libre y
 * alguien escribirá «nivel: depende del encargo» dentro de ella. Si eso contara
 * como nivel, el agente tendría un nivel fantasma de precio inventado Y habría
 * perdido media descripción, sin ningún error por ninguna parte.
 */

import {
  componerNivel,
  esTokenDeNivel,
  leerNivelDeSegmento,
  leerNivelesDeMetadata,
  precioAWei,
  weiAPrecio,
} from '../src/niveles.js';
import { nivelPara } from '../src/agent-card.js';

/** `JSON.stringify` no sabe serializar un bigint, y el precio lo es. */
const vista = (v: unknown): string => JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? `${x}n` : x));

let fallos = 0;
const check = (nombre: string, ok: boolean, detalle = ''): void => {
  console.log(`${ok ? '✅' : '❌'} ${nombre}${ok ? '' : ` — ${detalle}`}`);
  if (!ok) fallos++;
};

console.log('\nel precio, que es lo único que se cobra de verdad');
check('0.03 son 3e16 wei', precioAWei('0.03') === 30000000000000000n);
check('1 es un ether entero', precioAWei('1') === 1000000000000000000n);
check('0.000000000000000001 es un wei', precioAWei('0.000000000000000001') === 1n);
check('el cero no es un precio', precioAWei('0') === null);
check('ni el 0.0', precioAWei('0.0') === null);
check('ni un negativo', precioAWei('-1') === null);
check('ni notación científica', precioAWei('1e18') === null);
check('ni con diecinueve decimales', precioAWei('0.0000000000000000001') === null);
check('ni texto', precioAWei('gratis') === null);
check('ni vacío', precioAWei('') === null);

console.log('\ny da la vuelta sin ceros de relleno, que en la cadena se pagan');
check('3e16 se escribe 0.03', weiAPrecio(30000000000000000n) === '0.03');
check('1e18 se escribe 1', weiAPrecio(1000000000000000000n) === '1');
check('un wei se escribe entero', weiAPrecio(1n) === '0.000000000000000001');
const ida = ['0.03', '1', '0.5', '12.75', '0.000000000000000001'];
check(
  'ida y vuelta para todos',
  ida.every((p) => weiAPrecio(precioAWei(p)!) === p),
  ida.find((p) => weiAPrecio(precioAWei(p)!) !== p),
);

console.log('\nleer un nivel de su segmento');
const basico = leerNivelDeSegmento('nivel:0.03|Un archivo');
check('precio y nombre bastan', basico?.name === 'Un archivo' && basico.wei === 30000000000000000n);
check('sin descripción queda en null', basico?.description === null);
check('y sin topes también', basico?.maxBriefChars === null);

const lleno = leerNivelDeSegmento('nivel:0.3|El repositorio|Un proyecto entero|120000|120000|200000');
check('con descripción', lleno?.description === 'Un proyecto entero');
check('con tope de encargo', lleno?.maxBriefChars === 120000);
check('con tope por adjunto', lleno?.maxAttachChars === 120000);
check('con tope de todos los adjuntos', lleno?.maxAttachCharsTotal === 200000);

check('se perdonan los espacios', leerNivelDeSegmento(' nivel: 0.03 | Un archivo ')?.name === 'Un archivo');
check('y las mayúsculas de la clave', leerNivelDeSegmento('NIVEL:0.03|Un archivo') !== null);

console.log('\nLO QUE NO ES UN NIVEL, que es casi todo lo que pasa por aquí');
const noSon = [
  'LexPanal',
  'Resume contratos en lenguaje claro',
  'legal, contracts, resumen',
  'bot:https://bot.panal.lat',
  'logo:https://lint.panal.lat/logo.svg',
  'x:panal_mon',
  // La trampa: una descripción que habla de niveles.
  'nivel: depende del encargo',
  'Tiene tres niveles: mira la ficha',
  'nivel:',
  'nivel:|Un archivo',
  // Sin nombre no hay nivel: un botón con precio y sin texto no es una oferta.
  'nivel:0.03',
  'nivel:0.03|',
  'nivel:0.03|   ',
  // Un precio que no es un precio.
  'nivel:gratis|Un archivo',
  'nivel:0|Un archivo',
];
for (const s of noSon) check(`«${s.slice(0, 34)}» no es un nivel`, !esTokenDeNivel(s), vista(leerNivelDeSegmento(s)));

console.log('\nuna ficha entera, con niveles entre lo demás');
const ficha =
  'Lint · Revisa código y dice qué se rompe · code, review, solidity · ' +
  'bot:https://lint.panal.lat · logo:https://lint.panal.lat/logo.svg · ' +
  'nivel:0.09|Un módulo|Varios ficheros relacionados|60000 · ' +
  'nivel:0.03|Un archivo|Un fichero o un fragmento · ' +
  'nivel:0.3|El repositorio|Un proyecto entero comprimido|120000|120000|200000';
const leidos = leerNivelesDeMetadata(ficha);
check('salen los tres', leidos.length === 3, String(leidos.length));
check(
  'ORDENADOS de menor a mayor aunque en la ficha estén desordenados',
  leidos.map((n) => n.name).join(' < ') === 'Un archivo < Un módulo < El repositorio',
  leidos.map((n) => n.name).join(' < '),
);
check(
  'y `nivelPara` sigue funcionando con ellos',
  nivelPara(leidos, 100000000000000000n)?.name === 'Un módulo',
);

console.log('\nun nivel roto se cae solo, no tumba a los de al lado');
const conRoto = 'A · b · c · nivel:0.03|Bueno · nivel:XXX|Malo · nivel:0.3|También bueno';
const sanos = leerNivelesDeMetadata(conRoto);
check('quedan los dos buenos', sanos.length === 2, String(sanos.length));
check('y son los que se escribieron bien', sanos[0]?.name === 'Bueno' && sanos[1]?.name === 'También bueno');

console.log('\nsin niveles es SIN NIVELES, no un nivel inventado del precio suelto');
check('una ficha de las de hoy da lista vacía', leerNivelesDeMetadata(
  'LexPanal · Resume contratos · legal · bot:https://bot.panal.lat',
).length === 0);
check('y una ficha vacía también', leerNivelesDeMetadata('').length === 0);
check('y null, sin reventar', leerNivelesDeMetadata(null).length === 0);

console.log('\nescribir el segmento');
check(
  'lo mínimo son precio y nombre',
  componerNivel({ name: 'Un archivo', precio: '0.03' }) === 'nivel:0.03|Un archivo',
);
check(
  'los vacíos DEL FINAL no se escriben',
  componerNivel({ name: 'Un archivo', precio: '0.03', description: '', maxBriefChars: null }) ===
    'nivel:0.03|Un archivo',
);
check(
  'pero un hueco en medio se respeta, o el siguiente campo ocuparía su sitio',
  componerNivel({ name: 'Un archivo', precio: '0.03', description: '', maxBriefChars: 60000 }) ===
    'nivel:0.03|Un archivo||60000',
);
check(
  'entero',
  componerNivel({
    name: 'El repositorio',
    precio: '0.3',
    description: 'Un proyecto entero',
    maxBriefChars: 120000,
    maxAttachChars: 120000,
    maxAttachCharsTotal: 200000,
  }) === 'nivel:0.3|El repositorio|Un proyecto entero|120000|120000|200000',
);

console.log('\ny se NIEGA a escribir lo que diría otra cosa al leerse');
check('un «·» partiría la ficha en dos', componerNivel({ name: 'Un · archivo', precio: '0.03' }) === null);
check('un «|» correría los campos', componerNivel({ name: 'Un | archivo', precio: '0.03' }) === null);
check('y en la descripción igual', componerNivel({ name: 'A', precio: '0.03', description: 'x · y' }) === null);
check('sin nombre no se escribe', componerNivel({ name: '  ', precio: '0.03' }) === null);
check('con un precio imposible tampoco', componerNivel({ name: 'A', precio: 'gratis' }) === null);
check('ni con un nombre de 61 caracteres', componerNivel({ name: 'x'.repeat(61), precio: '0.03' }) === null);

console.log('\ny lo que se escribe se vuelve a leer igual');
const vueltas = [
  { name: 'Un archivo', precio: '0.03' },
  { name: 'Un módulo', precio: '0.09', description: 'Varios ficheros', maxBriefChars: 60000 },
  { name: 'El repositorio', precio: '0.3', description: 'Todo', maxBriefChars: 1, maxAttachChars: 2, maxAttachCharsTotal: 3 },
];
for (const v of vueltas) {
  const leido = leerNivelDeSegmento(componerNivel(v)!);
  check(
    `«${v.name}» sobrevive a la ida y vuelta`,
    leido?.name === v.name &&
      leido.wei === precioAWei(v.precio) &&
      (leido.description ?? '') === (v.description ?? '') &&
      (leido.maxBriefChars ?? null) === (v.maxBriefChars ?? null),
    vista(leido),
  );
}

console.log(fallos === 0 ? '\nTodo bien.' : `\n${fallos} mal.`);
process.exit(fallos === 0 ? 0 : 1);
