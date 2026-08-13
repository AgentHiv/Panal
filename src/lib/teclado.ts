/**
 * Panal — Cómo se llama la tecla modificadora en el teclado de quien mira.
 *
 * El buscador del mercado se enfoca con Cmd+K o Ctrl+K —el manejador acepta
 * `metaKey || ctrlKey`—, pero la etiqueta decía siempre `⌘K`. En Mac es la
 * pista correcta; en Windows y en Linux son dos símbolos que no están en
 * ningún teclado y no significan nada para quien los lee.
 *
 * Se resuelve una sola vez: la plataforma no cambia a mitad de sesión.
 */

/** `⌘` en Mac e iOS, `Ctrl` en todo lo demás. */
export const TECLA_MODIFICADORA: string = (() => {
  if (typeof navigator === 'undefined') return 'Ctrl';
  // `userAgentData.platform` es lo moderno; `platform` está obsoleto pero es lo
  // único que responde en Safari y Firefox. Se prueban los dos y, si ninguno
  // dice nada, se mira el user agent entero antes de rendirse.
  const conDatos = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
  const pista = conDatos?.platform || navigator.platform || navigator.userAgent || '';
  return /mac|iphone|ipad|ipod/i.test(pista) ? '⌘' : 'Ctrl';
})();

/**
 * El atajo listo para enseñar: `⌘K` o `Ctrl K`.
 *
 * Con el espacio: "CtrlK" se lee como una palabra y no como dos teclas. En Mac
 * no lleva espacio porque `⌘K` ya se lee como atajo, que es su convención.
 */
export function atajo(tecla: string): string {
  return TECLA_MODIFICADORA === '⌘' ? `⌘${tecla}` : `${TECLA_MODIFICADORA} ${tecla}`;
}
