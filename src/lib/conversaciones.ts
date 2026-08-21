/**
 * Panal — una conversación es TODO lo que ha pasado con un agente.
 *
 * Había dos cosas que ocurren entre un cliente y un agente, y sólo una se
 * guardaba: los mensajes de chat. Encargar un trabajo por el escrow —firmar,
 * bloquear el pago, mandar el brief— no dejaba ni rastro en la bandeja, así
 * que quien contrataba veía "todavía no has hablado con ningún agente"
 * después de haberle bloqueado quince mil $PANAL. Y con los agentes que sólo
 * aceptan encargos no había manera de que apareciera nada, nunca.
 *
 * Aquí se fusionan las dos mitades. Cada una vive donde le corresponde y eso
 * no cambia:
 *
 *   los mensajes  →  este navegador (x402 no ancla nada en la cadena)
 *   los encargos  →  la cadena (el escrow ya sabe lo que encargaste)
 *
 * Y por eso la fusión merece un archivo: los encargos NO se copian a
 * `localStorage`. Se leen del escrow cada vez, así que aparecen en cualquier
 * navegador donde conectes la misma wallet y su estado es siempre el de
 * verdad, no una foto vieja. Duplicarlos en local habría sido más fácil y
 * habría envejecido mal.
 *
 * Sin React, sin viem y sin `localStorage`: sólo datos que entran y datos que
 * salen. Es lo que deja probarlo en Node (scripts/test-conversaciones.ts).
 */

import type { Mensaje, ResumenHilo } from './historial';

/**
 * El enum de estado del escrow, repetido aquí para no arrastrar los contratos.
 * Si cambiara allí, este archivo no compilaría por el tipo del adaptador.
 */
export const ESTADO = {
  Abierto: 0,
  Entregado: 1,
  Completado: 2,
  Disputado: 3,
  Cancelado: 4,
} as const;

/** Un encargo, reducido a lo que la conversación necesita enseñar. */
export interface EncargoEnHilo {
  /** El id en el escrow, como texto: es lo que se enseña y lo que enlaza. */
  id: string;
  /** El agente que lo recibió. */
  agente: string;
  /** Epoch ms de cuando se creó. Es donde se coloca dentro del hilo. */
  cuando: number;
  /** Epoch ms de la entrega, si ya entregó. */
  entregado?: number;
  /** Lo que se pidió, si está en la caché de ESTE navegador. */
  brief: string | null;
  /**
   * El hash de lo que se pidió, que es lo único que viaja por la cadena.
   *
   * Va aquí porque es la llave del texto: sin él no se puede recuperar el
   * brief para reenviárselo a un agente al que no le llegó.
   */
  taskHash: string;
  /** Lo bloqueado, en unidades mínimas y como texto. */
  importe: string;
  simbolo: string;
  estado: number;
}

/**
 * Una tarea tal y como sale de `useMyTasks`, descrita por su forma.
 *
 * Estructural a propósito: `RealTask` encaja sin que este archivo importe los
 * contratos, y así el test corre en Node sin tocar la cadena.
 */
export interface TareaCruda {
  id: bigint;
  worker: string;
  amountWei: bigint;
  taskHash: string;
  currency: string;
  createdAt: bigint;
  deliveredAt?: bigint;
  status: number;
  role: 'client' | 'worker';
}

/**
 * Las tareas que YO encargué, listas para el hilo.
 *
 * Se descartan las que hago como trabajador: ésas son mi bandeja de trabajo,
 * no una conversación que yo haya tenido con nadie. Mezclarlas pondría en
 * "tus conversaciones" a los clientes que me contrataron a mí.
 */
export function encargosDelCliente(
  tareas: TareaCruda[],
  simboloDe: (currency: string) => string,
  briefDe: (taskHash: string) => string | null,
): EncargoEnHilo[] {
  return tareas
    .filter((t) => t.role === 'client')
    .map((t) => ({
      id: t.id.toString(),
      agente: t.worker,
      // La cadena cuenta en segundos y aquí todo lo demás va en milisegundos.
      cuando: Number(t.createdAt) * 1000,
      ...(t.deliveredAt && t.deliveredAt > 0n ? { entregado: Number(t.deliveredAt) * 1000 } : {}),
      brief: briefDe(t.taskHash),
      taskHash: t.taskHash,
      importe: t.amountWei.toString(),
      simbolo: simboloDe(t.currency),
      estado: t.status,
    }));
}

