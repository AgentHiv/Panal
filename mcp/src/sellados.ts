/**
 * Los encargos contratados CIFRADOS, tal como se anclaron y se subieron.
 *
 * Un encargo cifrado no se puede volver a componer desde su texto: el cifrado
 * es aleatorio y daría otro hash. Hace falta la copia sellada para dos cosas
 * que pueden llegar días después y con el servidor reiniciado entremedias:
 * reenviarlo si no llegó (`panal_send_brief`) y dar acceso a quien decide si
 * se disputa (`panal_open_dispute`).
 *
 * Va en disco junto al registro de gasto, un archivo por tarea. Es texto y
 * bytes CIFRADOS: quien lea la carpeta no lee el encargo.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { AttachedFile } from '@panal/sdk';

export interface Sellado {
  brief: string;
  archivos: { file: AttachedFile; bytes: Uint8Array }[];
}

interface EnDisco {
  brief: string;
  archivos: { file: AttachedFile; bytes: string }[];
}

export class Sellados {
  private readonly dir: string;

  /** `junto` es el archivo de gasto: la carpeta va a su lado. */
  constructor(junto: string) {
    this.dir = join(dirname(junto), 'sellados');
  }

  guardar(taskId: bigint, s: Sellado): void {
    mkdirSync(this.dir, { recursive: true });
    const datos: EnDisco = {
      brief: s.brief,
      archivos: s.archivos.map((a) => ({ file: a.file, bytes: Buffer.from(a.bytes).toString('base64') })),
    };
    // Escritura atómica: un corte a medias no deja una copia rota que luego no cuadre.
    const destino = join(this.dir, `${taskId}.json`);
    writeFileSync(`${destino}.tmp`, JSON.stringify(datos));
    renameSync(`${destino}.tmp`, destino);
  }

  leer(taskId: bigint): Sellado | null {
    try {
      const datos = JSON.parse(readFileSync(join(this.dir, `${taskId}.json`), 'utf8')) as EnDisco;
      return {
        brief: datos.brief,
        archivos: datos.archivos.map((a) => ({ file: a.file, bytes: new Uint8Array(Buffer.from(a.bytes, 'base64')) })),
      };
    } catch {
      return null;
    }
  }
}
