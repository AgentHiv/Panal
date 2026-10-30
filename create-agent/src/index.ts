#!/usr/bin/env node
/**
 * create-panal-agent — genera un agente de Panal listo para funcionar.
 *
 *   npx create-panal-agent mi-agente [--lang es] [--no-input]
 *   npx create-panal-agent upgrade [carpeta] [--check] [--yes] [--force]
 *
 * Copia la plantilla, le pone el nombre, genera una wallet dedicada nueva y
 * escribe la documentación del proyecto en el idioma de quien lo ejecuta.
 * Después son tres pasos: instalar, publicar el endpoint y registrarse.
 *
 * Por qué existe: antes, poner un agente en Panal significaba leer una guía de
 * 529 líneas, montar un VPS y mantenerlo encendido. Eso no es un alta, es un
 * trabajo — y explica por qué el marketplace tenía cinco agentes.
 *
 * Por qué en diez idiomas: el alta es lo primero que ve un desarrollador, y en
 * ella van las tres cosas que salen caras si se malinterpretan —la clave
 * privada, el endpoint público y el gas—. Un aviso que no se entiende es un
 * aviso que no existe.
 */

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { CATALOG, LANGS, fill, isLang, resolveLang, type Catalog, type Lang } from './i18n.js';
import { logoSvg } from './logo.js';
import { aplicar, escribirManifiesto, hayCambios, pareceUnAgente, planear } from './upgrade.js';

const HERE = dirname(fileURLToPath(import.meta.url));
/** La plantilla se empaqueta junto al binario (ver `files` del package.json). */
const TEMPLATE = resolve(HERE, '..', 'template');

/**
 * Archivos que en el repo llevan `_` delante y aquí recuperan su nombre real.
 *
 * Van así porque un `package.json` o un `.gitignore` de verdad dentro de la
 * plantilla los recogerían las herramientas del monorepo: npm intentaría
 * instalarlos, git ignoraría lo que no debe. El mapa es de nombre exacto a
 * nombre exacto, sin adivinar extensiones.
 */
const RENAMES: Record<string, string> = {
  '_package.json': 'package.json',
  '_tsconfig.json': 'tsconfig.json',
  '_env.example': '.env.example',
  _gitignore: '.gitignore',
};

const c = {
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
};

function fail(msg: string): never {
  console.error(`\n${msg}\n`);
  process.exit(1);
}

/** Los enlaces del escaparate, en el mismo orden en que los pinta el mercado. */
const ENLACES = ['logo', 'web', 'github', 'x', 'telegram'] as const;
type Enlace = (typeof ENLACES)[number];
type Enlaces = Record<Enlace, string>;
const SIN_ENLACES: Enlaces = { logo: '', web: '', github: '', x: '', telegram: '' };

/**
 * Lo que se puede escribir dentro de la plantilla, y por qué es tan estrecho.
 *
 * Este valor acaba DENTRO de un literal de TypeScript, en `src/register.ts`.
 * Una comilla, una barra invertida o un salto de línea no dan un enlace mal
 * puesto: dan un archivo que no compila, o —peor— uno que compila haciendo otra
 * cosa. El alfabeto de aquí es el de una URL y el de un nombre de usuario, y
 * nada más.
 *
 * NO valida el enlace. De eso se encarga el SDK al registrar, con reglas por
 * red (`usuario`, `usuario/repo`, `+invitación`…). Aquí solo se comprueba que
 * se pueda escribir sin romper nada, y el tope de 120 es el mismo que aguanta
 * la ficha on-chain.
 */
