/**
 * Panal — la reputación que se usa para ORDENAR, que no es la media a secas.
 *
 * EL PROBLEMA. Fabricar reseñas cuesta el precio del gas. Basta una segunda
 * wallet: A contrata a B por el mínimo (0,001 MON), B entrega, A aprueba con
 * cinco estrellas. B se queda el 97,5 %, que vuelve al mismo bolsillo, así que
 * el coste neto por reseña es el 2,5 % de una milésima. Cien reseñas perfectas
 * salen por 0,0025 MON.
 *
 * Y el mercado ordenaba por `rating` a secas, con el número de tareas como
 * desempate. Los dos números son igual de fáciles de inflar, así que quien
 * llegara al escaparate vería arriba al que mejor supiera inflarse.
 *
 * LO QUE HACE ESTO. Una media de 5,0 con tres reseñas no dice lo mismo que una
 * de 4,8 con doscientas, y ordenarlas por el número a pelo pone la primera
 * delante. La media se acerca a la del mercado cuantas menos reseñas la
 * respalden: con tres apenas se mueve del promedio general, y hacen falta
 * decenas para acercarse de verdad a un cinco. Eso no hace imposible el fraude
 * —nada aquí lo hace—, pero lo convierte en decenas de tareas y cientos de
 * transacciones en vez de tres clics.
 *
 * LO QUE NO ARREGLA, y conviene no confundirlo. Esto defiende el ORDEN del
 * mercado, no la cifra: la reputación on-chain sigue siendo inflable, y quien
 * la lea del contrato verá el número inflado. Las dos curas de verdad:
 *
 *   1. Clientes distintos. Un historial fabricado tiene un solo comprador, y
 *      esa es la señal que más lo delata. Desde noviembre de 2026 el indexador
 *      la publica (`clients`, `clientRating`): la nota que se enseña cuenta a
 *      cada cliente UNA vez, y lo que respalda la nota al ordenar son clientes
 *      distintos, no reseñas. Veinte reseñas de la misma wallet pesan como una.
 *      Llegó con un caso real: un agente nuevo con veinte encargos de 0,01 MON,
 *      uno cada ocho minutos, casi todos de la misma wallet y con cinco
 *      estrellas.
 *   2. Ponderar por importe en PanalReputation, para que inflar cueste dinero
 *      de verdad. Exige redesplegar el contrato y migrar el mercado.
 *
 * Lo que tampoco sabe nadie: si dos wallets son de la misma persona. Un
 * operador con veinte wallets sigue pudiendo fingir veinte clientes; cuesta
 * veinte veces más, que es de lo que se trata.
 */

import type { Agent } from '@/data/agents';
import type { AgentStats } from '@/lib/indexer';

/**
 * Cuántas reseñas "de mercado" pesan frente a las del agente.
 *
 * Con 10: tres reseñas mueven la nota poco, treinta la mueven casi del todo.
 * Subirlo castiga a los agentes nuevos honestos; bajarlo abarata el fraude.
 */
export const PESO_PREVIO = 10;

/**
 * Lo mismo cuando lo que respalda la nota son clientes distintos y no reseñas.
 * Un cliente vale más que una reseña —es otra wallet que tuvo que pagar—, así
 * que hacen falta menos: con tres, la nota se queda a medio camino.
 */
export const PESO_PREVIO_CLIENTES = 3;

/**
 * Y hacia dónde se acerca entonces: un 3, la mitad de la escala, y no la media
 * del mercado.
 *
 * Con la media no bastaba, y lo enseñó la prueba con los números de noviembre:
 * un 5,0 de un solo cliente quedaba por delante de un 4,5 de ocho, porque el
 * de ocho está cerca de la media y acercarlo a ella no le quita nada, mientras
 * que al de uno lo deja en «media y pico». Hacia un 3, una nota perfecta de un
 * solo cliente se queda en 3,5: hay que convencer a varios para subir.
 */
export const NOTA_PREVIA_CLIENTES = 3;

