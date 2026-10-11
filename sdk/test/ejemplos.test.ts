/**
 * Pruebas de los encargos de ejemplo dentro del metadataURI on-chain.
 *
 *   npx tsx test/ejemplos.test.ts
 *
 * HERMÉTICO: no toca la red.
 *
 * Lo que se protege es lo mismo que con los niveles: que un token nuevo no se
 * coma nada de lo que ya había. La ficha reparte posiciones —nombre,
 * descripción, skills— y un `ejemplo:` que no se aparte saldría como skill.
 *
 * Y al revés: la descripción es texto libre y alguien escribirá «Ejemplo:
 * traduzco tu web» dentro de ella. Eso tiene que seguir siendo descripción.
 */

import {
  componerEjemplo,
  conEjemplosDeLaFicha,
  esTokenDeEjemplo,
  falloDeEjemplo,
  leerEjemploDeSegmento,
  leerEjemplos,
  leerEjemplosDeMetadata,
  MAX_EJEMPLO,
} from '../src/ejemplos.js';
import { formatAgentMetadata, parseAgentMetadata } from '../src/types.js';
import { leerNivelesDeMetadata } from '../src/niveles.js';
import { leerTipo } from '../src/tipo.js';

let fallos = 0;
const check = (nombre: string, ok: boolean, detalle = ''): void => {
  console.log(`${ok ? '✅' : '❌'} ${nombre}${ok ? '' : ` — ${detalle}`}`);
  if (!ok) fallos++;
};

console.log('\nqué es un ejemplo y qué no');
check('ejemplo:texto lo es', leerEjemploDeSegmento('ejemplo:Revisa este contrato') === 'Revisa este contrato');
check('con espacios alrededor del segmento, también', esTokenDeEjemplo('  ejemplo:Hola  '));
check('«Ejemplo:» con mayúscula es prosa', !esTokenDeEjemplo('Ejemplo:traduzco tu web'));
check('«ejemplo: » con espacio es prosa', !esTokenDeEjemplo('ejemplo: traduzco tu web'));
check('«ejemplo:» vacío no es nada', !esTokenDeEjemplo('ejemplo:'));
check('otra palabra no', !esTokenDeEjemplo('ejemplos:algo') && !esTokenDeEjemplo('un ejemplo:x'));
check(
  'se recorta al tope',
  leerEjemploDeSegmento(`ejemplo:${'a'.repeat(MAX_EJEMPLO + 50)}`)?.length === MAX_EJEMPLO,
);
check('los espacios de dentro se colapsan', leerEjemploDeSegmento('ejemplo:Hola   que\ttal') === 'Hola que tal');

console.log('\nleerlos de la ficha');
const ficha =
  'Lint · Revisa código · solidity, auditoría · bot:https://lint.example · tipo:persona · ' +
  'nivel:0.03|Un archivo|Hasta 400 líneas · ejemplo:Revisa este contrato ERC-20 · ' +
  'ejemplo:¿Este modifier tiene reentrancy? · ejemplo:Revisa este contrato ERC-20 · ' +
  'ejemplo:Tercero · ejemplo:Cuarto, que ya no cabe';
const ejemplos = leerEjemplosDeMetadata(ficha);
check(
  'en orden, sin repetidos y como mucho tres',
  JSON.stringify(ejemplos) ===
    JSON.stringify(['Revisa este contrato ERC-20', '¿Este modifier tiene reentrancy?', 'Tercero']),
  JSON.stringify(ejemplos),
);
check('sin ficha, ninguno', leerEjemplosDeMetadata('') .length === 0 && leerEjemplosDeMetadata(null).length === 0);

console.log('\nno se comen nada de lo que ya había');
const meta = parseAgentMetadata(ficha);
check('el nombre sigue', meta.name === 'Lint');
check('la descripción sigue', meta.description === 'Revisa código');
check(
  'las skills no se llevan ningún ejemplo',
  JSON.stringify(meta.skills) === JSON.stringify(['solidity', 'auditoría']),
  JSON.stringify(meta.skills),
);
check('el bot sigue', meta.botUrl === 'https://lint.example');
check('los niveles siguen', leerNivelesDeMetadata(ficha).length === 1);
check('el tipo sigue', leerTipo(ficha) === 'persona');
const prosa = parseAgentMetadata('Babel · Ejemplo: traduzco tu web en un día · traducción');
check('una descripción que empieza por «Ejemplo:» se queda', prosa.description === 'Ejemplo: traduzco tu web en un día');
check('y no aparece ningún ejemplo', leerEjemplosDeMetadata('Babel · Ejemplo: traduzco tu web · traducción').length === 0);

console.log('\nescribirlos');
check('componer da la clave pegada', componerEjemplo('  Revisa   esto ') === 'ejemplo:Revisa esto');
check('vacío no se escribe', componerEjemplo('   ') === null);
check('con «·» no se escribe', componerEjemplo('uno · dos') === null && falloDeEjemplo('uno · dos') === 'separador');
check('demasiado largo no se escribe', componerEjemplo('a'.repeat(MAX_EJEMPLO + 1)) === null);
check('y se dice por qué', falloDeEjemplo('a'.repeat(MAX_EJEMPLO + 1)) === 'largo');
check('justo en el tope sí', componerEjemplo('a'.repeat(MAX_EJEMPLO))?.length === 'ejemplo:'.length + MAX_EJEMPLO);
const ida = componerEjemplo('¿Me traduces esto al francés?')!;
check('lo compuesto se vuelve a leer igual', leerEjemploDeSegmento(ida) === '¿Me traduces esto al francés?');
check(
  'formatAgentMetadata no los inventa',
  !formatAgentMetadata({ name: 'X', description: 'Y', skills: ['z'], botUrl: null }).includes('ejemplo:'),
);

console.log('\nla ficha del bot, que la escribe un servidor ajeno');
check('se leen las cadenas', leerEjemplos({ examples: ['Uno', 'Dos'] }).length === 2);
check('lo que no es cadena se ignora', JSON.stringify(leerEjemplos({ examples: ['Uno', 3, null, { a: 1 }] })) === '["Uno"]');
check('sin campo, ninguno', leerEjemplos({}).length === 0 && leerEjemplos(null).length === 0);
check('no es una lista, ninguno', leerEjemplos({ examples: 'Uno' }).length === 0);
check('se recortan y se limitan a tres', (() => {
  const r = leerEjemplos({ examples: ['a'.repeat(500), 'b', 'c', 'd'] });
  return r.length === 3 && r[0]!.length === MAX_EJEMPLO;
})());

console.log('\nla traducción de la ficha, solo cuando cuadra');
const cadena = ['Revisa este contrato', '¿Tiene reentrancy?'];
check('mismos en número: los traducidos', conEjemplosDeLaFicha(cadena, ['Review this contract', 'Any reentrancy?'])[0] === 'Review this contract');
check('distinto número: los de la cadena', conEjemplosDeLaFicha(cadena, ['Review this contract'])[0] === 'Revisa este contrato');
check('ficha sin ejemplos: los de la cadena', conEjemplosDeLaFicha(cadena, []).length === 2);
check('nada en la cadena: los de la ficha', conEjemplosDeLaFicha([], ['Solo en código'])[0] === 'Solo en código');

console.log(fallos === 0 ? '\nTodo bien.\n' : `\n${fallos} fallo(s).\n`);
process.exit(fallos === 0 ? 0 : 1);
