/**
 * El aviso de «te han aprobado»: a quién, cuándo, y qué se recuerda.
 *
 * Existe porque el primer intento se tragaba el caso más común —aprobado con la
 * app cerrada— al marcarlo como visto antes de saber si la wallet dependía de
 * mirar. Ver src/lib/aprobados.ts.
 */
const { decidirAprobados } = await import('../src/lib/aprobados.ts');

let bien = 0;
let mal = 0;
const dice = (que, cond) => {
  if (cond) { bien++; console.log('  ✅', que); }
  else { mal++; console.log('  ❌', que); }
};
const ap = (id, aprobadaParaMi = true) => ({ id, aprobadaParaMi });

console.log('Antes de que llegue la ficha no se toca nada');
{
  const d = decidirAprobados([ap('7')], new Set(), { fichaLista: false, dependeDeMi: false });
  dice('no avisa', d.avisar.length === 0);
  dice('y no guarda: si guardara, el aprobado con la app cerrada se perdería', d.vistos === null);
}

console.log('La primera vez se toma nota sin avisar');
{
  const d = decidirAprobados([ap('1'), ap('2'), ap('3', false)], null, { fichaLista: true, dependeDeMi: true });
  dice('no anuncia los de meses atrás', d.avisar.length === 0);
  dice('pero los recuerda (solo los aprobados para mí)', d.vistos.size === 2 && d.vistos.has('1') && !d.vistos.has('3'));
}

console.log('Después, lo nuevo se anuncia una vez');
{
  const antes = new Set(['1', '2']);
  const d = decidirAprobados([ap('1'), ap('2'), ap('9')], antes, { fichaLista: true, dependeDeMi: true });
  dice('anuncia solo el nuevo', d.avisar.join() === '9');
  dice('y lo recuerda', d.vistos.has('9'));
  const otra = decidirAprobados([ap('1'), ap('2'), ap('9')], d.vistos, { fichaLista: true, dependeDeMi: true });
  dice('en la siguiente pasada ya no lo repite', otra.avisar.length === 0);
  dice('sin mutar lo que se le pasó', antes.size === 2);
}

console.log('Solo a quien depende de mirar');
{
  const d = decidirAprobados([ap('9')], new Set(['1']), { fichaLista: true, dependeDeMi: false });
  dice('un agente con servidor no recibe «recógelo»', d.avisar.length === 0);
  dice('pero queda visto, para no avisar tarde si cambia', d.vistos.has('9'));
}

console.log('El caso que se tragaba el primer intento');
{
  // Encargo #5 aprobado con la app cerrada. Primera pasada: tareas sí, ficha no.
  const vistos0 = new Set(['1']);
  const p1 = decidirAprobados([ap('1'), ap('5')], vistos0, { fichaLista: false, dependeDeMi: false });
  // Segunda pasada: llega la ficha (es persona).
  const p2 = decidirAprobados([ap('1'), ap('5')], p1.vistos ?? vistos0, { fichaLista: true, dependeDeMi: true });
  dice('#5 se anuncia cuando llega la ficha', p2.avisar.join() === '5');
}

console.log(`\n${bien} bien · ${mal} mal`);
process.exit(mal === 0 ? 0 : 1);
