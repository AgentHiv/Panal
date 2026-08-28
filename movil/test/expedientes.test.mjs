/**
 * Los expedientes y su copia, sin navegador.
 *
 * Lo que de verdad se comprueba: que una entrega que NO cuadra con el hash de
 * la cadena no se guarda, que el expediente distingue lo que está de lo que se
 * perdió, y que el archivo exportado no depende de ninguna red.
 */
import { webcrypto } from 'node:crypto';
import { keccak256, toBytes } from 'viem';

const disco = new Map();
globalThis.localStorage = {
  getItem: (k) => (disco.has(k) ? disco.get(k) : null),
  setItem: (k, v) => disco.set(k, String(v)),
  removeItem: (k) => disco.delete(k),
};
if (!globalThis.crypto.randomUUID) globalThis.crypto.randomUUID = webcrypto.randomUUID.bind(webcrypto);
// La copia se escribe en el idioma puesto, y el Node del CI detecta el suyo.
// Sin fijarlo, el test comprobaría la traducción en vez del contenido.
disco.set('panal:idioma:v1', 'es');

const ex = await import('../../src/lib/expedientes.ts');
const cp = await import('../src/lib/copia.ts');

let bien = 0, mal = 0;
const dice = (q, c) => { if (c) { bien++; console.log('  ✅', q); } else { mal++; console.log('  ❌', q); } };

const BRIEF = 'Revisa el contrato de escrow y dime qué puede salir mal con los reembolsos.';
const ENTREGA = 'Encontré dos: la reentrada de withdraw() y el redondeo del fee.\n\nAdjunto el parche.';
const hashBrief = keccak256(toBytes(BRIEF));
const hashEntrega = keccak256(toBytes(ENTREGA));

const YO = '0x1111111111111111111111111111111111111111';
const AGENTE = '0x2222222222222222222222222222222222222222';

const tarea = {
  id: 12n,
  client: YO,
  worker: AGENTE,
  amountWei: 12000000000000000000n,
  taskHash: hashBrief,
  resultHash: hashEntrega,
  currency: '0x0000000000000000000000000000000000000000',
  createdAt: 1755100000n,
  deadline: 1755600000n,
  deliveredAt: 1755300000n,
  status: 2,
  role: 'client',
};

console.log('\nguardar una entrega');
dice('una que NO cuadra se rechaza', ex.guardarEntrega('12', 'otra cosa', hashEntrega) === false);
dice('y no queda guardada', ex.leerEntrega('12') === null);
dice('la buena se guarda', ex.guardarEntrega('12', ENTREGA, hashEntrega) === true);
dice('y vuelve a salir', ex.leerEntrega('12').texto === ENTREGA);

console.log('\narmar el expediente, con el brief perdido');
let e = ex.armar(tarea, 'MON', YO);
dice('sabe que no tiene el brief', e.local.brief === null);
dice('briefCuadra es false, no null', e.local.briefCuadra === false);
dice('la entrega sí está', e.local.entrega === ENTREGA);
dice('los campos de la cadena salen enteros', e.cadena.taskHash === hashBrief && e.cadena.resultHash === hashEntrega);
dice('las fechas pasan a milisegundos', e.cadena.creado === 1755100000000);

console.log('\ncon el brief guardado');
disco.set('panal:taskBriefs:v1', JSON.stringify({ [hashBrief.toLowerCase()]: BRIEF }));
e = ex.armar(tarea, 'MON', YO);
dice('ahora está', e.local.brief === BRIEF);
dice('y cuadra con la cadena', e.local.briefCuadra === true);

console.log('\nun brief que no es el suyo');
disco.set('panal:taskBriefs:v1', JSON.stringify({ [hashBrief.toLowerCase()]: 'texto cambiado' }));
e = ex.armar(tarea, 'MON', YO);
dice('lo enseña igual', e.local.brief === 'texto cambiado');
dice('pero avisa de que NO cuadra', e.local.briefCuadra === false);
disco.set('panal:taskBriefs:v1', JSON.stringify({ [hashBrief.toLowerCase()]: BRIEF }));

