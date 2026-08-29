/**
 * Panal — tu ficha en el idioma de quien la lee.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * QUÉ ARREGLA
 *
 * El marketplace habla diez idiomas; tu ficha, uno. Tu descripción y los
 * nombres de tus niveles son texto que escribiste tú, y salen igual en las
 * diez versiones del escaparate: quien entra en árabe ve toda la interfaz en
 * árabe y tu agente descrito en español, o peor, la descripción en inglés y
 * los niveles en español, que es lo que pasa hoy en mainnet.
 *
 * Aquí `GET /agent.json?lang=fr` devuelve tu MISMA ficha con las frases en
 * francés. Nadie tiene que aprender un formato nuevo: los lectores siguen
 * mirando `description` y `tiers[].name`, solo que traducidos.
 *
 * QUÉ CUESTA, QUE ES LA PREGUNTA DE VERDAD
 *
 * Una llamada a tu modelo por idioma, UNA VEZ. El resultado se guarda en disco
 * con la huella del texto original dentro del nombre, así que:
 *
 *   - la segunda petición en francés no llama a nadie;
 *   - y si cambias tu descripción, la huella cambia y se vuelve a traducir
 *     sola, sin que tengas que acordarte de borrar nada.
 *
 * Diez idiomas son diez llamadas en toda la vida de una descripción. Traducir
 * cuatro frases es la llamada más barata que va a hacer tu agente.
 *
 * NADIE ESPERA A QUE TRADUZCA
 *
 * La ficha se sirve SIEMPRE al momento. Si el idioma ya está guardado va
 * traducida; si no, va original y la traducción se pide POR DETRÁS, para la
 * próxima vez que alguien pregunte por ese idioma.
 *
 * Traducir dentro de la petición obliga a no reintentar, porque nadie va a
 * esperar a un modelo con la tarjeta en blanco. Y sin reintentos un
 * `429 Too Many Requests` —que en una cuenta compartida por cuatro agentes es
 * lo normal, no la excepción— significa «esta ficha no se traduce»; como no se
 * guarda nada, el siguiente que pregunte se come otro 429 y el idioma no llega
 * a traducirse NUNCA. Comprobado contra los agentes de mainnet: la misma
 * petición que falla con cero reintentos entra en cuanto se la deja insistir.
 *
 * Fuera de la petición sí se puede insistir, porque no hay nadie mirando.
 *
 * CUANDO FALLA NO SE NOTA
 *
 * Si el modelo no contesta, se acabó la cuota o no hay `LLM_API_KEY`, se sirve
 * la ficha ORIGINAL. Una traducción es una mejora, no un requisito: quedarse
 * sin ficha por no poder traducirla sería dejar al agente fuera del mercado
 * por un lujo.
 *
 * Y NO SE TRADUCE TU NOMBRE. «LexPanal» no significa nada en francés, y
 * traducirlo sería inventarle otro nombre a tu agente y romper toda referencia
 * escrita a él.
 * ───────────────────────────────────────────────────────────────────────────
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { llmChat, NOMBRE_IDIOMA, type Idioma, type LlmConfig } from '@panal/sdk';

/** Lo que se traduce de una ficha. Nada más: el nombre del agente no se toca. */
export interface Frases {
  description: string;
  /** Nombre y descripción de cada nivel, en el orden en que van en la ficha. */
  tiers: { name: string; description: string }[];
}

/** Tope de la respuesta que se acepta del modelo, por frase. */
const MAX_FRASE = 400;

/**
 * Cuánto se espera al modelo, y cuántas veces se insiste.
 *
 * Holgado porque esto ya NO corre dentro de la petición de la ficha: nadie está
 * mirando. Los reintentos son lo que hace que la traducción llegue; sin ellos
 * un 429 pasajero dejaba el idioma sin traducir para siempre.
 */
const ESPERA_MS = 60_000;
const REINTENTOS = 4;

/**
 * Los idiomas que se están traduciendo ahora mismo.
 *
 * El indexador pide los diez seguidos, y sin esta lista tres peticiones en
 * francés llegadas antes de que vuelva la primera lanzarían tres traducciones
 * idénticas: tres veces el gasto contra una cuenta que ya va justa de
 * peticiones por minuto, para escribir el mismo archivo.
 */
const enCurso = new Set<string>();

/** La huella del texto original: si cambia, la traducción guardada ya no vale. */
function huella(frases: Frases): string {
  return createHash('sha256').update(JSON.stringify(frases)).digest('hex').slice(0, 16);
}

function rutaCache(dir: string, idioma: Idioma, h: string): string {
  return join(dir, 'idiomas', `${idioma}-${h}.json`);
}

/** Lo guardado, si vale. Nunca lanza: un archivo roto es como si no estuviera. */
function leerGuardado(dir: string, idioma: Idioma, h: string): Frases | null {
  try {
    const ruta = rutaCache(dir, idioma, h);
    if (!existsSync(ruta)) return null;
    return validar(JSON.parse(readFileSync(ruta, 'utf8')), null);
  } catch {
    return null;
  }
}