const ESCRIBIBLE = /^[A-Za-z0-9:/?#@!&()*+,;=._~%-]{1,120}$/;

function limpiaEnlace(crudo: string): string {
  const valor = crudo.trim();
  return ESCRIBIBLE.test(valor) ? valor : '';
}

interface Args {
  name: string | null;
  lang: string | null;
  noInput: boolean;
  help: boolean;
  version: boolean;
  /** Lo que venga por bandera; lo demás se pregunta, o se queda vacío. */
  links: Enlaces;
  /** Segundo argumento suelto: la carpeta de `upgrade`. */
  carpeta: string | null;
  yes: boolean;
  check: boolean;
  force: boolean;
}

/**
 * Se admite `--lang es` y `--lang=es`. No es capricho: la primera forma es la
 * que teclea una persona y la segunda la que escriben los scripts.
 */
function parseArgs(argv: string[]): Args {
  const args: Args = {
    name: null,
    lang: null,
    noInput: false,
    help: false,
    version: false,
    links: { ...SIN_ENLACES },
    carpeta: null,
    yes: false,
    check: false,
    force: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--help' || a === '-h') args.help = true;
    else if (a === '--version' || a === '-v') args.version = true;
    else if (a === '--no-input') args.noInput = true;
    else if (a === '--yes' || a === '-y') {
      args.noInput = true;
      args.yes = true;
    } else if (a === '--check') args.check = true;
    else if (a === '--force') args.force = true;
    else if (a === '--lang') args.lang = argv[++i] ?? '';
    else if (a.startsWith('--lang=')) args.lang = a.slice('--lang='.length);
    else {
      // Los cinco enlaces, en las dos formas: `--x panal` y `--x=panal`.
      const enlace = ENLACES.find((e) => a === `--${e}` || a.startsWith(`--${e}=`));
      if (enlace) {
        const crudo = a.includes('=') ? a.slice(a.indexOf('=') + 1) : (argv[++i] ?? '');
        args.links[enlace] = limpiaEnlace(crudo);
      } else if (!a.startsWith('-') && args.name === null) {
        args.name = a;
      } else if (!a.startsWith('-') && args.carpeta === null) {
        args.carpeta = a;
      }
    }
  }
  return args;
}

/** Nombre válido de carpeta y de paquete npm. */
function validateName(raw: string | null, t: Catalog): string {
  const name = (raw ?? '').trim().replace(/^\.\//, '');
  if (!name) fail(t.errNoName);
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(name)) fail(fill(t.errBadName, { name }));
  return name;
}

/**
 * Selector interactivo. Solo aparece cuando hay una persona delante: sin TTY
 * —en CI, en un Dockerfile, tras una tubería— preguntar cuelga el proceso, así
 * que en ese caso se cae al inglés sin ruido.
 */
async function askLang(): Promise<Lang> {
  const { createInterface } = await import('node:readline/promises');
  console.log('');
  LANGS.forEach((l, i) => {
    console.log(`  ${c.bold(String(i + 1).padStart(2))}  ${l.label}${i === 0 ? c.dim('  (default)') : ''}`);
  });
  console.log('');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    // La pregunta va en inglés porque todavía no sabemos en qué idioma leer.
    const answer = (await rl.question(`${CATALOG.en.pickLang} [1-${LANGS.length}] `)).trim();
    const n = Number(answer);
    if (Number.isInteger(n) && n >= 1 && n <= LANGS.length) return LANGS[n - 1]!.code;
    if (isLang(answer.toLowerCase())) return answer.toLowerCase() as Lang;
    return 'en';
  } finally {
    rl.close();
  }
}

/**
 * Las preguntas del escaparate: el logo y los enlaces del creador.
 *
 * Existen por una razón concreta: en el mercado un agente sale entre
 * desconocidos, y un repositorio que se puede abrir dice más de él que
 * cualquier frase que escriba sobre sí mismo. Antes esto solo se podía poner
 * editando `src/register.ts` a mano, y un campo al que hay que ir no lo rellena
 * nadie.
 *
 * TODAS SE SALTAN CON ENTER, y no se preguntan siquiera sin terminal
 * interactiva ni con `--no-input`: quien monta esto en un Dockerfile no puede
 * contestar, y una pregunta ahí cuelga el proceso para siempre.
 *
 * Lo que llega por bandera no se vuelve a preguntar.
 */
async function askLinks(t: Catalog, yaPuestos: Enlaces): Promise<Enlaces> {
  const { createInterface } = await import('node:readline/promises');
  const puestos: Enlaces = { ...yaPuestos };
  console.log(`\n${c.bold(t.brand.title)}\n`);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    for (const clave of ENLACES) {
      if (puestos[clave]) continue;
      const dicho = (await rl.question(`  ${t.brand[clave]}: `)).trim();
      if (!dicho) continue;
      const limpio = limpiaEnlace(dicho);
      // Se avisa y se sigue. Un enlace raro no puede costarle a nadie volver a
      // empezar el alta: lo puede poner luego en `src/register.ts`.
      if (!limpio) console.log(c.yellow(`     ${fill(t.brand.bad, { name: dicho })}`));
      else puestos[clave] = limpio;
    }
  } finally {
    rl.close();
  }
  return puestos;
}

/** Copia la plantilla sustituyendo los marcadores. */
function copyTemplate(dest: string, name: string, links: Enlaces, t: Catalog): void {
  cpSync(TEMPLATE, dest, { recursive: true });

  for (const [from, to] of Object.entries(RENAMES)) {
    const src = join(dest, from);
    if (!existsSync(src)) fail(fill(t.errTemplateMissing, { name: from }));
    renameSync(src, join(dest, to));
  }

  // Un enlace vacío deja `logo: ''` en el perfil, que es exactamente lo que
  // había antes de que se pudieran pasar: no rellenar nada no cambia nada.
  const marcadores: Record<string, string> = {
    __NAME__: name,
    __LINK_LOGO__: links.logo,
    __LINK_WEB__: links.web,
    __LINK_GITHUB__: links.github,
    __LINK_X__: links.x,
    __LINK_TELEGRAM__: links.telegram,
  };

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      const before = readFileSync(full, 'utf8');
      let after = before;
      for (const [marcador, valor] of Object.entries(marcadores)) {
        after = after.replaceAll(marcador, valor);
      }
      if (after !== before) writeFileSync(full, after, 'utf8');
    }
  };
  walk(dest);
}

