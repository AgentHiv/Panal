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
 * Cuánto se espera. Corto a propósito: esto corre DENTRO de una petición de la
 * ficha, y una tarjeta que tarda medio minuto en pintar es una tarjeta rota.
 * Lo que no llegue a tiempo sale sin traducir y se traducirá en la siguiente.
 */
const ESPERA_MS = 20_000;

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
 * Las frases de la ficha en otro idioma.
 *
 * Devuelve `null` cuando no se ha podido traducir, y quien llama sirve el
 * original: no traducir NUNCA puede ser un error para el que pide la ficha.
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
      { ...llm, timeoutMs: ESPERA_MS, maxRetries: 0 },
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
