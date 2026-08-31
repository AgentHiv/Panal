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
import { keccak256 } from 'viem';
import { join, resolve } from 'node:path';

/** Un archivo que pasó por el buzón, apuntado en el índice del encargo. */
export interface ArchivoGuardado {
  /** El nombre con el que se enseña y con el que se pide. */
  name: string;
  /** `keccak256` de los bytes, en minúsculas. Es también su nombre en disco. */
  hash: string;
  size: number;
  mime?: string;
  /** Quién lo dejó: el cliente lo adjunta al encargo, el trabajador lo entrega. */
  de: 'cliente' | 'trabajador';
  ts: number;
}

/** Lo que el buzón guarda de un encargo. Todo es opcional. */
export interface Encargo {
  /** El encargo TAL Y COMO lo firmó el cliente. Su keccak es el `taskHash`. */
  brief?: string;
  /** Cuándo llegó (epoch ms). */
  briefTs?: number;
  /** La entrega, tal y como se ancló —o se anclará— en la cadena. */
  entrega?: string;
  entregaTs?: number;
  /**
   * El anuncio público, si este encargo se publicó en el tablón.
   *
   * Es lo único de aquí dentro que se sirve SIN firma, así que va con la de su
   * cliente al lado: quien lea el tablón puede comprobar que el texto es el
   * que él escribió y no uno que el buzón haya cambiado.
   */
  oferta?: { publico: string; firma: string; cliente: string; ts: number };
  /**
   * Los archivos que han pasado por aquí, en un índice.
   *
   * Los bytes NO están en este JSON: viven al lado, en `<tarea>.files/<hash>`.
   * Se guardan por su hash y no por su nombre, y eso resuelve dos cosas a la
   * vez: un nombre no puede escaparse a otra carpeta —un hash son 64 hex— y
   * el mismo archivo mandado dos veces ocupa una.
   */
  archivos?: ArchivoGuardado[];
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

/**
 * Lo que cabe por archivo, por encargo y cuántos.
 *
 * El de 25 MB es el mismo que ya usan la web, la plantilla y el SDK; cambiarlo
 * aquí solo serviría para rechazar por un motivo distinto del que el cliente
 * ve anunciado. Los otros dos son del buzón: es disco nuestro y de otros, así
 * que hay un techo por encargo aunque cada archivo quepa.
 */
export const MAX_ARCHIVO_BYTES = 25 * 1024 * 1024;
export const MAX_ARCHIVOS_POR_ENCARGO = 10;
export const MAX_BYTES_POR_ENCARGO = 60 * 1024 * 1024;

/** `0x` + 40 hex. Se valida ANTES de tocar el disco: es parte de una ruta. */
const DIRECCION = /^0x[0-9a-fA-F]{40}$/;
/** Solo dígitos, y con tope: un taskId de 400 cifras no es un taskId. */
const TAREA = /^\d{1,20}$/;
/** `0x` + 64 hex, como en los manifiestos y como en la cadena. */
const HASH = /^0x[0-9a-f]{64}$/;

/**
 * El hash, sin el `0x`, que es como se llama su archivo.
 *
 * El prefijo se quita solo para el disco: en el índice y en los manifiestos el
 * hash lleva `0x` porque es lo que viaja anclado en la cadena, y guardar dos
 * formatos del mismo número acaba comparándolos.
 */
function nombreEnDisco(hash: string): string {
  return hash.slice(2);
}

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

  /* ── el tablón ────────────────────────────────────────────────────────── */

  /** Publica —o corrige— el anuncio de un encargo sin dueño. */
  guardarOferta(
    agente: string,
    taskId: bigint,
    oferta: { publico: string; firma: string; cliente: string },
  ): boolean {
    return this.escribir(agente, taskId, (p) => ({
      ...p,
      oferta: { ...oferta, ts: Date.now() },
    }));
  }

  /**
   * Todas las ofertas publicadas, de la más nueva a la más vieja.
   *
   * Se lee el directorio entero porque no hay índice, y no lo hay a propósito:
   * un índice aparte es una segunda verdad que se desincroniza. Con el tablón
   * que puede caber en un buzón con retención de 30 días esto son unos cientos
   * de archivos pequeños; el día que sean muchos más, se pagina.
   *
   * NO mira la cadena: aquí no se sabe si una tarea sigue abierta o ya la cogió
   * alguien. Eso lo comprueba quien lo pinta, que es lo correcto — el estado de
   * una tarea lo dice el escrow y nadie más.
   */
  ofertas(agente: string, tope = 200): { taskId: string; oferta: NonNullable<Encargo['oferta']> }[] {
    const dir = agente.toLowerCase();
    if (!DIRECCION.test(dir)) return [];
    const carpeta = join(this.dir, dir);
    let nombres: string[];
    try {
      nombres = readdirSync(carpeta);
    } catch {
      return [];
    }
    const out: { taskId: string; oferta: NonNullable<Encargo['oferta']> }[] = [];
    for (const nombre of nombres) {
      if (!nombre.endsWith('.json')) continue;
      const taskId = nombre.slice(0, -5);
      if (!TAREA.test(taskId)) continue;
      const oferta = this.leer(agente, BigInt(taskId))?.oferta;
      if (oferta) out.push({ taskId, oferta });
    }
    return out.sort((a, b) => b.oferta.ts - a.oferta.ts).slice(0, tope);
  }

