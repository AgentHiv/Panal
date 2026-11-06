/**
 * Las pruebas de una disputa se firman igual en el SDK y en el buzón.
 *
 *   npx tsx scripts/test-pruebas-formato.ts
 *
 * El protocolo vive en `sdk/src/pruebas.ts` (lo usan la web, la app y el MCP)
 * y está copiado en `bot/src/buzon.ts`, que no depende del SDK. Si una copia
 * cambiara un espacio en el mensaje que se firma o en cómo se calcula el
 * contenido, el buzón rechazaría todas las pruebas con «bad signature» y nadie
 * sabría por qué.
 */
import { privateKeyToAccount } from 'viem/accounts';
import * as sdk from '@panal/sdk';
import * as bot from '../bot/src/buzon';

let fallos = 0;
const check = (nombre: string, ok: boolean, detalle = ''): void => {
  console.log(`${ok ? '✅' : '❌'} ${nombre}${ok ? '' : ` — ${detalle}`}`);
  if (!ok) fallos++;
};

const casos = [
  { texto: 'El motivo, con tildes, eñes y emojis 🐝.', archivos: [] },
  { texto: 'Con dos archivos', archivos: [{ hash: '0xAB'.padEnd(66, 'c'), size: 10 }, { hash: '0x' + '1'.repeat(64), size: 0 }] },
  { texto: JSON.stringify({ v: 'panal-cifrado-1', e: 'x', n: 'y', para: ['0xabc'], c: 'Zm9v' }), archivos: [] },
];

console.log('\n─── los mismos números ───');
check('el mismo plazo', sdk.PLAZO_DE_PRUEBAS_DIAS === bot.PLAZO_DE_PRUEBAS_DIAS);
check('el mismo tope de texto', sdk.MAX_PIEZA_CHARS === bot.MAX_PIEZA_CHARS);
check('los mismos archivos por pieza', sdk.MAX_ARCHIVOS_POR_PIEZA === bot.MAX_ARCHIVOS_POR_PIEZA);
check('el mismo margen de fecha', sdk.MARGEN_FECHA_MS === bot.MARGEN_FECHA_MS);

console.log('\n─── los mismos mensajes ───');
check('la firma de sesión', sdk.pruebasSignMessage(42n, 1_900_000_000) === bot.pruebasSignMessage(42n, 1_900_000_000));
for (const [i, c] of casos.entries()) {
  const a = sdk.contenidoDePieza(c.texto, c.archivos);
  const b = bot.contenidoDePieza(c.texto, c.archivos);
  check(`el mismo contenido (caso ${i + 1})`, a === b, `${a} ≠ ${b}`);
  check(`el mismo mensaje de pieza (caso ${i + 1})`, sdk.piezaSignMessage(7n, a, '2026-11-06T21:00:00.000Z') === bot.piezaSignMessage(7n, b, '2026-11-06T21:00:00.000Z'));
}
check('las mayúsculas del hash de un archivo no cambian el contenido', sdk.contenidoDePieza('x', [{ hash: '0xABCD', size: 1 }]) === sdk.contenidoDePieza('x', [{ hash: '0xabcd', size: 1 }]));
check('el orden de los archivos sí', sdk.contenidoDePieza('x', [{ hash: '0x1', size: 1 }, { hash: '0x2', size: 1 }]) !== sdk.contenidoDePieza('x', [{ hash: '0x2', size: 1 }, { hash: '0x1', size: 1 }]));

console.log('\n─── firmado con uno, comprobado con el otro ───');
const cuenta = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');
const fecha = new Date().toISOString();
const contenido = bot.contenidoDePieza(casos[1]!.texto, casos[1]!.archivos);
const firma = await cuenta.signMessage({ message: bot.piezaSignMessage(9n, contenido, fecha) });
const pieza = { de: 'cliente' as const, autor: cuenta.address, texto: casos[1]!.texto, archivos: casos[1]!.archivos, fecha, firma, recibida: Date.now() };
check('lo que firma el buzón lo comprueba el SDK', await sdk.verificarPieza(9n, pieza));
check('y con otra fecha no', !(await sdk.verificarPieza(9n, { ...pieza, fecha: '2020-01-01T00:00:00.000Z' })));

console.log(fallos === 0 ? '\n✅ El SDK y el buzón firman las pruebas igual\n' : `\n❌ ${fallos} comprobación(es) fallidas\n`);
process.exit(fallos === 0 ? 0 : 1);
