/**
 * Panal — el nombre único de un agente, en el formato que acepta la cadena.
 *
 * Estas reglas son las de `PanalNames._validar`, y tienen que coincidir EXACTO.
 * Si aquí se dejara pasar algo que el contrato rechaza, el usuario firmaría una
 * transacción que revierte y pagaría el gas para nada; si se rechazara algo que
 * el contrato acepta, se le estaría negando un nombre que era suyo.
 *
 * Por qué solo `a-z0-9-`: es lo que mata los homoglifos. La `а` cirílica no es
 * que colisione con la latina, es que no se puede escribir. Normalizar Unicode
 * en Solidity no es viable; rechazar todo lo que no sea ASCII minúscula, sí.
 */

export const HANDLE_MIN = 3;
export const HANDLE_MAX = 32;

/** Por qué no vale un handle. `null` = vale. */
export type MotivoHandle = 'corto' | 'largo' | 'caracter' | 'guion-borde' | 'guion-doble';

/**
 * Convierte un nombre libre en un handle candidato.
 *
 * Los acentos se quitan descomponiendo (NFD) y tirando las marcas: "Ágil" →
 * `agil`. Transliterar a ojo cada idioma sería inventar, y de un nombre en
 * alfabeto no latino —"日本語"— no sale nada, que es la consecuencia honesta de
 * aceptar solo ASCII.
 */
export function aHandle(nombre: string): string {
  return nombre
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, HANDLE_MAX)
    .replace(/-+$/, '');
}

/** Qué le pasa a este handle, o `null` si el contrato lo aceptaría. */
export function revisaHandle(handle: string): MotivoHandle | null {
  if (handle.length < HANDLE_MIN) return 'corto';
  if (handle.length > HANDLE_MAX) return 'largo';
  if (!/^[a-z0-9-]+$/.test(handle)) return 'caracter';
  if (handle.startsWith('-') || handle.endsWith('-')) return 'guion-borde';
  if (handle.includes('--')) return 'guion-doble';
  return null;
}
