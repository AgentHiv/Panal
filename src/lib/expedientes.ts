/**
 * Panal — los expedientes.
 *
 * La cadena guarda nueve campos por encargo y ni uno más: cliente, trabajador,
 * importe, hash de lo pedido, hash de la entrega, plazo, fecha, estado y
 * moneda. El TEXTO de lo que pediste y el de lo que te entregaron NO caben
 * ahí — solo sus hashes.
 *
 * De ahí sale todo este archivo: la cadena prueba QUE encargaste algo, cuándo,
 * por cuánto y que te entregaron. Tu copia prueba QUÉ. Un hash sin el texto no
 * dice qué había dentro; solo sirve para comprobar algo que ya tengas.
 *
 * Y ese texto se está perdiendo hoy, en silencio: `taskBriefs` guarda 200
 * briefs y al llegar ahí tira los más viejos, `historial` hace lo mismo con 60
 * conversaciones. Nadie se entera. `salud()` existe para que se entere.
 */

import { keccak256, toBytes } from 'viem';
import { getTaskBrief } from '@/lib/taskBriefs';
import { leerHilo } from '@/lib/historial';
import type { Mensaje } from '@/lib/historial';
import { parseFilesManifest, stripFilesManifest } from '@/lib/deliveredFiles';
import type { DeliveredFile } from '@/lib/deliveredFiles';

/** Los mismos topes que las capas de las que se lee, para poder avisar antes. */
const MAX_BRIEFS = 200;
const MAX_HILOS = 60;

const CLAVE_ENTREGAS = 'panal:entregas:v1';
/** Entregas guardadas. El texto es pequeño; los adjuntos no se guardan. */
const MAX_ENTREGAS = 120;

/* ── las entregas que sí caben en el teléfono ────────────────────────────── */

interface Entrega {
  /** El texto tal y como lo firmó el agente, con su bloque de archivos. */
  texto: string;
  /** Epoch ms de cuando se guardó en este teléfono. */
  guardada: number;
}

type Entregas = Record<string, Entrega>;

function leerEntregas(): Entregas {
  try {
    const crudo = localStorage.getItem(CLAVE_ENTREGAS);
    return crudo ? (JSON.parse(crudo) as Entregas) : {};
  } catch {
    return {};
  }
}

function escribirEntregas(e: Entregas): void {
  try {
    const entradas = Object.entries(e);
    const recortado = entradas.length > MAX_ENTREGAS ? entradas.slice(-MAX_ENTREGAS) : entradas;
    localStorage.setItem(CLAVE_ENTREGAS, JSON.stringify(Object.fromEntries(recortado)));
  } catch {
    /* Sin sitio. La entrega ya se leyó y se enseñó; lo que se pierde es la copia. */
  }
}

/**
 * Guarda el texto de una entrega, y solo si cuadra con lo que ancla la cadena.
 *
 * Comprobarlo aquí y no en la pantalla es a propósito: esto es lo que después
 * sale en el expediente diciendo «cuadra con la cadena», y esa frase no puede
 * depender de que quien llame se haya acordado de comprobarlo.
 */
export function guardarEntrega(taskId: string, texto: string, resultHash: string): boolean {
  if (keccak256(toBytes(texto)).toLowerCase() !== resultHash.toLowerCase()) return false;
  const todas = leerEntregas();
  todas[taskId] = { texto, guardada: Date.now() };
  escribirEntregas(todas);
  return true;
}

export function leerEntrega(taskId: string): Entrega | null {
  return leerEntregas()[taskId] ?? null;
}

/** El hash de un resultado que todavía no existe. */
const HASH_CERO = `0x${'0'.repeat(64)}`;

/**
 * Si el agente llegó a entregar algo.
 *
 * Vive aquí y no en cada pantalla porque son DOS las que preguntan lo mismo
 * —el archivo de la web y la tabla del dashboard— y tienen que contestar
 * igual: si una considera que hay entrega y la otra no, en una sale el botón
 * de ver el contenido y en la otra no, sin que falle nada.
 */
export function hayEntrega(resultHash: string): boolean {
  return resultHash.toLowerCase() !== HASH_CERO;
}

/* ── el expediente ───────────────────────────────────────────────────────── */

