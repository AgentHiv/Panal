/**
 * Panal — endpoint HTTP del bot de un agente (entrega privada de resultados).
 *
 * El operador del agente publica la URL pública de su bot en el metadataURI
 * on-chain del registry, como un token separado por '·' que empieza por
 * 'bot:'. Ejemplo:
 *
 *   LexPanal · Resumes legal documents EN⇄ES · summaries, legal · bot:https://bot.tudominio.com
 *
 * El bot (bot/src/http.ts) expone `GET /result/:taskId?address&signature` y
 * solo sirve el resultado si la firma EIP-191 de RESULT_SIGN_PREFIX+taskId
 * corresponde al cliente de la tarea.
 */

/**
 * Cuánto vale una firma de descarga. Corto a propósito.
 *
 * La firma abre el resultado y todos los archivos de la tarea: es un pase de
 * acceso. Si se filtra —y se filtraba, por la query string, al log del proxy—
 * lo que limita el daño es que caduque.
 */
export const VENTANA_FIRMA_S = 10 * 60;

/**
 * Mensaje exacto que firma el cliente. Debe coincidir con el del agente.
 *
 * Lleva la caducidad DENTRO: cambiarla invalida la firma, así que el agente
 * puede fiarse del número que le llega al lado.
 */
export function resultSignMessage(taskId: bigint, expira: number): string {
  return `Panal resultado #${taskId.toString()} · ${expira}`;
}

/** El segundo en el que caducará una firma que se emita ahora. */
export function expiraEn(ventanaS: number = VENTANA_FIRMA_S): number {
  return Math.floor(Date.now() / 1000) + ventanaS;
}

/**
 * Mensaje que firma el cliente para ENVIAR el brief al bot (POST /brief).
 * Análogo al de /result; incluye el taskId para evitar replay entre tareas.
 * Debe coincidir con briefSignMessage() de bot/src/http.ts.
 */
export function briefSignMessage(taskId: bigint): string {
  return `Panal brief #${taskId.toString()}`;
}

/**
 * Extrae la URL del bot del metadataURI. Devuelve null si no hay token
 * 'bot:' o si la URL no es http(s) absoluta.
 */
export function extractBotUrl(metadataURI: string | null | undefined): string | null {
  if (!metadataURI) return null;
  for (const token of metadataURI.split('·')) {
    const trimmed = token.trim();
    if (trimmed.toLowerCase().startsWith('bot:')) {
      const url = trimmed.slice(4).trim();
      return /^https?:\/\/\S+$/i.test(url) ? url : null;
    }
  }
  return null;
}

/**
 * URL de descarga del resultado. SIN credenciales.
 *
 * Antes las metía en la query, y de ahí pasaban al log de accesos del proxy
 * —23 firmas en claro en un log de producción—, al historial del navegador y a
 * cualquier intermediario. Ahora van en cabeceras, que no se registran.
 */
export function buildResultUrl(botUrl: string, taskId: bigint): string {
  return `${botUrl.replace(/\/+$/, '')}/result/${taskId.toString()}`;
}

/** Las cabeceras con las que el cliente demuestra que la tarea es suya. */
export function cabecerasFirma(address: string, signature: string, expira: number): Record<string, string> {
  return {
    'x-panal-address': address,
    'x-panal-signature': signature,
    'x-panal-expira': String(expira),
  };
}

/** Construye la URL de envío del brief firmado (POST /brief/:taskId). */
export function buildBriefUrl(botUrl: string, taskId: bigint): string {
  return `${botUrl.replace(/\/+$/, '')}/brief/${taskId.toString()}`;
}
