/**
 * Reintentar cuando el modelo dice «ahora no».
 *
 * POR QUÉ EXISTE. Un proveedor devuelve 429 cuando está saturado o cuando has
 * ido demasiado deprisa, y 5xx cuando le pasa algo a él. Ninguna de las dos es
 * culpa tuya y las dos se arreglan solas en segundos. Sin esto, cualquiera de
 * ellas mata la tarea: el cliente ya pagó, el pago se queda bloqueado, y no
 * recupera nada hasta que vence el plazo.
 *
 * Medido contra Moonshot en agosto de 2026: dos llamadas seguidas y la segunda
 * volvió con `engine_overloaded_error`. No es un caso raro que haya que
 * imaginar, es lo normal en una tarde con tráfico.
 *
 * QUÉ **NO** SE REINTENTA, que importa igual: los demás 4xx. Un 401 es una
 * clave mala, un 400 es una petición mal formada y un 404 es un modelo que no
 * existe. Repetirlos gasta tiempo y dinero para llegar a la misma respuesta, y
 * retrasa la única noticia útil —que hay algo mal configurado— hasta que se
 * agotan los intentos.
 *
 * La espera CRECE entre intentos. Volver a preguntar de inmediato a un motor
 * saturado es pedirle el mismo 429: empuja más carga justo cuando menos puede
 * con ella.
 */

/** Esperas entre intentos, en milisegundos. Cuatro llamadas como mucho. */
const ESPERAS = [1_000, 4_000, 10_000];

/** Los códigos que se vuelven a intentar. El resto son respuestas firmes. */
export function esReintentable(status: number): boolean {
  return status === 429 || status >= 500;
}

/**
 * `fetch` que aguanta un proveedor con hipo.
 *
 * Devuelve la última respuesta, reintentable o no: quien llama decide qué
 * hacer con ella, como con un `fetch` normal. Los fallos de RED sí se
 * propagan al agotar los intentos, porque ahí no hay respuesta que devolver.
 */
export async function fetchModelo(
  url: string,
  init: RequestInit,
  dormir: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<Response> {
  let ultimoFallo: unknown;

  for (let intento = 0; intento <= ESPERAS.length; intento++) {
    if (intento > 0) {
      const espera = ESPERAS[intento - 1]!;
      console.warn(`[modelo] reintento ${intento} de ${ESPERAS.length} dentro de ${espera} ms`);
      await dormir(espera);
    }
    try {
      const res = await fetch(url, init);
      if (!esReintentable(res.status) || intento === ESPERAS.length) return res;
      console.warn(`[modelo] el proveedor respondió ${res.status}`);
    } catch (err) {
      // Un corte de red o el timeout del AbortSignal. Se reintenta igual: son
      // tan pasajeros como un 503, y con el pago bloqueado no rendirse al
      // primer tropiezo es lo que separa entregar de no entregar.
      ultimoFallo = err;
      if (intento === ESPERAS.length) throw err;
      console.warn(`[modelo] la llamada falló: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  throw ultimoFallo ?? new Error('inalcanzable');
}
