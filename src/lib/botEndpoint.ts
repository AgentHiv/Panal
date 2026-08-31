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

import { fichaEnIdioma, leerNiveles } from '@panal/sdk';
import type { Nivel } from '@panal/sdk';

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
 * El buzón de Panal: la dirección que usa quien no tiene servidor propio.
 *
 * Es un endpoint como cualquier otro —habla el mismo protocolo, ver
 * `bot/src/buzon.ts`—, así que un agente que lo escribe en su ficha se
 * contrata igual que los demás y nada de esta capa lo trata distinto. Lo que
 * cambia es quién contesta al otro lado: una persona desde su panel, en vez de
 * un programa desde su máquina.
 */
export const BUZON_BASE = 'https://api.panal.lat/buzon';

/** La URL de buzón de una dirección. Es lo que se escribe en `bot:<url>`. */
export function urlDeBuzon(address: string): string {
  return `${BUZON_BASE}/${address}`;
}

/** ¿Este endpoint es el buzón de Panal, y no una máquina de su dueño? */
export function esBuzon(botUrl: string | null | undefined): boolean {
  return !!botUrl && botUrl.replace(/\/+$/, '').toLowerCase().startsWith(BUZON_BASE.toLowerCase());
}

/**
 * Por dónde le llega el trabajo a un agente.
 *
 * - `publicado`: hay un `bot:<url>` en su ficha on-chain.
 * - `ninguno`: la ficha se ha leído entera y no lo lleva. Ese agente no puede
 *   recibir el encargo —el brief no viaja on-chain, se le manda a esa URL— ni
 *   servir lo que entregue. Contratarlo es bloquear un pago a cambio de nada.
 * - `desconocido`: no se ha podido mirar. NO se avisa: acusar sin haber leído
 *   la ficha sale más caro que callarse.
 */
export type Canal = 'publicado' | 'ninguno' | 'desconocido';

/**
 * La ficha on-chain → por dónde recibe. Sin ficha, no se sabe.
 *
 * `undefined` no es «no tiene»: es que quien la traía no la mandó. El catálogo
 * del indexador incluye el `metadataURI` desde hace poco, y uno anterior lo
 * omite; devolver `ninguno` ahí dejaría el mercado ENTERO marcado como que no
 * recibe encargos por tener el indexador viejo.
 */
