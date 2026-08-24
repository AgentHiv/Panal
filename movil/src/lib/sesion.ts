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
 *
 * POR ESO SE CIERRA SOLO, y por inactividad y no al salir de la app.
 *
 * Cerrar al pasar a segundo plano suena más seguro y en un teléfono no lo es:
 * mirar una notificación te saca de la app, así que el PIN acabaría pidiéndose
 * cinco veces por conversación y la gente pondría el más corto que le dejen.
 * Lo que de verdad protege es que un móvil olvidado encima de una mesa deje de
 * poder firmar, y eso lo mide el tiempo sin tocar nada.
 *
 * El tiempo se mide con una MARCA, no con un temporizador. Un `setTimeout` en
 * segundo plano lo estrangula Android o no corre en absoluto, así que la app
 * volvería creyendo que no ha pasado el rato. Con una marca, el tiempo cuenta
 * igual con la pantalla apagada — que es justo cuando importa.
 */

import { useSyncExternalStore } from 'react';
import type { Account } from 'viem';
import { cuentaDe } from '~/lib/llavero';
import type { Llave, WalletGuardada } from '~/lib/llavero';

const ELEGIDA = 'panal:wallet-del-telefono:v1';

/** Cuánto aguanta abierto sin que nadie toque nada. */
export const INACTIVIDAD_MS = 15 * 60 * 1000;

let cuenta: Account | null = null;
let wallet: WalletGuardada | null = null;
/** Epoch del último uso. Contra esto se mide, no contra un temporizador. */
let ultimoUso = 0;

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
  ultimoUso = Date.now();
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
  ultimoUso = 0;
  avisar();
}

/** Alguien está usando la app: el reloj vuelve a empezar. */
export function tocar(): void {
  if (cuenta) ultimoUso = Date.now();
}

/**
 * Cierra si ha pasado el rato. Devuelve `true` si acaba de cerrarse.
 *
 * Se llama desde un intervalo Y al volver a primer plano, porque en segundo
 * plano el intervalo puede no haber corrido: es la comprobación la que decide,
 * no el reloj que la dispara.
 */
export function caducar(ahora = Date.now()): boolean {
  if (!cuenta || ahora - ultimoUso < INACTIVIDAD_MS) return false;
  cerrarSesion();
  return true;
}

/** Cuánto le queda abierto, en ms. `0` si ya está cerrado. */
export function leQueda(ahora = Date.now()): number {
  if (!cuenta) return 0;
  return Math.max(0, INACTIVIDAD_MS - (ahora - ultimoUso));
}

/** La cuenta lista para firmar, o `null` si el llavero está cerrado.
 *
 * Firmar TAMBIÉN cuenta como usar la app: sin esto, alguien que solo firma
 * —sin tocar la pantalla entre transacción y transacción— se quedaría fuera a
 * mitad de lo que está haciendo.
 */
export function cuentaViva(): Account | null {
  if (caducar()) return null;
  tocar();
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
