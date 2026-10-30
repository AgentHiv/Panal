/**
 * `create-panal-agent upgrade`: que traiga el motor nuevo y no pise lo tuyo.
 *
 *   npx tsx test/upgrade.test.ts
 *
 * HERMÉTICO: un agente de mentira y una plantilla de mentira en un temporal.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { aplicar, archivosDelMotor, escribirManifiesto, hayCambios, MANIFIESTO, pareceUnAgente, planear } from '../src/upgrade.js';

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (ok) console.log(`✅ ${label}${detail ? `: ${detail}` : ''}`);
  else {
    failures += 1;
    console.error(`❌ ${label}${detail ? `: ${detail}` : ''}`);
  }
}

const raiz = mkdtempSync(join(tmpdir(), 'panal-upgrade-'));
const leer = (...r: string[]) => readFileSync(join(...r), 'utf8');

function plantilla(version: { motor: string; sdk: string }): string {
  const dir = mkdtempSync(join(raiz, 'plantilla-'));
  mkdirSync(join(dir, 'src'));
  mkdirSync(join(dir, 'deploy'));
  writeFileSync(join(dir, 'src', 'server.ts'), `// motor ${version.motor}\n`);
  writeFileSync(join(dir, 'src', 'vigilante.ts'), '// vigilante\n');
  writeFileSync(join(dir, 'src', 'agent.ts'), '// ejemplo de la plantilla\n');
  writeFileSync(join(dir, 'src', 'register.ts'), '// alta de la plantilla\n');
  writeFileSync(join(dir, 'deploy', 'Caddyfile'), '# __NAME__\n');
  writeFileSync(
    join(dir, '_package.json'),
    JSON.stringify({ name: '__NAME__', scripts: { start: 'tsx src/server.ts', doctor: 'tsx src/doctor.ts' }, dependencies: { '@panal/sdk': version.sdk, viem: '^2.21.0' } }),
  );
  return dir;
}

function agenteDesde(p: string, version: string | null): string {
  const dir = mkdtempSync(join(raiz, 'agente-'));
  mkdirSync(join(dir, 'src'));
  for (const r of archivosDelMotor(p)) writeFileSync(join(dir, r), leer(p, r));
  writeFileSync(join(dir, 'src', 'agent.ts'), '// MI TRABAJO\n');
  writeFileSync(join(dir, 'src', 'register.ts'), '// MI PERFIL\n');
  writeFileSync(join(dir, '.env'), 'AGENT_PRIVATE_KEY=secreta\n');
  writeFileSync(join(dir, '.gitignore'), 'node_modules/\n');
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'mi-agente', scripts: { start: 'tsx src/server.ts' }, dependencies: { '@panal/sdk': '^0.27.0', viem: '^2.21.0', 'mi-libreria': '^1.0.0' } }),
  );
  if (version) escribirManifiesto(dir, p, version);
  return dir;
}

try {
  const vieja = plantilla({ motor: 'viejo', sdk: '^0.27.0' });
  const nueva = plantilla({ motor: 'nuevo', sdk: '^0.28.0' });

  console.log('── qué es el motor ──');
  check('agent.ts y register.ts no lo son', archivosDelMotor(nueva).join() === 'src/server.ts,src/vigilante.ts', archivosDelMotor(nueva).join());
  check('reconoce un agente', pareceUnAgente(agenteDesde(nueva, '1')));
  check('y no cualquier carpeta', !pareceUnAgente(raiz));

  console.log('\n── al día ──');
  const alDia = agenteDesde(nueva, '0.29.0');
  writeFileSync(join(alDia, 'package.json'), JSON.stringify({ name: 'x', scripts: { start: 'a', doctor: 'b' }, dependencies: { '@panal/sdk': '^0.28.0', viem: '^2.21.0' } }));
  mkdirSync(join(alDia, 'deploy'));
  writeFileSync(join(alDia, 'deploy', 'Caddyfile'), 'mío\n');
  check('nada que hacer', !hayCambios(planear(alDia, nueva, '0.29.0')));

  console.log('\n── una versión normal ──');
  const dir = agenteDesde(vieja, '0.28.2');
  writeFileSync(join(dir, 'deploy-no-toca'), 'x');
  const plan = planear(dir, nueva, '0.29.0');
  check('sabe de qué versión viene', plan.versionActual === '0.28.2');
  check('cambia solo lo que cambió', plan.cambian.join() === 'src/server.ts', plan.cambian.join());
  check('no dice que lo hayas tocado', plan.tocados.length === 0);
  check('sube el SDK', plan.dependencias.some((d) => d.nombre === '@panal/sdk' && d.a === '^0.28.0'));
  check('añade el script que falta', plan.scripts.join() === 'doctor');

  const copia = aplicar(dir, nueva, plan, new Date('2026-10-30T12:00:00Z'));
  check('el motor es el nuevo', leer(dir, 'src/server.ts').includes('motor nuevo'));
  check('tu trabajo sigue ahí', leer(dir, 'src/agent.ts') === '// MI TRABAJO\n');
  check('tu perfil sigue ahí', leer(dir, 'src/register.ts') === '// MI PERFIL\n');
  check('tu clave sigue ahí', leer(dir, '.env') === 'AGENT_PRIVATE_KEY=secreta\n');
  const pkg = JSON.parse(leer(dir, 'package.json')) as { name: string; scripts: Record<string, string>; dependencies: Record<string, string> };
  check('el nombre no cambia', pkg.name === 'mi-agente');
  check('tus dependencias siguen', pkg.dependencies['mi-libreria'] === '^1.0.0');
  check('el SDK sube', pkg.dependencies['@panal/sdk'] === '^0.28.0');
  check('el script nuevo está', pkg.scripts.doctor === 'tsx src/doctor.ts');
  check('hay copia del motor anterior', leer(dir, copia, 'src/server.ts').includes('motor viejo'), copia);
  check('y del package.json', JSON.parse(leer(dir, copia, 'package.json')).dependencies['@panal/sdk'] === '^0.27.0');
  check('el despliegue llega, con tu nombre', leer(dir, 'deploy/Caddyfile') === '# mi-agente\n');
  check('las copias no van al repo', leer(dir, '.gitignore').includes('.panal-respaldo/'));
  check('la versión queda apuntada', JSON.parse(leer(dir, MANIFIESTO)).version === '0.29.0');
  check('otra vez, ya nada', !hayCambios(planear(dir, nueva, '0.29.0')));

  console.log('\n── tu despliegue es tuyo ──');
  const conDeploy = agenteDesde(vieja, '0.28.2');
  mkdirSync(join(conDeploy, 'deploy'));
  writeFileSync(join(conDeploy, 'deploy', 'Caddyfile'), '# el mío\n');
  aplicar(conDeploy, nueva, planear(conDeploy, nueva, '0.29.0'));
  check('no se pisa', leer(conDeploy, 'deploy/Caddyfile') === '# el mío\n');

  console.log('\n── si tocaste el motor ──');
  const tocado = agenteDesde(vieja, '0.28.2');
  writeFileSync(join(tocado, 'src/server.ts'), '// motor con un cambio mío\n');
  check('se detecta', planear(tocado, nueva, '0.29.0').tocados.join() === 'src/server.ts');
  const igual = agenteDesde(vieja, '0.28.2');
  writeFileSync(join(igual, 'src/server.ts'), leer(nueva, 'src/server.ts'));
  check('si ya coincide con lo nuevo, no hay nada que pisar', planear(igual, nueva, '0.29.0').tocados.length === 0);

  console.log('\n── un agente de antes del manifiesto ──');
  const antiguo = agenteDesde(vieja, null);
  const planAntiguo = planear(antiguo, nueva, '0.29.0');
  check('no se sabe de qué versión viene', planAntiguo.versionActual === null);
  check('hay que apuntarlo aunque el motor coincida', hayCambios(planear(agenteDesde(nueva, null), nueva, '0.29.0')));

  console.log('\n── un archivo del motor que no existía ──');
  const sinVigilante = agenteDesde(vieja, '0.28.2');
  rmSync(join(sinVigilante, 'src/vigilante.ts'));
  const planNuevo = planear(sinVigilante, nueva, '0.29.0');
  check('se añade', planNuevo.nuevos.join() === 'src/vigilante.ts');
  aplicar(sinVigilante, nueva, planNuevo);
  check('y está', existsSync(join(sinVigilante, 'src/vigilante.ts')));
} finally {
  rmSync(raiz, { recursive: true, force: true });
}

console.log('');
if (failures === 0) console.log('✅ upgrade trae el motor y no pisa lo tuyo');
else {
  console.error(`❌ ${failures} comprobación(es) fallaron`);
  process.exitCode = 1;
}
