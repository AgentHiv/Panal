/**
 * Pruebas de que cada moneda lleva su propia cuenta.
 *
 *   npx tsx test/monedas.test.ts
 *
 * HERMÉTICO: no toca la red ni la cadena. Escribe en un directorio temporal.
 *
 * El fallo que motivó esto: había UN contador y UN tope. Panal cobra en MON
 * nativo y en $PANAL, que no valen lo mismo y no tienen tipo de cambio, así que
 * sumarlos era inventárselo. En la práctica, tres consultas pagadas en $PANAL
 * agotaron un presupuesto diario puesto pensando en MON y bloquearon una
 * contratación que sobraba de presupuesto.
 *
 * Protegía de más, que es el lado bueno del fallo. Pero un tope que no
 * significa lo que dice no se puede ajustar: subirlo para gastar $PANAL abre la
 * mano con el MON sin que nadie lo haya decidido.
 */

import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Address } from 'viem';
import { SpendLedger, limitFor, limitsFromEnv } from '../src/limits.js';

let fallos = 0;
const check = (nombre: string, ok: boolean, detalle = ''): void => {
  console.log(`${ok ? '✅' : '❌'} ${nombre}${ok ? '' : ` — ${detalle}`}`);
  if (!ok) fallos++;
};

const MON = '0x0000000000000000000000000000000000000000' as Address;
const PANAL = '0x2e2e44e7fa6178822d4397299f719e89d1a67777' as Address;
const OTRO = '0x1111111111111111111111111111111111111111' as Address;
const hoy = new Date().toISOString().slice(0, 10);
const nuevoLedger = () => new SpendLedger(join(mkdtempSync(join(tmpdir(), 'panal-')), 'spend.json'), () => {});

// --- los contadores no se pisan -------------------------------------------

{
  const l = nuevoLedger();
  l.record(PANAL, 3n * 10n ** 18n);
  check('gastar $PANAL no toca el contador de MON', l.spentToday(MON) === 0n, String(l.spentToday(MON)));
  check('  y sí queda anotado en el suyo', l.spentToday(PANAL) === 3n * 10n ** 18n);

  l.record(MON, 10n ** 17n);
  check('cada moneda suma por su lado', l.spentToday(MON) === 10n ** 17n && l.spentToday(PANAL) === 3n * 10n ** 18n);

  l.record(PANAL, 10n ** 18n);
  check('acumula dentro de la misma moneda', l.spentToday(PANAL) === 4n * 10n ** 18n);
}

// --- la mayúscula de la dirección no crea un contador nuevo ----------------

{
  const l = nuevoLedger();
  l.record('0x2E2E44E7FA6178822D4397299F719E89D1A67777' as Address, 5n);
  check('la dirección en mayúsculas cuenta en el mismo sitio', l.spentToday(PANAL) === 5n);
}

// --- el día -----------------------------------------------------------------

{
  const dir = mkdtempSync(join(tmpdir(), 'panal-'));
  const file = join(dir, 'spend.json');
  writeFileSync(file, JSON.stringify({ day: '2020-01-01', spent: { [PANAL.toLowerCase()]: '999' } }));
  const l = new SpendLedger(file, () => {});
  check('el gasto de otro día no cuenta hoy', l.spentToday(PANAL) === 0n);
}

// --- ACTUALIZAR desde el formato viejo -------------------------------------
//
// Había un `spentWei` suelto, sin moneda. Descartarlo pondría a cero el tope
// del día justo al actualizar el servidor: quien ya hubiera gastado su
// presupuesto podría gastarlo otra vez entero. Se adopta como MON, que es lo
// que ese contador acababa siendo en la práctica.
{
  const dir = mkdtempSync(join(tmpdir(), 'panal-'));
  const file = join(dir, 'spend.json');
  writeFileSync(file, JSON.stringify({ day: hoy, spentWei: '7000000000000000000' }));
  const l = new SpendLedger(file, () => {});
  check('el formato viejo se adopta como MON', l.spentToday(MON) === 7n * 10n ** 18n, String(l.spentToday(MON)));
  check('  y no se le regala a $PANAL', l.spentToday(PANAL) === 0n);

  l.record(PANAL, 1n);
  check('  al escribir se migra al formato nuevo', l.spentToday(MON) === 7n * 10n ** 18n && l.spentToday(PANAL) === 1n);
  const guardado = JSON.parse(readFileSync(file, 'utf8')) as { spent?: Record<string, string>; spentWei?: string };
  check('  el archivo ya no lleva el campo viejo', guardado.spentWei === undefined && !!guardado.spent);
}

