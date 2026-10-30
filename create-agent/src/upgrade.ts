/**
 * `create-panal-agent upgrade`: traer el motor nuevo a un agente ya generado.
 *
 * Un arreglo de seguridad en la plantilla no servía de nada a quien ya tenía su
 * agente en marcha: el generador copia y se olvida. Aquí se separa lo que es de
 * Panal (el motor) de lo que es tuyo (`src/agent.ts`, `src/register.ts`, `.env`),
 * que no se toca nunca.
 *
 * `.panal-motor.json` guarda el hash de cada archivo tal como salió de aquí. Así se
 * distingue «el motor es de otra versión» de «lo has cambiado tú», y lo segundo no
 * se pisa sin que lo pidas. Un agente anterior a ese archivo no se puede distinguir,
 * y por eso pide confirmación.
 */

import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const MANIFIESTO = '.panal-motor.json';
const RESPALDO = '.panal-respaldo';
/** Los archivos de `src/` que son de quien programa el agente. */
const PROPIOS = new Set(['agent.ts', 'register.ts']);

interface Manifiesto {
  version: string;
  archivos: Record<string, string>;
}

interface PackageJson {
  name?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  [k: string]: unknown;
}

const huella = (ruta: string): string => createHash('sha256').update(readFileSync(ruta)).digest('hex');

/** Los archivos del motor, con su ruta dentro del proyecto. */
export function archivosDelMotor(plantilla: string): string[] {
  return readdirSync(join(plantilla, 'src'))
    .filter((f) => f.endsWith('.ts') && !PROPIOS.has(f))
    .sort()
    .map((f) => `src/${f}`);
}

export function escribirManifiesto(dest: string, plantilla: string, version: string): void {
  const archivos: Record<string, string> = {};
  for (const r of archivosDelMotor(plantilla)) archivos[r] = huella(join(plantilla, r));
  const contenido: Manifiesto = { version, archivos };
  writeFileSync(join(dest, MANIFIESTO), `${JSON.stringify(contenido, null, 2)}\n`, 'utf8');
}

function leerManifiesto(dest: string): Manifiesto | null {
  try {
    return JSON.parse(readFileSync(join(dest, MANIFIESTO), 'utf8')) as Manifiesto;
  } catch {
    return null;
  }
}

export interface Plan {
  /** Del manifiesto; null si el agente es anterior a él. */
  versionActual: string | null;
  versionNueva: string;
  cambian: string[];
  nuevos: string[];
  /** Los que no coinciden con lo que se generó: los ha tocado alguien. */
  tocados: string[];
  dependencias: { nombre: string; de: string | null; a: string }[];
  scripts: string[];
  /** Solo se añaden si faltan: tu configuración de despliegue es tuya. */
  despliegue: string[];
}

export function hayCambios(p: Plan): boolean {
  return p.cambian.length + p.nuevos.length + p.dependencias.length + p.scripts.length + p.despliegue.length > 0 || p.versionActual === null;
}

/** Si es un proyecto de los que salen de aquí: lo mínimo para no escribir en otra carpeta. */
export function pareceUnAgente(dest: string): boolean {
  return existsSync(join(dest, 'src', 'server.ts')) && existsSync(join(dest, 'src', 'agent.ts')) && existsSync(join(dest, 'package.json'));
}

export function planear(dest: string, plantilla: string, version: string): Plan {
  const manifiesto = leerManifiesto(dest);
  const plan: Plan = {
    versionActual: manifiesto?.version ?? null,
    versionNueva: version,
    cambian: [],
    nuevos: [],
    tocados: [],
    dependencias: [],
    scripts: [],
    despliegue: [],
  };
  for (const r of archivosDelMotor(plantilla)) {
    const suyo = join(dest, r);
    if (!existsSync(suyo)) {
      plan.nuevos.push(r);
      continue;
    }
    const actual = huella(suyo);
    if (manifiesto?.archivos[r] && actual !== manifiesto.archivos[r]) plan.tocados.push(r);
    if (actual !== huella(join(plantilla, r))) plan.cambian.push(r);
  }
  // Tocado Y que además ya coincide con lo nuevo no es un problema: no se va a pisar.
  plan.tocados = plan.tocados.filter((r) => plan.cambian.includes(r));

  const pkg = JSON.parse(readFileSync(join(dest, 'package.json'), 'utf8')) as PackageJson;
  const base = JSON.parse(readFileSync(join(plantilla, '_package.json'), 'utf8')) as PackageJson;
  for (const [nombre, a] of Object.entries(base.dependencies ?? {})) {
    const de = pkg.dependencies?.[nombre] ?? null;
    if (de !== a) plan.dependencias.push({ nombre, de, a });
  }
  for (const s of Object.keys(base.scripts ?? {})) if (!pkg.scripts?.[s]) plan.scripts.push(s);
  if (existsSync(join(plantilla, 'deploy'))) {
    for (const f of readdirSync(join(plantilla, 'deploy')).sort()) {
      if (!existsSync(join(dest, 'deploy', f))) plan.despliegue.push(`deploy/${f}`);
    }
  }
  return plan;
}

/** Aplica el plan, con copia de lo que va a cambiar. Devuelve dónde quedó la copia. */
export function aplicar(dest: string, plantilla: string, plan: Plan, ahora: Date = new Date()): string {
  const carpeta = join(RESPALDO, ahora.toISOString().replace(/[:.]/g, '-'));
  const respaldo = join(dest, carpeta);
  mkdirSync(join(respaldo, 'src'), { recursive: true });
  for (const r of plan.cambian) copyFileSync(join(dest, r), join(respaldo, r));
  copyFileSync(join(dest, 'package.json'), join(respaldo, 'package.json'));
  if (existsSync(join(dest, MANIFIESTO))) copyFileSync(join(dest, MANIFIESTO), join(respaldo, MANIFIESTO));

  for (const r of [...plan.cambian, ...plan.nuevos]) copyFileSync(join(plantilla, r), join(dest, r));

  const pkg = JSON.parse(readFileSync(join(dest, 'package.json'), 'utf8')) as PackageJson;
  const base = JSON.parse(readFileSync(join(plantilla, '_package.json'), 'utf8')) as PackageJson;
  pkg.dependencies ??= {};
  for (const { nombre, a } of plan.dependencias) pkg.dependencies[nombre] = a;
  pkg.scripts ??= {};
  for (const s of plan.scripts) pkg.scripts[s] = base.scripts![s]!;
  writeFileSync(join(dest, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');

  if (plan.despliegue.length) mkdirSync(join(dest, 'deploy'), { recursive: true });
  for (const r of plan.despliegue) {
    const texto = readFileSync(join(plantilla, r), 'utf8').replaceAll('__NAME__', pkg.name ?? 'agente');
    writeFileSync(join(dest, r), texto, 'utf8');
  }

  // Las copias no se suben al repo: pueden llevar lo que tocaste a mano.
  const gitignore = join(dest, '.gitignore');
  const ignorado = existsSync(gitignore) ? readFileSync(gitignore, 'utf8') : '';
  if (!ignorado.split('\n').includes(`${RESPALDO}/`)) {
    writeFileSync(gitignore, `${ignorado}${ignorado && !ignorado.endsWith('\n') ? '\n' : ''}${RESPALDO}/\n`, 'utf8');
  }

  escribirManifiesto(dest, plantilla, plan.versionNueva);
  return carpeta;
}
