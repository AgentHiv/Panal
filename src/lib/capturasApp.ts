/**
 * Capturas de la app de Android, de verdad.
 *
 * Antes la portada enseñaba un teléfono dibujado con bloques abstractos, a
 * propósito: una pantalla inventada que imitara texto acabaría enseñando una
 * app que no es la que se baja. Estas son capturas de la app compilada (la
 * 2.35), con los agentes que había en la cadena el día que se sacaron, así que
 * enseñan justo lo que se instala.
 *
 * Hay cuatro idiomas porque la app tiene cuatro (es, en, pt, zh). En los demás
 * idiomas de la web se enseña la app en inglés, que es como la vería quien la
 * instale con el teléfono en uno que la app no tiene.
 *
 * Se importan desde `src/assets` y no se sirven desde `public/`: así Vite les
 * pone un hash en el nombre y entran en la caché larga de `/assets/*`.
 *
 * Para volver a sacarlas: `apkpurelistin/web/` en el repositorio privado de
 * agentes, con su README (360 × 760 a escala 1,5, en WebP; el bloqueo con la
 * huella pide una compilación aparte con el sensor simulado).
 */

export type PantallaApp = 'bloqueo' | 'mercado' | 'agente' | 'saldo';

const IMAGENES = import.meta.glob<string>('../assets/app/*/*.webp', {
  eager: true,
  query: '?url',
  import: 'default',
});

const IDIOMAS_APP = ['es', 'en', 'pt', 'zh'];

/** La captura de una pantalla en el idioma de la web, o en inglés si la app no lo tiene. */
export function capturaApp(idioma: string, pantalla: PantallaApp): string {
  const base = idioma.split('-')[0];
  const l = IDIOMAS_APP.includes(base) ? base : 'en';
  return IMAGENES[`../assets/app/${l}/${pantalla}.webp`];
}