// --- un archivo roto nunca deja el servidor inservible ---------------------

for (const basura of ['', '{', 'null', '[]', '{"day":"' + hoy + '","spent":{"0xabc":"no-es-un-numero"}}']) {
  const dir = mkdtempSync(join(tmpdir(), 'panal-'));
  const file = join(dir, 'spend.json');
  writeFileSync(file, basura);
  const l = new SpendLedger(file, () => {});
  check(`  un ledger ${JSON.stringify(basura.slice(0, 20))} se lee como cero`, l.spentToday(MON) === 0n);
}

// --- los topes, por moneda --------------------------------------------------

{
  delete process.env.MCP_MAX_PER_TASK_WEI;
  delete process.env.MCP_DAILY_BUDGET_WEI;
  delete process.env.MCP_MAX_PER_TASK_PANAL_WEI;
  delete process.env.MCP_DAILY_BUDGET_PANAL_WEI;
  const l = limitsFromEnv();
  check('MON trae tope por defecto', limitFor(l, MON)?.maxPerTaskWei === 10n ** 18n);
  check('$PANAL trae el suyo, aparte', limitFor(l, PANAL)?.maxPerTaskWei === 10n ** 18n);

  // Sin tipo de cambio no se puede reutilizar el tope de otra moneda. Decir
  // que no es la única respuesta honesta.
  check('un token desconocido NO tiene presupuesto', limitFor(l, OTRO) === null);
}

{
  process.env.MCP_MAX_PER_TASK_WEI = '50000000000000000'; // 0,05 MON
  process.env.MCP_MAX_PER_TASK_PANAL_WEI = '3000000000000000000'; // 3 $PANAL
  const l = limitsFromEnv();
  check('subir el tope de $PANAL no toca el de MON', limitFor(l, MON)?.maxPerTaskWei === 5n * 10n ** 16n);
  check('  y el de $PANAL es el suyo', limitFor(l, PANAL)?.maxPerTaskWei === 3n * 10n ** 18n);
  check(
    'cada tope sabe qué variable hay que subir',
    limitFor(l, PANAL)?.envMaxPerTask === 'MCP_MAX_PER_TASK_PANAL_WEI' &&
      limitFor(l, MON)?.envDailyBudget === 'MCP_DAILY_BUDGET_WEI',
  );
  delete process.env.MCP_MAX_PER_TASK_WEI;
  delete process.env.MCP_MAX_PER_TASK_PANAL_WEI;
}

// --- el caso exacto que nos bloqueó hoy ------------------------------------
//
// Tres consultas en $PANAL (0,5 + 0,5 + 2) contra un presupuesto de 1,5 pensado
// para MON. Antes, la cuarta se rechazaba «por presupuesto». Ahora el MON está
// intacto y solo se mira el bote de $PANAL.
{
  const l = nuevoLedger();
  for (const p of [5n * 10n ** 17n, 5n * 10n ** 17n, 2n * 10n ** 18n]) l.record(PANAL, p);
  check('las tres consultas de hoy suman 3 $PANAL', l.spentToday(PANAL) === 3n * 10n ** 18n);
  check('  y el presupuesto de MON sigue entero', l.spentToday(MON) === 0n);
}

console.log(fallos === 0 ? '\n✅ Todas las comprobaciones de monedas pasaron' : `\n❌ ${fallos} fallo(s)`);
process.exit(fallos === 0 ? 0 : 1);
