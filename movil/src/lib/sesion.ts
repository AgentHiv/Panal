/**
 * Panal — la wallet del teléfono, mientras la app está abierta.
 *
 * El llavero guarda claves cifradas; esto guarda LA QUE SE ESTÁ USANDO, ya
 * descifrada, para que el conector de wagmi pueda firmar sin volver a pedir el
 * PIN en cada pantalla.
 *
 * QUÉ SE GUARDA Y DÓNDE, que aquí importa:
 *
 *   - La cuenta descifrada vive SOLO en memoria. Al cerrar la app se va, y no
 *     hay forma de que vuelva sin el PIN. No se escribe en `localStorage` ni
 *     en ningún sitio: eso convertiría el PIN en un adorno.
 *   - CUÁL de las wallets del llavero se eligió sí se recuerda en disco. Es un
 *     identificador, no una clave: sirve para que al volver a abrir la app la
 *     pantalla ofrezca la misma en vez de preguntar otra vez cuál.
 *
 * LO QUE ESTO SIGNIFICA, dicho sin adornos: con el llavero abierto, la app
 * firma sin preguntar. Lo que se aprueba es lo que enseñan las hojas de la
 * app —el precio del mensaje, el depósito del encargo— y no hay una segunda
 * pantalla de otra aplicación detrás. Ese es exactamente el intercambio que se
 * pidió: menos incomodidad a cambio de que la confirmación sea la de Panal.
 * Por eso el llavero se abre una vez por sesión y no queda abierto para
 * siempre.
 */

import { useSyncExternalStore } from 'react';
import type { Account } from 'viem';
import { cuentaDe } from '~/lib/llavero';
import type { Llave, WalletGuardada } from '~/lib/llavero';

const ELEGIDA = 'panal:wallet-del-telefono:v1';

let cuenta: Account | null = null;
let wallet: WalletGuardada | null = null;

export interface Sesion {
  /** Si hay una wallet del llavero lista para firmar. */
  abierta: boolean;
  wallet: WalletGuardada | null;
}

let instantanea: Sesion = { abierta: false, wallet: null };
const oyentes = new Set<() => void>();

function avisar(): void {
  instantanea = { abierta: cuenta !== null, wallet };
  for (const f of oyentes) f();
}

/** Estable a propósito: `useSyncExternalStore` la compara por identidad. */
function suscribir(f: () => void): () => void {
  oyentes.add(f);
  return () => {
    oyentes.delete(f);
  };
}

const leer = (): Sesion => instantanea;

export function useSesion(): Sesion {
  return useSyncExternalStore(suscribir, leer, leer);
}

/**
 * Abre la sesión: descifra la clave una vez y la deja lista.
 *
 * Se descifra AQUÍ y no en cada firma porque descifrar necesita el PIN
 * derivado, y pedirlo en mitad de un pago sería volver a la incomodidad que
 * esto viene a quitar.
 */
export async function abrirSesion(llave: Llave, w: WalletGuardada): Promise<void> {
  cuenta = await cuentaDe(llave, w.id);
  wallet = w;
  try {
    localStorage.setItem(ELEGIDA, w.id);
  } catch {
    /* recordar cuál es una comodidad, no un requisito */
  }
  avisar();
}

/** Tira la clave descifrada. Lo guardado sigue cifrado en el llavero. */
export function cerrarSesion(): void {
  cuenta = null;
  wallet = null;
  avisar();
}

/** La cuenta lista para firmar, o `null` si el llavero está cerrado. */
export function cuentaViva(): Account | null {
  return cuenta;
}

export function walletViva(): WalletGuardada | null {
  return wallet;
}

/** Cuál se usó la última vez, para ofrecerla ya marcada. */
export function idRecordado(): string | null {
  try {
    return localStorage.getItem(ELEGIDA);
  } catch {
    return null;
  }
}
