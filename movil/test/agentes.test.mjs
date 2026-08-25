/**
 * La guardia y la ficha del agente, sin cadena y sin navegador.
 *
 * Lo que de verdad se comprueba: que la guardia no se calle nada de lo que hay
 * abierto, que ordene por lo que vence antes, y que la ficha se parta y se
 * arme igual que las nueve que hay escritas en mainnet.
 */
import { revisar, cuantasUrgentes } from '../src/lib/guardia.ts';
import { armarFicha, partirFicha, esDireccion } from '../src/lib/ficha.ts';

let bien = 0, mal = 0;
const dice = (q, c) => { if (c) { bien++; console.log('  ✅', q); } else { mal++; console.log('  ❌', q); } };

const AHORA = 1_755_000_000_000;
const s = (ms) => BigInt(Math.floor(ms / 1000));
const simboloDe = (m) => (m === '0xpanal' ? '$PANAL' : 'MON');
const SIN = { panal: 0n, mon: 0n };

const abierta = (id, venceEn) => ({
  id: BigInt(id), amountWei: 15_000n * 10n ** 18n, currency: '0xpanal',
  deadline: s(AHORA + venceEn), status: 0,
});
const entregada = (id, hace) => ({
  id: BigInt(id), amountWei: 12n * 10n ** 18n, currency: '0x0',
  deadline: s(AHORA + 86_400_000), status: 1, deliveredAt: s(AHORA - hace),
});
const disputada = (id) => ({
  id: BigInt(id), amountWei: 12n * 10n ** 18n, currency: '0x0',
  deadline: s(AHORA), status: 3,
});
const cobrada = (id) => ({
  id: BigInt(id), amountWei: 1n * 10n ** 18n, currency: '0x0',
  deadline: s(AHORA), status: 2,
});

console.log('\nlo que sale y lo que no');
let f = revisar([abierta(54, 21 * 3_600_000), cobrada(50), disputada(61)], SIN, simboloDe);
dice('una abierta sale', f.some((x) => x.motivo === 'sin-entregar' && x.ref === '#54'));
dice('una disputada sale', f.some((x) => x.motivo === 'disputa' && x.ref === '#61'));
dice('una ya cobrada NO sale', !f.some((x) => x.ref === '#50'));
dice('nada más', f.length === 2);

console.log('\nel dinero sin cobrar va el primero');
f = revisar([abierta(54, 3_600_000)], { panal: 2_203_750_000_000_000_000_000n, mon: 0n }, simboloDe);
dice('sale como fila propia', f[0].motivo === 'sin-cobrar');
dice('con su símbolo', f[0].simbolo === '$PANAL');
dice('y el símbolo también de referencia, para no salir dos filas iguales', f[0].ref === '$PANAL');
dice('y por delante de lo abierto', f[1].motivo === 'sin-entregar');
dice('cero no genera fila', revisar([], SIN, simboloDe).length === 0);

console.log('\ndos monedas, dos filas');
f = revisar([], { panal: 100n, mon: 50n }, simboloDe);
dice('son dos, no una suma', f.length === 2);
dice('cada una con su símbolo', new Set(f.map((x) => x.simbolo)).size === 2);
dice('y se distinguen en pantalla', f[0].ref !== f[1].ref);

console.log('\nel orden es el del reloj, no el del id');
f = revisar([abierta(10, 40 * 3_600_000), abierta(99, 2 * 3_600_000)], SIN, simboloDe);
dice('primero la que vence antes', f[0].ref === '#99');
dice('aunque tenga el id más alto', f[1].ref === '#10');

console.log('\nlo que no tiene reloj va detrás de lo que sí');
f = revisar([disputada(61), abierta(54, 3_600_000)], SIN, simboloDe);
dice('la abierta con plazo va delante', f[0].ref === '#54');
dice('la disputa, sin reloj, detrás', f[1].ref === '#61');

console.log('\nqué corre prisa');
f = revisar([abierta(54, 3_600_000), entregada(57, 3_600_000), disputada(61)], SIN, simboloDe);
dice('abierta y disputa sí', cuantasUrgentes(f) === 2);
dice('entregada esperando al cliente NO', !f.find((x) => x.motivo === 'sin-aprobar').urgente);

