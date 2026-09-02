/**
 * panal-mcp — recogida del resultado desde el endpoint del agente.
 *
 * El resultado NO viaja on-chain: en la cadena solo queda su keccak256. El
 * texto se le pide al endpoint que el agente publica en su metadata, firmando
 * como cliente con EIP-191 (sin gas), y se comprueba que el hash de lo que
 * llega coincide con el anclado. Si no coincide, el agente entregó una cosa y
 * te está enseñando otra.
 *
 * La URL sale del metadata on-chain, o sea que la escribe un desconocido: se
 * valida antes de pedirle nada, y la respuesta se lee con un tope de tamaño.
 */

// El guard de SSRF viene del SDK, no de una copia local. Había dos
// implementaciones equivalentes de lo mismo —la del SDK y una aquí—, y dos
// copias de un control de seguridad son una que se queda atrás sin que nadie
// se entere el día que la otra mejora.
import { assertPublicUrl, leerMaxBriefChars, leerNiveles, rutaDeAgente } from '@panal/sdk';
import type { Nivel } from '@panal/sdk';

/** Tope de la respuesta. Sin esto, un endpoint hostil tumba el proceso. */
const MAX_BYTES = 512 * 1024;
const TIMEOUT_MS = 20_000;

/** Cuánto vale una firma de descarga: abre toda la entrega, así que poco. */
export const VENTANA_FIRMA_S = 10 * 60;

/**
 * El mensaje que firma el cliente. Debe coincidir con el bot y el frontend.
 *
 * Lleva la caducidad dentro: cambiarla invalida la firma. Antes no caducaba, y
 * como además viajaba en la query acababa en el log del proxy — un pase de
 * acceso permanente escrito en un archivo de texto.
 */
export function resultSignMessage(taskId: bigint, expira: number): string {
  return `Panal resultado #${taskId.toString()} · ${expira}`;
}

/** El segundo en el que caduca una firma emitida ahora. */
export function expiraEn(ventanaS: number = VENTANA_FIRMA_S): number {
  return Math.floor(Date.now() / 1000) + ventanaS;
}

/** El mensaje que firma el cliente para MANDAR el encargo. Mismo pacto. */
export function briefSignMessage(taskId: bigint): string {
  return `Panal brief #${taskId.toString()}`;
}

/**
 * Le entrega el encargo al agente: POST /brief/<taskId>, firmado.
 *
 * Existe porque contratar sin esto deja la tarea a medias. On-chain solo queda
 * el hash del encargo; el texto tiene que llegarle al agente por su endpoint o
 * el agente se queda mirando una tarea pagada sin saber qué se le pide. Antes
 * el MCP contrataba y le decía al usuario "ahora hazle llegar el texto tú",
 * que en una conversación con un modelo no lo hace nadie.
 *
 * Devuelve null si fue bien, o el motivo si no. No lanza: cuando esto falla el
 * pago YA está bloqueado, así que lo útil es contarlo, no romper.
 */
export async function pushBrief(
  botUrl: string,
  taskId: bigint,
  brief: string,
  client: string,
  signature: string,
): Promise<string | null> {
  let url: URL;
  try {
    const base = await assertPublicUrl(botUrl);
    url = new URL(rutaDeAgente(base.toString(), `brief/${taskId}`));
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ brief, address: client, signature }),
      signal: controller.signal,
      redirect: 'error',
    });
    if (res.ok) return null;
    // El cuerpo del error dice cuál de las comprobaciones del agente falló
    // —firma, estado, o que el texto no cuadra con el hash—, y eso es
    // exactamente lo que hay que enseñar para poder arreglarlo.
    const detalle = (await res.text().catch(() => '')).slice(0, 300);
    return `the agent replied ${res.status}${detalle ? `: ${detalle}` : ''}`;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return `the endpoint did not answer within ${TIMEOUT_MS / 1000} s`;
    }
    return err instanceof Error ? err.message : String(err);
  } finally {
    clearTimeout(timer);
  }
}



/**
 * Los límites que el agente publica en su tarjeta (GET /agent.json).
 *
 * Existe para no descubrir un límite pagando. El encargo se entrega DESPUÉS de
 * crear la tarea en la cadena —la firma va atada al taskId, que hasta entonces
 * no existe—, así que un brief que el agente rechaza deja el pago bloqueado por
 * una tarea que no puede empezar. Preguntando antes, eso se convierte en un
 * presupuesto que no se emite y no cuesta nada.
 *
 * `maxBriefChars: null` significa NO LO SÉ, y no «no hay límite». Sigue
 * pasando: los agentes desplegados antes de que la plantilla lo publicara no
 * declaran ninguno. Quien llame tiene que poder distinguir las dos cosas,
 * porque tratar «no lo sé» como «no hay tope» es volver a averiguarlo pagando.
 *
 * La lectura vive en `@panal/sdk` para que haya UNA sola definición de qué es
 * una ficha válida. Se reexporta con el nombre de aquí porque el servidor MCP
 * ya lo usaba así.
 */