/**
 * El `.env.example` se escribe aquí, no se copia: sus comentarios explican qué
 * es cada clave y son justo lo que hay que entender antes de pegar una clave
 * privada en un servidor.
 */
function writeEnvExample(dest: string, t: Catalog): string {
  const bloque = (texto: string): string =>
    texto
      .split('\n')
      .map((l) => `# ${l}`)
      .join('\n');

  const contenido = [
    bloque(t.env.key),
    'AGENT_PRIVATE_KEY=',
    '',
    bloque(t.env.port),
    'PORT=8787',
    '',
    bloque(t.env.host),
    '# HOST=127.0.0.1',
    '',
    bloque(t.env.model),
    '#   claude · gemini · kimi · grok · glm · deepseek · groq · openai · mistral · ollama',
    'LLM_PROVIDER=deepseek',
    'LLM_API_KEY=',
    '# LLM_MODEL=',
    '# LLM_BASE_URL=',
    '',
    bloque(t.env.rpc),
    'RPC_URL=',
    '',
    bloque(t.env.data),
    'DATA_DIR=./data',
    '',
    bloque(t.env.x402),
    'X402_PRICE=',
    '# X402_TOKEN=PANAL',
    '# X402_DESCRIPTION=',
    '',
    bloque(t.env.subcontrata),
    'SUBCONTRATA_MAX=',
    'SUBCONTRATA_SALTOS=2',
    '',
    bloque(t.env.vigilante),
    'VIGILANTE_SEGUNDOS=60',
    'PUBLIC_URL=',
    '',
    bloque(t.env.retirada),
    'RETIRADA_MINUTOS=60',
    'RETIRADA_MAX_GAS_PCT=2',
    'RETIRADA_PANAL_DESDE=1000',
    '',
    bloque(t.env.tablon),
    'TABLON=off',
    'TABLON_CATEGORIAS=',
    'TABLON_MINUTOS=5',
    'TABLON_MARGEN_MINUTOS=60',
    'TABLON_PALABRAS=',
    'TABLON_MINIMO_USD=',
    '',
    bloque(t.env.memoria),
    'MEMORIA_TURNOS=6',
    'MEMORIA_CHARS=4000',
    '',
    bloque(t.env.seguridad),
    'LIMITE_POR_MINUTO=60',
    '# TRAS_PROXY=1',
    '# AUTH_ESTRICTA=1',
    '',
    bloque(t.env.operacion),
    '# X402_PLAZO_SEGUNDOS=100',
    '# APAGADO_SEGUNDOS=110',
    '',
  ].join('\n');

  writeFileSync(join(dest, '.env.example'), contenido, 'utf8');
  return contenido;
}

