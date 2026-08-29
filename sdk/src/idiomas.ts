/**
 * Panal — la ficha de un agente en el idioma de quien la lee.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * EL PROBLEMA
 *
 * El marketplace habla diez idiomas. Los AGENTES no: su nombre, su descripción
 * y sus niveles son texto libre que escribió una persona en el suyo, y ese
 * texto sale igual en las diez versiones del escaparate. Hoy en mainnet hay
 * fichas que enseñan las dos cosas a la vez —la descripción en inglés y los
 * niveles en español, en la misma tarjeta—, porque una la escribió el registro
 * y los otros el código del bot.
 *
 * QUIÉN TRADUCE
 *
 * El propio agente. No hay un traductor de Panal en medio, por dos razones que
 * no son de gusto:
 *
 *   - Un servicio central que traduzca todas las fichas es un servidor que hay
 *     que pagar, mantener y del que pasa a depender el escaparate. Panal no
 *     tiene ninguno: el catálogo se puede reconstruir leyendo la cadena.
 *   - El agente YA es un modelo. Traducir cuatro frases suyas es la llamada más
 *     barata que va a hacer en su vida, y la paga quien se beneficia.
 *
 * Se pide con `?lang=`, y lo que vuelve es la MISMA ficha con los campos de
 * texto traducidos. Así ningún lector cambia: `leerNiveles`, `leerX402` y todo
 * lo demás siguen leyendo los mismos campos.
 *
 * LO QUE NO SE TRADUCE
 *
 * El nombre del agente. «LexPanal» no significa nada en francés y traducirlo
 * sería inventarle otro nombre a alguien, además de romper toda referencia
 * escrita a él. Se traduce lo que es una frase: la descripción y el nombre y la
 * descripción de cada nivel, que sí describen —«Un archivo», «El repositorio»—
 * y que hoy son lo único que un francés no puede leer.
 * ───────────────────────────────────────────────────────────────────────────
 */

/**
 * Los idiomas del marketplace, en códigos ISO 639-1.
 *
 * Es la MISMA lista que `src/i18n/locales` de la web. Si allí entra uno nuevo,
 * entra aquí, o los agentes no sabrán que se lo pueden pedir.
 */
export const IDIOMAS = ['ar', 'bn', 'en', 'es', 'fr', 'hi', 'pt', 'ru', 'ur', 'zh'] as const;

export type Idioma = (typeof IDIOMAS)[number];

/**
 * `'fr-CA'` → `'fr'`, `'klingon'` → `null`.
 *
 * El navegador dice `es-419` y `zh-Hans`, no `es` y `zh`. Quedarse con la
 * primera parte es lo que hace que un mexicano y un argentino vean lo mismo en
 * vez de caer los dos al inglés.
 */
export function normalizarIdioma(v: unknown): Idioma | null {
  if (typeof v !== 'string') return null;
  const base = v.trim().toLowerCase().split(/[-_]/)[0];
  return (IDIOMAS as readonly string[]).includes(base ?? '') ? (base as Idioma) : null;
}

/**
 * La URL de la ficha de un agente en un idioma.
 *
 * Sin idioma reconocible se pide la ficha de siempre, SIN parámetro: un agente
 * viejo que no sepa de esto contesta igual, y uno nuevo no gasta una traducción
 * en un código que no existe.
 */
export function fichaEnIdioma(botUrl: string, idioma: unknown): string {
  const base = `${botUrl.replace(/\/+$/, '')}/agent.json`;
  const lang = normalizarIdioma(idioma);
  return lang ? `${base}?lang=${lang}` : base;
}

/**
 * Cómo se llama cada idioma EN ese idioma.
 *
 * Para pedirle una traducción a un modelo, que entiende mucho mejor «français»
 * que «fr». Y de paso es la lista que enseñaría un selector, si algún día hace
 * falta uno aquí.
 */
export const NOMBRE_IDIOMA: Record<Idioma, string> = {
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
