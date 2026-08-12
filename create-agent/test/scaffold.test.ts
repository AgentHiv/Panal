/**
 * Prueba del generador: crea un agente de verdad en un directorio temporal y
 * comprueba que lo que sale sirve.
 *
 *   npx tsx test/scaffold.test.ts     (o: npm test)
 *
 * HERMÉTICO salvo el `npm install` del proyecto generado, que sí baja paquetes.
 * No toca la cadena ni firma nada.
 *
 * Lo que de verdad se comprueba: que el proyecto generado COMPILA. Una
 * plantilla que no compila es peor que no tener plantilla, porque el
 * desarrollador se encuentra el error creyendo que lo rompió él.
 */

import { execFileSync, spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
// Las aserciones se atan al catálogo, no a una frase suelta: así siguen
// valiendo cuando cambie la redacción o el idioma por defecto.
import { CATALOG, fill } from '../src/i18n.js';
import { privateKeyToAccount } from 'viem/accounts';

let failures = 0;

function check(label: string, ok: boolean, detail = ''): void {
  if (ok) console.log(`✅ ${label}${detail ? `: ${detail}` : ''}`);
  else {
    failures += 1;
    console.error(`❌ ${label}${detail ? `: ${detail}` : ''}`);
  }
}

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(HERE, '..', 'src', 'index.ts');

function run(args: string[], cwd: string, env: Record<string, string> = {}): { out: string; code: number } {
  // PANAL_LANG y LANG se limpian salvo que la prueba los ponga: si no, el
  // idioma de la máquina donde corre el CI decidiría el de las aserciones.
  const entorno = { ...process.env, PANAL_LANG: '', LC_ALL: '', LC_MESSAGES: '', LANG: '', ...env };
  try {
    const out = execFileSync('npx', ['tsx', CLI, ...args], { cwd, encoding: 'utf8', stdio: 'pipe', env: entorno });
    return { out, code: 0 };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return { out: `${e.stdout ?? ''}${e.stderr ?? ''}`, code: e.status ?? 1 };
  }
}

/** Sondea una URL hasta que responde o se acaba el tiempo. */
async function esperarRespuesta(url: string, timeoutMs: number): Promise<unknown | null> {
  const hasta = Date.now() + timeoutMs;
  while (Date.now() < hasta) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
    } catch {
      /* todavía no escucha */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}

const work = mkdtempSync(join(tmpdir(), 'panal-scaffold-'));

async function main(): Promise<void> {
 try {
  console.log('── 1. Nombres que no valen ──');

  check('sin nombre explica cómo se usa', run([], work).out.includes('create-panal-agent'));
  check('rechaza mayúsculas y espacios', run(['Mi Agente'], work).code !== 0);
  check('rechaza un nombre que empieza por guion', run(['-raro'], work).code !== 0);

  console.log('\n── 1b. El idioma ──');

  const ayuda = run(['--help'], work);
  check('--help explica el uso y termina bien', ayuda.code === 0 && ayuda.out.includes('--lang'));
  const version = run(['--version'], work);
  check('--version imprime una versión', version.code === 0 && /^\d+\.\d+\.\d+/.test(version.out.trim()), version.out.trim());
  check('un idioma inventado se rechaza', run(['agente-x', '--lang', 'klingon'], work).code !== 0);
  check('--help sale en el idioma pedido', run(['--help', '--lang=ru'], work).out.includes('Опции'));
  check('PANAL_LANG manda cuando no hay bandera', run(['--help'], work, { PANAL_LANG: 'fr' }).out.includes('Options'));
  check('el locale del sistema se respeta', run(['--help'], work, { LANG: 'zh_CN.UTF-8' }).out.includes('选项'));

  // Sin TTY —CI, Docker, una tubería— no se puede preguntar: preguntar ahí
  // cuelga el proceso para siempre. Debe caer al inglés y seguir.
  const sinTty = run(['agente-sin-tty'], work);
  check('sin terminal interactiva no se queda preguntando', sinTty.code === 0 && sinTty.out.includes('created'));

  console.log('\n── 1c. Un agente generado en chino ──');

  const zh = run(['agente-zh', '--lang', 'zh'], work);
  const destZh = join(work, 'agente-zh');
  check('se genera', zh.code === 0);
  check('la salida del CLI está en chino', zh.out.includes('代理钱包'), zh.out.split('\n').find((l) => l.includes('代理')) ?? '');
  const readmeZh = readFileSync(join(destZh, 'README.md'), 'utf8');
  check('el README del proyecto está en chino', readmeZh.includes('三个步骤'));
  check('el README lleva su nombre y su wallet', readmeZh.includes('agente-zh') && /0x[0-9a-fA-F]{40}/.test(readmeZh));
  check('no quedan marcadores sin sustituir en el README', !readmeZh.includes('{name}') && !readmeZh.includes('{address}'));
  const envZh = readFileSync(join(destZh, '.env.example'), 'utf8');
  check('el .env.example está en chino', envZh.includes('私钥'));
  check('y conserva todas sus claves', ['AGENT_PRIVATE_KEY=', 'PORT=', 'LLM_API_KEY=', 'RPC_URL=', 'DATA_DIR='].every((k) => envZh.includes(k)));

  console.log('\n── 2. Se genera el proyecto ──');

  const name = 'agente-prueba';
  const created = run([name], work);
  const dest = join(work, name);
  check('el generador termina bien', created.code === 0, created.out.split('\n').find((l) => l.includes('creado')) ?? '');

  for (const file of ['package.json', 'tsconfig.json', '.env.example', '.gitignore', '.env', 'src/agent.ts', 'src/server.ts', 'src/register.ts', 'src/pdf.ts']) {
    check(`  ${file}`, existsSync(join(dest, file)));
  }

  console.log('\n── 3. Los marcadores se sustituyen ──');

  const pkg = JSON.parse(readFileSync(join(dest, 'package.json'), 'utf8')) as { name: string; dependencies: Record<string, string> };
  check('el package.json lleva el nombre', pkg.name === name, pkg.name);
  check('depende del SDK', Boolean(pkg.dependencies['@panal/sdk']), pkg.dependencies['@panal/sdk']);
  const register = readFileSync(join(dest, 'src', 'register.ts'), 'utf8');
  check('el perfil lleva el nombre', register.includes(`name: '${name}'`));
  check('no queda ningún marcador sin sustituir', !register.includes('__NAME__'));

  console.log('\n── 4. La wallet dedicada ──');

  const env = readFileSync(join(dest, '.env'), 'utf8');
  const key = /AGENT_PRIVATE_KEY=(0x[0-9a-fA-F]{64})/.exec(env)?.[1];
  check('se genera una clave válida', Boolean(key));
  // La dirección que se le enseña al usuario tiene que ser la de esa clave: si
  // no cuadraran, mandaría el gas a una wallet que no controla el agente.
  const shown = /0x[0-9a-fA-F]{40}/.exec(created.out)?.[0];
  check(
    'la dirección mostrada es la de la clave generada',
    Boolean(key && shown && privateKeyToAccount(key as `0x${string}`).address.toLowerCase() === shown.toLowerCase()),
    shown ?? '',
  );
  check('cada proyecto recibe una clave distinta', (() => {
    run(['otro-agente'], work);
    const otra = /AGENT_PRIVATE_KEY=(0x[0-9a-fA-F]{64})/.exec(readFileSync(join(work, 'otro-agente', '.env'), 'utf8'))?.[1];
    return Boolean(otra && otra !== key);
  })());
  check('el .env está ignorado por git', readFileSync(join(dest, '.gitignore'), 'utf8').includes('.env'));
  // Lo que no puede aparecer aquí es una CLAVE PRIVADA (0x + 64 hex). Hay otras
  // direcciones legítimas —la del token de x402, por ejemplo—, así que buscar
  // "0x" a secas daría un falso positivo y dejaría de comprobar lo que importa.
  check(
    'el .env.example NO lleva la clave privada',
    !/0x[0-9a-fA-F]{64}/.test(readFileSync(join(dest, '.env.example'), 'utf8')),
  );

  console.log('\n── 5. No se pisa una carpeta con contenido ──');
  const repetido = run([name], work);
  check(
    'avisa en vez de sobreescribir',
    repetido.code !== 0 && repetido.out.includes(fill(CATALOG.en.errDirExists, { name })),
    `código ${repetido.code}`,
  );

  console.log('\n── 6. El proyecto generado COMPILA ──');
  console.log('   (instalando dependencias, tarda un poco…)');
  try {
    // La plantilla apunta a la versión del SDK que se va a publicar CON ella, y
    // esa version puede no estar aun en npm: instalarla fallaria con ETARGET.
    // Se instala el resto y se enlaza el SDK de este repo, que ademas es lo que
    // de verdad interesa comprobar —que la plantilla cuadra con el SDK actual—.
    const pkgPath = join(dest, 'package.json');
    const generated = JSON.parse(readFileSync(pkgPath, 'utf8')) as { dependencies: Record<string, string> };
    const sdkRange = generated.dependencies['@panal/sdk']!;
    delete generated.dependencies['@panal/sdk'];
    writeFileSync(pkgPath, `${JSON.stringify(generated, null, 2)}\n`);

    execFileSync('npm', ['install', '--no-audit', '--no-fund'], { cwd: dest, stdio: 'pipe', timeout: 300_000 });
    check('npm install funciona', true);

    generated.dependencies['@panal/sdk'] = sdkRange;
    writeFileSync(pkgPath, `${JSON.stringify(generated, null, 2)}\n`);

    const localSdk = resolve(HERE, '..', '..', 'sdk');
    check('el SDK local está compilado', existsSync(join(localSdk, 'dist', 'index.d.ts')), 'dist/index.d.ts');

    // Se COPIA, no se enlaza. Un symlink hacia el paquete del workspace hace que
    // el SDK resuelva el viem de la raíz mientras el proyecto usa el suyo, y
    // TypeScript ve dos viem incompatibles: un fallo del montaje de la prueba
    // que no le pasaría a nadie instalando desde npm. Copiar reproduce lo que
    // npm deja de verdad en node_modules.
    const installed = join(dest, 'node_modules', '@panal', 'sdk');
    rmSync(installed, { recursive: true, force: true });
    mkdirSync(installed, { recursive: true });
    cpSync(join(localSdk, 'dist'), join(installed, 'dist'), { recursive: true });
    cpSync(join(localSdk, 'package.json'), join(installed, 'package.json'));

    execFileSync('npx', ['tsc', '--noEmit'], { cwd: dest, stdio: 'pipe', timeout: 180_000 });
    check('typecheck del proyecto generado', true);

    // Y ARRANCA. Compilar no basta: la version 0.1.0 publicada compilaba
    // perfectamente y moria al arrancar porque el servidor no cargaba dotenv,
    // asi que no veia la clave que el propio generador le habia dejado en el
    // .env. El typecheck no puede cazar eso; encender el proceso, si.
    const port = 9700 + Math.floor(Math.random() * 200);
    // Se lanza el binario de tsx DIRECTAMENTE y en su propio grupo de procesos.
    //
    // Con `npx tsx …` hay dos procesos: el envoltorio y el node de dentro.
    // `kill()` mataba solo el envoltorio y el nieto sobrevivia agarrando las
    // tuberias de stdio que heredo. En local eso deja un huerfano; en CI cuelga
    // el trabajo para siempre, porque el runner no da un paso por terminado
    // hasta que esas tuberias se cierran, no cuando sale el proceso principal.
    const agent = spawn(join(dest, 'node_modules', '.bin', 'tsx'), ['src/server.ts'], {
      cwd: dest,
      env: { ...process.env, PORT: String(port) },
      stdio: 'pipe',
      detached: true, // grupo propio: se puede matar entero con kill(-pid)
    });
    let salida = '';
    agent.stdout.on('data', (d: Buffer) => (salida += d.toString()));
    agent.stderr.on('data', (d: Buffer) => (salida += d.toString()));

    try {
      const card = await esperarRespuesta(`http://127.0.0.1:${port}/agent.json`, 30_000);
      check('el agente arranca y se presenta', card !== null, JSON.stringify(card));
      check(
        'se presenta con la wallet que generó el andamiaje',
        (card as { agent?: string } | null)?.agent?.toLowerCase() === shown?.toLowerCase(),
      );

      // Sin firma no se trabaja: si esto pasara, cualquiera colaría encargos
      // que nadie ha pagado.
      const sinFirma = await fetch(`http://127.0.0.1:${port}/brief`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ taskId: 0, brief: 'gratis' }),
      });
      check('un brief sin firma se rechaza', sinFirma.status === 400, `HTTP ${sinFirma.status}`);

      // Un ciclo se corta ANTES de trabajar y ANTES de comprobar la firma: si
      // el agente ya está en el camino de la cadena, atender costaría dinero a
      // alguien para nada. Se manda un sobre en el que él mismo aparece; el
      // 508 tiene que llegar aunque el resto de la petición sea basura, porque
      // se mira lo primero de todo.
      const suPropia = (card as { agent?: string } | null)?.agent ?? '';
      const ciclo = await fetch(`http://127.0.0.1:${port}/brief/0`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-panal-trace': 'prueba-de-ciclo',
          'x-panal-depth': '3',
          'x-panal-budget': '1000000000000000000',
          'x-panal-path': `0xAAaA000000000000000000000000000000000001,${suPropia}`,
        },
        body: JSON.stringify({ taskId: 0, brief: 'da la vuelta', signature: '0x00' }),
      });
      check('un encargo que cierra un ciclo se corta con 508', ciclo.status === 508, `HTTP ${ciclo.status}`);

      // Y sin sobre no se vigila nada: la inmensa mayoría de encargos vienen de
      // una persona, y esos no traen cadena que proteger.
      const sinSobre = await fetch(`http://127.0.0.1:${port}/brief/0`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ taskId: 0, brief: 'normal', signature: '0x00' }),
      });
      check('sin sobre el encargo sigue su curso normal', sinSobre.status !== 508, `HTTP ${sinSobre.status}`);

      // La ruta CANÓNICA es /brief/<taskId>: es la que llama el dashboard de
      // panal.lat. Esto no es un detalle de estilo — la plantilla 0.1.2 solo
      // escuchaba en /brief y devolvía 404 a todos los encargos reales, con el
      // cliente viendo su pago hecho y al agente sin enterarse de nada. Un 404
      // aquí significa que ese agujero ha vuelto.
      const rutaDelDashboard = await fetch(`http://127.0.0.1:${port}/brief/7`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ brief: 'con el id en la ruta, como lo manda la web' }),
      });
      check(
        'la ruta /brief/<taskId> del dashboard existe',
        rutaDelDashboard.status === 400,
        `HTTP ${rutaDelDashboard.status}${rutaDelDashboard.status === 404 ? ' — el agente vuelve a ser sordo al dashboard' : ''}`,
      );

      // Cobro por llamada: sin X402_PRICE en el .env, la ruta no debe existir.
      // Un agente que cobrara sin que su dueño lo pidiera seria un problema.
      const sinCobro = await fetch(`http://127.0.0.1:${port}/x402/ask`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: 'hola' }),
      });
      check('sin X402_PRICE no se cobra por llamada', sinCobro.status === 404, `HTTP ${sinCobro.status}`);
      const tarjeta = (await (await fetch(`http://127.0.0.1:${port}/agent.json`)).json()) as Record<string, unknown>;
      check('y la tarjeta no anuncia cobro que no existe', tarjeta.x402Ask === undefined);

      // Salida de emergencia cuando el envío automático no llega (móvil, wallet
      // que se traga la firma). Servida por el propio agente: mismo origen, sin
      // CORS, y funciona dentro del navegador de una wallet.
      const reenvio = await fetch(`http://127.0.0.1:${port}/reenviar?task=7`);
      const html = await reenvio.text();
      check(
        'la página de reenvío manual se sirve',
        reenvio.status === 200 && html.includes('Firmar y enviar'),
        `HTTP ${reenvio.status}`,
      );

      // El generador de PDF que viaja en la plantilla tiene que producir un
      // archivo VÁLIDO, no bytes con extensión: cabecera, xref y %%EOF. Y los
      // símbolos que la codificación del PDF no tiene deben traducirse, no
      // destrozarse — un "≠" salía impreso como "`", y eso convertía un caso de
      // prueba en su contrario dentro de un entregable que se cobra.
      const pdfSalida = join(dest, 'pdf-generado.pdf');
      writeFileSync(
        join(dest, 'pdf-prueba.ts'),
        "import { writeFileSync } from 'node:fs';\n" +
          "import { textoAPdf } from './src/pdf.js';\n" +
          `writeFileSync(${JSON.stringify(pdfSalida)}, textoAPdf('Prueba', 'b \u2260 0 y x \u2264 5\\nacentos: ñ á é'));\n`,
      );
      execFileSync('npx', ['tsx', 'pdf-prueba.ts'], { cwd: dest, stdio: 'pipe' });
      const pdfBytes = readFileSync(pdfSalida);
      const pdfTexto = pdfBytes.toString('latin1');
      check(
        'la plantilla genera un PDF válido',
        pdfTexto.startsWith('%PDF-1.4') && pdfTexto.includes('xref') && pdfTexto.trimEnd().endsWith('%%EOF'),
        `${pdfBytes.length} bytes`,
      );
      check(
        'y traduce los símbolos que la codificación no tiene',
        pdfTexto.includes('b != 0') && pdfTexto.includes('x <= 5') && !pdfTexto.includes('b ` 0'),
      );

      // Descarga de archivos entregados. Está detrás de la MISMA firma que el
      // resultado, así que sin ella tiene que cortar antes de mirar el disco.
      const archivoSinFirma = await fetch(`http://127.0.0.1:${port}/files/7/informe.pdf`);
      check('un archivo sin firma no se entrega', archivoSinFirma.status === 400, `HTTP ${archivoSinFirma.status}`);

      // Y el nombre viene de la URL, o sea de fuera. Si el 400 de arriba
      // llegara a fallar algún día, esto es lo que impide que la ruta sirva de
      // lectura arbitraria del disco del agente.
      const travesia = await fetch(
        `http://127.0.0.1:${port}/files/7/${encodeURIComponent('../../.env')}?address=0x0000000000000000000000000000000000000001&signature=0x00`,
      );
      const cuerpoTravesia = await travesia.text();
      check(
        'un nombre con ../ no saca nada del disco',
        travesia.status !== 200 && !cuerpoTravesia.includes('AGENT_PRIVATE_KEY'),
        `HTTP ${travesia.status}`,
      );
    } finally {
      // Se mata el GRUPO entero (el menos delante del pid), no solo el proceso:
      // si queda algo vivo con las tuberias abiertas, el paso de CI no termina.
      try {
        if (agent.pid) process.kill(-agent.pid, 'SIGKILL');
      } catch {
        agent.kill('SIGKILL');
      }
      // Y se sueltan las tuberias por si acaso: basta con que una siga abierta.
      agent.stdout.destroy();
      agent.stderr.destroy();
      agent.stdin.destroy();
    }
    if (!salida.includes('escuchando')) {
      check('el arranque no imprime errores', false, salida.slice(0, 300));
    }
  } catch (err) {
    const e = err as { stdout?: Buffer; stderr?: Buffer; message?: string };
    const detail = `${e.stdout ?? ''}${e.stderr ?? ''}`.trim() || e.message || 'sin detalle';
    check('el proyecto generado compila y arranca', false, detail.slice(0, 600));
  }

  console.log('');
  if (failures === 0) console.log('✅ El generador produce un agente que compila y arranca');
  else {
    console.error(`❌ ${failures} comprobación(es) fallaron`);
    process.exitCode = 1;
  }
} finally {
  rmSync(work, { recursive: true, force: true });
 }
}

main().catch((err) => {
  console.error(`❌ error inesperado: ${err instanceof Error ? err.message : err}`);
  rmSync(work, { recursive: true, force: true });
  process.exitCode = 1;
});
