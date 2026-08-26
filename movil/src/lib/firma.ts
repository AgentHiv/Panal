/**
 * Panal — enterarse de CUÁNDO se ha firmado, sin tocar lo que se firma.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * EL PROBLEMA
 *
 * `payAndAsk` del SDK hace dos cosas seguidas en una sola llamada: firma el
 * permiso EIP-2612 —que es instantáneo con la wallet del teléfono— y después
 * manda la petición al agente, que cobra en la cadena, se lo piensa y contesta.
 * Eso segundo tarda de unos segundos a un minuto largo.
 *
 * La hoja de firmar se quedaba puesta y bloqueada durante las dos, así que
 * después de firmar seguías mirando un botón que decía «Esperando…» sin saber
 * si habías firmado ya o no. Y no es un detalle de paciencia: la hoja tapa el
 * hilo, así que el mensaje que acabas de mandar no se ve hasta que contesta el
 * agente. Parece que no ha pasado nada.
 *
 * POR QUÉ NO SE ARREGLA EN EL SDK
 *
 * Se podría añadir un `onSigned` a `payAndAsk`, y sería más limpio. Pero eso es
 * publicar una versión del SDK, actualizarla en tres sitios y esperar a que el
 * lockfile la vea, todo para mover una hoja de sitio. El sitio de este arreglo
 * es la app.
 *
 * CÓMO
 *
 * `payAndAsk` llama a `wallet.signTypedData` UNA vez, y justo después manda.
 * Así que ese momento es exactamente la frontera que hace falta. El proxy deja
 * pasar todo lo demás sin tocarlo y solo envuelve esa función: lo que se firma,
 * quién lo firma y qué comprobaciones se hacen antes siguen viviendo enteros en
 * el SDK, que es donde tienen que estar.
 *
 * El aviso sale DESPUÉS de que la firma se resuelva. Si la persona la rechaza,
 * `signTypedData` lanza y aquí no se avisa de nada — que es lo correcto: no se
 * ha firmado, no se ha mandado, y la hoja se tiene que quedar.
 * ───────────────────────────────────────────────────────────────────────────
 */

import type { WalletClient } from 'viem';

export function avisandoAlFirmar(wallet: WalletClient, alFirmar: () => void): WalletClient {
  return new Proxy(wallet, {
    get(destino, prop, receptor) {
      if (prop !== 'signTypedData') return Reflect.get(destino, prop, receptor);
      const original = Reflect.get(destino, prop, receptor) as (
        ...args: unknown[]
      ) => Promise<unknown>;
      return async (...args: unknown[]) => {
        // `apply` con el cliente original: viem monta sus métodos como cierres
        // y no usa `this`, pero llamarlos sueltos es apostar a eso.
        const firma = await original.apply(destino, args);
        alFirmar();
        return firma;
      };
    },
  });
}
