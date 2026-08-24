/**
 * Las barras del informe, sin dibujar nada.
 *
 * Lo que de verdad se comprueba: que un mes sin cobrar sale como hueco y no
 * se salta —saltarlo convertiría una parada en una racha—, que la altura es
 * relativa al mes más alto, y que la variación se calla cuando no se puede
 * decir en vez de inventarse un infinito.
 */
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

const { porMes, techo, variacion } = await import('../src/lib/barras.ts');

let bien = 0, mal = 0;
const dice = (q, c) => { if (c) { bien++; console.log('  ✅', q); } else { mal++; console.log('  ❌', q); } };

const UNO = 10n ** 18n;
/** Un encargo liquidado el día 15 de ese mes. */
const linea = (anio, mes, pagado) => ({
  id: `${anio}${mes}`,
  ts: Math.floor(new Date(anio, mes - 1, 15).getTime() / 1000),
  cliente: '0x1', moneda: 'MON',
  bruto: pagado, pagado, comision: 0n, devuelto: 0n,
  rating: null, txHash: null, resultHash: null, disputada: false,
});
const cuentas = (lineas) => ({ moneda: 'MON', bruto: 0n, comision: 0n, devuelto: 0n, neto: 0n, lineas });

const AHORA = new Date(2026, 7, 20).getTime(); // agosto de 2026

console.log('\nsin nada');
dice('sin líneas, sin barras', porMes(cuentas([]), 6, AHORA).length === 0);

console.log('\ntres meses seguidos');
let b = porMes(cuentas([linea(2026, 6, 10n * UNO), linea(2026, 7, 20n * UNO), linea(2026, 8, 5n * UNO)]), 3, AHORA);
dice('salen tres', b.length === 3);
dice('en orden, de más viejo a más nuevo', b[0].clave === '2026-06' && b[2].clave === '2026-08');
dice('con su importe', b[1].neto === 20n * UNO);
dice('el más alto llena la barra', b[1].alto === 1);
dice('y la mitad, la mitad', b[0].alto === 0.5);
dice('el techo es el mayor', techo(b) === 20n * UNO);

console.log('\nUN MES SIN COBRAR SALE COMO HUECO');
b = porMes(cuentas([linea(2026, 5, 10n * UNO), linea(2026, 8, 10n * UNO)]), 4, AHORA);
dice('cuatro barras, no dos', b.length === 4);
dice('mayo tiene', b[0].clave === '2026-05' && b[0].neto === 10n * UNO);
dice('junio está vacío', b[1].clave === '2026-06' && b[1].neto === 0n);
dice('julio también', b[2].clave === '2026-07' && b[2].neto === 0n);
dice('y agosto tiene', b[3].clave === '2026-08' && b[3].neto === 10n * UNO);
dice('los vacíos no levantan barra', b[1].alto === 0);

console.log('\nvarios encargos en el mismo mes');
b = porMes(cuentas([linea(2026, 8, 3n * UNO), { ...linea(2026, 8, 7n * UNO), id: 'otro' }]), 1, AHORA);
dice('se suman', b[0].neto === 10n * UNO);
dice('y se cuentan', b[0].cuantos === 2);

console.log('\ncambio de año');
b = porMes(cuentas([linea(2025, 12, UNO), linea(2026, 1, UNO)]), 2, AHORA);
dice('diciembre y enero, en ese orden', b[0].clave === '2025-12' && b[1].clave === '2026-01');

console.log('\nse cuenta desde el último mes CON datos, no desde hoy');
// Un agente parado desde mayo: contar desde agosto daría barras vacías y ni
// una cifra, que es peor que no enseñar nada.
b = porMes(cuentas([linea(2026, 4, UNO), linea(2026, 5, 2n * UNO)]), 3, AHORA);
dice('la última barra es mayo, no agosto', b[b.length - 1].clave === '2026-05');
dice('y hay cifras que mirar', b.some((x) => x.neto > 0n));

console.log('\nla variación');
b = porMes(cuentas([linea(2026, 7, 10n * UNO), linea(2026, 8, 15n * UNO)]), 2, AHORA);
dice('de 10 a 15 es +50 %', Math.abs(variacion(b) - 0.5) < 1e-9);
b = porMes(cuentas([linea(2026, 7, 20n * UNO), linea(2026, 8, 10n * UNO)]), 2, AHORA);
dice('de 20 a 10 es −50 %', Math.abs(variacion(b) + 0.5) < 1e-9);
dice('con una sola barra, se calla', variacion(porMes(cuentas([linea(2026, 8, UNO)]), 1, AHORA)) === null);
b = porMes(cuentas([linea(2026, 6, UNO), linea(2026, 8, UNO)]), 2, AHORA);
dice('con el mes previo a cero, se calla en vez de decir infinito', variacion(b) === null);

console.log('\ncifras grandes, que es donde revienta un Number');
const MUCHO = 88_052n * UNO;
b = porMes(cuentas([linea(2026, 8, MUCHO)]), 1, AHORA);
dice('el importe sobrevive entero, sin pasar por Number', b[0].neto === MUCHO);

console.log(`\n${bien} bien · ${mal} mal\n`);
process.exit(mal === 0 ? 0 : 1);
