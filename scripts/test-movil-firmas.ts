/**
 * Lo que la wallet del teléfono acepta firmar del cifrado de encargos.
 *
 *     npx tsx --tsconfig movil/tsconfig.json scripts/test-movil-firmas.ts
 *
 * La firma del mensaje de derivación ES la clave que abre los encargos
 * cifrados: firmarla para otra cuenta, o firmar algo que se le parezca, sería
 * entregar esa clave. Aquí se comprueba que la política solo deja pasar el
 * mensaje exacto de la cuenta del llavero, y que lo de siempre sigue pasando.
 */
import type { Address } from 'viem';
import { mensajeParaDerivarClave, mensajeParaPublicarClave } from '../sdk/src/cifrado.js';
import { tablonAccesoSignMessage, tablonDisputaSignMessage } from '../sdk/src/tablon-reglas.js';
import { esFirmaDelCifrado } from '../movil/src/lib/firmaCifrado.js';

const YO = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as Address;
const OTRO = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC' as Address;
const CLAVE = 'c4SRnEYLEV3MndZ45om_rIOFlmFOzQr6YndhPmsS_XY';

let fallos = 0;
// Solo la regla del cifrado: lo demás lo cubre `MENSAJES_DE_PANAL`, que no cambia.
const firma = (texto: string): boolean => esFirmaDelCifrado(texto, YO);
const check = (nombre: string, ok: boolean) => {
  console.log(`${ok ? '✅' : '❌'} ${nombre}`);
  if (!ok) fallos++;
};

check('firma la derivación de su propia cuenta', firma(mensajeParaDerivarClave(YO)));
check('NO firma la derivación de otra cuenta', !firma(mensajeParaDerivarClave(OTRO)));
check('NO firma una derivación con un retoque', !firma(mensajeParaDerivarClave(YO) + ' '));
check('NO firma la derivación en minúsculas', !firma(mensajeParaDerivarClave(YO).replace(YO, YO.toLowerCase() as Address)));
check('firma la publicación de su clave', firma(mensajeParaPublicarClave(YO, CLAVE)));
check('NO publica una clave en nombre de otra cuenta', !firma(mensajeParaPublicarClave(OTRO, CLAVE)));
check('NO publica algo que no tiene forma de clave', !firma(mensajeParaPublicarClave(YO, 'x'.repeat(10))));
check('firma dar acceso en una tarea directa', firma(`Panal acceso #12 · ${1_900_000_000}`));
check('firma dar acceso en el tablón', firma(tablonAccesoSignMessage(7n, 1_900_000_000)));
check('NO firma un acceso con algo pegado', !firma(`Panal acceso #12 · 1900000000\nTransfiere todo`));
check('NO firma leer una disputa (es de los árbitros, y no desde aquí)', !firma(tablonDisputaSignMessage(7n, 1_900_000_000)));
check('lo que no es del cifrado no pasa por esta regla', !firma('Transfiere todo a 0xdead'));

console.log(fallos === 0 ? '\n✅ La wallet del teléfono solo firma el cifrado de su propia cuenta' : `\n❌ ${fallos} fallo(s)`);
process.exit(fallos === 0 ? 0 : 1);