export const parseMaxBriefChars = leerMaxBriefChars;

export interface LimitesDelAgente {
  /**
   * Si contestó ALGO, aunque fuera un error.
   *
   * Un 404 en `/agent.json` cuenta como alcanzable: hay agentes que no sirven
   * tarjeta y su `POST /brief` funciona igual. Lo que descalifica es que no
   * conteste nadie —DNS que no resuelve, conexión rechazada, timeout— o que la
   * URL no pase el guard, porque entonces el encargo tampoco va a llegar.
   *
   * `null` = no se preguntó (el agente no publica endpoint, que es un modo
   * soportado: el encargo se le hace llegar por otro canal).
   */
  alcanzable: boolean | null;
  maxBriefChars: number | null;
  /**
   * Los niveles que la ficha declara, si declara alguno.
   *
   * Salen de la MISMA lectura que el tope del brief: preguntar dos veces por
   * `agent.json` para sacar dos campos del mismo JSON es una petición de más a
   * un servidor ajeno cada vez que alguien pide precio.
   *
   * De aquí sale solo el TEXTO. El precio que se bloquea es el de la cadena
   * —ver `nivelesDeAgente` en server.ts—, porque es el único que sigue ahí con
   * el agente caído y el único que nadie puede cambiar entre mirar y pagar.
   */
  niveles: Nivel[];
}

export async function fetchAgentLimits(botUrl: string): Promise<LimitesDelAgente> {
  let url: URL;
  try {
    const base = await assertPublicUrl(botUrl);
    url = new URL(rutaDeAgente(base.toString(), 'agent.json'));
  } catch {
    // El guard rechaza la URL: a esa dirección no se le puede entregar nada, ni
    // ahora ni al contratar. Es inalcanzable, no «no lo sé».
    return { alcanzable: false, maxBriefChars: null, niveles: [] };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: 'error' });
    // A partir de aquí YA contestó, y eso no se revoca: una tarjeta ilegible o
    // un 500 dejan el tope sin saber, pero el agente sigue siendo contratable.
    // Meter el parseo en el catch de la red convertiría un JSON roto en «este
    // agente no existe», que es una acusación distinta y falsa.
    if (!res.ok) return { alcanzable: true, maxBriefChars: null, niveles: [] };
    try {
      const card = await res.json();
      return { alcanzable: true, maxBriefChars: parseMaxBriefChars(card), niveles: leerNiveles(card) };
    } catch {
      return { alcanzable: true, maxBriefChars: null, niveles: [] };
    }
  } catch {
    return { alcanzable: false, maxBriefChars: null, niveles: [] };
  } finally {
    clearTimeout(timer);
  }
}

/** Descarga acotada: se corta en cuanto se pasa del tope. */
export async function fetchResultText(
  botUrl: string,
  taskId: bigint,
  client: string,
  signature: string,
  expira: number,
): Promise<string> {
  const base = await assertPublicUrl(botUrl);
  const url = new URL(rutaDeAgente(base.toString(), `result/${taskId}`));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    // En cabeceras, no en la query: por ahí acababan en el log del proxy.
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        accept: 'application/json',
        'x-panal-address': client,
        'x-panal-signature': signature,
        'x-panal-expira': String(expira),
      },
    });
    if (!res.ok) {
      throw new Error(`The agent endpoint replied ${res.status}. Is it still up, and is the signature the client's?`);
    }
    const reader = res.body?.getReader();
    if (!reader) throw new Error('The agent endpoint replied with no body.');

    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BYTES) {
        await reader.cancel();
        throw new Error(`The result exceeds ${MAX_BYTES / 1024} KB: cut off for safety.`);
      }
      chunks.push(value);
    }
    const body = Buffer.concat(chunks).toString('utf8');
    const parsed = JSON.parse(body) as { resultText?: string };
    if (typeof parsed.resultText !== 'string') throw new Error('The agent response has no `resultText`.');
    return parsed.resultText;
  } finally {
    clearTimeout(timer);
  }
}
