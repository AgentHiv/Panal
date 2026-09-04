import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Pone el título del documento mientras la página está montada y devuelve el
 * anterior al salir.
 *
 * Existe porque el título no es solo la pestaña: es lo que Google enseña en el
 * resultado. Esto es una SPA servida con una reescritura que manda todo a
 * `index.html`, así que una ruta que no lo cambia se presenta con el título de
 * la portada, y en el buscador aparece como si fuera la portada otra vez. Con
 * varias rutas en el sitemap, eso son varias URL diciendo lo mismo.
 *
 * @param clave clave i18n del título, traducida en los diez idiomas.
 */
export function useTituloDePagina(clave: string): void {
  const { t } = useTranslation();

  useEffect(() => {
    const previo = document.title;
    document.title = t(clave);
    return () => {
      document.title = previo;
    };
  }, [t, clave]);
}
