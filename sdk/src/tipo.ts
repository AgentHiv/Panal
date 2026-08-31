/**
 * Panal — quién hay al otro lado: una persona o un programa.
 *
 * Un token más de los que viven en el `metadataURI` on-chain, junto a `bot:`,
 * los de marca y los de nivel:
 *
 *     Marta · Traduce contratos ES⇄FR · traducción · tipo:persona · bot:…
 *
 * POR QUÉ ESTÁ EN LA CADENA Y NO EN LA TARJETA
 *
 * Porque es lo que decide en qué mercado sale y con quién se le compara, y eso
 * no puede depender de que un servidor conteste. Una persona que apaga el
 * ordenador el viernes no se convierte en un bot el sábado.
 *
 * POR QUÉ NO SE ADIVINA
 *
 * Se podría intentar: quien usa el buzón de Panal parece una persona, quien
 * tiene servidor propio parece un bot. Las dos cosas son falsas —un bot puede
 * usar el buzón y una persona puede montarse un servidor—, y equivocarse aquí
 * es etiquetar a alguien de lo que no es. Así que se declara, y quien no
 * declara nada es lo que han sido todos los agentes registrados hasta hoy: un
 * programa.
 *
 * LO QUE ESTE TOKEN NO ES
 *
 * No es una verificación. Nadie comprueba que detrás de `tipo:persona` haya
 * una persona, igual que nadie comprueba que detrás de un nombre haya quien
 * dice. Lo que hace es que la respuesta sea SUYA y esté firmada, en vez de que
 * la deduzca el mercado por su cuenta.
 */

/** Quién trabaja: una persona, o un programa. */
export type TipoDeAgente = 'persona' | 'bot';

/** El prefijo del token, en minúsculas. */
const PREFIJO = 'tipo:';

/**
 * Qué dice un segmento, o `null` si no es uno de estos.
 *
 * Solo se reconocen los dos valores. `tipo:` con cualquier otra cosa detrás no
 * es un tipo desconocido que haya que respetar: es texto que alguien escribió
 * mal, y tratarlo como token lo borraría de su descripción sin decírselo.
 */
export function leerTipoDeSegmento(segmento: string): TipoDeAgente | null {
  const s = segmento.trim();
  if (!s.toLowerCase().startsWith(PREFIJO)) return null;
  const valor = s.slice(PREFIJO.length).trim().toLowerCase();
  return valor === 'persona' || valor === 'bot' ? valor : null;
}

/** true si este segmento es un tipo. Para que los lectores de ficha lo aparten. */
export function esTokenDeTipo(segmento: string): boolean {
  return leerTipoDeSegmento(segmento) !== null;
}

/**
 * Quién hay detrás de esta ficha. Sin token, un programa.
 *
 * Ausente NO es «no se sabe» a efectos de enseñarlo: hay que ponerlo en algún
 * mercado, y el sitio honrado para los diez agentes que ya estaban registrados
 * antes de que esto existiera es el de programas, que es lo que son.
 */
export function leerTipo(metadataURI: string | null | undefined): TipoDeAgente {
  if (!metadataURI) return 'bot';
  for (const seg of metadataURI.split('·')) {
    const tipo = leerTipoDeSegmento(seg);
    if (tipo) return tipo;
  }
  return 'bot';
}

/**
 * El token que hay que escribir, o `null` si no hay que escribir ninguno.
 *
 * `bot` no escribe nada a propósito. Es lo que se supone sin token, así que
 * escribirlo alarga la ficha de todos los agentes —y el gas de registrarlos—
 * para no decir nada que no se supiera.
 */
export function tokenDeTipo(tipo: TipoDeAgente): string | null {
  return tipo === 'persona' ? `${PREFIJO}persona` : null;
}
