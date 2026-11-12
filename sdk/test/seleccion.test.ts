/**
 * A quién puede pagar `ask` sin que nadie lo revise.
 *
 *   npx tsx test/seleccion.test.ts
 *
 * HERMÉTICO: no toca la red. Lo que se lee en la cadena (nivel y suspensión)
 * se prueba contra mainnet en x402.test.ts.
 *
 * El fallo que se protege aquí: hasta la 0.29, `ask` pagaba siempre al más
 * barato. A un estafador le bastaba con darse de alta con la skill y el precio
 * mínimo para cobrar todas las subcontrataciones de todos los agentes.
 */

import {
  NIVEL_MINIMO_PARA_SUBCONTRATAR,
  casiTodoDeUnCliente,
  mejorParaSubcontratar,
  motivoPorClientes,
  motivoPorNivel,
  validarNivelMinimo,
} from '../src/index.js';

let fallos = 0;
const check = (nombre: string, ok: boolean, detalle = ''): void => {
  console.log(`${ok ? '✅' : '❌'} ${nombre}${detalle ? ` — ${detalle}` : ''}`);
  if (!ok) fallos++;
};
const lanza = (fn: () => unknown): string => {
  try {
    fn();
    return '';
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
};

const AHORA = 1_800_000_000;

console.log('\n── El nivel por defecto ──\n');

check('es el 1 del tablón', NIVEL_MINIMO_PARA_SUBCONTRATAR === 1);
check('0 vale: quita el filtro', validarNivelMinimo(0) === 0);
check('5 vale: el más alto', validarNivelMinimo(5) === 5);
check('6 no existe', lanza(() => validarNivelMinimo(6)).includes('del 0 al 5'));
check('ni un negativo', lanza(() => validarNivelMinimo(-1)).includes('del 0 al 5'));
check('ni 1,5: daría un filtro distinto del que se cree', lanza(() => validarNivelMinimo(1.5)).includes('del 0 al 5'));
check('ni un texto', lanza(() => validarNivelMinimo('1')).includes('del 0 al 5'));

console.log('\n── El truco de la segunda wallet: casi todo de un cliente ──\n');

const deUno = { completados: 5, distintos: 1, cuotaDelMayor: 1 };
check('5 encargos de un solo cliente: no', casiTodoDeUnCliente(deUno));
check('  y se dice por qué', motivoPorClientes(deUno) === 'sus 5 encargos son de un solo cliente', motivoPorClientes(deUno) ?? '');
const deDos = { completados: 8, distintos: 2, cuotaDelMayor: 0.5 };
check('de dos clientes, aunque repartido: no', casiTodoDeUnCliente(deDos));
check('  y se dice', (motivoPorClientes(deDos) ?? '').includes('solo 2 clientes'));
const concentrado = { completados: 10, distintos: 3, cuotaDelMayor: 0.8 };
check('el 80 % de uno, con tres clientes: no', casiTodoDeUnCliente(concentrado));
check('  y se dice el porcentaje', (motivoPorClientes(concentrado) ?? '').includes('80 %'));
// Los de producción el 12-nov-2026: Lint (6 de 6 clientes) y Spec (10 de 5,
// el mayor con la mitad) subcontratan entre ellos y tienen que seguir pudiendo.
check('Lint pasa', motivoPorClientes({ completados: 6, distintos: 6, cuotaDelMayor: 1 / 6 }) === null);
check('Spec pasa', motivoPorClientes({ completados: 10, distintos: 5, cuotaDelMayor: 0.5 }) === null);
check('con menos de 5 encargos no se juzga: decide el nivel', !casiTodoDeUnCliente({ completados: 4, distintos: 1, cuotaDelMayor: 1 }));
check('sin encargos tampoco', !casiTodoDeUnCliente({ completados: 0, distintos: 0, cuotaDelMayor: null }));
check('sin datos de clientes: no se le paga', (motivoPorClientes(undefined) ?? '').includes('sin datos'));

console.log('\n── El nivel, leído en la cadena ──\n');

check('nivel 1 con mínimo 1: pasa', motivoPorNivel({ nivel: 1, suspendidoHasta: 0 }, 1, AHORA) === null);
check('nivel 3 con mínimo 1: pasa', motivoPorNivel({ nivel: 3, suspendidoHasta: 0 }, 1, AHORA) === null);
check('nivel 0 con mínimo 1: no', motivoPorNivel({ nivel: 0, suspendidoHasta: 0 }, 1, AHORA) === 'nivel 0, y se pide 1');
check('nivel 2 con mínimo 3: no', (motivoPorNivel({ nivel: 2, suspendidoHasta: 0 }, 3, AHORA) ?? '').includes('se pide 3'));
check('suspendido: no, aunque tenga nivel', (motivoPorNivel({ nivel: 4, suspendidoHasta: AHORA + 60 }, 1, AHORA) ?? '').includes('suspendido'));
check('una suspensión ya cumplida no cuenta', motivoPorNivel({ nivel: 1, suspendidoHasta: AHORA - 1 }, 1, AHORA) === null);
check('si no se pudo leer: no', (motivoPorNivel(null, 1, AHORA) ?? '').includes('no se pudo leer'));

console.log('\n── El orden: más nivel primero, luego más barato (como el tablón) ──\n');

const ofertas = [
  { quien: 'barato-nivel-1', nivel: 1, precio: 10n },
  { quien: 'caro-nivel-3', nivel: 3, precio: 90n },
  { quien: 'medio-nivel-3', nivel: 3, precio: 50n },
  { quien: 'barato-nivel-2', nivel: 2, precio: 5n },
];
const orden = [...ofertas].sort(mejorParaSubcontratar).map((o) => o.quien);
check('gana el de más nivel', orden[0] === 'medio-nivel-3', orden.join(' > '));
check('  y a igual nivel, el más barato', orden[1] === 'caro-nivel-3');
check('  el nivel pesa más que el precio', orden.indexOf('barato-nivel-2') < orden.indexOf('barato-nivel-1'));
const sinNivel = [
  { quien: 'b', nivel: null, precio: 20n },
  { quien: 'a', nivel: null, precio: 10n },
];
check('sin filtro (nivel desconocido) manda solo el precio', [...sinNivel].sort(mejorParaSubcontratar)[0]!.quien === 'a');

console.log(
  fallos === 0
    ? '\n✅ ask solo paga a quien tiene nivel, no está suspendido y no vive de un solo cliente\n'
    : `\n❌ ${fallos} comprobación(es) fallaron\n`,
);
if (fallos) process.exitCode = 1;
