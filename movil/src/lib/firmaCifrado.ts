/**
 * Las dos firmas del cifrado de encargos (`sdk/src/cifrado.ts`) que la wallet
 * del teléfono acepta, y SOLO para la cuenta de su llavero.
 *
 * La primera no es una firma cualquiera: de ella sale la clave que abre los
 * encargos cifrados, así que firmarla para otro sería darle esa clave. Por eso
 * se compara con el mensaje entero de ESTA cuenta y no con un patrón. La
 * segunda solo publica la clave pública, pero tampoco tiene por qué firmarse
 * en nombre de otra cuenta.
 *
 * Aparte de `signingPolicy.ts` para poder probarlo sin la configuración de
 * Vite (scripts/test-movil-firmas.ts).
 */
import { getAddress, type Address } from 'viem';
import { mensajeParaDerivarClave } from '@panal/sdk';

const PUBLICAR_CLAVE = /^Panal · mi clave pública de cifrado · v1\n\nCuenta: (0x[0-9a-fA-F]{40})\nClave: [A-Za-z0-9_-]{43}$/;

export function esFirmaDelCifrado(texto: string, dueno: Address): boolean {
  if (texto === mensajeParaDerivarClave(dueno)) return true;
  const m = PUBLICAR_CLAVE.exec(texto);
  return !!m && m[1] === getAddress(dueno);
}