/** Lo que respalda la nota: clientes que puntuaron si el índice lo sabe, y si no reseñas. */
export function respaldo(a: Agent): number {
  return a.ratedClients ?? a.reviews;
}

/** El peso del promedio del mercado según con qué se cuente. */
function pesoPrevio(a: Agent): number {
  return a.ratedClients !== undefined ? PESO_PREVIO_CLIENTES : PESO_PREVIO;
}

/**
 * Los campos de reputación de una ficha, a partir de las stats del indexador.
 *
 * `rating` pasa a ser la nota por cliente si el índice la trae; la media simple
 * se queda en `chainRating`, para enseñarla al lado cuando no coincide. Sin
 * esas cifras (un indexador anterior), todo como antes.
 */
export function reputacionDeStats(st: AgentStats | null | undefined): Pick<
  Agent,
  'rating' | 'reviews' | 'clients' | 'ratedClients' | 'chainRating' | 'topClientShare'
> {
  const simple = st?.avgRating ?? 0;
  const acotar = (n: number) => (n > 0 ? Math.min(5, n) : 0);
  if (!st || st.clients === undefined) return { rating: acotar(simple), reviews: st?.ratingCount ?? 0 };
  return {
    rating: acotar(st.clientRating ?? simple),
    reviews: st.ratingCount,
    clients: st.clients,
    ratedClients: st.ratedClients ?? 0,
    chainRating: acotar(simple),
    ...(st.topClientShare !== null && st.topClientShare !== undefined ? { topClientShare: st.topClientShare } : {}),
  };
}

/**
 * Casi todo su trabajo lo pagó la misma gente: cinco o más encargos
 * completados, y el 80 % de un solo cliente o todo de dos. Es la señal F7 de
 * la vigilancia del indexador (contracts/TABLON-SECURITY.md) adelantada de
 * diez a cinco completadas, porque aquí se enseña a quien está a punto de
 * pagar y no a quien vigila. No dice que sea un fraude: un cliente fiel
 * también da esto. Dice que la nota la ha puesto muy poca gente.
 */
export function casiDeUnCliente(a: Agent): boolean {
  if (a.clients === undefined || a.topClientShare === undefined) return false;
  if (a.tasksCompleted < 5) return false;
  return a.topClientShare >= 0.8 || a.clients <= 2;
}

/** La nota media del mercado, que es contra lo que se compara a cada uno. */
export function mediaDelMercado(agents: Agent[]): number {
  const conNota = agents.filter((a) => respaldo(a) > 0);
  if (!conNota.length) return 0;
  const suma = conNota.reduce((s, a) => s + a.rating * respaldo(a), 0);
  const peso = conNota.reduce((s, a) => s + respaldo(a), 0);
  return peso > 0 ? suma / peso : 0;
}

/**
 * La nota con la que se ordena. Cero si el agente no tiene ninguna reseña.
 *
 * Un agente sin reseñas se queda al final en vez de heredar la media del
 * mercado, que es lo que dicta la estadística: darle la nota media a quien no
 * ha trabajado nunca lo pondría por delante de agentes reales con notas
 * bajas, y eso es otra forma del mismo problema.
 */
export function reputacionOrdenable(agent: Agent, mediaMercado: number): number {
  const n = respaldo(agent);
  if (n <= 0) return 0;
  const k = pesoPrevio(agent);
  const previa = agent.ratedClients !== undefined ? NOTA_PREVIA_CLIENTES : mediaMercado;
  return (k * previa + agent.rating * n) / (k + n);
}

/**
 * Comparador listo para `sort`, de mayor a menor reputación.
 *
 * El desempate es el número de reseñas, no el de tareas: entre dos notas
 * ajustadas iguales, gana la que descansa sobre más historial.
 */
export function porReputacion(agents: Agent[]): (a: Agent, b: Agent) => number {
  const media = mediaDelMercado(agents);
  // Sin desempatar por reseñas: veinte de la misma wallet no deben ganarle a una.
  return (a, b) => reputacionOrdenable(b, media) - reputacionOrdenable(a, media) || respaldo(b) - respaldo(a);
}
