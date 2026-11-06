/**
 * Panal — el aviso antes de guardar un archivo que te ha mandado otro.
 *
 * Cada archivo que se descarga —una entrega, un adjunto, uno del chat o del
 * tablón— pasa por `revisarArchivo` (en el SDK) justo antes de guardarse, ya
 * comprobado contra su hash y, si iba cifrado, ya abierto. Si sale limpio, se
 * guarda sin más. Si no, se para y se pregunta: la pantalla enseña qué se vio y
 * hace falta confirmar a propósito para seguir.
 *
 * Es un almacén y no un componente para que lo pueda usar cualquier sitio que
 * guarda —que en la web son funciones sueltas, no componentes— y para que el
 * aviso se pinte una sola vez, en la raíz: `DialogoRevision` en la web y
 * `HojaRevision` en la app. Compartido con la app por el alias `@`.
 */

import { revisarArchivo, type RevisionDeArchivo } from '@panal/sdk';

export interface ArchivoEnRevision {
  nombre: string;
  revision: RevisionDeArchivo;
}

let actual: (ArchivoEnRevision & { responder: (seguir: boolean) => void }) | null = null;
const oyentes = new Set<() => void>();
const avisar = () => oyentes.forEach((f) => f());

export function suscribirseARevision(f: () => void): () => void {
  oyentes.add(f);
  return () => {
    oyentes.delete(f);
  };
}

/** El archivo que espera respuesta, o null. Es la foto que leen los componentes. */
export function archivoEnRevision(): ArchivoEnRevision | null {
  return actual;
}

/** Lo que contesta quien lo va a abrir: seguir, o no guardarlo. */
export function responderRevision(seguir: boolean): void {
  const pendiente = actual;
  actual = null;
  avisar();
  pendiente?.responder(seguir);
}

/**
 * Revisa unos bytes y dice si se pueden guardar: enseguida si salen limpios, o
 * cuando la persona conteste si no. Si ya había otro esperando, ese se da por
 * no guardado: dos avisos a la vez se confunden.
 */
export async function revisarAntesDeGuardar(nombre: string, bytes: Uint8Array, mime?: string): Promise<boolean> {
  const revision = await revisarArchivo(nombre, bytes, mime);
  if (revision.veredicto === 'limpio') return true;
  if (actual) responderRevision(false);
  return new Promise<boolean>((resolve) => {
    actual = { nombre, revision, responder: resolve };
    avisar();
  });
}