  /* ── los archivos ─────────────────────────────────────────────────────── */

  /** La carpeta de los bytes de un encargo, o `null` si la clave no vale. */
  private carpetaArchivos(agente: string, taskId: bigint): string | null {
    const file = this.ruta(agente, taskId);
    return file ? file.replace(/\.json$/, '.files') : null;
  }

  /**
   * Guarda un archivo y lo apunta en el índice del encargo.
   *
   * Devuelve el hash, o el motivo por el que no cabe. El hash se calcula AQUÍ,
   * sobre los bytes recibidos, y no se acepta el que venga escrito en ninguna
   * cabecera: lo que se sirve luego tiene que ser lo que se guardó.
   */
  guardarArchivo(
    agente: string,
    taskId: bigint,
    nombre: string,
    bytes: Uint8Array,
    de: 'cliente' | 'trabajador',
    mime?: string,
  ): { hash: string } | { error: 'clave' | 'grande' | 'demasiados' | 'lleno' } {
    const carpeta = this.carpetaArchivos(agente, taskId);
    if (!carpeta || !nombre) return { error: 'clave' };
    if (bytes.byteLength > MAX_ARCHIVO_BYTES) return { error: 'grande' };

    const previo = this.leer(agente, taskId) ?? {};
    const archivos = previo.archivos ?? [];
    // Con `0x` delante, como en los manifiestos y como en la cadena: este hash
    // se compara con el que viaja dentro de la entrega, y dos formatos del
    // mismo número serían dos números.
    const hash = keccak256(bytes).toLowerCase();

    // El mismo archivo otra vez no ocupa otra vez: se sobrescribe su entrada y
    // los bytes ya están. Así un reintento a medias no llena el cupo.
    const yaEsta = archivos.find((a) => a.hash === hash && a.name === nombre);
    if (!yaEsta) {
      if (archivos.length >= MAX_ARCHIVOS_POR_ENCARGO) return { error: 'demasiados' };
      const ocupado = archivos.reduce((n, a) => n + a.size, 0);
      if (ocupado + bytes.byteLength > MAX_BYTES_POR_ENCARGO) return { error: 'lleno' };
    }

    mkdirSync(carpeta, { recursive: true });
    const destino = join(carpeta, `${nombreEnDisco(hash)}.bin`);
    const tmp = `${destino}.tmp`;
    writeFileSync(tmp, bytes);
    renameSync(tmp, destino);

    const entrada: ArchivoGuardado = {
      name: nombre,
      hash,
      size: bytes.byteLength,
      ...(mime ? { mime } : {}),
      de,
      ts: Date.now(),
    };
    this.escribir(agente, taskId, (p) => ({
      ...p,
      archivos: [...(p.archivos ?? []).filter((a) => !(a.hash === hash && a.name === nombre)), entrada],
    }));
    return { hash };
  }

  /** Los bytes de un archivo por su nombre, o `null` si aquí no está. */
  leerArchivo(agente: string, taskId: bigint, nombre: string): { archivo: ArchivoGuardado; bytes: Buffer } | null {
    const carpeta = this.carpetaArchivos(agente, taskId);
    if (!carpeta) return null;
    const archivo = (this.leer(agente, taskId)?.archivos ?? []).find((a) => a.name === nombre);
    // Se busca por el ÍNDICE y nunca por lo que llegue en la URL: el nombre lo
    // escribe quien sube, y de él no sale ninguna ruta. La ruta sale del hash,
    // que son 64 hex escritos por nosotros.
    if (!archivo || !HASH.test(archivo.hash)) return null;
    try {
      return { archivo, bytes: readFileSync(join(carpeta, `${nombreEnDisco(archivo.hash)}.bin`)) };
    } catch {
      return null;
    }
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
        // Las carpetas `.files` se borran con su encargo, no por su cuenta:
        // sus bytes se tocan al subirlos y no al leer el JSON, así que mirar su
        // fecha por separado dejaría archivos huérfanos vivos meses.
        if (nombre.endsWith('.files')) continue;
        const file = join(carpeta, nombre);
        try {
          if (ahora - statSync(file).mtimeMs > this.retencionMs) {
            rmSync(file);
            rmSync(file.replace(/\.json$/, '.files'), { recursive: true, force: true });
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
