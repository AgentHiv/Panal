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
 *
 * LA V2 (noviembre de 2026): LOS JUECES PREGUNTAN, Y SOLO CUENTA LO ANCLADO
 *
 * Con un agente que tiene servidor propio, el encargo y la entrega están en su
 * máquina: los jueces de la disputa del encargo 133 no podían ver ni lo uno ni
 * lo otro, y el expediente solo traía lo que alguien quisiera escribir. Desde
 * la v2:
 *
 *   - TODO VA CIFRADO, y para TODOS: las dos partes y los tres jueces que
 *     tengan clave. El buzón lo comprueba con los destinatarios del sobre (sin
 *     abrirlo): ni una pieza en claro, ni una escondida a la otra parte.
 *   - LOS JUECES TAMBIÉN ESCRIBEN: preguntan, y PIDEN el encargo o la entrega
 *     a una parte (`peticion`). Cada juez por su cuenta.
 *   - SOLO CUENTA LO ANCLADO EN LA CADENA. El encargo y la entrega se aportan
 *     con su texto EXACTO, y quien lee comprueba que su keccak256 es el
 *     `taskHash` o el `resultHash` del escrow (`anclaDeLaPieza`). Archivos,
 *     solo los que van dentro de ellos, por su hash (`hashesAnclados`); nada
 *     de archivos de fuera. Lo demás es conversación.
 *
 * Qué es cada pieza (un mensaje, el encargo, una petición…) va DENTRO del
 * sobre (`CuerpoDePieza`): el buzón no lo ve. Lo de fuera —quién la firma, los
 * destinatarios, la fecha— sí, y con eso aplica las reglas.
 */

import { getAddress, keccak256, toBytes, verifyMessage, type Address, type Hex } from 'viem';
import type { Destinatario } from './cifrado.js';
import { parseAttachmentsManifest, parseFilesManifest } from './files.js';

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

/** Quién aporta una pieza: una de las dos partes o, desde la v2, un juez. */
export type AutorDePieza = 'cliente' | 'trabajador' | 'juez';

