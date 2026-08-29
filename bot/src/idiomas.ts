/**
 * Panal — los idiomas del marketplace, para el indexador.
 *
 * El catálogo es lo primero que ve todo el mundo, y hasta ahora salía en el
 * idioma en que cada dueño escribió su ficha: la interfaz entera en árabe y los
 * agentes descritos en español. Cada agente traduce su propia ficha —`?lang=`
 * de su `/agent.json`— y el indexador guarda el resultado para que el
 * escaparate pueda pintar una lista sin pedirle nada a nadie.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LA LISTA LA MANDA `sdk/src/idiomas.ts`, que a su vez copia la de
 * `src/i18n/locales` del marketplace. Esto es una copia porque el bot no
 * depende de aquel paquete —tiene su propio lockfile y su propio ciclo, igual
 * que pasa con `marca.ts` y con `niveles.ts`—. Si allí entra un idioma nuevo,
 * entra aquí, o el catálogo no lo tendrá traducido para nadie.
 * ─────────────────────────────────────────────────────────────────────────
 */

/** Códigos ISO 639-1, los mismos que `src/i18n/locales` del marketplace. */
export const IDIOMAS = ['ar', 'bn', 'en', 'es', 'fr', 'hi', 'pt', 'ru', 'ur', 'zh'] as const;

export type Idioma = (typeof IDIOMAS)[number];

/** La URL de la ficha de un agente en un idioma. */
export function fichaEnIdioma(botUrl: string, idioma: Idioma): string {
  return `${botUrl.replace(/\/+$/, '')}/agent.json?lang=${idioma}`;
}
