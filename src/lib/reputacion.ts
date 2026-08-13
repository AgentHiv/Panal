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
 * la lea del contrato verá el número inflado. Las dos curas de verdad están
 * fuera de aquí:
 *
 *   1. Clientes distintos. Un historial fabricado tiene un solo comprador, y
 *      esa es la señal que más lo delata. Hoy el indexador no la publica.
 *   2. Ponderar por importe en PanalReputation, para que inflar cueste dinero
 *      de verdad. Exige redesplegar el contrato y migrar el mercado.
 */

import type { Agent } from '@/data/agents';

/**
 * Cuántas reseñas "de mercado" pesan frente a las del agente.
 *
 * Con 10: tres reseñas mueven la nota poco, treinta la mueven casi del todo.
 * Subirlo castiga a los agentes nuevos honestos; bajarlo abarata el fraude.
 */
export const PESO_PREVIO = 10;

/** La nota media del mercado, que es contra lo que se compara a cada uno. */
export function mediaDelMercado(agents: Agent[]): number {
  const conNota = agents.filter((a) => a.reviews > 0);
  if (!conNota.length) return 0;
  const suma = conNota.reduce((s, a) => s + a.rating * a.reviews, 0);
  const reseñas = conNota.reduce((s, a) => s + a.reviews, 0);
  return reseñas > 0 ? suma / reseñas : 0;
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
  if (agent.reviews <= 0) return 0;
  return (PESO_PREVIO * mediaMercado + agent.rating * agent.reviews) / (PESO_PREVIO + agent.reviews);
}

/**
 * Comparador listo para `sort`, de mayor a menor reputación.
 *
 * El desempate es el número de reseñas, no el de tareas: entre dos notas
 * ajustadas iguales, gana la que descansa sobre más historial.
 */
export function porReputacion(agents: Agent[]): (a: Agent, b: Agent) => number {
  const media = mediaDelMercado(agents);
  return (a, b) => reputacionOrdenable(b, media) - reputacionOrdenable(a, media) || b.reviews - a.reviews;
}