/** Una pieza del expediente, como la guarda y la sirve el buzón. */
export interface PiezaDeDisputa {
  /** Quién la aporta, por su papel en la tarea. */
  de: AutorDePieza;
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

/* ── la v2 ────────────────────────────────────────────────────────────── */

/** Una de las dos partes de la tarea. */
export type ParteDeLaTarea = 'cliente' | 'trabajador';

/** Piezas por juez: cada uno las suyas, igual que cada parte. */
export const MAX_PIEZAS_POR_JUEZ = 20;
/**
 * Lo que cabe en una pieza que trae el encargo o la entrega: su texto EXACTO,
 * que puede ser bastante más largo que un mensaje (un encargo admite 32 000
 * caracteres, y una entrega lleva además la lista de sus archivos).
 */
export const MAX_TEXTO_ANCLADO_CHARS = 64_000;

/**
 * Qué es una pieza:
 *   - `mensaje`: lo que alguien dice. De un juez puede ir a una parte (`para`).
 *   - `encargo` / `entrega`: el texto exacto de lo pedido o lo entregado, que
 *     se comprueba contra la cadena.
 *   - `peticion`: un juez le pide a una parte (`para`) el encargo o la entrega
 *     (`pide`).
 */
export type TipoDePieza = 'mensaje' | 'encargo' | 'entrega' | 'peticion';

/** Un archivo de una pieza, por dentro: su nombre y el hash con el que se ancló. */
export interface ArchivoDeCuerpo {
  name: string;
  size: number;
  /** El hash de lo que se subió al expediente (cifrado): lo que comprueba el buzón. */
  hash: string;
  mime?: string;
  /**
   * El keccak256 de los bytes TAL COMO SE ANCLARON: el que figura en la lista
   * de adjuntos del encargo o en la de archivos de la entrega. Sin él, o si no
   * está en esas listas, el archivo no cuenta y no se ofrece para abrir.
   */
  h?: string;
}

/** Lo que va dentro del sobre de cada pieza de la v2. */
export interface CuerpoDePieza {
  v: 2;
  k: TipoDePieza;
  /** El texto: el mensaje, o el encargo o la entrega exactos. */
  t: string;
  /** Sus archivos (solo en el encargo o la entrega, y solo anclados). */
  a: ArchivoDeCuerpo[];
  /** A qué parte va un mensaje o una petición de un juez. Sin él, a todos. */
  para?: ParteDeLaTarea;
  /** Qué pide una petición. */
  pide?: 'encargo' | 'entrega';
  /** La escribió la IA de un agente, sola: se enseña como automática. */
  auto?: true;
}

/** Arma el cuerpo de una pieza, sin campos de más. */
export function cuerpoDePieza(o: {
  tipo: TipoDePieza;
  texto: string;
  archivos?: ArchivoDeCuerpo[];
  para?: ParteDeLaTarea;
  pide?: 'encargo' | 'entrega';
  auto?: boolean;
}): CuerpoDePieza {
  return {
    v: 2,
    k: o.tipo,
    t: o.texto,
    a: o.archivos ?? [],
    ...(o.para ? { para: o.para } : {}),
    ...(o.pide ? { pide: o.pide } : {}),
    ...(o.auto ? { auto: true as const } : {}),
  };
}

const TIPOS: TipoDePieza[] = ['mensaje', 'encargo', 'entrega', 'peticion'];

/**
 * Lee lo que hay dentro de un sobre de pieza. Las de la v1 eran `{ t, a }` (o
 * el texto tal cual, si iban en claro): salen como un mensaje. Lo que no se
 * entiende también sale como mensaje, con el texto crudo: mejor leer algo raro
 * que perderlo.
 */
export function leerCuerpoDePieza(dentro: string): CuerpoDePieza {
  let crudo: unknown;
  try {
    crudo = JSON.parse(dentro);
  } catch {
    return cuerpoDePieza({ tipo: 'mensaje', texto: dentro });
  }
  if (!crudo || typeof crudo !== 'object' || Array.isArray(crudo)) return cuerpoDePieza({ tipo: 'mensaje', texto: dentro });
  const o = crudo as Record<string, unknown>;
  const texto = typeof o.t === 'string' ? o.t : '';
  const archivos = (Array.isArray(o.a) ? o.a : [])
    .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
    .filter((x) => typeof x.name === 'string' && typeof x.hash === 'string' && typeof x.size === 'number')
    .map((x) => ({
      name: x.name as string,
      size: x.size as number,
      hash: (x.hash as string).toLowerCase(),
      ...(typeof x.mime === 'string' ? { mime: x.mime } : {}),
      ...(typeof x.h === 'string' ? { h: x.h.toLowerCase() } : {}),
    }));
  const tipo = TIPOS.includes(o.k as TipoDePieza) ? (o.k as TipoDePieza) : 'mensaje';
  const para = o.para === 'cliente' || o.para === 'trabajador' ? o.para : undefined;
  const pide = o.pide === 'encargo' || o.pide === 'entrega' ? o.pide : undefined;
  return cuerpoDePieza({ tipo, texto, archivos, para, pide, auto: o.auto === true });
}

/**
 * ¿Lo que trae una pieza de encargo o de entrega es lo que se ancló? El
 * keccak256 de su texto tiene que ser el `taskHash` o el `resultHash` de la
 * tarea en el escrow. `null` si la pieza no es de esas (o si la tarea aún no
 * tiene entrega anclada).
 */
export function anclaDeLaPieza(
  cuerpo: CuerpoDePieza,
  tarea: { taskHash: Hex | string; resultHash: Hex | string },
): 'coincide' | 'no-coincide' | null {
  const ancla = cuerpo.k === 'encargo' ? tarea.taskHash : cuerpo.k === 'entrega' ? tarea.resultHash : null;
  if (!ancla || /^0x0*$/i.test(ancla)) return null;
  return keccak256(toBytes(cuerpo.t)).toLowerCase() === ancla.toLowerCase() ? 'coincide' : 'no-coincide';
}

/**
 * Los hashes de los archivos anclados, sacados de los textos YA COMPROBADOS
 * del encargo (su lista de adjuntos) y de la entrega (la de sus archivos). Un
 * archivo de una pieza solo cuenta si su `h` está aquí.
 */
export function hashesAnclados(o: { encargo?: string | null; entrega?: string | null }): Set<string> {
  const hashes = new Set<string>();
  if (o.encargo) for (const f of parseAttachmentsManifest(o.encargo)) hashes.add(f.hash.toLowerCase());
  if (o.entrega) for (const f of parseFilesManifest(o.entrega)) hashes.add(f.hash.toLowerCase());
  return hashes;
}

/** Quiénes forman el expediente: las dos partes y los jueces, sin repetir. */
export function miembrosDelExpediente(cliente: Address, trabajador: Address, jueces: readonly Address[]): Address[] {
  const vistos = new Set<string>();
  const out: Address[] = [];
  for (const c of [cliente, trabajador, ...jueces]) {
    const k = c.toLowerCase();
    if (vistos.has(k)) continue;
    vistos.add(k);
    out.push(getAddress(c));
  }
  return out;
}

/**
 * Para quién se cifra cada pieza de la v2: TODOS los miembros que tengan clave
 * publicada. El buzón rechaza una pieza a la que le falte alguno (que no se
 * pueda esconder nada a nadie) o en la que no esté su autor. `sinClave` son
 * los que todavía no la tienen: cuando la publiquen, quien pueda abrir lo
 * anterior les da acceso.
 */
export async function destinatariosDelExpediente(
  miembros: readonly Address[],
  claveDe: (cuenta: Address) => Promise<string | null>,
): Promise<{ para: Destinatario[]; sinClave: Address[] }> {
  const claves = await Promise.all(miembros.map((m) => claveDe(m)));
  const para: Destinatario[] = [];
  const sinClave: Address[] = [];
  miembros.forEach((m, i) => {
    const clave = claves[i];
    if (clave) para.push({ cuenta: m, clave });
    else sinClave.push(m);
  });
  return { para, sinClave };
}