console.log('\nel hilo es del par cliente|agente');
disco.set('panal:hilos:v1', JSON.stringify({
  [`${YO.toLowerCase()}|${AGENTE.toLowerCase()}`]: [
    { id: 'a', de: 'yo', texto: 'Hola', cuando: 1755000000000 },
    { id: 'b', de: 'agente', texto: 'Dime', cuando: 1755000100000 },
  ],
}));
e = ex.armar(tarea, 'MON', YO);
dice('sale el hilo entero', e.local.hilo.length === 2);
const comoTrabajador = ex.armar({ ...tarea, role: 'worker' }, 'MON', YO);
dice('como trabajador NO se ve la conversación del cliente', comoTrabajador.local.hilo.length === 0);

console.log('\nla salud del archivo');
const s = ex.salud();
dice('cuenta los briefs', s.briefs === 1);
dice('cuenta los hilos', s.hilos === 1);
dice('cuenta las entregas', s.entregas === 1);
dice('con uno de 200 no está apretado', s.apretado === false);
disco.set('panal:taskBriefs:v1', JSON.stringify(Object.fromEntries(
  Array.from({ length: 190 }, (_, i) => [`0x${i}`, 'x']),
)));
dice('a 190 de 200 sí avisa', ex.salud().apretado === true);
disco.set('panal:taskBriefs:v1', JSON.stringify({ [hashBrief.toLowerCase()]: BRIEF }));

console.log('\nel archivo que se saca');
e = ex.armar(tarea, 'MON', YO);
const html = cp.aHtml(e);
dice('lleva el brief dentro', html.includes(BRIEF));
dice('lleva la entrega dentro', html.includes('reentrada de withdraw()'));
dice('lleva los dos hashes', html.includes(hashBrief) && html.includes(hashEntrega));
dice('lleva el hilo', html.includes('Hola') && html.includes('Dime'));
dice('el importe sale bien, no 12000000000000000000', html.includes('12 MON'));
dice('NO pide nada a ningún servidor',
  !/(src|href)=["']https?:/i.test(html) && !/fetch\(|XMLHttpRequest|<script/i.test(html));
dice('el nombre se ordena por fecha', /^panal-encargo-12-\d{4}-\d{2}-\d{2}\.html$/.test(cp.nombreDe(e)));

console.log('\ny escapa lo que viene de fuera');
const malo = ex.armar({ ...tarea, id: 13n }, 'MON', YO);
malo.local.brief = '<script>alert(1)</script>';
malo.local.briefCuadra = false;
const htmlMalo = cp.aHtml(malo);
dice('un brief con etiquetas no se convierte en HTML', !htmlMalo.includes('<script>alert'));
dice('sale escapado', htmlMalo.includes('&lt;script&gt;'));

console.log('\nla copia de todo');
const todo = cp.todoAHtml([e, malo], YO);
dice('lleva los dos encargos', todo.includes('Encargo #12') && todo.includes('Encargo #13'));
dice('tiene índice con anclas', todo.includes('href="#e12"') && todo.includes('id="e13"'));
dice('no se cuela un <html> anidado', (todo.match(/<html/g) ?? []).length === 1);
dice('tampoco pide red', !/(src|href)=["']https?:/i.test(todo));

console.log('\ndisco corrupto');
disco.set('panal:entregas:v1', '{roto');
dice('leerEntrega no revienta', ex.leerEntrega('12') === null);
dice('salud tampoco', ex.salud().entregas === 0);

console.log('\nsi hay entrega o todavía no');
// Lo preguntan DOS pantallas —el archivo de la web y la tabla del dashboard— y
// de la respuesta depende que salga o no el botón de ver lo que se pagó. Si
// cada una lo decidiera por su cuenta, no fallaría nada: simplemente en una
// habría puerta y en la otra no.
const CERO = `0x${'0'.repeat(64)}`;
dice('el hash a cero es «todavía nada»', ex.hayEntrega(CERO) === false);
dice('en mayúsculas, también', ex.hayEntrega(CERO.toUpperCase().replace('0X', '0x')) === false);
dice('un hash de verdad sí es entrega', ex.hayEntrega(hashEntrega) === true);
dice('y en otro caso el mismo hash cuenta igual', ex.hayEntrega(hashEntrega.toUpperCase().replace("0X", "0x")) === true);

console.log(`\n${bien} bien, ${mal} mal\n`);
process.exit(mal ? 1 : 0);
