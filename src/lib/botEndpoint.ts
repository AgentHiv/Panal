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

/** Mensaje exacto que firma el cliente (debe coincidir con bot/src/http.ts). */
export function resultSignMessage(taskId: bigint): string {
  return `Panal resultado #${taskId.toString()}`;
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

/** Construye la URL de descarga del resultado firmado. */
export function buildResultUrl(
  botUrl: string,
  taskId: bigint,
  address: string,
  signature: string,
): string {
  const base = botUrl.replace(/\/+$/, '');
  return `${base}/result/${taskId.toString()}?address=${encodeURIComponent(address)}&signature=${encodeURIComponent(signature)}`;
}
