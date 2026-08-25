/**
 * La marca de un agente, leída por los tres que la leen.
 *
 *     npx tsx scripts/test-marca.ts
 *
 * El logo y los enlaces de un agente viven dentro del `metadataURI`, que es UN
 * campo de texto en el registro. Eso obliga a que todo el que lo lea reparta
 * igual: nombre, descripción, skills… y los tokens fuera. Y lo leen tres capas
 * que no comparten código a propósito —el marketplace (`src/lib/marca.ts`), el
 * SDK (`sdk/src/types.ts`) y el bot (`bot/src/marca.ts`)— porque el bot tiene
 * su propio lockfile y el SDK arrastra medio Node.
 *
 * Lo que se rompe si se separan no da ningún error: un token que una capa
 * reconoce y otra no CORRE LAS POSICIONES, y el agente aparece en el mercado
 * con su `logo:https://…` de skill y su descripción donde iba el nombre. Se ve
 * mirando la web, no leyendo ninguno de los tres archivos.
 *
 * Y hay un caso que importa más que los demás: la descripción es texto libre.
 * Alguien va a escribir «web: la mejor del mercado» ahí dentro, y esa frase NO
 * puede desaparecer de su ficha.
 */
import {
  CLAVES_MARCA,
  enlaceDe,
  esTokenDeMarca,
  hayMarca,
  leerMarca,
  normalizarMarca,
  tokensDeMarca,
  type ClaveMarca,
  type Marca,
} from '../src/lib/marca.js';
import { composeAgentMetadata, parseAgentMetadata } from '../src/lib/agentMetadata.js';
import {
  AGENT_LINK_KEYS,
  formatAgentMetadata,
  normalizeAgentLink,
  parseAgentMetadata as parseSdk,
} from '../sdk/src/types.js';
import { esTokenDeMarca as esTokenBot, leerMarca as leerMarcaBot } from '../bot/src/marca.js';

let fallos = 0;
const check = (nombre: string, ok: boolean, detalle = ''): void => {
  console.log(`${ok ? '✅' : '❌'} ${nombre}${ok ? '' : ` — ${detalle}`}`);
  if (!ok) fallos++;
};

/* ── qué vale y qué no ───────────────────────────────────────────────────── */

console.log('\n── Un valor solo cuenta si vale ──\n');

const BUENOS: [ClaveMarca, string, string][] = [
  ['logo', 'https://lint.dev/logo.png', 'https://lint.dev/logo.png'],
  ['web', 'https://lint.dev', 'https://lint.dev'],
  ['github', 'lintlabs', 'lintlabs'],
  ['github', 'lintlabs/lint', 'lintlabs/lint'],
  ['github', 'https://github.com/lintlabs/lint', 'lintlabs/lint'],
  ['x', '@lintlabs', 'lintlabs'],
  ['x', 'https://twitter.com/lintlabs', 'lintlabs'],
  ['x', 'https://x.com/lintlabs/', 'lintlabs'],
  ['telegram', 'https://t.me/lintlabs', 'lintlabs'],
  ['telegram', '+AbCdEfGh12', '+AbCdEfGh12'],
];

for (const [clave, crudo, esperado] of BUENOS) {
  const web = normalizarMarca(clave, crudo);
  const sdk = normalizeAgentLink(clave, crudo);
  check(`${clave}: «${crudo}» → «${esperado}»`, web === esperado, `web dio «${web}»`);
  check(`  y el SDK lo deja igual`, sdk === web, `sdk dio «${sdk}»`);
}

const MALOS: [ClaveMarca, string][] = [
  ['logo', 'http://lint.dev/logo.png'],      // http se ve en blanco y sin error
  ['logo', 'lint.dev/logo.png'],             // sin protocolo no es una URL
  ['web', 'javascript:alert(1)'],
  ['web', 'https://localhost'],              // sin punto no es un dominio
  ['github', 'https://gitlab.com/lint'],     // no es el dominio de esa clave
  ['x', 'dos palabras'],
  ['github', ''],
];

for (const [clave, crudo] of MALOS) {
  check(`${clave}: «${crudo}» no vale`, normalizarMarca(clave, crudo) === '');
  check(`  y para el SDK tampoco`, normalizeAgentLink(clave, crudo) === '');
}

/* ── los tres leen la misma ficha ────────────────────────────────────────── */

console.log('\n── La misma ficha, leída por los tres ──\n');

const FICHA =
  'Lint · Revisa contratos en Solidity · solidity, auditoría · bot:https://bot.lint.dev' +
  ' · logo:https://lint.dev/logo.png · web:https://lint.dev · github:lintlabs/lint · x:lintlabs';

const web = leerMarca(FICHA);
const sdk = parseSdk(FICHA).links;
const bot = leerMarcaBot(FICHA);

for (const clave of CLAVES_MARCA) {
  check(`${clave}: web y SDK coinciden`, web[clave] === sdk[clave], `${web[clave]} ≠ ${sdk[clave]}`);
  check(`${clave}: web y bot coinciden`, web[clave] === (bot[clave] ?? ''), `${web[clave]} ≠ ${bot[clave]}`);
}

