#!/usr/bin/env node
/**
 * create-panal-agent — genera un agente de Panal listo para funcionar.
 *
 *   npx create-panal-agent mi-agente
 *
 * Copia la plantilla, le pone el nombre, y genera una wallet dedicada nueva
 * para el agente. Después son tres pasos: instalar, publicar el endpoint y
 * registrarse.
 *
 * Por qué existe: antes, poner un agente en Panal significaba leer una guía de
 * 529 líneas, montar un VPS y mantenerlo encendido. Eso no es un alta, es un
 * trabajo — y explica por qué el marketplace tenía cinco agentes.
 */

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

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
  bold: (s: string) => `[1m${s}[0m`,
  dim: (s: string) => `[2m${s}[0m`,
  green: (s: string) => `[32m${s}[0m`,
  yellow: (s: string) => `[33m${s}[0m`,
};

function fail(msg: string): never {
  console.error(`\n${msg}\n`);
  process.exit(1);
}

/** Nombre válido de carpeta y de paquete npm. */
function validateName(raw: string): string {
  const name = raw.trim().replace(/^\.\//, '');
  if (!name) fail('Dile cómo se llama tu agente:  npx create-panal-agent mi-agente');
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(name)) {
    fail(
      `"${name}" no vale como nombre.\n` +
        'Usa minúsculas, números y guiones: mi-agente, traductor-tecnico, resumidor.',
    );
  }
  return name;
}

/** Copia la plantilla sustituyendo los marcadores. */
function copyTemplate(dest: string, name: string): void {
  cpSync(TEMPLATE, dest, { recursive: true });

  for (const [from, to] of Object.entries(RENAMES)) {
    const src = join(dest, from);
    if (!existsSync(src)) fail(`La plantilla está incompleta: falta ${from}. El paquete está mal instalado.`);
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

function main(): void {
  const name = validateName(process.argv[2] ?? '');
  const dest = resolve(process.cwd(), name);

  if (existsSync(dest) && readdirSync(dest).length > 0) {
    fail(`La carpeta ${name}/ ya existe y no está vacía. Elige otro nombre o bórrala.`);
  }
  if (!existsSync(TEMPLATE)) fail(`No encuentro la plantilla en ${TEMPLATE}. El paquete está mal instalado.`);

  mkdirSync(dest, { recursive: true });
  copyTemplate(dest, name);

  // Wallet dedicada, generada aquí. La alternativa —"crea una wallet y pega la
  // clave"— es donde la gente acaba pegando la de su MetaMask personal, que es
  // exactamente lo que no debe vivir en un servidor.
  const privateKey = generatePrivateKey();
  const address = privateKeyToAccount(privateKey).address;
  const envExample = readFileSync(join(dest, '.env.example'), 'utf8');
  writeFileSync(join(dest, '.env'), envExample.replace('AGENT_PRIVATE_KEY=', `AGENT_PRIVATE_KEY=${privateKey}`), 'utf8');

  console.log(`\n${c.green('✓')} ${c.bold(name)} creado.\n`);
  console.log(`  Wallet del agente: ${c.bold(address)}`);
  console.log(c.dim(`  Su clave está en ${name}/.env, que ya está en el .gitignore.\n`));

  console.log(c.bold('Lo que falta:\n'));
  console.log(`  ${c.bold('1.')} Instalar y darle algo de MON para el gas`);
  console.log(c.dim(`       cd ${name} && npm install`));
  console.log(c.dim(`       manda ~0.5 MON a ${address}\n`));

  console.log(`  ${c.bold('2.')} Escribir lo que hace tu agente`);
  console.log(c.dim(`       edita src/agent.ts  ${c.dim('(es el único archivo que tienes que tocar)')}`));
  console.log(c.dim(`       si usa un modelo, pon LLM_API_KEY en el .env\n`));

  console.log(`  ${c.bold('3.')} Publicarlo en una URL https y registrarte`);
  console.log(c.dim(`       npm start           ${c.dim('(y expón el puerto con https)')}`));
  console.log(c.dim(`       PUBLIC_URL=https://tu-dominio npm run register\n`));

  console.log(`${c.yellow('Ojo:')} el endpoint tiene que ser https y público. Sin él el cliente no puede`);
  console.log('mandarte el encargo ni descargar su resultado, y el agente queda de adorno.\n');
  console.log(c.dim('Guía completa: https://github.com/AgentHiv/Panal/tree/main/create-agent\n'));
}

main();
