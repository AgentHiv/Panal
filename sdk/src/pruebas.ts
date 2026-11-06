/**
 * Panal — las pruebas de una disputa.
 *
 * Una disputa se abre en el escrow con un botón, y la cadena no guarda POR
 * QUÉ: ni el motivo, ni lo que cada parte tiene que decir. Los jueces (la
 * multisig 2 de 3) decidían viendo el importe y las direcciones, y el encargo y
 * la entrega si pasaron por el buzón.
 *
 * Esto es el expediente de la disputa: lo guarda el buzón de Panal, sin tocar
 * el contrato. Quien la abre escribe el motivo y aporta pruebas, la otra parte
 * contesta con las suyas, y las dos ven las de la otra. Los jueces lo leen
 * todo y deciden; no hay un modelo que decida por ellos.
 *
 * LAS REGLAS
 *
 *   - Cada pieza la FIRMA la wallet de quien la aporta, sobre su contenido y su
 *     fecha (`piezaSignMessage`). Nadie puede negar después lo que aportó, ni
 *     el buzón cambiarla: los jueces comprueban la firma.
 *   - Hay PLAZO_DE_PRUEBAS_DIAS desde que se abrió la disputa (el
 *     `disputedAt` del escrow). El contrato devuelve el dinero al cliente si
 *     nadie decide en 14 días, así que a los jueces les quedan siete para
 *     decidir con el expediente cerrado.
 *   - Solo las dos partes y los jueces lo leen. Si las dos partes publicaron
 *     su clave, cada pieza y sus archivos van cifrados para ellas y para los
 *     jueces que tengan la suya: el buzón guarda sobres que no puede abrir.
 *
 * Lo que firma cada pieza es el CONTENIDO TAL COMO SE GUARDA —el sobre si va
 * cifrada— y los hashes de sus archivos tal como se suben: así el buzón puede
 * comprobarlo al recibirla y los jueces al leerla, sin abrir nada.
 *
 * Las mismas funciones están copiadas en el buzón (`bot/src/buzon.ts`) y una
 * prueba (`scripts/test-pruebas-formato.ts`) comprueba que dicen lo mismo.
 */

import { getAddress, keccak256, toBytes, verifyMessage, type Address, type Hex } from 'viem';

/** Días para aportar pruebas desde que se abre la disputa. */
export const PLAZO_DE_PRUEBAS_DIAS = 7;
/** Lo que cabe en el texto de una pieza, sin cifrar. */
export const MAX_PIEZA_CHARS = 8_000;
/** Piezas por parte: de sobra para contar lo que pasó, y un tope. */
export const MAX_PIEZAS_POR_PARTE = 20;
/** Archivos por pieza. */
export const MAX_ARCHIVOS_POR_PIEZA = 5;
/** Cuánto puede separarse la fecha de una pieza de la hora del buzón al recibirla. */
export const MARGEN_FECHA_MS = 10 * 60_000;

/**
 * La firma para leer el expediente o subir un archivo: una por sesión, que
 * caduca, como la de la conversación. Aportar una pieza lleva además la suya.
 */
export function pruebasSignMessage(taskId: bigint, expira: number): string {
  return `Panal pruebas #${taskId.toString()} · ${expira}`;
}

/** Un archivo de una pieza, tal como se subió (cifrado si la pieza va cifrada). */
export interface ArchivoDePieza {
  hash: string;
  size: number;
}

/**
 * El contenido de una pieza, en un hash: el texto tal cual se guarda y los
 * archivos por su hash y su tamaño, en ese orden. Es lo que se firma.
 */
export function contenidoDePieza(texto: string, archivos: ArchivoDePieza[]): Hex {
  const canonico = JSON.stringify({
    v: 1,
    texto,
    archivos: archivos.map((a) => ({ hash: a.hash.toLowerCase(), size: a.size })),
  });
  return keccak256(toBytes(canonico));
}

/** Lo que firma quien aporta una pieza: la tarea, el contenido y la fecha. */
export function piezaSignMessage(taskId: bigint, contenido: Hex, fecha: string): string {
  return ['Panal · pieza de una disputa', `Tarea: #${taskId.toString()}`, `Contenido: ${contenido.toLowerCase()}`, `Fecha: ${fecha}`].join('\n');
}

/** Una pieza del expediente, como la guarda y la sirve el buzón. */
export interface PiezaDeDisputa {
  /** Quién la aporta, por su papel en la tarea. */
  de: 'cliente' | 'trabajador';
  /** Su dirección, la que firmó. */
  autor: Address;
  /** El texto, o el sobre cifrado. */
  texto: string;
  archivos: ArchivoDePieza[];
  /** La fecha que firmó, ISO 8601 en UTC. */
  fecha: string;
  firma: Hex;
  /** Cuándo la recibió el buzón (ms desde 1970). */
  recibida: number;
}

/** El expediente de una disputa, como lo devuelve `GET /pruebas/:tarea`. */
export interface ExpedienteDeDisputa {
  piezas: PiezaDeDisputa[];
  /** Hasta cuándo se aportan pruebas (segundos desde 1970). */
  plazo: number;
  /** Si ahora se puede aportar algo: en disputa y dentro del plazo. */
  abierto: boolean;
  /** Los accesos a lo cifrado que tiene quien lee (`cifrado.ts`, `Acceso`). */
  accesos: { o: string; a: string; e: string; n: string; k: string }[];
}

/**
 * ¿La firmó de verdad su autor, sobre este contenido y esta fecha? Lo
 * comprueban los jueces al leer, sin fiarse del buzón.
 */
export async function verificarPieza(taskId: bigint, pieza: PiezaDeDisputa): Promise<boolean> {
  try {
    return await verifyMessage({
      address: getAddress(pieza.autor),
      message: piezaSignMessage(taskId, contenidoDePieza(pieza.texto, pieza.archivos), pieza.fecha),
      signature: pieza.firma,
    });
  } catch {
    return false;
  }
}

/** Hasta cuándo hay plazo, a partir del `disputedAt` del escrow (segundos). */
export function plazoDePruebas(disputedAt: bigint | number): number {
  return Number(disputedAt) + PLAZO_DE_PRUEBAS_DIAS * 86_400;
}
