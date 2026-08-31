/**
 * Panal — el almacén del buzón.
 *
 * Guarda dos textos por encargo: el que escribió el cliente y el que entregó
 * quien lo hizo. Nada más. Ni claves, ni saldos, ni permisos.
 *
 * ES UN RELEVO, NO UN ARCHIVO. El brief ya vive en el navegador del cliente
 * (`taskBriefs`) y la entrega también en cuanto la descarga (`expedientes.ts`).
 * Esto solo cubre el trecho entre que uno escribe y el otro lee, y por eso
 * puede caducar: `RETENCION_DIAS` borra lo viejo y nadie pierde su copia.
 *
 * Y no puede mentir sobre lo que guarda. El texto de la entrega está atado a
 * la cadena por `keccak256`, y quien la descarga lo recomprueba: si un byte
 * cambiara aquí, el cliente lo vería en rojo. Ver `buzon.ts`.
 *
 * Un archivo JSON por encargo, escritura atómica (tmp + rename) igual que
 * `store.ts`. No hay índice ni base de datos: la clave es la dirección del
 * agente y el número de la tarea, que es exactamente como se pregunta por
 * ellos, y así un encargo corrupto no se lleva por delante a los demás.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';

/** Lo que el buzón guarda de un encargo. Las dos mitades son opcionales. */
export interface Encargo {
  /** El encargo TAL Y COMO lo firmó el cliente. Su keccak es el `taskHash`. */
  brief?: string;
  /** Cuándo llegó (epoch ms). */
  briefTs?: number;
  /** La entrega, tal y como se ancló —o se anclará— en la cadena. */
  entrega?: string;
  entregaTs?: number;
}

/**
 * Cuánto se guarda. Treinta días.
 *
 * El plazo más largo que ofrece la web es una semana y el auto-release son 72
 * horas, así que un mes cubre de sobra la vida de un encargo y su disputa. Lo
 * que se borra pasado ese tiempo no desaparece del mundo: sigue en las dos
 * copias de las partes, y su hash sigue en la cadena para siempre.
 */
export const RETENCION_DIAS = 30;

/** `0x` + 40 hex. Se valida ANTES de tocar el disco: es parte de una ruta. */
const DIRECCION = /^0x[0-9a-fA-F]{40}$/;
/** Solo dígitos, y con tope: un taskId de 400 cifras no es un taskId. */
const TAREA = /^\d{1,20}$/;

export class BuzonStore {
  private readonly dir: string;
  private readonly retencionMs: number;

  constructor(dir: string, retencionDias: number = RETENCION_DIAS) {
    this.dir = resolve(dir);
    this.retencionMs = retencionDias * 86_400_000;
    mkdirSync(this.dir, { recursive: true });
  }

  /**
   * La ruta del encargo, o `null` si lo que piden no tiene forma de encargo.
   *
   * Todo lo que llega aquí viene de una URL. La dirección y el número se
   * comprueban contra su forma y no se limpian «lo mejor posible»: un
   * `../../etc` no es una dirección con algo raro, es otra cosa, y lo que hay
   * que hacer con otra cosa es no tocarla.
   */
  private ruta(agente: string, taskId: bigint | string): string | null {
    const dir = agente.toLowerCase();
    const tarea = taskId.toString();
    if (!DIRECCION.test(dir) || !TAREA.test(tarea)) return null;
    return join(this.dir, dir, `${tarea}.json`);
  }

  leer(agente: string, taskId: bigint): Encargo | null {
    const file = this.ruta(agente, taskId);
    if (!file) return null;
    try {
      return JSON.parse(readFileSync(file, 'utf8')) as Encargo;
    } catch {
      // No existe, o quedó a medias. Las dos cosas se responden igual: aquí no
      // hay nada. Inventar un objeto vacío haría creer que sí lo hay.
      return null;
    }
  }

  /** Guarda el brief. Devuelve false si la clave no tiene forma de encargo. */
  guardarBrief(agente: string, taskId: bigint, brief: string): boolean {
    return this.escribir(agente, taskId, (previo) => ({
      ...previo,
      brief,
      briefTs: Date.now(),
    }));
  }

  /** Guarda la entrega. Quién puede hacerlo y cuándo lo decide `buzon.ts`. */
  guardarEntrega(agente: string, taskId: bigint, entrega: string): boolean {
    return this.escribir(agente, taskId, (previo) => ({
      ...previo,
      entrega,
      entregaTs: Date.now(),
    }));
  }

  private escribir(
    agente: string,
    taskId: bigint,
    cambio: (previo: Encargo) => Encargo,
  ): boolean {
    const file = this.ruta(agente, taskId);
    if (!file) return false;
    const previo = this.leer(agente, taskId) ?? {};
    const nuevo = cambio(previo);
    mkdirSync(join(this.dir, agente.toLowerCase()), { recursive: true });
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(nuevo), 'utf8');
    renameSync(tmp, file);
    return true;
  }

  /**
   * Borra lo que ha pasado de la retención. Devuelve cuántos encargos cayeron.
   *
   * Se mira la fecha del ARCHIVO y no la de dentro: un encargo a medio escribir
   * —brief sin entrega— también tiene que caducar, y su `entregaTs` no existe.
   */
  limpiar(ahora: number = Date.now()): number {
    if (!existsSync(this.dir)) return 0;
    let borrados = 0;
    for (const agente of readdirSync(this.dir)) {
      const carpeta = join(this.dir, agente);
      let encargos: string[];
      try {
        encargos = readdirSync(carpeta);
      } catch {
        continue;
      }
      for (const nombre of encargos) {
        const file = join(carpeta, nombre);
        try {
          if (ahora - statSync(file).mtimeMs > this.retencionMs) {
            rmSync(file);
            borrados++;
          }
        } catch {
          /* desapareció por el camino: ya está borrado */
        }
      }
    }
    return borrados;
  }
}
