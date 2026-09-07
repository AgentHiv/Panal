/**
 * Panal — de dónde se baja la app de Android.
 *
 * EL APK VIVE EN R2, no en las releases de GitHub. La release sigue existiendo
 * y sigue siendo el original firmado: R2 es una copia servida desde el dominio
 * propio, sin la marca de GitHub por delante y sin sus límites de descarga.
 *
 * DOS URLS Y NINGUNA LLEVA LA VERSIÓN DENTRO
 *
 * El enlace de descarga apunta a una clave FIJA (`panal.apk`) que el flujo de
 * publicación sobrescribe en cada versión. Antes esto apuntaba a
 * `releases/latest` de GitHub por el mismo motivo, dicho en su comentario: un
 * enlace con el número dentro se queda viejo en cuanto sale la siguiente y
 * nadie se acuerda de tocarlo. Con una clave fija, el enlace de esta página no
 * hay que volver a tocarlo nunca.
 *
 * Al lado va `ultima.json`, que el mismo flujo escribe con lo que la página
 * necesita contar: qué versión es, cuánto pesa y su SHA-256. Se PIDE en vez de
 * escribirse aquí a propósito — si estuviera aquí, cada versión nueva exigiría
 * tocar este archivo y desplegar la web, y el día que se olvidara la página
 * enseñaría un número que no es el del archivo que sirve. Un checksum
 * equivocado es peor que no enseñar ninguno: el que lo comprueba concluye que
 * le han dado un APK manipulado.
 */

/** El dominio del bucket. Se cambia aquí y en ningún otro sitio. */
const R2 = 'https://panalandroid.panal.lat';

/** Siempre la última. La clave no cambia; lo que hay debajo, sí. */
export const APK_URL = `${R2}/panal.apk`;

/** Lo que el flujo escribe al publicar. */
export const APK_MANIFIESTO_URL = `${R2}/ultima.json`;

/**
 * Las releases de GitHub, que siguen siendo el original.
 *
 * Se enseña en la página a propósito: quien quiera bajarlo de donde lo
 * construyó la máquina que lo firmó, y no de una copia, tiene que poder.
 */
export const APK_RELEASES_URL = 'https://github.com/AgentHiv/Panal/releases/latest';

/**
 * La huella de la clave con la que se firma, para poder comprobarla.
 *
 * Esta SÍ va escrita aquí y no en el manifiesto, y es deliberado: el manifiesto
 * lo escribe la misma máquina que sube el archivo, así que si esa máquina
 * estuviera comprometida escribiría la huella de SU clave y cuadraría con todo.
 * Escrita en el repositorio, cambiarla deja rastro en un commit.
 *
 * Es la misma desde la 2.2.0, que fue la primera firmada con la clave estable.
 * Se comprueba con:
 *
 *     keytool -printcert -jarfile panal.apk
 */
export const APK_FIRMA_SHA256 =
  '05:A7:4C:E7:6A:D3:20:3D:F7:B4:34:71:07:EF:0D:77:62:65:CF:F3:48:56:CF:2E:6C:FA:AE:FC:34:6C:22:9C';

/** Lo que `ultima.json` trae. Todo opcional: es un archivo remoto. */
export interface ManifiestoApk {
  version: string;
  /** Bytes, tal cual los da el sistema de archivos. */
  bytes: number;
  sha256: string;
  /** ISO 8601, cuando se publicó. */
  publicado: string;
}

/** ¿Tiene la forma que esperamos? Un JSON remoto puede ser cualquier cosa. */
function esManifiesto(x: unknown): x is ManifiestoApk {
  if (typeof x !== 'object' || x === null) return false;
  const m = x as Record<string, unknown>;
  return (
    typeof m.version === 'string' &&
    typeof m.bytes === 'number' &&
    Number.isFinite(m.bytes) &&
    typeof m.sha256 === 'string' &&
    typeof m.publicado === 'string'
  );
}

/**
 * Lee el manifiesto. `null` si no se puede, y eso NO es un error de la página.
 *
 * El botón de descargar funciona igual sin él: apunta a la clave fija, que no
 * depende de esto. Lo único que se pierde es poder decir qué versión es y con
 * qué comprobarla, y para eso la página lo dice —«no se pudo leer»— en vez de
 * inventarse un número.
 */
export async function leerManifiestoApk(signal?: AbortSignal): Promise<ManifiestoApk | null> {
  try {
    const res = await fetch(APK_MANIFIESTO_URL, { signal, cache: 'no-cache' });
    if (!res.ok) return null;
    const datos: unknown = await res.json();
    return esManifiesto(datos) ? datos : null;
  } catch {
    return null;
  }
}

/** `4098765` → `3,9 MB`. Con la coma del idioma que se esté leyendo. */
export function tamanoLegible(bytes: number, idioma: string): string {
  return `${new Intl.NumberFormat(idioma, { maximumFractionDigits: 1 }).format(bytes / 1024 / 1024)} MB`;
}
