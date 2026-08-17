/**
 * Pruebas de cómo se generaliza una skill al buscar a quién subcontratar.
 *
 *   npx tsx test/skill.test.ts
 *
 * HERMÉTICO: no toca la red.
 *
 * Esto protege dinero en las dos direcciones. Si generaliza de menos, el agente
 * no encuentra a nadie y entrega peor de lo que podría. Si generaliza de más,
 * encuentra al agente equivocado y le PAGA: un mal recorte no da un error, da
 * una factura.
 *
 * El caso que lo motivó es real: Spec pidió "Spanish tax law" en mainnet, la
 * búsqueda exige que todas las palabras casen, y no había nadie. Se quedó sin
 * delegar y el cliente recibió unos casos de prueba más flojos sin enterarse.
 */

import { variantesDeSkill } from '../src/client.js';

let fallos = 0;
const check = (nombre: string, ok: boolean, detalle = ''): void => {
  console.log(`${ok ? '✅' : '❌'} ${nombre}${ok ? '' : ` — ${detalle}`}`);
  if (!ok) fallos++;
};
const eq = (nombre: string, a: string[], b: string[]): void =>
  check(nombre, JSON.stringify(a) === JSON.stringify(b), `${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`);

// --- el caso normal no cambia --------------------------------------------

eq('una palabra se busca una sola vez', variantesDeSkill('legal'), ['legal']);
eq('dos palabras: primero la exacta', variantesDeSkill('code review'), ['code review', 'review']);
check(
  'la skill pedida SIEMPRE se prueba primero',
  variantesDeSkill('Spanish tax law')[0] === 'Spanish tax law',
);

// --- el recorte va por la izquierda --------------------------------------

// En inglés el núcleo del sintagma va al final. "Spanish tax law" trata de
// leyes, no de España: quedarse con "Spanish" encontraría un traductor y le
// pagaría por algo que no sabe.
eq('recorta por la izquierda, no por la derecha', variantesDeSkill('Spanish tax law'), [
  'Spanish tax law',
  'tax law',
  'law',
]);
check('nunca deja el modificador suelto', !variantesDeSkill('Spanish tax law').includes('Spanish'));
check('el núcleo sobrevive hasta el final', variantesDeSkill('Spanish tax law').at(-1) === 'law');

// --- higiene --------------------------------------------------------------

eq('espacios de más no generan variantes falsas', variantesDeSkill('  code   review  '), [
  'code review',
  'review',
]);
eq('una cadena vacía no produce búsquedas', variantesDeSkill('   '), []);
check(
  'no se repite ninguna variante',
  new Set(variantesDeSkill('a b c d')).size === variantesDeSkill('a b c d').length,
);
check('el número de intentos es el de palabras', variantesDeSkill('a b c d').length === 4);

// Un modelo suelto puede devolver una frase entera. Que degrade, pero acotado:
// son búsquedas locales sobre una lista ya descargada, no una llamada por cada
// una, y solo se llega a las últimas si las anteriores no encontraron a nadie.
check('una frase larga no explota', variantesDeSkill('someone who knows about tax law').length === 6);
check(
  '  y su última variante sigue siendo el núcleo',
  variantesDeSkill('someone who knows about tax law').at(-1) === 'law',
);

console.log(fallos === 0 ? '\n✅ Todas las comprobaciones de skill pasaron' : `\n❌ ${fallos} fallo(s)`);
process.exit(fallos === 0 ? 0 : 1);
