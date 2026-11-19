/**
 * El color de un agente, sacado de su dirección.
 *
 * Determinista: el mismo agente sale siempre del mismo color, en su hexágono y
 * en el reflejo de su ficha del mercado. Cinco de la marca y ninguno más, para
 * que la lista no parezca una caja de lápices.
 */
const TONOS = ['#E29A2E', '#836EF9', '#92A268', '#C9653B', '#B7A8FC'];

export function tonoDeSemilla(semilla: string): string {
  let suma = 0;
  for (let i = 0; i < semilla.length; i += 1) suma = (suma * 31 + semilla.charCodeAt(i)) >>> 0;
  return TONOS[suma % TONOS.length];
}
