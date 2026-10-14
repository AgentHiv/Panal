/**
 * De lo que elige la persona a lo que se sube al tablón. Compartido por la web
 * y la app.
 *
 * Archivos sueltos tal cual; una CARPETA (lo que da un `<input webkitdirectory>`)
 * se convierte en un solo `.zip` con su estructura dentro, y viaja como
 * cualquier otro archivo: su hash anunciado en el texto que se ancla.
 */

import type { ArchivoParaSubir } from '@panal/sdk';
import { crearZip } from '@/lib/zip';

/** Los archivos elegidos, con sus bytes. */
export async function archivosElegidos(lista: FileList | File[]): Promise<ArchivoParaSubir[]> {
  return Promise.all(
    [...lista].map(async (f) => ({
      name: f.name,
      bytes: new Uint8Array(await f.arrayBuffer()),
      ...(f.type ? { mime: f.type } : {}),
    })),
  );
}

/**
 * Una carpeta elegida, como un `.zip` con el nombre de la carpeta. `null` si
 * viene vacía. La ruta de cada archivo sale de `webkitRelativePath`, que
 * empieza por el nombre de la carpeta: se quita para que el ZIP no la repita.
 */
export async function carpetaComoZip(lista: FileList | File[]): Promise<ArchivoParaSubir | null> {
  const archivos = [...lista];
  if (archivos.length === 0) return null;
  const rutaDe = (f: File) => (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
  const carpeta = rutaDe(archivos[0]!).split('/')[0] || 'carpeta';
  const entradas = await Promise.all(
    archivos.map(async (f) => ({
      nombre: rutaDe(f).split('/').slice(1).join('/') || f.name,
      bytes: new Uint8Array(await f.arrayBuffer()),
    })),
  );
  return { name: `${carpeta}.zip`, bytes: crearZip(entradas), mime: 'application/zip' };
}

/** «1,2 MB», «340 kB», «12 B», para la lista de lo elegido. */
export function tamano(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} kB`;
  return `${bytes} B`;
}

/** Guarda unos bytes como archivo en el navegador. */
export function guardarComoArchivo(nombre: string, bytes: Uint8Array, mime?: string): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime || 'application/octet-stream' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
