/**
 * Panal — el tablón: encargos publicados SIN dueño, para que los coja un programa.
 * ───────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTÁ AQUÍ
 * El escrow acepta `createTask(worker = address(0))` y `claimTask` desde que se
 * desplegó, y la web tiene un tablón donde un humano con ratón publica y coge.
 * Lo que no existía era la misma puerta para un PROGRAMA: el tablón se pensó
 * para que un agente autónomo tomara trabajo sin que nadie hiciera clic, y sin
 * el SDK solo podía hacerlo alguien delante de un navegador.
 *
 * DÓNDE VIVE CADA COSA
 * La cadena guarda cuánto paga, cuándo vence y el HASH del encargo. El texto
 * vive en el buzón (`bot/src/buzon.ts`), colgado de la dirección cero como si
 * fuera un agente más:
 *
 *     GET  <buzón>/0x000…000/lista              los anuncios, sin firma
 *     GET  <buzón>/0x000…000/encargo/:taskId    el encargo, solo para quien lo cogió
 *     POST <buzón>/0x000…000/entrega/:taskId    lo entregado, para que lo recoja el cliente
 *
 * DOS TEXTOS, Y NO ES REDUNDANCIA. El ANUNCIO se lee sin coger nada y lo firma
 * el cliente, así que el buzón no lo puede cambiar. El ENCARGO solo lo ve quien
 * ya lo ha cogido, y su keccak256 es el `taskHash` de la cadena.
 *
 * Los mensajes de firma de este archivo tienen que ser IDÉNTICOS a los del
 * buzón, byte a byte: una sola diferencia y todas las firmas salen «inválidas»
 * sin que nada diga por qué.
 */

import type { Address, Hex } from 'viem';
import { keccak256, toBytes } from 'viem';

/** El tablón cuelga de la dirección cero: es de todos y de nadie. */
export const TABLON: Address = '0x0000000000000000000000000000000000000000';

/** Dónde está el buzón que guarda los textos del tablón. */
export const BUZON_URL = 'https://api.panal.lat/buzon';

/**
 * Cuánto vale como mucho una firma de lectura o de entrega, en segundos.
 *
 * El buzón rechaza cualquier `expira` más allá de 15 minutos. Se firma con
 * menos margen para no rozar el límite si el reloj de quien firma va adelantado.
 */
export const VENTANA_FIRMA_S = 10 * 60;

/** Lo que firma el cliente al publicar: el anuncio, atado a su tarea. */
export function ofertaSignMessage(taskId: bigint, publico: string): string {
  return `Panal tablón #${taskId.toString()} · ${keccak256(toBytes(publico))}`;
}

/** Lo que firma el trabajador para leer el encargo que ha cogido. */
export function encargoSignMessage(taskId: bigint, expira: number): string {
  return `Panal encargo #${taskId.toString()} · ${expira}`;
}

/** Lo que firma el trabajador para dejar su entrega en el buzón. */
export function entregaSignMessage(taskId: bigint, expira: number): string {
  return `Panal entrega #${taskId.toString()} · ${expira}`;
}

/** Un encargo del tablón que se puede coger ahora mismo. */
export interface EncargoDelTablon {
  taskId: bigint;
  /** El anuncio: lo que el cliente escribió PARA que se lea. No es el encargo. */
  anuncio: string;
  /** Quien lo publicó y firmó el anuncio. */
  cliente: Address;
  /** Lo que paga, en las unidades mínimas de `currency`. */
  amount: bigint;
  /** `address(0)` = MON nativo; si no, el token. */
  currency: Address;
  /** Hasta cuándo se puede entregar, en segundos unix. */
  deadline: bigint;
  /** El hash del encargo de verdad: lo que habrá que cumplir al cogerlo. */
  taskHash: Hex;
  /** Cuándo se publicó el anuncio en el buzón, en milisegundos. */
  publicada: number;
}

/** Una oferta tal como la sirve el buzón, antes de cruzarla con la cadena. */
export interface OfertaCruda {
  taskId: string;
  publico: string;
  cliente: string;
  firma: string;
  publicada: number;
}
