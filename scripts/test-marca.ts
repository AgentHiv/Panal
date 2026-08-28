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
  MAX_LOGO_DATA,
  bytesDeLogo,
  enlaceDe,
  esLogoIncrustado,
  esTokenDeMarca,
  hayMarca,
  leerMarca,
  normalizarMarca,
  tokensDeMarca,
  type ClaveMarca,
  type Marca,
} from '../src/lib/marca.js';
import { composeAgentMetadata, parseAgentMetadata, resumirFicha } from '../src/lib/agentMetadata.js';
import {
  AGENT_LINK_KEYS,
  formatAgentMetadata,
  isEmbeddedLogo,
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

/* ── el logo que viaja DENTRO de la ficha ────────────────────────────────── */

console.log('\n── Una imagen incrustada, leída por los tres ──\n');

/**
 * Un base64 cualquiera del largo que toca. Ninguna de las tres capas decodifica
 * la imagen —no pueden: no hay navegador— así que lo que se comprueba aquí es
 * lo único que ellas deciden: el alfabeto, el largo y el tipo.
 */
const base64De = (largo: number): string => 'QUJDRA'.repeat(Math.ceil(largo / 6)).slice(0, largo);

const LOGO_DATA = `data:image/webp;base64,${base64De(2000)}`;

check('el marketplace guarda la imagen entera', normalizarMarca('logo', LOGO_DATA) === LOGO_DATA);
check(
  '  y el SDK NO la recorta a 120 caracteres',
  normalizeAgentLink('logo', LOGO_DATA) === LOGO_DATA,
  `sdk devolvió ${normalizeAgentLink('logo', LOGO_DATA).length} caracteres`,
);
check('  y el bot la reconoce como token', esTokenBot(`logo:${LOGO_DATA}`));
check('las dos capas coinciden en si vale', esLogoIncrustado(LOGO_DATA) === isEmbeddedLogo(LOGO_DATA));
check('el peso sale bien', bytesDeLogo(LOGO_DATA) === 1500, String(bytesDeLogo(LOGO_DATA)));

const FICHA_CON_IMAGEN = composeAgentMetadata({
  name: 'Lint',
  description: 'Revisa contratos en Solidity',
  skills: ['solidity', 'auditoría'],
  botUrl: 'https://bot.lint.dev',
  marca: { logo: LOGO_DATA, web: '', github: 'lintlabs', x: '', telegram: '' },
});

// Lo que de verdad se rompe si una capa no entiende el token: no es que falte
// el logo, es que la ficha entera se corre y el agente sale con la descripción
// donde iba el nombre.
check('el nombre no se desplaza', parseSdk(FICHA_CON_IMAGEN).name === 'Lint');
check('las skills siguen siendo skills', parseSdk(FICHA_CON_IMAGEN).skills.join(',') === 'solidity,auditoría');
check('el bot no la cuela de skill', !parseAgentMetadata(FICHA_CON_IMAGEN).skills.some((s) => s.includes('data:')));
check('la imagen vuelve entera', leerMarca(FICHA_CON_IMAGEN).logo === LOGO_DATA);
check('  también por el SDK', parseSdk(FICHA_CON_IMAGEN).links.logo === LOGO_DATA);
check('  también por el bot', leerMarcaBot(FICHA_CON_IMAGEN).logo === LOGO_DATA);
check('y recomponerla no la cambia', composeAgentMetadata(parseAgentMetadata(FICHA_CON_IMAGEN)) === FICHA_CON_IMAGEN);

// El preview del formulario tiene que dejar VER lo que se firma, y 2 000
// caracteres de base64 tapan justo lo que hay que mirar.
const resumida = resumirFicha(FICHA_CON_IMAGEN);
check('el preview resume la imagen', resumida.includes('logo:<imagen 1.5 KB>'), resumida.slice(0, 120));
check('  y deja el resto intacto', resumida.includes('Lint · Revisa contratos en Solidity') && resumida.includes('github:lintlabs'));

console.log('\n── Lo que NO puede entrar en la ficha ──\n');

const IMAGENES_MALAS: [string, string][] = [
  // Un SVG es un documento con <script> dentro y esta cadena la pinta
  // cualquiera: el formulario lo acepta, pero lo rasteriza antes de guardarlo.
  ['un SVG', `data:image/svg+xml;base64,${base64De(200)}`],
  ['algo que no es imagen', `data:text/html;base64,${base64De(200)}`],
  ['sin base64', 'data:image/png,%3Csvg%3E'],
  ['con un espacio dentro', `data:image/webp;base64,${base64De(100)} ${base64De(100)}`],
  ['fuera del alfabeto', `data:image/webp;base64,${base64De(96)}·${base64De(100)}`],
  ['más larga que el tope', `data:image/webp;base64,${base64De(MAX_LOGO_DATA)}`],
  ['un base64 que no decodifica', `data:image/webp;base64,${base64De(101)}`],
  ['una miniatura de un píxel', `data:image/webp;base64,${base64De(8)}`],
];

for (const [nombre, valor] of IMAGENES_MALAS) {
  check(`${nombre}: el marketplace no lo guarda`, normalizarMarca('logo', valor) === '');
  check(`  el SDK tampoco`, normalizeAgentLink('logo', valor) === '');
  check(`  ni el bot`, !esTokenBot(`logo:${valor}`));
}

check('y `web:` no admite imágenes: es un enlace', normalizarMarca('web', LOGO_DATA) === '');
check('  el SDK igual', normalizeAgentLink('web', LOGO_DATA) === '');
check('  y el bot igual', !esTokenBot(`web:${LOGO_DATA}`));

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
