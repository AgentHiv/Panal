/**
 * Los importes que enseña la app antes de que alguien firme.
 *
 *     npx tsx scripts/test-movil-importes.ts
 *
 * ESTO NO ES COSMÉTICA. Cada sitio de la app elegía su número fijo de decimales
 * y el más repetido era CERO: `dinero(importe, 0)` en la tarjeta del encargo,
 * en el botón de bloquear el dinero, en el de aprobar el pago y en el aviso que
 * llega al teléfono. Con un encargo de 0,5 MON el botón decía «Bloquear 1 MON»
 * —otra cantidad distinta de la que se iba a firmar— y con 0,4 decía «Bloquear
 * 0 MON». Los precios reales de la mayoría de agentes de Panal están justo ahí:
 * por debajo de 1.
 *
 * Se comprueba lo único que de verdad importa: que el número escrito sea el
 * número, y que nunca aparezca un cero delante de alguien que tiene algo.
 */
import { parseEther } from 'viem';
import { monto, precio } from '../movil/src/lib/formato.js';

let fallos = 0;
const check = (nombre: string, ok: boolean, detalle = ''): void => {
  console.log(`${ok ? '✅' : '❌'} ${nombre}${ok ? '' : ` — ${detalle}`}`);
  if (!ok) fallos++;
};

console.log('\n── Los casos que estaban mal ──\n');

const casos: [string, string][] = [
  ['0.5', '0,5'],
  ['0.4', '0,4'],
  ['0.05', '0,05'],
  ['0.0125', '0,0125'],
  ['1', '1'],
  ['12', '12'],
  ['12.5', '12,5'],
  // El español NO agrupa los millares de cuatro cifras (minimumGroupingDigits
  // es 2 en es-ES): «1284», pero «12.845». Lo da Intl, no nosotros.
  ['1284', '1284'],
  ['12845', '12.845'],
  // Cuatro cifras enteras: tampoco se agrupa, aunque lleve decimales.
  ['1284.5', '1284,5'],
];
for (const [mon, esperado] of casos) {
  const salida = monto(parseEther(mon));
  check(`${mon} → «${esperado}»`, salida === esperado, `salió «${salida}»`);
}

console.log('\n── Cero es cero, y solo cero ──\n');

check('0 se escribe 0', monto(0n) === '0');
check('1 wei NO se escribe 0', monto(1n) !== '0', monto(1n));
check('1 wei avisa de que es menos de lo que cabe', monto(1n) === '<0,0001', monto(1n));

// La propiedad de verdad: leer el número de vuelta tiene que dar lo mismo que
// se iba a firmar. Un aviso de "menos de" es aceptable; un número CAMBIADO no.
console.log('\n── Lo escrito es lo que se firma ──\n');

const cantidades = [
  '0.0001', '0.001', '0.4', '0.5', '0.999', '1', '1.5', '9.99', '10', '99.99', '100', '1284.5',
];
let peor = 0;
for (const c of cantidades) {
  const escrito = monto(parseEther(c));
  const leido = Number(escrito.replace(/\./g, '').replace(',', '.'));
  const real = Number(c);
  const desvio = Math.abs(leido - real) / real;
  if (desvio > peor) peor = desvio;
  check(`${c} → «${escrito}» se lee igual`, desvio < 0.0005, `desvío ${(desvio * 100).toFixed(3)} %`);
}
check(`el peor desvío de la tabla es despreciable`, peor < 0.0005, `${(peor * 100).toFixed(3)} %`);

console.log('\n── Precios que no existen ──\n');

check('un precio de 0 no es un número, es «no hay»', precio(0) === null);
check('un precio negativo tampoco', precio(-1) === null);
check('NaN tampoco', precio(Number.NaN) === null);
check('0,5 sí, y se escribe 0,5', precio(0.5) === '0,5', String(precio(0.5)));
check('100 se escribe sin decimales', precio(100) === '100', String(precio(100)));

console.log(fallos === 0 ? '\n✅ todo bien\n' : `\n❌ ${fallos} fallos\n`);
process.exit(fallos === 0 ? 0 : 1);
