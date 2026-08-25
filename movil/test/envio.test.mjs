/**
 * Las cuentas de mandar dinero, sin red.
 *
 * Lo que se comprueba de verdad: que «1,5» con coma es una cantidad, que
 * «Todo» en MON deja el gas, que las pegas salen en el orden en que le
 * importan a quien manda, y que una frase de doce palabras con la suma de
 * control mal se rechaza — que es lo que viem NO hace y por lo que existe
 * `validarPalabras`.
 */
/*
 * Dos módulos, un solo `e`: las cuentas del dinero se fueron a la capa
 * compartida —la web también manda $PANAL ahora— y las palabras se quedaron en
 * el llavero, que es lo único que las usa. Se juntan aquí para seguir
 * comprobando lo mismo que antes, que es de lo que trata este archivo.
 */
const dinero = await import('../../src/lib/envio.ts');
const palabras = await import('../src/lib/envio.ts');
const e = { ...dinero, ...palabras };

let bien = 0;
let mal = 0;
const dice = (que, cond) => {
  if (cond) { bien++; console.log('  ✅', que); }
  else { mal++; console.log('  ❌', que); }
};

const UNO = 1_000_000_000_000_000_000n;

console.log('\nleer una cantidad');
dice('la coma vale', e.aWei('1,5') === UNO + UNO / 2n);
dice('el punto también', e.aWei('1.5') === UNO + UNO / 2n);
dice('con espacios alrededor', e.aWei('  2  ') === 2n * UNO);
dice('vacío es null', e.aWei('') === null);
dice('letras es null', e.aWei('mucho') === null);
dice('un punto suelto es null', e.aWei('.') === null);
dice('dos comas es null', e.aWei('1,5,5') === null);
dice('un negativo es null', e.aWei('-1') === null);
dice('el cero se lee, no se rechaza aquí', e.aWei('0') === 0n);
dice('4 decimales pequeños', e.aWei('0,0001') === UNO / 10_000n);

console.log('\ncuánto es «todo»');
dice('en MON deja la reserva', e.maximo('MON', UNO, 0n) === UNO - e.RESERVA_GAS);
dice('en MON, con menos que la reserva, es cero', e.maximo('MON', 1000n, 0n) === 0n);
dice('en $PANAL es el saldo entero', e.maximo('$PANAL', 0n, 7n * UNO) === 7n * UNO);

console.log('\nrevisar antes de firmar');
const YO = '0x58A57ed9d8d624cBD12e2C467D34787555bB1b25';
const OTRO = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const base = { moneda: 'MON', importe: '1', destino: OTRO, mio: YO, saldoMon: 2n * UNO, saldoPanal: 0n };

dice('un envío normal pasa', e.revisar(base).ok === true);
dice('y trae la cantidad ya en wei', e.revisar(base).wei === UNO);
dice('sin destino no pasa', e.revisar({ ...base, destino: '' }).ok === false);
dice('destino a medias no pasa', e.revisar({ ...base, destino: '0x1234' }).ok === false);
dice('mandársela a sí misma no pasa', e.revisar({ ...base, destino: YO.toLowerCase() }).ok === false);
dice('sin cantidad no pasa', e.revisar({ ...base, importe: '' }).ok === false);
dice('cantidad cero no pasa', e.revisar({ ...base, importe: '0' }).ok === false);
dice('más de lo que hay no pasa', e.revisar({ ...base, importe: '3' }).ok === false);
dice(
  'el saldo entero de MON no pasa: no quedaría gas',
  e.revisar({ ...base, importe: '2' }).ok === false,
);
dice(
  'lo que deja «Todo» sí pasa',
  e.revisar({ ...base, importe: (Number(e.maximo('MON', 2n * UNO, 0n)) / 1e18).toString() }).ok === true,
);

const conPanal = { ...base, moneda: '$PANAL', saldoPanal: 10n * UNO };
dice('$PANAL con MON de sobra pasa', e.revisar(conPanal).ok === true);
dice(
  '$PANAL sin nada de MON no pasa',
  e.revisar({ ...conPanal, saldoMon: 0n }).ok === false,
);
dice(
  'y lo dice por el gas, no por el saldo',
  e.revisar({ ...conPanal, saldoMon: 0n }).pega === 'sin-mon-para-gas',
);
dice(
  '$PANAL con poquísimo MON pasa pero avisa',
  (() => { const r = e.revisar({ ...conPanal, saldoMon: 1000n }); return r.ok === true && r.aviso !== null; })(),
);
dice(
  'el destino se juzga antes que la cantidad',
  e.revisar({ ...base, destino: 'yo qué sé', importe: '' }).pega === 'destino-malo',
);

console.log('\nlimpiar lo que se pega');
dice(
  'una lista numerada queda en palabras sueltas',
  e.limpiarFrase('1. Legal 2. Winner 3. Thank') === 'legal winner thank',
);
dice('las comas se van', e.limpiarFrase('legal, winner, thank') === 'legal winner thank');
dice('los saltos de línea también', e.limpiarFrase('legal\nwinner\n\tthank') === 'legal winner thank');
dice('y las mayúsculas', e.limpiarFrase('LEGAL Winner') === 'legal winner');

console.log('\nuna clave privada');
// La de la cuenta 0 de Hardhat: pública desde siempre y vacía en toda red.
const CLAVE = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
dice('con 0x', e.limpiarClave(CLAVE) === CLAVE);
dice('sin 0x, se le pone', e.limpiarClave(CLAVE.slice(2)) === CLAVE);
dice('en mayúsculas, se baja', e.limpiarClave(CLAVE.toUpperCase()) === CLAVE);
dice('con espacios alrededor', e.limpiarClave(`  ${CLAVE}  `) === CLAVE);
dice('a medias es null', e.limpiarClave(CLAVE.slice(0, 40)) === null);
dice('con una letra que no es hex es null', e.limpiarClave(`0xz${CLAVE.slice(3)}`) === null);

console.log('\nqué ha pegado');
const FRASE = 'legal winner thank year wave sausage worth useful legal winner thank yellow';
dice('doce palabras', e.claseDeSecreto(FRASE) === 'palabras');
dice('una clave', e.claseDeSecreto(CLAVE) === 'clave');
dice('trece palabras no es nada', e.claseDeSecreto(`${FRASE} extra`) === null);
dice('una frase cualquiera no es nada', e.claseDeSecreto('hola qué tal') === null);

console.log('\nla suma de control de BIP-39');
dice('la frase buena vale', e.validarPalabras(FRASE) === true);
dice(
  'cambiar la última palabra la invalida',
  e.validarPalabras(FRASE.replace(/yellow$/, 'zoo')) === false,
);
dice(
  'intercambiar dos palabras la invalida',
  e.validarPalabras('winner legal thank year wave sausage worth useful legal winner thank yellow') === false,
);
dice(
  'una palabra que no está en la lista la invalida',
  e.validarPalabras(FRASE.replace('sausage', 'chorizo')) === false,
);
dice('numerada y en mayúsculas, vale igual', e.validarPalabras(
  FRASE.split(' ').map((p, i) => `${i + 1}. ${p.toUpperCase()}`).join('\n'),
) === true);
dice(
  'veinticuatro palabras también',
  e.validarPalabras(`${'abandon '.repeat(23)}art`) === true,
);
dice('once palabras no', e.validarPalabras(FRASE.split(' ').slice(0, 11).join(' ')) === false);

console.log(`\n${bien} bien · ${mal} mal\n`);
process.exit(mal === 0 ? 0 : 1);
