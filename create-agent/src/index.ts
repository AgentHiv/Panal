#!/usr/bin/env node
/**
 * create-panal-agent — genera un agente de Panal listo para funcionar.
 *
 *   npx create-panal-agent mi-agente [--lang es] [--no-input]
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
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { CATALOG, LANGS, fill, isLang, resolveLang, type Catalog, type Lang } from './i18n.js';

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

interface Args {
  name: string | null;
  lang: string | null;
  noInput: boolean;
  help: boolean;
  version: boolean;
}

/**
 * Se admite `--lang es` y `--lang=es`. No es capricho: la primera forma es la
 * que teclea una persona y la segunda la que escriben los scripts.
 */
function parseArgs(argv: string[]): Args {
  const args: Args = { name: null, lang: null, noInput: false, help: false, version: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--help' || a === '-h') args.help = true;
    else if (a === '--version' || a === '-v') args.version = true;
    else if (a === '--no-input' || a === '--yes' || a === '-y') args.noInput = true;
    else if (a === '--lang') args.lang = argv[++i] ?? '';
    else if (a.startsWith('--lang=')) args.lang = a.slice('--lang='.length);
    else if (!a.startsWith('-') && args.name === null) args.name = a;
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

/** Copia la plantilla sustituyendo los marcadores. */
function copyTemplate(dest: string, name: string, t: Catalog): void {
  cpSync(TEMPLATE, dest, { recursive: true });

  for (const [from, to] of Object.entries(RENAMES)) {
    const src = join(dest, from);
    if (!existsSync(src)) fail(fill(t.errTemplateMissing, { name: from }));
    renameSync(src, join(dest, to));
  }

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      const before = readFileSync(full, 'utf8');
      const after = before.replaceAll('__NAME__', name);
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
    bloque(t.env.model),
    '#   OpenAI     https://api.openai.com/v1        gpt-4o-mini',
    '#   DeepSeek   https://api.deepseek.com/v1      deepseek-chat',
    '#   Groq       https://api.groq.com/openai/v1   llama-3.3-70b-versatile',
    'LLM_BASE_URL=https://api.deepseek.com/v1',
    'LLM_API_KEY=',
    'LLM_MODEL=deepseek-chat',
    '',
    bloque(t.env.rpc),
    'RPC_URL=',
    '',
    bloque(t.env.data),
    'DATA_DIR=./data',
    '',
    bloque(t.env.x402),
    'X402_PRICE=',
    '# X402_TOKEN=0x2e2e44e7fa6178822d4397299f719e89d1a67777',
    '# X402_SYMBOL=$PANAL',
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
    bloque(t.env.seguridad),
    'LIMITE_POR_MINUTO=60',
    '# TRAS_PROXY=1',
    '# AUTH_ESTRICTA=1',
    '',
  ].join('\n');

  writeFileSync(join(dest, '.env.example'), contenido, 'utf8');
  return contenido;
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
    console.log(`\n${(pedido ? CATALOG[pedido] : CATALOG.en).usage}\n`);
    return;
  }

  // Sin idioma decidido: se pregunta si hay alguien delante, y si no, inglés.
  const interactivo = !args.noInput && process.stdin.isTTY === true && process.stdout.isTTY === true;
  const lang: Lang = pedido ?? (interactivo ? await askLang() : 'en');
  const t = CATALOG[lang];

  const name = validateName(args.name, t);
  const dest = resolve(process.cwd(), name);

  if (existsSync(dest) && readdirSync(dest).length > 0) fail(fill(t.errDirExists, { name }));
  if (!existsSync(TEMPLATE)) fail(fill(t.errTemplateMissing, { name: TEMPLATE }));

  mkdirSync(dest, { recursive: true });
  copyTemplate(dest, name, t);
  const envExample = writeEnvExample(dest, t);

  // Wallet dedicada, generada aquí. La alternativa —"crea una wallet y pega la
  // clave"— es donde la gente acaba pegando la de su MetaMask personal, que es
  // exactamente lo que no debe vivir en un servidor.
  const privateKey = generatePrivateKey();
  const address = privateKeyToAccount(privateKey).address;
  writeFileSync(
    join(dest, '.env'),
    envExample.replace('AGENT_PRIVATE_KEY=', `AGENT_PRIVATE_KEY=${privateKey}`),
    'utf8',
  );

  // El README del proyecto, en su idioma. Es donde vive lo que no cabe en la
  // pantalla de alta: cómo se cobra, qué hace cada archivo y qué rompe agentes.
  writeFileSync(join(dest, 'README.md'), fill(t.readme, { name, address }), 'utf8');

  console.log(`\n${c.green('✓')} ${c.bold(fill(t.created, { name }))}\n`);
  console.log(`  ${t.walletLabel} ${c.bold(address)}`);
  console.log(c.dim(`  ${fill(t.walletNote, { name })}\n`));

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
