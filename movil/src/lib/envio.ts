/**
 * Panal — lo que entra de fuera al llavero: palabras y claves privadas.
 *
 * Solo lo que hace falta para LEER lo que alguien pega: limpiarlo, adivinar si
 * son doce palabras o una clave, y comprobar la suma de control de BIP-39.
 * Nada de esto toca la red ni la pantalla.
 *
 * LAS CUENTAS DE MANDAR DINERO ESTABAN AQUÍ Y SE HAN IDO a `@/lib/envio`, en
 * la capa compartida, desde que el sitio también manda $PANAL: la regla de que
 * sin MON no sale nada es la misma en los dos sitios y no puede haber dos
 * copias. Este archivo se queda con lo que de verdad es solo del teléfono,
 * porque en la web no hay llavero que importar nada.
 */

import { sha256 } from 'viem';
import { english } from 'viem/accounts';

/* ── importar una wallet de fuera ────────────────────────────────────────── */

/**
 * Deja la frase como la espera BIP-39: minúsculas y un espacio entre palabras.
 *
 * Se borra todo lo que no sea una letra a propósito. Las doce palabras se
 * copian de sitios que las numeran («1. abandon 2. ability»), las pegan con
 * comas o las meten en una tabla, y hacer que la persona limpie eso a mano en
 * el teclado del móvil es pedirle que se equivoque.
 */
export function limpiarFrase(texto: string): string {
  return texto
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/** Una clave privada suelta, con o sin `0x`. `null` si no lo es. */
export function limpiarClave(texto: string): `0x${string}` | null {
  const s = texto.trim().replace(/\s/g, '');
  const hex = /^0[xX]/.test(s) ? s.slice(2) : s;
  return /^[0-9a-fA-F]{64}$/.test(hex) ? (`0x${hex.toLowerCase()}` as `0x${string}`) : null;
}

/** Cuántas palabras admite BIP-39. Doce es lo normal; 24 lo usan las frías. */
const LARGOS = [12, 15, 18, 21, 24];

/**
 * Qué ha pegado la persona, mirando solo la forma.
 *
 * No dice si es válido —eso lo comprueba viem con la suma de control, y por
 * eso no se repite aquí—: dice cuál de los dos caminos hay que intentar, para
 * que el mensaje de error hable de lo que la persona creía estar pegando.
 */
export function claseDeSecreto(texto: string): 'palabras' | 'clave' | null {
  if (limpiarClave(texto)) return 'clave';
  const n = limpiarFrase(texto).split(' ').filter(Boolean).length;
  return LARGOS.includes(n) ? 'palabras' : null;
}

/**
 * Si esas palabras son de verdad una frase BIP-39.
 *
 * ESTO NO ES UN ADORNO. `mnemonicToAccount` de viem NO comprueba la suma de
 * control: con la última palabra cambiada devuelve tan contenta una dirección
 * distinta —comprobado— y la persona se quedaría mirando una wallet vacía sin
 * entender por qué, convencida de haber importado la suya. La suma de control
 * existe justo para eso: doce palabras de la lista, en el orden equivocado,
 * fallan.
 *
 * Cómo va: cada palabra son 11 bits (2048 = 2¹¹). De los N·11 bits, los
 * últimos N/3 no son entropía, son los primeros bits del SHA-256 de la
 * entropía. Se rehace el SHA-256 y se comparan.
 */
export function validarPalabras(frase: string): boolean {
  const palabras = limpiarFrase(frase).split(' ').filter(Boolean);
  if (!LARGOS.includes(palabras.length)) return false;

  let bits = '';
  for (const p of palabras) {
    const i = english.indexOf(p);
    if (i < 0) return false;
    bits += i.toString(2).padStart(11, '0');
  }

  const control = palabras.length / 3;
  const entropia = bits.slice(0, bits.length - control);
  const bytes = new Uint8Array(entropia.length / 8);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(entropia.slice(i * 8, i * 8 + 8), 2);

  const resumen = sha256(bytes).slice(2);
  let esperado = '';
  for (const c of resumen) {
    esperado += parseInt(c, 16).toString(2).padStart(4, '0');
    if (esperado.length >= control) break;
  }

  return esperado.slice(0, control) === bits.slice(bits.length - control);
}