/** `upgrade`: el motor nuevo en un agente ya generado. Lo tuyo no se toca (ver upgrade.ts). */
function upgrade(args: Args, t: Catalog): void {
  const dest = resolve(process.cwd(), args.carpeta ?? '.');
  if (!pareceUnAgente(dest)) fail(fill(t.upNotAgent, { name: dest }));
  const { version } = JSON.parse(readFileSync(resolve(HERE, '..', 'package.json'), 'utf8')) as { version: string };
  const plan = planear(dest, TEMPLATE, version);

  if (!hayCambios(plan)) {
    console.log(`\n${c.green('✓')} ${fill(t.upUpToDate, { to: version })}\n`);
    return;
  }
  console.log(`\n${c.bold(fill(t.upPlan, { name: basename(dest), from: plan.versionActual ?? '?', to: version }))}\n`);
  if (plan.cambian.length) console.log(`${t.upChanges}\n${plan.cambian.map((r) => `  ${r}`).join('\n')}\n`);
  const nuevos = [...plan.nuevos, ...plan.despliegue];
  if (nuevos.length) console.log(`${t.upNew}\n${nuevos.map((r) => `  ${r}`).join('\n')}\n`);
  if (plan.dependencias.length) {
    console.log(`${t.upDeps}\n${plan.dependencias.map((d) => `  ${d.nombre}: ${d.de ?? '—'} → ${d.a}`).join('\n')}\n`);
  }
  if (args.check) {
    console.log(c.dim(`${t.upCheckOnly}\n`));
    return;
  }
  if (plan.tocados.length && !args.force) fail(fill(t.upEdited, { files: plan.tocados.map((r) => `  ${r}`).join('\n') }));
  if (plan.versionActual === null && !args.yes && !args.force) fail(t.upUnknown);

  const copia = aplicar(dest, TEMPLATE, plan);
  console.log(`${c.green('✓')} ${fill(t.upDone, { backup: copia })}`);
  console.log(c.dim(`${t.upNext}\n`));
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  // --help y --version salen antes que nada: son las dos cosas que se piden
  // cuando aún no se sabe qué hace el comando.
  const pedido = resolveLang(args.lang, process.env);
  if (args.lang && !pedido) fail(fill(CATALOG.en.errBadLang, { name: args.lang }));

  if (args.version) {
    const pkg = JSON.parse(readFileSync(resolve(HERE, '..', 'package.json'), 'utf8')) as { version: string };
    console.log(pkg.version);
    return;
  }
  if (args.help) {
    const ayuda = pedido ? CATALOG[pedido] : CATALOG.en;
    console.log(`\n${ayuda.usage}\n\n${ayuda.usageUpgrade}\n`);
    return;
  }

  // Sin idioma decidido: se pregunta si hay alguien delante, y si no, inglés.
  const interactivo = !args.noInput && process.stdin.isTTY === true && process.stdout.isTTY === true;
  const lang: Lang = pedido ?? (interactivo ? await askLang() : 'en');
  const t = CATALOG[lang];

  if (args.name === 'upgrade') {
    upgrade(args, t);
    return;
  }

  const name = validateName(args.name, t);
  const dest = resolve(process.cwd(), name);

  if (existsSync(dest) && readdirSync(dest).length > 0) fail(fill(t.errDirExists, { name }));
  if (!existsSync(TEMPLATE)) fail(fill(t.errTemplateMissing, { name: TEMPLATE }));

  // El escaparate se pregunta AQUÍ: después de validar el nombre y la carpeta,
  // para no hacer cinco preguntas y fallar luego, y antes de copiar nada,
  // porque los enlaces se escriben dentro de la plantilla al copiarla.
  const links = interactivo ? await askLinks(t, args.links) : args.links;

  // Wallet dedicada, generada aquí. La alternativa —"crea una wallet y pega la
  // clave"— es donde la gente acaba pegando la de su MetaMask personal, que es
  // exactamente lo que no debe vivir en un servidor.
  const privateKey = generatePrivateKey();
  const address = privateKeyToAccount(privateKey).address;

  mkdirSync(dest, { recursive: true });
  copyTemplate(dest, name, links, t);
  const envExample = writeEnvExample(dest, t);
  writeFileSync(
    join(dest, '.env'),
    envExample.replace('AGENT_PRIVATE_KEY=', `AGENT_PRIVATE_KEY=${privateKey}`),
    'utf8',
  );

  // Su cara desde el primer minuto. El servidor de la plantilla ya sirve este
  // archivo en `/logo`, y el registro publica esa URL solo si no has puesto
  // otra: un agente recién generado deja de salir igual que todos los demás sin
  // que haya que hacer nada.
  writeFileSync(join(dest, 'logo.svg'), logoSvg(name, address), 'utf8');

  // El README del proyecto, en su idioma. Es donde vive lo que no cabe en la
  // pantalla de alta: cómo se cobra, qué hace cada archivo y qué rompe agentes.
  writeFileSync(join(dest, 'README.md'), `${fill(t.readme, { name, address })}\n\n${t.readmeOps}\n`, 'utf8');
  const { version } = JSON.parse(readFileSync(resolve(HERE, '..', 'package.json'), 'utf8')) as { version: string };
  escribirManifiesto(dest, TEMPLATE, version);

  console.log(`\n${c.green('✓')} ${c.bold(fill(t.created, { name }))}\n`);
  console.log(`  ${t.walletLabel} ${c.bold(address)}`);
  console.log(c.dim(`  ${fill(t.walletNote, { name })}`));
  console.log(c.dim(`  ${t.logoWritten}\n`));

  console.log(c.bold(`${t.stepsTitle}\n`));
  console.log(`  ${c.bold('1.')} ${t.s1Title}`);
  console.log(c.dim(`       ${fill(t.s1Install, { name })}`));
  console.log(c.dim(`       ${fill(t.s1Fund, { address })}\n`));

  console.log(`  ${c.bold('2.')} ${t.s2Title}`);
  console.log(c.dim(`       ${t.s2Edit}`));
  console.log(c.dim(`       ${t.s2Key}\n`));

  console.log(`  ${c.bold('3.')} ${t.s3Title}`);
  console.log(c.dim(`       ${t.s3Start}`));
  console.log(c.dim(`       ${t.s3Register}\n`));

  console.log(`${c.yellow(t.warnLabel)} ${t.warnBody}\n`);
  console.log(c.dim(`${t.docs}\n`));
}

void main();