function guardar(dir: string, idioma: Idioma, h: string, frases: Frases): void {
  try {
    mkdirSync(join(dir, 'idiomas'), { recursive: true });
    writeFileSync(rutaCache(dir, idioma, h), JSON.stringify(frases), 'utf8');
  } catch {
    // Sin disco se traduce más veces, que es lo peor que puede pasar aquí.
  }
}

/**
 * Lo que devolvió el modelo, comprobado contra la forma que se le pidió.
 *
 * Un modelo puede contestar cualquier cosa: una disculpa, el JSON envuelto en
 * markdown, o la lista con un nivel de más. Lo que no cuadre se descarta
 * ENTERO y se sirve el original, porque media traducción en una tarjeta es
 * peor que ninguna: parece que al agente le falta la mitad de la ficha.
 *
 * `original` sirve para exigir el mismo número de niveles. Con `null` solo se
 * comprueba la forma, que es lo que hace falta al leer del disco.
 */
function validar(v: unknown, original: Frases | null): Frases | null {
  if (!v || typeof v !== 'object') return null;
  const { description, tiers } = v as Record<string, unknown>;
  if (typeof description !== 'string' || !description.trim()) return null;
  if (!Array.isArray(tiers)) return null;
  if (original && tiers.length !== original.tiers.length) return null;

  const salida: Frases['tiers'] = [];
  for (const t of tiers) {
    if (!t || typeof t !== 'object') return null;
    const { name, description: d } = t as Record<string, unknown>;
    if (typeof name !== 'string' || typeof d !== 'string') return null;
    salida.push({ name: name.trim().slice(0, MAX_FRASE), description: d.trim().slice(0, MAX_FRASE) });
  }
  return { description: description.trim().slice(0, MAX_FRASE), tiers: salida };
}

/** El JSON que venga, aunque llegue envuelto en un bloque de markdown. */
function comoJson(crudo: string): unknown {
  const limpio = crudo.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '');
  try {
    return JSON.parse(limpio);
  } catch {
    // A veces el modelo escribe una frase antes del JSON. Se busca el objeto.
    const i = limpio.indexOf('{');
    const j = limpio.lastIndexOf('}');
    if (i < 0 || j <= i) return null;
    try {
      return JSON.parse(limpio.slice(i, j + 1));
    } catch {
      return null;
    }
  }
}

const SISTEMA =
  'You translate short marketplace copy. Reply with JSON only, no explanation, ' +
  'no markdown fence. Keep the exact same JSON shape and the same number of ' +
  'array items you are given. Translate the meaning, not word by word: these ' +
  'are product labels that people choose from, so they must read naturally and ' +
  'stay short. Do not translate brand names, product names or code identifiers.';

/**
 * Las frases ya traducidas, si están guardadas. NO llama a nadie.
 *
 * Esta es la que usa la ficha, y por eso es síncrona: contesta en microsegundos
 * y no puede hacer esperar a quien pide `/agent.json`.
 */
export function frasesGuardadas(frases: Frases, idioma: Idioma, dir: string): Frases | null {
  return leerGuardado(dir, idioma, huella(frases));
}

/**
 * Pide la traducción POR DETRÁS, para la próxima vez.
 *
 * No devuelve nada y no se espera: quien la llama ya ha servido la ficha
 * original. Si sale bien queda guardada y la siguiente petición en ese idioma
 * la encuentra hecha; si sale mal no se entera nadie y se reintentará.
 */
export function pedirTraduccion(
  frases: Frases,
  idioma: Idioma,
  llm: LlmConfig | null,
  dir: string,
): void {
  if (!llm) return;
  if (!frases.description.trim() && frases.tiers.length === 0) return;
  const clave = `${idioma}-${huella(frases)}`;
  if (enCurso.has(clave) || frasesGuardadas(frases, idioma, dir)) return;
  enCurso.add(clave);
  void traducirFrases(frases, idioma, llm, dir).finally(() => enCurso.delete(clave));
}

/**
 * Las frases de la ficha en otro idioma, esperando al modelo.
 *
 * Devuelve `null` cuando no se ha podido traducir. La ficha NO la llama
 * directamente —usa el par de arriba—; esta existe para las pruebas y para
 * traducir a mano, donde sí se quiere el resultado.
 */
export async function traducirFrases(
  frases: Frases,
  idioma: Idioma,
  llm: LlmConfig | null,
  dir: string,
): Promise<Frases | null> {
  // Sin nada que traducir no se molesta a nadie.
  if (!frases.description.trim() && frases.tiers.length === 0) return null;

  const h = huella(frases);
  const guardado = leerGuardado(dir, idioma, h);
  if (guardado) return guardado;
  if (!llm) return null;

  try {
    const crudo = await llmChat(
      { ...llm, timeoutMs: ESPERA_MS, maxRetries: REINTENTOS },
      {
        system: SISTEMA,
        user:
          `Translate the values of this JSON into ${NOMBRE_IDIOMA[idioma]}.\n` +
          'Keep the keys in English and the array in the same order.\n\n' +
          JSON.stringify(frases),
      },
    );
    const traducido = validar(comoJson(crudo), frases);
    if (!traducido) return null;
    guardar(dir, idioma, h, traducido);
    return traducido;
  } catch {
    // Sin clave, sin cuota, sin red o con el modelo caído: la ficha original.
    return null;
  }
}
