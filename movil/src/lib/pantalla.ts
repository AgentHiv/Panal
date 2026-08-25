/**
 * Panal — tapar la pantalla mientras hay un secreto delante.
 *
 * Las doce palabras son la wallet entera. La pantalla que las enseña ya evita
 * el portapapeles y no ofrece copiar, pero una captura se las lleva igual y
 * acaba en la galería, que casi siempre está sincronizada con la nube. Eso no
 * se puede impedir desde el WebView: lo decide el sistema de ventanas de
 * Android, y por eso hay un trozo nativo (`android/.../Pantalla.java`).
 *
 * SE CUENTA CUÁNTOS LA PIDEN, no se enciende y se apaga a secas. Puede haber
 * dos cosas a la vez pidiendo tapado —la hoja de importar abierta encima de la
 * pantalla de las palabras—, y si la de arriba se cierra y apaga la bandera,
 * destapa la de abajo, que sigue enseñando el secreto. Con un contador, se
 * apaga cuando se va el último.
 *
 * EN EL NAVEGADOR NO HACE NADA, y no puede hacerlo: no existe forma de impedir
 * una captura en un navegador. Falla en silencio a propósito, para que la
 * misma pantalla se pueda abrir en el escritorio mientras se desarrolla. Lo
 * que NO hace es prometerlo: quien mire las palabras en un navegador no está
 * protegido, y eso es cierto se diga o no.
 */

import { useEffect } from 'react';
import { registerPlugin } from '@capacitor/core';

interface PluginPantalla {
  proteger(): Promise<void>;
  desproteger(): Promise<void>;
}

const Pantalla = registerPlugin<PluginPantalla>('Pantalla');

/** Cuántas pantallas piden tapado ahora mismo. */
let cuantos = 0;

function pedir(): void {
  cuantos += 1;
  if (cuantos === 1) void Pantalla.proteger().catch(() => {});
}

function soltar(): void {
  cuantos = Math.max(0, cuantos - 1);
  if (cuantos === 0) void Pantalla.desproteger().catch(() => {});
}

/**
 * Mientras este componente esté montado, no se pueden hacer capturas.
 *
 * Se destapa al desmontar, que es lo mismo que decir «al salir de la pantalla»:
 * no hay que acordarse de apagarlo en cada camino de salida —el botón, el
 * gesto de atrás, cambiar de wallet—, y esos son justo los que se olvidan.
 */
export function useSinCapturas(): void {
  useEffect(() => {
    pedir();
    return soltar;
  }, []);
}
