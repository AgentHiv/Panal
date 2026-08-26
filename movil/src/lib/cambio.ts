/**
 * Panal — cambiar de wallet desde cualquier pantalla.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTO NO VA EN `useWallet`
 *
 * `WalletState` es el contrato que comparten la web y la app: las mismas
 * quince pantallas leen `address` de ahí y no saben —ni deben— de dónde sale.
 * En la web no hay nada que cambiar: la wallet la elige la extensión o la app
 * de fuera, y Panal solo pregunta cuál está puesta. Meter un `cambiar` allí
 * obligaría al proveedor de la web a inventarse uno que no hace nada, que es
 * la clase de campo que alguien acaba llamando.
 *
 * Aquí sí existe, porque aquí el llavero es del teléfono y la app es la única
 * que puede decidir con cuál se firma.
 *
 * QUÉ ARREGLA
 *
 * La app se quedaba con la primera wallet que crearas o importaras. La hoja de
 * elegir existía desde el principio, pero solo se abría desde `connect()`, y
 * `connect()` se va de vacío si ya hay una conectada — que es siempre, desde
 * que el cerrojo pide el PIN al arrancar. Las wallets que crearas después
 * salían en el llavero, con su saldo, y no había forma de hablar con un agente
 * ni encargarle nada desde ellas: para eso había que desconectar, que es un
 * botón que parece que te echa de la app.
 * ───────────────────────────────────────────────────────────────────────────
 */

import { createContext, useContext } from 'react';
import type { WalletGuardada } from '~/lib/llavero';

export interface Cambio {
  /**
   * Pide cambiar la wallet con la que se firma.
   *
   * Sin argumento abre la lista para elegir. Con una wallet va derecho a su
   * PIN: se llama así desde el llavero, donde ya se está mirando UNA y volver
   * a elegirla en una lista sería preguntar lo que ya se ha contestado.
   */
  cambiar: (cual?: WalletGuardada) => void;
  /**
   * Suelta la wallet en uso, sin elegir otra.
   *
   * Existe para un caso concreto: borrar del llavero la wallet con la que se
   * está firmando. Sin esto, la clave descifrada se quedaba en memoria y wagmi
   * seguía anunciando conectada una dirección cuya wallet ya no existe.
   */
  soltar: () => void;
}

export const CambioContext = createContext<Cambio>({
  cambiar: () => {},
  soltar: () => {},
});

export function useCambio(): Cambio {
  return useContext(CambioContext);
}
