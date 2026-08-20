/**
 * Panal — los archivos que el CLIENTE adjunta a su encargo.
 *
 * Es el espejo de `deliveredFiles.ts`. Allí un agente entrega un PDF y ancla
 * su hash; aquí una persona manda una foto y pasa lo mismo, sólo que antes:
 *
 *     [panal-attach/1]
 *     name: recibo.png
 *     size: 184320
 *     mime: image/png
 *     hash: 0x8f3a…
 *
 * Ese bloque se pega al encargo ANTES de contratar, así que el `taskHash` que
 * el escrow ancla al bloquear el pago ya cubre la foto:
 *
 *     taskHash on-chain → texto del brief → hash del adjunto → bytes
 *
 * De ahí sale lo que protege al agente: puede rechazar cualquier byte que su
 * encargo no anuncie, y por eso los bytes pueden subirse después, por una ruta
 * aparte, sin que nadie pueda colarle nada por ella.
 *
 * No lleva `path` ni `url` a propósito: un navegador no aloja nada. Es la
 * diferencia con `[panal-files/1]`, donde no decir de dónde se baja el archivo
 * convertiría la entrega en una promesa.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * El formato lo define `sdk/src/files.ts`, que es la fuente de la verdad. Aquí
 * se reimplementa la parte de ESCRITURA por lo mismo que en `deliveredFiles.ts`
 * y en `contracts/abis.ts`: el SDK trae cliente, cadenas y un
 * `import('node:dns')` que no pintan nada en un navegador. Si cambias el
 * formato, cámbialo en los dos sitios — y ojo, que este texto se hashea: un
 * espacio de diferencia y el agente rechaza el encargo con el pago bloqueado.
 * ─────────────────────────────────────────────────────────────────────────
 */

import { keccak256 } from 'viem';
import { sanitizeFileName } from './deliveredFiles';

/** Cabecera del bloque. Lleva versión porque el formato se ancla en la cadena. */
export const ATTACH_BLOCK = '[panal-attach/1]';

/** Tope por archivo: 25 MB, el mismo que el SDK y que la ruta de subida. */
export const MAX_ADJUNTO_BYTES = 25 * 1024 * 1024;

/**
 * Cuántos archivos como mucho.
 *
 * No es un límite del protocolo: es que cada uno es una subida más entre el
 * pago y el trabajo, y una tarea que espera seis subidas tiene seis maneras de
 * quedarse a medias.
 */
export const MAX_ADJUNTOS = 5;

export interface Adjunto {
  /** Nombre ya limpio: es el que se anuncia y el que buscará el agente. */
  name: string;
  size: number;
  mime?: string;
  hash: string;
  /**
   * Los bytes, para subirlos después de contratar.
   *
   * El `<ArrayBuffer>` no es adorno: sin él son `ArrayBufferLike`, que incluye
   * `SharedArrayBuffer`, y un Blob no acepta eso.
   */
  bytes: Uint8Array<ArrayBuffer>;
}

/**
 * Limpia un nombre para que no pueda salirse de su carpeta, y exige que quede
 * algo.
 *
 * Se apoya en el `sanitizeFileName` de las entregas —el mismo criterio en las
 * dos direcciones, que es justo lo que hace falta: lo que se anuncia aquí es
 * lo que el agente buscará en su disco, y un nombre saneado de dos maneras
 * distintas es un adjunto que no se reconoce nunca.
 *
 * La diferencia es que aquí un nombre que se queda en nada NO puede pasar en
 * silencio: sin nombre no hay nada que subir, y el encargo se quedaría
 * anunciando un archivo que nunca podría llegar.
 */
export function limpiarNombre(nombre: string): string {
  const limpio = sanitizeFileName(nombre);
  if (!limpio) throw new Error(`Nombre de archivo inservible: "${nombre}"`);
  return limpio;
}

/** Lee un archivo del disco del usuario y lo describe para el manifiesto. */
export async function describirArchivo(file: File): Promise<Adjunto> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  return {
    name: limpiarNombre(file.name),
    size: bytes.byteLength,
    hash: keccak256(bytes),
    ...(file.type ? { mime: file.type } : {}),
    bytes,
  };
}

/**
 * Construye el bloque.
 *
 * Orden de claves fijo y saltos de línea simples: esto se hashea, así que dos
 * ejecuciones con los mismos archivos tienen que dar los mismos bytes.
 */
export function buildAttachmentsManifest(adjuntos: Adjunto[]): string {
  return adjuntos
    .map((a) => {
      const lineas = [ATTACH_BLOCK, `name: ${limpiarNombre(a.name)}`, `size: ${a.size}`];
      if (a.mime) lineas.push(`mime: ${a.mime}`);
      lineas.push(`hash: ${a.hash}`);
      return lineas.join('\n');
    })
    .join('\n\n');
}

/** El encargo con los adjuntos anunciados al final. Esto es lo que se hashea. */
export function appendAttachmentsManifest(brief: string, adjuntos: Adjunto[]): string {
  if (adjuntos.length === 0) return brief;
  return `${brief.trimEnd()}\n\n${buildAttachmentsManifest(adjuntos)}\n`;
}

/** Tamaño legible, para decirle a alguien por qué no cabe su archivo. */
export function tamanoLegible(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
