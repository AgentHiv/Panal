/**
 * Panal — la capa del chip seguro para el llavero.
 *
 * El llavero ya va cifrado con el PIN. Esto lo vuelve a cifrar con una clave
 * que vive en el almacén de claves de Android y no se puede sacar de allí
 * (`android/.../SecureKey.java`). Sin ella, los datos del llavero copiados
 * fuera del teléfono no sirven para probar PINs en un ordenador.
 *
 * Fuera de Android —el navegador mientras se desarrolla, las pruebas en Node—
 * no hay chip: `capaDelChip()` devuelve `null` y el llavero se guarda como
 * siempre. No se promete lo que no se puede dar.
 */
import { Capacitor, registerPlugin } from '@capacitor/core';

interface PluginSecureKey {
  cifrar(o: { datos: string }): Promise<{ iv: string; datos: string }>;
  descifrar(o: { iv: string; datos: string }): Promise<{ datos: string }>;
}

/** Lo que el chip devuelve al cifrar: se guarda tal cual. */
export interface Sobre {
  iv: string;
  datos: string;
}

/** Cifrar y descifrar texto con la clave del chip. */
export interface CapaSegura {
  cifrar(texto: string): Promise<Sobre>;
  descifrar(sobre: Sobre): Promise<string>;
}

const nativo = registerPlugin<PluginSecureKey>('SecureKey');

function aBase64(texto: string): string {
  const bytes = new TextEncoder().encode(texto);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function deBase64(b64: string): string {
  const s = atob(b64);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/** La capa del chip, o `null` si en esta plataforma no hay. */
export function capaDelChip(): CapaSegura | null {
  if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable('SecureKey')) return null;
  return {
    cifrar: (texto) => nativo.cifrar({ datos: aBase64(texto) }),
    descifrar: async (sobre) => deBase64((await nativo.descifrar(sobre)).datos),
  };
}
