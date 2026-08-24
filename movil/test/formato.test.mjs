/**
 * Los números tal como se leen antes de firmar.
 *
 * Estas tres funciones salieron de fallos vistos en una foto, no de una idea
 * previa: un saldo que decía «2,00» teniendo 1,995, una pantalla de confirmar
 * que redondeaba la cantidad que se iba a mandar, y una dirección que partía
 * dejando una cifra suelta en la línea de abajo.
 */
const f = await import('../src/lib/formato.ts');

let bien = 0;
let mal = 0;
const dice = (que, cond) => {
  if (cond) { bien++; console.log('  ✅', que); }
  else { mal++; console.log('  ❌', que); }
};

const UNO = 1_000_000_000_000_000_000n;
const wei = (s) => {
  const [e, d = ''] = s.split(',');
  return BigInt(e) * UNO + BigInt(d.padEnd(18, '0'));
};

console.log('\nun saldo se corta, no se redondea');
dice('1,995 NO se enseña como 2,00', f.conDecimales(wei('1,995'), 18) === '1,99');
dice('1,999999 tampoco', f.conDecimales(wei('1,999999'), 18) === '1,99');
dice('2 justo sí es 2,00', f.conDecimales(2n * UNO, 18) === '2,00');
dice('el cero es cero a secas', f.conDecimales(0n, 18) === '0');
dice('por debajo de un céntimo, cuatro decimales', f.conDecimales(wei('0,0025'), 18) === '0,0025');
dice(
  'y lo que no cabe ni en cuatro no se enseña como cero',
  f.conDecimales(1n, 18) === '<0,0001',
);

console.log('\nlos miles se agrupan aunque sean cuatro cifras');
dice('mil', f.conDecimales(1000n * UNO, 18) === '1.000,00');
dice('diez mil', f.conDecimales(10_000n * UNO, 18) === '10.000,00');
dice('ochenta y ocho mil y pico', f.conDecimales(wei('88052,5'), 18) === '88.052,50');
dice('un millón', f.conDecimales(1_000_000n * UNO, 18) === '1.000.000,00');
dice('cien no lleva punto', f.conDecimales(100n * UNO, 18) === '100,00');

console.log('\nla cantidad exacta, la que se firma');
dice('1,995 se enseña entera', f.exacto(wei('1,995')) === '1,995');
dice('sin decimales no pone coma', f.exacto(3n * UNO) === '3');
dice('un wei se ve entero', f.exacto(1n) === '0,000000000000000001');
dice('y agrupa los miles', f.exacto(wei('1234,5')) === '1.234,5');
dice(
  'nunca redondea hacia arriba, que es de lo que se trata',
  f.exacto(wei('1,999999999999999999')) === '1,999999999999999999',
);

console.log('\nuna dirección en grupos de cuatro');
const DIR = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
dice('empieza por 0x suelto', f.troceada(DIR).startsWith('0x f39F'));
dice('no pierde ni un carácter', f.troceada(DIR).replace(/\s/g, '') === DIR);
dice('agrupa de cuatro en cuatro', f.troceada(DIR).split(' ').slice(1).every((g) => g.length === 4));

console.log(`\n${bien} bien · ${mal} mal\n`);
process.exit(mal === 0 ? 0 : 1);