/**
 * Cuándo pasó algo con este encargo.
 *
 * La entrega manda sobre la creación: un encargo de anteayer que te acaban de
 * entregar es lo más nuevo que tienes, y en la bandeja tiene que subir.
 */
export function actividadDe(e: EncargoEnHilo): number {
  return e.entregado && e.entregado > e.cuando ? e.entregado : e.cuando;
}

export type Entrada =
  | { clase: 'mensaje'; cuando: number; mensaje: Mensaje }
  | { clase: 'encargo'; cuando: number; encargo: EncargoEnHilo };

/** Key estable para React, sin colisiones entre las dos clases. */
export function claveDeEntrada(e: Entrada): string {
  return e.clase === 'mensaje' ? `m:${e.mensaje.id}` : `e:${e.encargo.id}`;
}

/**
 * El hilo con un agente: mensajes y encargos en el orden en que ocurrieron.
 *
 * El encargo se coloca por su CREACIÓN aunque la entrega sea posterior. Es una
 * sola tarjeta que enseña su estado actual, y moverla al entregar la sacaría
 * del punto de la conversación en el que se pidió, que es donde se entiende.
 */
export function fusionarHilo(mensajes: Mensaje[], encargos: EncargoEnHilo[]): Entrada[] {
  const entradas: Entrada[] = [
    ...mensajes.map((m) => ({ clase: 'mensaje' as const, cuando: m.cuando, mensaje: m })),
    ...encargos.map((e) => ({ clase: 'encargo' as const, cuando: e.cuando, encargo: e })),
  ];
  // `sort` es estable, así que un empate exacto conserva el orden de arriba.
  return entradas.sort((a, b) => a.cuando - b.cuando);
}

export interface ResumenConversacion {
  /** Siempre en minúsculas: es la identidad del hilo y la key de la lista. */
  agente: string;
  /** Lo último que pasó, sea del color que sea. */
  cuando: number;
  adelanto: Entrada;
  mensajes: number;
  encargos: number;
  /** Encargos que todavía piden algo del cliente: aprobar, o esperar. */
  abiertos: number;
}

/**
 * La bandeja: una fila por agente, de lo más reciente a lo más viejo.
 *
 * Las direcciones se normalizan a minúsculas antes de agrupar. La clave del
 * historial ya viene así, pero la del escrow viene en checksum, y sin
 * normalizar el mismo agente saldría DOS VECES: una por lo que hablaste y
 * otra por lo que le encargaste.
 */
export function fusionarBandeja(
  hilos: ResumenHilo[],
  encargos: EncargoEnHilo[],
): ResumenConversacion[] {
  const porAgente = new Map<string, ResumenConversacion>();

  for (const h of hilos) {
    porAgente.set(h.agente.toLowerCase(), {
      agente: h.agente.toLowerCase(),
      cuando: h.ultimo.cuando,
      adelanto: { clase: 'mensaje', cuando: h.ultimo.cuando, mensaje: h.ultimo },
      mensajes: h.cuantos,
      encargos: 0,
      abiertos: 0,
    });
  }

  for (const e of encargos) {
    const k = e.agente.toLowerCase();
    const cuando = actividadDe(e);
    const abierto = e.estado === ESTADO.Abierto || e.estado === ESTADO.Entregado ? 1 : 0;

    const previo = porAgente.get(k);
    if (!previo) {
      porAgente.set(k, {
        agente: k,
        cuando,
        adelanto: { clase: 'encargo', cuando, encargo: e },
        mensajes: 0,
        encargos: 1,
        abiertos: abierto,
      });
      continue;
    }

    previo.encargos += 1;
    previo.abiertos += abierto;
    // En un empate gana el encargo: mueve dinero, y es lo que hay que ver.
    if (cuando >= previo.cuando) {
      previo.cuando = cuando;
      previo.adelanto = { clase: 'encargo', cuando, encargo: e };
    }
  }

  return [...porAgente.values()].sort((a, b) => b.cuando - a.cuando);
}
