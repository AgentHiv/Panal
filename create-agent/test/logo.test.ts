/**
 * El logo con el que nace un agente.
 *
 *   npx tsx test/logo.test.ts     (o: npm test)
 *
 * Lo que se comprueba aquí no es que quede bonito —eso se mira— sino las dos
 * formas que tiene de salir MAL sin avisar: un nombre que rompe el XML, y una
 * inicial partida por la mitad. Las dos producen un archivo que se escribe sin
 * error y no se pinta, y el agente se entera cuando ya está en el escaparate.
 */

import { inicial, logoSvg } from '../src/logo.js';

let fallos = 0;
const check = (nombre: string, ok: boolean, detalle = ''): void => {
  console.log(`${ok ? '✅' : '❌'} ${nombre}${ok ? '' : ` — ${detalle}`}`);
  if (!ok) fallos++;
};

console.log('\n── La inicial ──\n');

check('una letra normal', inicial('lint') === 'L');
check('se pone en mayúscula', inicial('parse') === 'P');
check('respeta el alfabeto que sea', inicial('資料') === '資');
check('y los acentos', inicial('Ágil') === 'Á');
check('el espacio de delante no cuenta', inicial('  lint') === 'L');
// Un emoji son DOS `char` en JavaScript: quedarse con el primero da media
// letra, que ni siquiera se puede pintar.
check('un emoji no se parte por la mitad', inicial('🐝 abeja') === '🐝', inicial('🐝 abeja'));
check('un nombre vacío no revienta', inicial('') === '?');

console.log('\n── El SVG ──\n');

const svg = logoSvg('lint', '0x1558cF6aed695F3F8AafE488058EfE28d216E69C');
check('es un SVG', svg.startsWith('<svg ') && svg.trimEnd().endsWith('</svg>'));
check('lleva la inicial', svg.includes('>L</text>'));
check('trae medidas', svg.includes('viewBox="0 0 96 96"') && svg.includes('width="96"'));
check('y un color de la paleta', /fill="#(E29A2E|836EF9|6E7B4E|1B1814)"/.test(svg));

// El mismo agente tiene que salir siempre igual: si el color cambiara en cada
// generación, regenerar el proyecto le cambiaría la cara al agente.
check('el mismo agente da siempre el mismo logo', logoSvg('lint', '0xAA') === logoSvg('lint', '0xAA'));
check('y dos agentes distintos no comparten semilla', logoSvg('a', '0xAA') !== logoSvg('a', '0xBB'));

// Lo que de verdad rompe: un nombre con `&` o `<` deja un XML inválido, y un
// SVG inválido no se pinta —no da error, sale el hueco—.
const raro = logoSvg('R&D <script>alert("x")</script>', '0xAA');
check('el & se escapa', raro.includes('&amp;') && !/&(?!amp;|lt;|gt;|quot;)/.test(raro), raro);
check('el < también', !raro.includes('<script'), raro);
check('y las comillas del atributo', !/aria-label="[^"]*"[^>]*"/.test(raro));

console.log(
  fallos === 0
    ? '\n✅ El logo se escribe bien con cualquier nombre\n'
    : `\n❌ ${fallos} comprobación(es) fallidas\n`,
);
process.exit(fallos === 0 ? 0 : 1);
