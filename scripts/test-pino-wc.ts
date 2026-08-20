/**
 * El logger de WalletConnect y la versión de pino que hay debajo.
 *
 *     npx tsx scripts/test-pino-wc.ts
 *
 * Existe por un fallo que costó varias rondas encontrar. El JSDoc del conector
 * de wagmi pide forzar `pino` a 10.0.0 para cerrar una vulnerabilidad, y hacerlo
 * rompe WalletConnect ENTERO en el navegador:
 *
 *     r.bindings is not a function
 *
 * `@walletconnect/logger@2.1.2` resuelve el contexto así:
 *
 *     typeof r.bindings > "u" ? contextoDelNavegador(r) : r.bindings().context
 *
 * Mira si `bindings` existe y, si existe, lo llama. El logger de NAVEGADOR de
 * pino 7 no lo tiene; el de pino 8, 9 y 10 lo expone como propiedad y no como
 * función, así que lo llama y revienta.
 *
 * En Node no se ve: allí WalletConnect usa el logger de servidor, donde
 * `bindings` sí es una función. Por eso el fallo llegó a producción — todo lo
 * que se probaba fuera del navegador funcionaba.
 *
 * Esta prueba usa el build de NAVEGADOR de pino a propósito, que es el único
 * sitio donde el problema se manifiesta.
 */
import { createRequire } from 'node:module';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * pnpm aísla las dependencias transitivas, así que ni `pino` ni
 * `@walletconnect/logger` se resuelven desde la raíz: hay que ir a buscarlos al
 * almacén. Es feo, y es la única forma de probar exactamente lo que se empaqueta.
 */
const ALMACEN = 'node_modules/.pnpm';
function enAlmacen(prefijo: string, dentro: string): string {
  const dir = readdirSync(ALMACEN).find((d) => d.startsWith(prefijo));
  if (!dir) throw new Error(`no encuentro ${prefijo} en ${ALMACEN}`);
  return join(process.cwd(), ALMACEN, dir, 'node_modules', dentro);
}

const require = createRequire(join(process.cwd(), 'noop.js'));
const rutaLogger = enAlmacen('@walletconnect+logger@', '@walletconnect/logger');
// pino se resuelve por el enlace del PROPIO logger, no por el primero que
// aparezca en el almacén: ahí puede quedar una versión suelta de un install
// anterior, y probar esa da un aprobado que no significa nada. Pasó.
//
// En pnpm las dependencias de un paquete son sus HERMANAS dentro del mismo
// `node_modules`, no hijas suyas: de ahí los dos niveles hacia arriba.
const rutaPino = join(rutaLogger, '..', '..', 'pino');
const { getLoggerContext, generateChildLogger } = require(rutaLogger) as {
  getLoggerContext: (logger: unknown) => string;
  generateChildLogger: (logger: unknown, contexto: string) => unknown;
};

let fallos = 0;
const check = (nombre: string, ok: boolean, detalle = ''): void => {
  console.log(`${ok ? '✅' : '❌'} ${nombre}${ok ? '' : ` — ${detalle}`}`);
  if (!ok) fallos++;
};

const version = (require(join(rutaPino, 'package.json')) as { version: string }).version;
console.log(`\npino que usa @walletconnect/logger: ${version}\n`);

// El build de NAVEGADOR, que es el que se empaqueta en la web.
const pinoBrowser = require(join(rutaPino, 'browser.js')) as (opts?: unknown) => unknown;
const raiz = pinoBrowser({ level: 'error' });

// El logger RAÍZ no tiene `bindings` en ninguna versión de pino, así que
// probarlo a él no detecta nada. Donde se rompe es en los HIJOS, que es lo que
// WalletConnect crea para cada subsistema: core, relayer, subscriber…
let error: unknown = null;
let contexto: string | null = null;
try {
  const hijo = generateChildLogger(raiz, 'core');
  contexto = getLoggerContext(generateChildLogger(hijo, 'relayer'));
} catch (err) {
  error = err;
}

check(
  'un logger hijo no revienta al pedirle su contexto',
  error === null,
  error instanceof Error ? error.message : String(error),
);
check('y el contexto se anida como debe', contexto === 'core/relayer', String(contexto));

if (error instanceof Error && /bindings is not a function/.test(error.message)) {
  console.log(
    '\n   Es EL fallo. Alguien ha vuelto a forzar pino por encima de 7.x.\n' +
      '   Está explicado en pnpm-workspace.yaml: no se puede, este logger no lo aguanta.\n',
  );
}

console.log(
  fallos === 0
    ? '✅ WalletConnect puede arrancar en un navegador\n'
    : `❌ ${fallos} comprobación(es) fallidas: WalletConnect NO arrancará en el navegador\n`,
);
process.exit(fallos === 0 ? 0 : 1);