export function canalDeFicha(metadataURI: string | undefined): Canal {
  if (metadataURI === undefined) return 'desconocido';
  return extractBotUrl(metadataURI) ? 'publicado' : 'ninguno';
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

/**
 * Lo que un agente dice que sabe hacer, leído de su tarjeta (`/agent.json`).
 */
export interface CapacidadesAgente {
  /** ¿Acepta archivos del cliente? Un agente anterior a la función NO. */
  adjuntos: boolean;
  /** El tope por archivo que anuncia, si lo dice. */
  maxAdjuntoBytes?: number;
  /**
   * Los niveles que vende, de menor a mayor. Vacío es lo NORMAL.
   *
   * Vacío significa que este agente no vende niveles y hay que tratarlo como
   * se le trataba siempre: un precio, un tamaño. No es una invitación a
   * fabricarle niveles multiplicando su precio, que es exactamente lo que
   * hacía la pestaña de servicios y por lo que enseñaba precios que luego no
   * se cobraban.
   */
  niveles: Nivel[];
}

/**
 * Pregunta al agente si acepta adjuntos, ANTES de ofrecer el clip.
 *
 * Sin esto el fallo es caro y además invisible. Un agente con la plantilla
 * anterior no tiene la ruta `/upload`, pero sí acepta el encargo: el
 * manifiesto va DENTRO del brief, así que `keccak256(brief)` cuadra con el
 * taskHash y la comprobación pasa. El agente trata el bloque como texto más,
 * trabaja sin la foto, entrega y ancla el resultado. Para cuando la subida
 * devuelve 404 el trabajo ya está hecho y cobrado.
 *
 * Nadie ve un error: el pago salió bien, el encargo llegó, el agente entregó.
 * Sólo el resultado ignora la mitad de lo que se pidió, y la única salida es
 * una disputa.
 *
 * Falla CERRADO. Si la tarjeta no contesta —agente caído, CORS mal puesto,
 * red lenta— se asume que no acepta. Ante la duda es mejor no ofrecer algo
 * que puede acabar en un cobro por trabajo no hecho.
 */
/** Lo que se devuelve cuando la tarjeta no contesta: ni adjuntos ni niveles. */
const SIN_NADA: CapacidadesAgente = { adjuntos: false, niveles: [] };

/**
 * @param idioma El idioma de quien está mirando, para pedir la ficha traducida.
 *
 * El agente traduce SU PROPIA ficha y guarda el resultado (ver `traduccion.ts`
 * de la plantilla), así que esto no cuesta nada salvo la primera vez de cada
 * idioma. Un agente antiguo que no sepa de `?lang=` ignora el parámetro y
 * contesta lo de siempre: el texto sin traducir, que es lo que hay hoy.
 */
export async function leerCapacidades(
  botUrl: string,
  timeoutMs = 6_000,
  idioma?: string,
): Promise<CapacidadesAgente> {
  try {
    const res = await fetch(fichaEnIdioma(botUrl, idioma), {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return SIN_NADA;
    const card = (await res.json()) as {
      endpoints?: { postAttachment?: { path?: string; maxAttachmentBytes?: number } };
    };
    // Los niveles se leen aunque no acepte adjuntos: son cosas distintas y un
    // agente puede vender tamaños de encargo sin recibir un solo archivo.
    const niveles = leerNiveles(card);
    const subida = card.endpoints?.postAttachment;
    if (!subida?.path) return { adjuntos: false, niveles };
    const tope = subida.maxAttachmentBytes;
    return {
      adjuntos: true,
      ...(typeof tope === 'number' && tope > 0 ? { maxAdjuntoBytes: tope } : {}),
      niveles,
    };
  } catch {
    return SIN_NADA;
  }
}

/**
 * URL de subida de un adjunto (POST /upload/:taskId).
 *
 * Va DESPUÉS del brief, nunca antes: el agente sólo acepta bytes que su
 * encargo anuncie, y hasta tener el encargo no sabe cuáles son.
 *
 * Se firma con el MISMO `Panal brief #<id>` que abrió el encargo, y eso no es
 * un atajo: lo que decide qué entra es el manifiesto que la cadena ya cubre,
 * no la firma. Pedir una firma por archivo serían tres popups más a alguien
 * que ya pagó, y en el navegador de una wallet cada popup es una ocasión de
 * perder el encargo.
 */
export function buildUploadUrl(botUrl: string, taskId: bigint): string {
  return `${botUrl.replace(/\/+$/, '')}/upload/${taskId.toString()}`;
}

/**
 * Manda el brief reintentando mientras el agente diga «todavia no».
 *
 * POR QUE. El encargo se envia justo despues de minar `createTask`, y el
 * agente valida leyendo la tarea contra SU nodo RPC, que no es el nuestro y
 * puede ir un bloque por detras: para el, esa tarea aun no existe. Responde 425
 * (Too Early) con `reintentable: true`, y rendirse ahi deja al cliente con el
 * pago bloqueado y el encargo sin entregar, reenviandolo a mano. Paso de
 * verdad, en mainnet, con el encargo #39.
 *
 * SOLO se reintenta el 425. Un 401, un 403 o un 409 son respuestas firmes —la
 * firma no cuadra, la tarea no es suya, ya no esta abierta— y repetirlas solo
 * retrasa la misma noticia. Un fallo de red tampoco: ahi no sabemos si el POST
 * llego, y reenviar a ciegas un encargo que quiza ya entro es peor que avisar.
 *
 * Tres intentos, con 1 s y 2 s de espera. El agente ya absorbe la carrera por
 * su cuenta (reintenta su lectura ~1,5 s), asi que esto es la segunda red:
 * cubre un nodo especialmente rezagado sin que el cliente haga nada.
 */
export async function enviarBriefConReintento(
  url: string,
  init: RequestInit,
  dormir: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<Response> {
  const esperas = [1_000, 2_000];
  let res = await fetch(url, init);
  for (const espera of esperas) {
    if (res.status !== 425) return res;
    console.warn(`[panal] el agente aun no ve la tarea (425); reintento en ${espera} ms`);
    await dormir(espera);
    res = await fetch(url, init);
  }
  return res;
}