check('el nombre no se desplaza', parseSdk(FICHA).name === 'Lint');
check('la descripción tampoco', parseSdk(FICHA).description === 'Revisa contratos en Solidity');
check(
  'y las skills son las skills, no los enlaces',
  parseSdk(FICHA).skills.join(',') === 'solidity,auditoría',
  parseSdk(FICHA).skills.join(','),
);
check('el bot ve el mismo nombre', parseAgentMetadata(FICHA).name === 'Lint');
check(
  'el marketplace ve las mismas skills',
  parseAgentMetadata(FICHA).skills.join(',') === 'solidity,auditoría',
  parseAgentMetadata(FICHA).skills.join(','),
);
check('las tres claves reconocidas son las mismas', AGENT_LINK_KEYS.join(',') === CLAVES_MARCA.join(','));

/* ── lo que se escribe se vuelve a leer ──────────────────────────────────── */

console.log('\n── Ida y vuelta ──\n');

const MARCA: Marca = {
  logo: 'https://lint.dev/logo.png',
  web: 'https://lint.dev',
  github: 'lintlabs/lint',
  x: '@lintlabs',
  telegram: '',
};

const compuesta = composeAgentMetadata({
  name: 'Lint',
  description: 'Revisa contratos en Solidity',
  skills: ['solidity', 'auditoría'],
  botUrl: 'https://bot.lint.dev',
  marca: MARCA,
});
check('la web compone la misma ficha', compuesta === FICHA, `\n  ${compuesta}\n  ${FICHA}`);
check(
  'y el SDK compone exactamente lo mismo',
  formatAgentMetadata({
    name: 'Lint',
    description: 'Revisa contratos en Solidity',
    skills: ['solidity', 'auditoría'],
    botUrl: 'https://bot.lint.dev',
    links: MARCA,
  }) === compuesta,
);

const vuelta = parseAgentMetadata(compuesta);
check('el @ del usuario no vuelve', vuelta.marca.x === 'lintlabs');
check('lo vacío sigue vacío', vuelta.marca.telegram === '');
check('el bot no se pierde', vuelta.botUrl === 'https://bot.lint.dev');

/* ── el agente que no puso nada ──────────────────────────────────────────── */

console.log('\n── Un agente sin marca sigue igual que siempre ──\n');

const VIEJA = 'LexPanal · Resúmenes legales EN⇄ES · legal, traducción · bot:https://bot.panal.lat';
check('la ficha no cambia al recomponerla', composeAgentMetadata(parseAgentMetadata(VIEJA)) === VIEJA);
check('no se inventa marca', !hayMarca(leerMarca(VIEJA)));
check('el SDK tampoco', Object.values(parseSdk(VIEJA).links).every((v) => v === ''));
check('ni el bot', Object.keys(leerMarcaBot(VIEJA)).length === 0);

/* ── la descripción es texto libre, y hay que respetarla ─────────────────── */

console.log('\n── Una descripción con dos puntos NO se convierte en un enlace ──\n');

const TRAMPA = 'Copy · web: la mejor del mercado · copywriting';
check('el segmento sigue siendo descripción', parseAgentMetadata(TRAMPA).description === 'web: la mejor del mercado');
check('no sale ningún enlace', !hayMarca(leerMarca(TRAMPA)));
check('para el SDK igual', parseSdk(TRAMPA).description === 'web: la mejor del mercado');
check('y el bot no lo aparta', !esTokenBot('web: la mejor del mercado'));
check('los tres coinciden en que no es un token', !esTokenDeMarca('web: la mejor del mercado'));

check('un «·» dentro de un valor no se guarda', tokensDeMarca({ x: 'lint·labs' }).length === 0);
check('ni un espacio: «dos palabras» no es el usuario «dospalabras»', normalizarMarca('x', 'dos palabras') === '');
check('  el SDK tampoco lo pega', normalizeAgentLink('x', 'dos palabras') === '');
check('  ni el bot lo acepta', !esTokenBot('x:dos palabras'));

/* ── a dónde lleva cada enlace ───────────────────────────────────────────── */

console.log('\n── Los enlaces llevan a donde dicen ──\n');

check('github', enlaceDe('github', 'lintlabs/lint') === 'https://github.com/lintlabs/lint');
check('x', enlaceDe('x', 'lintlabs') === 'https://x.com/lintlabs');
check('telegram', enlaceDe('telegram', 'lintlabs') === 'https://t.me/lintlabs');
check('web es la URL tal cual', enlaceDe('web', 'https://lint.dev') === 'https://lint.dev');
check('el logo no es un enlace: es una imagen', enlaceDe('logo', 'https://lint.dev/l.png') === '');

console.log(
  fallos === 0
    ? '\n✅ El mercado, el SDK y el bot leen la misma ficha, y una descripción con dos puntos sigue siendo una descripción\n'
    : `\n❌ ${fallos} comprobación(es) fallidas: las implementaciones se han separado\n`,
);
process.exit(fallos === 0 ? 0 : 1);