/** Un encargo tal y como lo necesita esta capa. Estructural, como `TareaCruda`. */
export interface TareaExpediente {
  id: bigint;
  client: string;
  worker: string;
  amountWei: bigint;
  taskHash: string;
  resultHash: string;
  currency: string;
  createdAt: bigint;
  deadline: bigint;
  deliveredAt?: bigint;
  status: number;
  role: 'client' | 'worker';
}

export interface Expediente {
  id: string;
  agente: string;
  cliente: string;
  /** Lo que la cadena guarda, en el orden en que se lee del contrato. */
  cadena: {
    importe: bigint;
    simbolo: string;
    taskHash: string;
    resultHash: string;
    creado: number;
    plazo: number;
    entregado: number | null;
    estado: number;
  };
  /** Lo que solo está aquí. `null` en cada campo = se perdió o nunca estuvo. */
  local: {
    brief: string | null;
    /** Si el brief guardado da el mismo hash que ancló la cadena. */
    briefCuadra: boolean;
    entrega: string | null;
    entregaGuardada: number | null;
    /** Los archivos que ANUNCIA la entrega. No están en el teléfono. */
    adjuntos: DeliveredFile[];
    hilo: Mensaje[];
  };
}

export function armar(
  tarea: TareaExpediente,
  simbolo: string,
  yo: string,
): Expediente {
  const brief = getTaskBrief(tarea.taskHash);
  const guardada = leerEntrega(tarea.id.toString());
  // El hilo pertenece al par cliente|agente, y el cliente puede no ser quien
  // mira: un trabajador ve el encargo pero no la conversación del otro.
  const hilo = tarea.role === 'client' ? leerHilo(yo, tarea.worker) : [];

  return {
    id: tarea.id.toString(),
    agente: tarea.worker,
    cliente: tarea.client,
    cadena: {
      importe: tarea.amountWei,
      simbolo,
      taskHash: tarea.taskHash,
      resultHash: tarea.resultHash,
      creado: Number(tarea.createdAt) * 1000,
      plazo: Number(tarea.deadline) * 1000,
      entregado: tarea.deliveredAt && tarea.deliveredAt > 0n ? Number(tarea.deliveredAt) * 1000 : null,
      estado: tarea.status,
    },
    local: {
      brief,
      briefCuadra: brief !== null && keccak256(toBytes(brief)).toLowerCase() === tarea.taskHash.toLowerCase(),
      entrega: guardada ? stripFilesManifest(guardada.texto) : null,
      entregaGuardada: guardada?.guardada ?? null,
      adjuntos: guardada ? parseFilesManifest(guardada.texto) : [],
      hilo,
    },
  };
}

/* ── cuánto de lo tuyo se está perdiendo ─────────────────────────────────── */

export interface Salud {
  briefs: number;
  briefsTope: number;
  hilos: number;
  hilosTope: number;
  entregas: number;
  /** Lo que ocupa todo esto, en bytes de localStorage. */
  bytes: number;
  /** `true` cuando alguno de los topes está lo bastante cerca para avisar. */
  apretado: boolean;
}

function cuantasClaves(clave: string): number {
  try {
    const crudo = localStorage.getItem(clave);
    return crudo ? Object.keys(JSON.parse(crudo) as object).length : 0;
  } catch {
    return 0;
  }
}

export function salud(): Salud {
  const briefs = cuantasClaves('panal:taskBriefs:v1');
  const hilos = cuantasClaves('panal:hilos:v1');
  const entregas = cuantasClaves(CLAVE_ENTREGAS);

  let bytes = 0;
  for (const k of ['panal:taskBriefs:v1', 'panal:hilos:v1', CLAVE_ENTREGAS]) {
    bytes += (localStorage.getItem(k) ?? '').length;
  }

  return {
    briefs,
    briefsTope: MAX_BRIEFS,
    hilos,
    hilosTope: MAX_HILOS,
    entregas,
    bytes,
    // 80 %: hay que avisar mientras todavía se puede sacar la copia, no
    // cuando ya se ha tirado el primer brief.
    apretado: briefs >= MAX_BRIEFS * 0.8 || hilos >= MAX_HILOS * 0.8,
  };
}
