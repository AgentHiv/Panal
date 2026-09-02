/**
 * Los tamaños que vende un agente, vistos desde este servidor.
 *
 * Lo que se comprueba aquí es sobre todo QUÉ IMPORTE se acaba bloqueando, que
 * es lo único que el agente mira para saber qué le compraron. Equivocarlo no
 * da un error: da un encargo aceptado a un precio y rechazado por tamaño, con
 * el dinero ya en el escrow.
 */
import { formatEther, parseEther } from 'viem';
import type { Nivel } from '@panal/sdk';
import { buscarNivel, lineaDeNiveles, nivelesDeAgente, renderNiveles } from '../src/niveles.js';

let fallos = 0;
const check = (nombre: string, ok: boolean, detalle = ''): void => {
  console.log(`${ok ? '✅' : '❌'} ${nombre}${ok ? '' : ` — ${detalle}`}`);
  if (!ok) fallos++;
};

const nivel = (name: string, precio: string, maxBriefChars: number | null = null): Nivel => ({
  name,
  description: null,
  wei: parseEther(precio),
  maxBriefChars,
  maxAttachChars: null,
  maxAttachCharsTotal: null,
});

// --- de dónde sale cada mitad -----------------------------------------------

const URI = 'Lex · Resúmenes · legal · bot:https://lex.dev · nivel:0.1|Encargo|Uno suelto|32000 · nivel:0.3|Libro||320000';

{
  const leidos = nivelesDeAgente(URI, []);
  check('lee los niveles de la cadena', leidos.length === 2);
  check('  y en orden, de barato a caro', leidos[0]!.wei < leidos[1]!.wei);
  check('  con su tope de texto', leidos[0]!.maxBriefChars === 32_000 && leidos[1]!.maxBriefChars === 320_000);
}

{
  // La ficha traduce el NOMBRE; el precio sigue siendo el de la cadena.
  const ficha = [nivel('Book', '0.3'), nivel('Job', '0.1')];
  const juntos = nivelesDeAgente(URI, ficha);
  check('el texto lo pone la ficha', juntos.map((n) => n.name).join(',') === 'Job,Book');
  check('  pero el importe sigue siendo el de la cadena', juntos[1]!.wei === parseEther('0.3'));
  check('  y el tope también', juntos[1]!.maxBriefChars === 320_000);
}

{
  // Un agente que solo los declara en su ficha sigue vendiéndolos.
  const soloFicha = nivelesDeAgente('Lex · Resúmenes · legal', [nivel('Grande', '2')]);
  check('sin niveles en la cadena valen los de la ficha', soloFicha.length === 1 && soloFicha[0]!.name === 'Grande');
}

check('un agente sin niveles no se los inventa', nivelesDeAgente('Lex · Resúmenes · legal', []).length === 0);
check('  ni con la ficha caída', nivelesDeAgente(null, []).length === 0);

// --- elegir uno -------------------------------------------------------------

const tres = [nivel('Encargo', '0.1'), nivel('Libro', '0.3'), nivel('Colección', '1.5')];

check('por su nombre', buscarNivel(tres, 'Libro') === tres[1]);
check('  sin distinguir mayúsculas', buscarNivel(tres, 'libro') === tres[1]);
check('  ni espacios de más', buscarNivel(tres, '  Colección  ') === tres[2]);
check('por su precio', buscarNivel(tres, '0.3') === tres[1]);
check('  con el símbolo detrás', buscarNivel(tres, '1.5 MON') === tres[2]);
check('por su posición en la lista', buscarNivel(tres, '1') === tres[0]);
check('lo que no es ninguno es null', buscarNivel(tres, 'gigante') === null);
check('  y el vacío también', buscarNivel(tres, '   ') === null);
// Un índice fuera de rango no puede colarse como el último: quien pidió el
// cuarto de tres no quería el tercero.
check('  y un número fuera de la lista, también', buscarNivel(tres, '4') === null);
check('un precio que no es de nadie no elige el más parecido', buscarNivel(tres, '0.2') === null);

// --- el importe que se bloquea ----------------------------------------------
//
// Esta es la cuenta que hace `panal_quote_hire`, y la razón de todo lo demás.

const importe = (niveles: Nivel[], pedido: string | null, pricePerTask: bigint): bigint | null => {
  if (niveles.length === 0) return pricePerTask;
  const elegido = pedido ? buscarNivel(niveles, pedido) : niveles[0]!;
  return elegido ? elegido.wei : null;
};

check('sin elegir, se cotiza el más barato', importe(tres, null, parseEther('0.1')) === parseEther('0.1'));
check('eligiendo, se cotiza ese', importe(tres, 'Libro', parseEther('0.1')) === parseEther('0.3'));
check('sin niveles, el precio del registro', importe([], null, parseEther('0.07')) === parseEther('0.07'));

// El caso que justifica no usar `pricePerTask` cuando hay niveles: un agente
// cuyo nivel más barato cuesta MÁS que su precio registrado. Pagando el del
// registro, el encargo se rechaza con el dinero ya bloqueado.
{
  const caros = [nivel('Mínimo', '0.5'), nivel('Grande', '2')];
  check(
    'el mínimo manda sobre un pricePerTask más bajo',
    importe(caros, null, parseEther('0.05')) === parseEther('0.5'),
  );
}

// --- cómo se enseñan --------------------------------------------------------

{
  const texto = renderNiveles([nivel('Encargo', '0.1', 32_000), nivel('Libro', '0.3')], 'MON').join('\n');
  check('el listado trae precio y tope', texto.includes('0.1 MON') && texto.includes('up to 32000 chars'));
  check('  y no inventa un tope al que no lo declara', !texto.includes('up to null'));
  check('  y dice qué se compra sin elegir', texto.includes('cheapest'));
  check('sin niveles no se enseña nada', renderNiveles([], 'MON').length === 0);
}

{
  const linea = lineaDeNiveles(tres, 'MON');
  check('la línea de las listas trae el rango', linea === '  Sizes: 3 (0.1 to 1.5 MON) — panal_get_agent lists them');
  check('  con uno solo, no hay rango', lineaDeNiveles([tres[0]!], 'MON')!.includes('(0.1 MON)'));
  check('  y sin niveles no hay línea', lineaDeNiveles([], 'MON') === null);
}

// --- el redondeo no existe --------------------------------------------------
//
// `formatEther` de un precio de nivel tiene que dar la misma cadena que el
// agente escribió en su ficha, o `buscarNivel` por precio no encontraría nada.
check('un precio con muchos decimales se busca igual', buscarNivel([nivel('Fino', '0.000123')], '0.000123') !== null);
check('  y se enseña sin ceros de relleno', formatEther(parseEther('0.03')) === '0.03');

console.log(fallos === 0 ? '\n✅ todo bien' : `\n❌ ${fallos} fallo(s)`);
process.exit(fallos === 0 ? 0 : 1);
