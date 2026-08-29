/**
 * Panal — la ficha de este agente en el idioma de quien la lee.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTÁ AQUÍ TAMBIÉN
 *
 * Esto ya existe en `create-agent/template/src/traduccion.ts` y de allí lo
 * heredan los agentes generados. Pero LexPanal no sale de la plantilla: es
 * este paquete, con su propio ciclo y sin más dependencias que viem y dotenv.
 * Sin una copia, el agente con más encargos de mainnet sería el único que
 * enseña su descripción en un solo idioma, y el catálogo lo trataría como a
 * uno de plantilla vieja.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * EL FORMATO Y LAS REGLAS LOS MANDA LA PLANTILLA. Si allí cambia el campo
 * `lang` o la forma del JSON que se le pide al modelo, cambia aquí. Es la
 * misma disciplina que `marca.ts` y `niveles.ts`.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * NADIE ESPERA A QUE SE TRADUZCA
 *
 * La traducción NO ocurre dentro de la petición. Si el idioma ya está guardado
 * se sirve; si no, se sirve la ficha original y la traducción se lanza por
 * detrás, para la próxima vez. Medido en producción: traduciendo en el momento
 * la primera petición de cada idioma tardaba veinte segundos y AUN ASÍ devolvía
 * el original, porque el modelo tarda más que cualquier tope razonable.
 *
 * Y quien pide la ficha tiene que poder distinguir una cosa de la otra, así que
 * la respuesta lleva `lang` SOLO cuando se ha traducido de verdad. Sin eso, un
 * 200 con el texto original es indistinguible de una traducción: el indexador
 * guardó el inglés como si fueran los diez idiomas y, al llegarle diez, dio el
 * trabajo por hecho y no volvió a por él.
 * ───────────────────────────────────────────────────────────────────────────
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BotConfig } from './config.js';
import { chatWithSystem } from './llm.js';

/** Los idiomas del marketplace. La lista la manda `sdk/src/idiomas.ts`. */
export const IDIOMAS = ['ar', 'bn', 'en', 'es', 'fr', 'hi', 'pt', 'ru', 'ur', 'zh'] as const;

export type Idioma = (typeof IDIOMAS)[number];

/** Cómo se llama cada idioma EN ese idioma: un modelo lo entiende mejor que `fr`. */
const NOMBRE: Record<Idioma, string> = {
  ar: 'العربية (Arabic)',
  bn: 'বাংলা (Bengali)',
  en: 'English',
  es: 'español (Spanish)',
  fr: 'français (French)',
  hi: 'हिन्दी (Hindi)',
  pt: 'português (Portuguese)',
  ru: 'русский (Russian)',
  ur: 'اردو (Urdu)',
  zh: '中文 (Chinese, simplified)',
};

/**
 * `'fr-CA'` → `'fr'`, `'klingon'` → `null`.
 *
 * El navegador dice `es-419` y `zh-Hans`. Quedarse con la primera parte es lo
 * que hace que un mexicano y un argentino vean lo mismo en vez de caer los dos
 * al idioma original.
 */
export function normalizarIdioma(v: unknown): Idioma | null {
  if (typeof v !== 'string') return null;
  const base = v.trim().toLowerCase().split(/[-_]/)[0];
  return (IDIOMAS as readonly string[]).includes(base ?? '') ? (base as Idioma) : null;
}

/** Lo que se traduce. El NOMBRE del agente no: «LexPanal» no significa nada en francés. */
export interface Frases {
  description: string;
  tiers: { name: string; description: string }[];
}

const MAX_FRASE = 400;
/** Ancho: ya no corre dentro de una petición, nadie mira una pantalla en blanco. */
const ESPERA_MS = 120_000;

/**
 * Lo que se está traduciendo ahora mismo.
 *
 * El indexador pide los diez seguidos y un escaparate puede pedir el mismo tres
 * veces mientras el modelo piensa. Sin esto, cada una lanzaría su llamada: diez
 * peticiones se volverían treinta, todas para escribir el mismo archivo.
 */
const enCurso = new Set<string>();

function huella(frases: Frases): string {
  return createHash('sha256').update(JSON.stringify(frases)).digest('hex').slice(0, 16);
}

function ruta(dir: string, idioma: Idioma, h: string): string {
  return join(dir, 'idiomas', `${idioma}-${h}.json`);
}

/** Lo guardado, si vale. Nunca lanza: un archivo roto es como si no estuviera. */
function leerGuardado(dir: string, idioma: Idioma, h: string): Frases | null {
  try {
    const p = ruta(dir, idioma, h);
    if (!existsSync(p)) return null;
    return validar(JSON.parse(readFileSync(p, 'utf8')), null);
  } catch {
    return null;
  }
}

function guardar(dir: string, idioma: Idioma, h: string, frases: Frases): void {
  try {
    mkdirSync(join(dir, 'idiomas'), { recursive: true });
    writeFileSync(ruta(dir, idioma, h), JSON.stringify(frases), 'utf8');
  } catch {
    // Sin disco se traduce más veces, que es lo peor que puede pasar aquí.
  }
}

/**
 * Lo que devolvió el modelo, comprobado contra la forma que se le pidió.
 *
 * Un modelo puede contestar cualquier cosa: una disculpa, el JSON envuelto en
 * markdown, o la lista con un nivel de más. Lo que no cuadre se descarta ENTERO
 * y se sirve el original: media traducción en una tarjeta es peor que ninguna,
 * porque parece que al agente le falta la mitad de la ficha.
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
 * Las frases en otro idioma si ya están hechas, y si no `null` — encargándolas.
 *
 * `null` significa «sirve el original y NO pongas `lang`». Quien llama no debe
 * esperar: ver `ESPERA_MS` y el comentario de arriba.
 */
export function traducirFrases(
  frases: Frases,
  idioma: Idioma,
  cfg: BotConfig,
  dir: string,
): Frases | null {
  if (!frases.description.trim() && frases.tiers.length === 0) return null;

  const h = huella(frases);
  const guardado = leerGuardado(dir, idioma, h);
  if (guardado) return guardado;
  if (!cfg.llm.apiKey) return null;

  void encargar(frases, idioma, cfg, dir, h);
  return null;
}

/** La llamada al modelo, fuera de la petición. No lanza nunca. */
async function encargar(
  frases: Frases,
  idioma: Idioma,
  cfg: BotConfig,
  dir: string,
  h: string,
): Promise<void> {
  const clave = `${idioma}-${h}`;
  if (enCurso.has(clave)) return;
  enCurso.add(clave);
  try {
    const crudo = await chatWithSystem(
      { ...cfg, llm: { ...cfg.llm, timeoutMs: ESPERA_MS, maxRetries: 0 } },
      SISTEMA,
      `Translate the values of this JSON into ${NOMBRE[idioma]}.\n` +
        'Keep the keys in English and the array in the same order.\n\n' +
        JSON.stringify(frases),
    );
    const traducido = validar(comoJson(crudo), frases);
    if (traducido) guardar(dir, idioma, h, traducido);
  } catch {
    // Sin clave, sin cuota, sin red o con el modelo caído: no se guarda nada, y
    // se reintenta la próxima vez que alguien pida este idioma.
  } finally {
    enCurso.delete(clave);
  }
}
