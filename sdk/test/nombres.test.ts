/**
 * El nombre de PanalNames leido de la CADENA en getAgent().
 *
 * Importa porque es la unica senal de identidad que no depende del indexador:
 * el nombre del perfil es texto libre y se repite —hay varias direcciones
 * anunciandose como "LexPanal"— mientras que un nombre de PanalNames lo tiene
 * una sola direccion, y se comprueba con una llamada `view`.
 *
 * Lee mainnet. Las aserciones son estructurales salvo la del nombre concreto,
 * que se apoya en que `lexpanal` esta reclamado desde hace meses.
 */
import { createPanalClient } from '../src/index.js';

let fallos = 0;
const check = (nombre: string, ok: boolean, detalle = ''): void => {
  console.log(`${ok ? '✅' : '❌'} ${nombre}${detalle ? `: ${detalle}` : ''}`);
  if (!ok) fallos++;
};

const panal = createPanalClient();

// El LexPanal de verdad: tiene el nombre unico reclamado.
const REAL = '0x8a672775121DeB778E19158425b34eE4F85F8539';
// Otra direccion que se anuncia como "LexPanal" apuntando al endpoint del real.
const COPIA = '0x17b59Ac5B740De1549F6F92D47599Eaaf99F9302';

const real = await panal.getAgent(REAL);
check('getAgent trae el nombre desde la cadena', real.nombre?.nombre === 'lexpanal', real.nombre?.nombre ?? 'sin nombre');
check('y con la fecha desde la que es suyo', typeof real.nombre?.desdeTs === 'number' && real.nombre.desdeTs > 0);
// `origen` sale de los eventos, no de una lectura: por esta ruta NO se sabe, y
// tiene que quedarse sin saber en vez de darse por 'reclamado'.
check('el origen queda como desconocido, no inventado', real.nombre?.origen === undefined);

const copia = await panal.getAgent(COPIA);
check('quien no reclamo el nombre no lo tiene', copia.nombre === undefined, String(copia.nombre?.nombre));

// Los dos dicen llamarse LexPanal en su metadata: eso es texto libre y no
// prueba nada. El nombre unico es lo que los separa.
check(
  'ambos se anuncian igual en el perfil (por eso hace falta el nombre unico)',
  real.metadata.name === copia.metadata.name,
  `"${real.metadata.name}" vs "${copia.metadata.name}"`,
);

// listAgents NO paga las lecturas extra: son N en paralelo contra el RPC.
const todos = await panal.listAgents();
check('listAgents sigue sin buscar nombres (una lectura por agente)', todos.every((a) => a.nombre === undefined));
check('y devuelve agentes', todos.length > 0, `${todos.length} agentes`);

console.log(fallos === 0 ? '\n✅ Todas las comprobaciones de nombres pasaron' : `\n❌ ${fallos} fallo(s)`);
process.exit(fallos === 0 ? 0 : 1);
