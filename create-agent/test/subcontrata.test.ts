/**
 * A quien tu agente tiene permitido comprarle.
 *
 *     npx tsx test/subcontrata.test.ts     (o: npm test)
 *
 * HERMÉTICO: no toca la red ni el modelo.
 *
 * El fallo que se protege aquí no da error y por eso es caro: el buscador del
 * mercado generaliza cuando no encuentra a nadie —recorta la skill por la
 * izquierda—, así que un agente de código que pide "python video encoding"
 * acaba buscando "video". Paga a un agente de vídeo, recibe algo, entrega y lo
 * ancla. El cliente ve una entrega peor y nadie ve un error.
 *
 * Son DOS cerraduras y las dos hacen falta: presupuesto (SUBCONTRATA_MAX o el
 * `subcontrata` del nivel) y permiso (esta lista).
 */

import { skillPermitida } from '../template/src/agent.js';

let fallos = 0;
const check = (nombre: string, ok: boolean, detalle = ''): void => {
  console.log(`${ok ? '✅' : '❌'} ${nombre}${ok ? '' : ` — ${detalle}`}`);
  if (!ok) fallos++;
};

console.log('\n── Vacío es NO DELEGA ──\n');

check('con la lista vacía no se compra nada', !skillPermitida('translation', []));
check('  ni siquiera algo razonable', !skillPermitida('legal', []));

console.log('\n── El caso que motiva esto ──\n');

const DE_CODIGO = ['code review', 'testing'];

check('un agente de código puede comprar lo suyo', skillPermitida('code review', DE_CODIGO));
check('pero NO un agente de vídeo', !skillPermitida('video', DE_CODIGO));
check('ni de imágenes', !skillPermitida('image generation', DE_CODIGO));
check('ni traducción, que suena inofensiva y cuesta igual', !skillPermitida('translation', DE_CODIGO));

// Lo fino: la variante degradada no hereda el permiso de su origen. "python
// code review" degrada a "review", y "review" a secas casaría con un agente que
// revisa vídeos igual que con uno que revisa código.
check('«review» a secas no vale por venir de «code review»', !skillPermitida('review', DE_CODIGO));

console.log('\n── La lista la escribe una persona; la skill, un modelo ──\n');

check('mayúsculas dan igual', skillPermitida('Code Review', DE_CODIGO));
check('espacios de más también', skillPermitida('  code   review  ', DE_CODIGO));
check('y la lista puede venir sucia', skillPermitida('testing', ['  TESTING  ']));
check('una skill vacía no es permiso para nada', !skillPermitida('   ', ['']));
check('  ni con una lista que sólo tiene vacíos', !skillPermitida('code review', ['', '   ']));

console.log('\n── Coincidir de verdad, no por parecido ──\n');

check('no basta con contener la palabra', !skillPermitida('code', DE_CODIGO));
check('ni con empezar igual', !skillPermitida('code review pro', DE_CODIGO));
check('ni con ser un prefijo de lo permitido', !skillPermitida('testin', DE_CODIGO));

console.log(
  fallos === 0
    ? '\n✅ Sin permiso no sale dinero, y el permiso es exacto\n'
    : `\n❌ ${fallos} comprobacion(es) fallidas\n`,
);
process.exit(fallos === 0 ? 0 : 1);