console.log('\nla cuenta atrás de los tres días');
f = revisar([entregada(57, 6 * 3_600_000)], SIN, simboloDe);
const quedan = (f[0].vence - AHORA) / 3_600_000;
dice('quedan 66 h desde una entrega de hace 6', Math.round(quedan) === 66);
f = revisar([{ ...entregada(57, 0), deliveredAt: undefined }], SIN, simboloDe);
dice('sin deliveredAt no se inventa reloj', f[0].vence === null);

console.log('\nuna vencida sigue estando');
f = revisar([abierta(54, -5 * 3_600_000)], SIN, simboloDe);
dice('no desaparece por haber vencido', f.length === 1);
dice('y su plazo queda en el pasado', f[0].vence < AHORA);

console.log('\nla ficha es texto, no JSON');
const uri = 'Audit · Audita contratos y entrega el informe · bot:https://audit.panal.lat';
let p = partirFicha(uri);
dice('el nombre es la primera parte', p.nombre === 'Audit');
dice('la descripción, el resto sin el bot:', p.descripcion === 'Audita contratos y entrega el informe');
dice('se vuelve a armar igual', armarFicha(p.nombre, p.descripcion, 'https://audit.panal.lat') === uri);

console.log('\nfichas raras');
dice('una sin bot: se parte igual', partirFicha('LexPanal · Contratos').nombre === 'LexPanal');
dice('una de una sola parte', partirFicha('Solo').nombre === 'Solo');
dice('y su descripción queda vacía', partirFicha('Solo').descripcion === '');
dice('vacía no revienta', partirFicha('').nombre === '');
dice('sin endpoint no escribe bot:', !armarFicha('A', 'B', '').includes('bot:'));
dice('sin descripción no deja el separador suelto', armarFicha('A', '', 'https://x.lat') === 'A · bot:https://x.lat');
dice('recorta espacios', armarFicha('  A  ', '  B  ', '  https://x.lat  ') === 'A · B · bot:https://x.lat');

console.log('\nla marca del creador: logo y enlaces');
const CON_MARCA =
  'Audit · Audita contratos · bot:https://audit.panal.lat · logo:https://audit.lat/l.png · github:auditlabs/audit';
p = partirFicha(CON_MARCA);
dice('el logo NO acaba dentro de la descripción', p.descripcion === 'Audita contratos');
dice('el nombre sigue siendo el nombre', p.nombre === 'Audit');
dice('el logo se lee', p.marca.logo === 'https://audit.lat/l.png');
dice('y el github también', p.marca.github === 'auditlabs/audit');
dice('lo que no puso queda vacío', p.marca.x === '' && p.marca.telegram === '');
dice(
  'se vuelve a armar igual, con marca y todo',
  armarFicha(p.nombre, p.descripcion, 'https://audit.panal.lat', p.marca) === CON_MARCA,
);
// Lo que de verdad importa al editar desde el teléfono: tocar la descripción
// de un agente que tiene logo no puede borrarle el logo.
dice(
  'editar la descripción no borra el logo',
  armarFicha(p.nombre, 'Otra cosa', 'https://audit.panal.lat', p.marca).includes('logo:https://audit.lat/l.png'),
);
dice('un agente sin marca escribe la ficha de siempre', armarFicha('A', 'B', 'https://x.lat') === 'A · B · bot:https://x.lat');
// La descripción es texto libre y alguien va a escribir dos puntos dentro.
dice(
  'una descripción con «web:» sigue siendo descripción',
  partirFicha('Copy · web: la mejor del mercado').descripcion === 'web: la mejor del mercado',
);

console.log('\ndirecciones');
dice('una buena pasa', esDireccion('0x6073e8b4e0c5a1f2d3b4c5d6e7f8a9b0c1d2b7B4'));
dice('con espacios alrededor también', esDireccion('  0x6073e8b4e0c5a1f2d3b4c5d6e7f8a9b0c1d2b7B4  '));
dice('una corta no', !esDireccion('0x6073'));
dice('sin 0x tampoco', !esDireccion('6073e8b4e0c5a1f2d3b4c5d6e7f8a9b0c1d2b7B4'));
dice('con letras de más, no', !esDireccion('0xZZ73e8b4e0c5a1f2d3b4c5d6e7f8a9b0c1d2b7B4'));

console.log(`\n${bien} bien, ${mal} mal\n`);
process.exit(mal ? 1 : 0);
