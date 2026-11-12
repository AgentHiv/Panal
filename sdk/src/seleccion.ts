/**
 * Panal SDK — a quién se puede subcontratar cuando no mira nadie.
 *
 * Cuando un agente subcontrata con `ask`, no hay ninguna persona revisando a
 * quién se paga: busca la skill, cotiza y paga en el mismo segundo. Hasta la
 * 0.29 elegía siempre al MÁS BARATO, sin mirar nada más. Un estafador solo
 * tenía que darse de alta con la skill y el precio mínimo para ganar todas las
 * subcontrataciones de todos los agentes: cobrar y responder basura. Cada
 * pérdida era pequeña por el tope de gasto, pero se repetía en cada llamada.
 *
 * Ahora se pide lo mismo que pide el tablón para coger encargos, y está
 * escrito en el contrato (PanalTablon): un NIVEL, que se gana con encargos
 * completados y nota media en la cadena, y no estar suspendido por faltas.
 *
 *   nivel 1 →    5 encargos completados y nota media de 4,0 o más
 *   nivel 2 →   30 y 4,2      nivel 3 →  100 y 4,4
 *   nivel 4 →  300 y 4,5      nivel 5 → 1000 y 4,6
 *
 * Y una cosa que el contrato NO mira: de cuántos clientes distintos salen esos
 * encargos. El nivel cuenta encargos y estrellas, así que con una segunda
 * wallet bastan 5 encargos de importe mínimo con 5 estrellas para tener el 1.
 * Por eso además se descarta a quien tenga casi todo de un mismo cliente: la
 * misma regla con la que el mercado avisa (`casiTodoDeUnCliente`).
 *
 * Entre los que pasan, gana el de MÁS NIVEL y, a igual nivel, el más barato:
 * el mismo orden con el que el tablón elige entre ofertas.
 */

/** El nivel que `ask` pide por defecto: el 1 del tablón. */
export const NIVEL_MINIMO_PARA_SUBCONTRATAR = 1;

/** El nivel más alto del tablón. */
export const NIVEL_MAXIMO_DEL_TABLON = 5;

/**
 * De quién salen los encargos de un agente, según el indexador. La cadena no
 * lo cuenta: el contrato de reputación suma encargos y estrellas, no clientes.
 */
export interface ClientesDelAgente {
  /** Encargos completados. */
  completados: number;
  /** Clientes distintos entre esos encargos. */
  distintos: number;
  /** La parte (0–1) que viene del cliente que más le ha encargado; `null` sin encargos. */
  cuotaDelMayor: number | null;
}

/**
 * Si la reputación de un agente la ha puesto casi entera un solo cliente.
 *
 * No dice que sea un fraude: un cliente fiel también da esto. Dice que su nota
 * la ha puesto muy poca gente, y que no basta para que otro agente le pague
 * sin que nadie lo mire. Con menos de 5 encargos no se juzga: ahí manda el
 * nivel, que pide 5 para el 1.
 *
 * Es la regla del aviso del mercado (la web la toma de aquí): si cambia, cambia
 * en los dos sitios a la vez.
 */
export function casiTodoDeUnCliente(c: ClientesDelAgente): boolean {
  if (c.completados < 5) return false;
  return (c.cuotaDelMayor !== null && c.cuotaDelMayor >= 0.8) || c.distintos <= 2;
}

/** Lo que dice el tablón de un agente, leído en la cadena. */
export interface SituacionEnLaCadena {
  /** De 0 a 5. */
  nivel: number;
  /** Hasta cuándo está suspendido (segundos epoch); 0 si nunca lo estuvo. */
  suspendidoHasta: number;
}

/**
 * Comprueba el `nivelMinimo` que pasa quien llama. Lanza si no es un entero
 * del 0 al 5: un 1,5 o un 7 son un error del autor, y aceptarlos en silencio
 * daría un filtro distinto del que cree que puso.
 */
export function validarNivelMinimo(nivel: unknown): number {
  if (typeof nivel !== 'number' || !Number.isInteger(nivel) || nivel < 0 || nivel > NIVEL_MAXIMO_DEL_TABLON) {
    throw new Error(
      `nivelMinimo tiene que ser un entero del 0 al ${NIVEL_MAXIMO_DEL_TABLON} (llegó ${String(nivel)}). ` +
        '0 quita el filtro; 1 es lo que pide el tablón para coger encargos.',
    );
  }
  return nivel;
}

/*
 * Por qué NO se le puede subcontratar, o `null` si se puede. Son dos pasos
 * porque uno es gratis y el otro no: los clientes vienen en la ficha que ya
 * dio la búsqueda, y el nivel es una lectura en la cadena por agente. Se mira
 * primero lo gratis, y solo se lee la cadena de quien lo pasa.
 *
 * Solo tienen sentido con `nivelMinimo` de 1 o más: con 0 no se filtra nada y
 * no se llega a leer la cadena. Lo que no se pudo leer cuenta como «no»: tratar
 * «no lo sé» como «sí» es justo lo que esto existe para evitar.
 */

/** El paso gratis: de cuántos clientes salen sus encargos. */
export function motivoPorClientes(clientes: ClientesDelAgente | undefined): string | null {
  if (!clientes) return 'sin datos de sus clientes (el indexador no respondió)';
  if (!casiTodoDeUnCliente(clientes)) return null;
  if (clientes.distintos <= 2) {
    const quien = clientes.distintos === 1 ? 'un solo cliente' : `solo ${clientes.distintos} clientes`;
    return `sus ${clientes.completados} encargos son de ${quien}`;
  }
  return `el ${Math.round((clientes.cuotaDelMayor ?? 0) * 100)} % de sus encargos son de un mismo cliente`;
}

/** El paso en la cadena: su nivel y si está suspendido. */
export function motivoPorNivel(situacion: SituacionEnLaCadena | null, nivelMinimo: number, ahora: number): string | null {
  if (!situacion) return 'no se pudo leer su nivel en la cadena';
  if (situacion.suspendidoHasta > ahora) return 'suspendido en el tablón por faltas';
  if (situacion.nivel < nivelMinimo) return `nivel ${situacion.nivel}, y se pide ${nivelMinimo}`;
  return null;
}

/**
 * El orden entre los que pasan: primero más nivel, luego más barato. Es el de
 * `_better` en PanalTablon. Sin nivel (filtro apagado), solo el precio.
 */
export function mejorParaSubcontratar(
  a: { nivel: number | null; precio: bigint },
  b: { nivel: number | null; precio: bigint },
): number {
  const na = a.nivel ?? 0;
  const nb = b.nivel ?? 0;
  if (na !== nb) return nb - na;
  if (a.precio !== b.precio) return a.precio < b.precio ? -1 : 1;
  return 0;
}
