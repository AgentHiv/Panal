/**
 * Por dónde recibe un agente, y qué pasa cuando no lo dice.
 *
 *     npx tsx scripts/test-canal.ts
 *
 * El brief NO viaja on-chain: la cadena guarda su hash y el texto se le manda
 * al agente a `POST /brief/:id`, a la URL que él publica en su ficha como
 * `bot:<url>`. Lo que entrega se baja de su `GET /result/:id`. Un agente sin
 * esa URL, por tanto, no puede leer lo que le piden ni servir lo que entregue
 * —y aun así salía en el mercado con su botón de contratar, cobraba, y el
 * cliente se enteraba por un aviso DESPUÉS de firmar el pago.
 *
 * De ahí que esto tenga tres estados y no dos. El tercero es el que sostiene
 * todo lo demás: el catálogo del indexador manda el `metadataURI` desde hace
 * poco y uno anterior no lo manda. Si «no me lo han dicho» contara como «no
 * tiene», un indexador viejo dejaría el mercado ENTERO sin poder contratar a
 * nadie, que es un fallo mucho más caro que el que esto arregla.
 */
import { canalDeFicha, extractBotUrl } from '../src/lib/botEndpoint.js';
import { composeAgentMetadata } from '../src/lib/agentMetadata.js';

let fallos = 0;
const check = (nombre: string, ok: boolean, detalle = ''): void => {
  console.log(`${ok ? '✅' : '❌'} ${nombre}${ok ? '' : ` — ${detalle}`}`);
  if (!ok) fallos++;
};

/* ── los tres estados ────────────────────────────────────────────────────── */

console.log('\n── Tres estados, y el tercero no acusa a nadie ──\n');

check(
  'con bot: publica canal',
  canalDeFicha('Lint · Revisa código · lint, ts · bot:https://lint.panal.lat') === 'publicado',
);
check('sin bot: no tiene canal', canalDeFicha('Lint · Revisa código · lint, ts') === 'ninguno');
check('sin ficha: no se sabe', canalDeFicha(undefined) === 'desconocido');
check('ficha vacía: se ha leído y no lo lleva', canalDeFicha('') === 'ninguno');

/* ── lo que un indexador viejo NO manda ──────────────────────────────────── */

console.log('\n── Un indexador que no manda la ficha no cierra el mercado ──\n');

// Es el caso real: `metadataURI` es opcional en el catálogo (CatalogAgent), y
// `leerMarca` ya trata su ausencia como «sin marca». Aquí no vale hacer lo
// mismo: sin marca se pinta una tarjeta más sosa, sin canal no se contrata.
check(
  'undefined NO es ninguno',
  canalDeFicha(undefined) !== 'ninguno',
  'un catálogo sin metadataURI dejaría a todos los agentes sin poder recibir encargos',
);

/* ── la ficha de verdad, con todo lo que hoy le cabe ─────────────────────── */

console.log('\n── El canal se encuentra entre todo lo demás ──\n');

const conTodo = composeAgentMetadata({
  name: 'Lint',
  description: 'Revisa código',
  skills: ['lint', 'typescript'],
  botUrl: 'https://lint.panal.lat',
  marca: { logo: 'https://lint.dev/logo.png', github: 'lintlabs/lint' },
  niveles: [
    { name: 'Rápido', description: 'Un archivo', wei: 10n ** 17n, maxBriefChars: 2000, maxAttachChars: null, maxAttachCharsTotal: null },
    { name: 'Repo', description: 'El repo entero', wei: 10n ** 18n, maxBriefChars: 20000, maxAttachChars: null, maxAttachCharsTotal: null },
  ],
});
check('con marca y niveles delante, el bot: sigue encontrándose', canalDeFicha(conTodo) === 'publicado');
check('  y es la URL suya', extractBotUrl(conTodo) === 'https://lint.panal.lat');

const sinBotConTodo = composeAgentMetadata({
  name: 'Lint',
  description: 'Revisa código',
  skills: ['lint'],
  botUrl: '',
  marca: { web: 'https://lint.dev' },
  niveles: [
    { name: 'Rápido', description: null, wei: 10n ** 17n, maxBriefChars: null, maxAttachChars: null, maxAttachCharsTotal: null },
  ],
});
check(
  'una ficha llena de tokens pero sin bot: sigue siendo «ninguno»',
  canalDeFicha(sinBotConTodo) === 'ninguno',
  'un token de marca o de nivel no puede pasar por endpoint',
);

/* ── lo que NO cuenta como una dirección ─────────────────────────────────── */

console.log('\n── Un bot: que no lleva a ningún sitio no es un canal ──\n');

for (const [nombre, ficha] of [
  ['sin URL', 'Lint · Revisa · bot:'],
  ['una palabra', 'Lint · Revisa · bot:mi-bot'],
  ['sin esquema', 'Lint · Revisa · bot:lint.panal.lat'],
  ['ftp', 'Lint · Revisa · bot:ftp://lint.panal.lat'],
] as const) {
  check(`${nombre}: no es una dirección`, canalDeFicha(ficha) === 'ninguno');
}

// Una descripción con la palabra dentro NO es un endpoint. El token tiene que
// ser un segmento suyo, no aparecer en mitad de una frase.
check(
  'y «bot» dentro de la descripción tampoco',
  canalDeFicha('Lint · Soy un bot: reviso código · lint') === 'ninguno',
  'se estaría leyendo como endpoint una frase de la descripción',
);

console.log(
  fallos === 0
    ? '\n✅ Un agente sin dirección donde recibir no se puede contratar, y no haberla mirado no cuenta como no tenerla\n'
    : `\n❌ ${fallos} comprobación(es) fallidas\n`,
);
process.exit(fallos === 0 ? 0 : 1);
