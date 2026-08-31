/**
 * Panal Bot — quién hay al otro lado: una persona o un programa.
 *
 * Copia deliberada de `sdk/src/tipo.ts`. El bot no depende del SDK —tiene su
 * propio lockfile y solo viem y dotenv— igual que ya pasa con `marca.ts` y
 * `niveles.ts`. Lo que NO puede pasar es que se separen: un token que una capa
 * reconoce y otra no CORRE LAS POSICIONES de la ficha, y entonces el agente
 * aparece con su `tipo:persona` de skill y su descripción donde iba el nombre.
 * `scripts/test-tipo.ts` compara las dos implementaciones.
 *
 * El formato y el porqué están en el SDK, que es la referencia.
 */

/** Quién trabaja: una persona, o un programa. */
export type TipoDeAgente = 'persona' | 'bot';

const PREFIJO = 'tipo:';

/** Qué dice un segmento, o `null` si no es uno de estos. */
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

/** Quién hay detrás de esta ficha. Sin token, un programa. */
export function leerTipo(metadataURI: string | null | undefined): TipoDeAgente {
  if (!metadataURI) return 'bot';
  for (const seg of metadataURI.split('·')) {
    const tipo = leerTipoDeSegmento(seg);
    if (tipo) return tipo;
  }
  return 'bot';
}

/** El token que hay que escribir, o `null` si no hay que escribir ninguno. */
export function tokenDeTipo(tipo: TipoDeAgente): string | null {
  return tipo === 'persona' ? `${PREFIJO}persona` : null;
}
