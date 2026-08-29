/**
 * Panal — en qué idioma está mirando esto quien lo mira.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * POR QUÉ NO SE PREGUNTA A i18next
 *
 * Este archivo lo comparten la WEB y la APP. La web monta i18next con diez
 * idiomas; la app tiene su propio catálogo de cuatro, escrito a mano y sin
 * librería, porque i18next entero pesa más que el hueco que dejaba (está
 * contado en `movil/src/i18n/idiomas.ts`). O sea que la app NO tiene un
 * `I18nextProvider`, y un `useTranslation()` dentro de código compartido
 * devolvería ahí un `i18n` sin instancia: la lista de agentes reventaría al
 * pintarse, y solo en el teléfono.
 *
 * Lo que las dos SÍ comparten es el `lang` del documento. Las dos lo escriben
 * al arrancar y al cambiar de idioma —`src/i18n/index.ts` y
 * `movil/src/i18n/idiomas.ts`— porque de él dependen la separación de palabras,
 * la voz del lector de pantalla y la dirección del texto. Leer de ahí es leer
 * la misma verdad, sin atar este archivo a ninguna librería.
 * ───────────────────────────────────────────────────────────────────────────
 */

import { useSyncExternalStore } from 'react';

/** El idioma del documento ahora mismo, o `'en'` si aún no hay ninguno. */
export function idiomaDelDocumento(): string {
  if (typeof document === 'undefined') return 'en';
  return document.documentElement.lang || 'en';
}

/**
 * Avisa cuando cambia el `lang` del documento.
 *
 * Con un observador y no con un evento propio porque el cambio lo escriben dos
 * sitios distintos —uno por aplicación— y ninguno sabe del otro. El atributo es
 * el punto en el que se encuentran.
 */
function suscribir(avisar: () => void): () => void {
  if (typeof document === 'undefined') return () => undefined;
  const observador = new MutationObserver(avisar);
  observador.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
  return () => observador.disconnect();
}

/**
 * El idioma del documento, y se vuelve a pintar cuando cambia.
 *
 * Con `useSyncExternalStore` y no con un estado sincronizado desde un efecto,
 * que es lo que parecía más fácil: el idioma vive FUERA de React —lo escribe
 * i18next, o el selector de la app— y copiarlo a un estado deja un hueco entre
 * el primer render y el efecto en el que se enseña el idioma de antes. Aquí no
 * hay copia: cada render lee el atributo.
 */
export function useIdiomaDelDocumento(): string {
  // El tercer argumento es para el render en servidor, donde no hay documento.
  return useSyncExternalStore(suscribir, idiomaDelDocumento, () => 'en');
}
