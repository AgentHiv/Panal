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

import { variantesDeSkill, variantesPermitidas } from '../src/client.js';

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


// --- Y a quién se le deja comprar ------------------------------------------
//
// La degradación de arriba es útil y es peligrosa por lo mismo: generaliza. Un
// agente de código que pide "python video encoding" acaba buscando "video", y
// pagarle a un agente de vídeo con el dinero de un encargo de código es un
// fallo que además parece un éxito — cobró, le contestaron, entregó.

eq('sin lista, se buscan todas las variantes de siempre', variantesPermitidas('code review'), [
  'code review',
  'review',
]);

// El caso que motiva todo esto.
eq(
  'un agente de código no llega a buscar "video"',
  variantesPermitidas('python video encoding', ['code review', 'testing']),
  [],
);
check(
  '  y sin variantes permitidas no se cotiza a nadie',
  variantesPermitidas('python video encoding', ['code review']).length === 0,
);

eq('lo permitido sí se busca', variantesPermitidas('code review', ['code review']), ['code review']);

// Lo fino: la variante degradada NO se cuela por ser hija de una permitida.
eq(
  'una degradación fuera de la lista se cae, aunque su origen esté permitido',
  variantesPermitidas('python code review', ['python code review']),
  ['python code review'],
);
check(
  '  «review» a secas no se busca si no está en la lista',
  !variantesPermitidas('python code review', ['python code review']).includes('review'),
);
eq(
  'y si la degradación TAMBIÉN está permitida, se prueban las dos en orden',
  variantesPermitidas('python code review', ['python code review', 'review']),
  ['python code review', 'review'],
);

// La lista la escribe una persona y la skill la escribe un modelo: no van a
// coincidir en mayúsculas ni en espacios.
// `variantesDeSkill` ya colapsa los espacios, así que lo que sale es la forma
// limpia: se compara sin distinguir mayúsculas y con los espacios ya normales.
eq('mayúsculas y espacios no cambian el permiso', variantesPermitidas('Code   Review', ['  code review  ']), [
  'Code Review',
]);

// Lista vacía es NO SUBCONTRATA, y no «todo permitido». La diferencia entre
// las dos lecturas es que una gasta dinero.
check('una lista vacía no permite nada', variantesPermitidas('code review', []).length === 0);
check('  y `undefined` sí lo permite todo', variantesPermitidas('code review', undefined).length === 2);

console.log(fallos === 0 ? '\n✅ Todas las comprobaciones de skill pasaron' : `\n❌ ${fallos} fallo(s)`);
process.exit(fallos === 0 ? 0 : 1);
