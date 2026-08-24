/**
 * Panal — el idioma de la app.
 *
 * POR QUÉ NO SE USA EL i18n DE LA WEB
 *
 * La web tiene `src/i18n` montado con i18next y diez idiomas, y no sirve aquí:
 * lo que hay dentro son SUS textos. La app no comparte ni una frase con el
 * sitio —es otra aplicación, con otras pantallas y otra manera de hablar—, así
 * que importarlo traería mil cien claves que no se usan y ni una que sí.
 *
 * POR QUÉ NO SE INSTALA i18next AQUÍ
 *
 * Porque lo que hace falta cabe en este archivo. i18next resuelve detección,
 * espacios de nombres, carga por red, plurales de veinte familias de idiomas y
 * formato ICU; de todo eso la app usa cero. A cambio pesa más que esto entero
 * en un paquete que ya va por 860 kB.
 *
 * NO HAY CLAVES DE TEXTO, HAY UN OBJETO
 *
 * `T.saldo.titulo` en vez de `t('saldo.titulo')`. Parece un detalle y es la
 * decisión que más sujeta esto: una clave escrita a mano se equivoca en
 * silencio y sale una pantalla con «saldo.titulo» puesto; un campo no existe
 * o el typecheck para el build. Y como cada idioma se declara `: Textos`, al
 * traductor —humano o no— le falta una frase y no compila, en vez de quedar un
 * hueco que se descubre en el teléfono de otro.
 */

import { useSyncExternalStore } from 'react';
import { es } from '~/i18n/es';
import { en } from '~/i18n/en';
import { pt } from '~/i18n/pt';
import { zh } from '~/i18n/zh';
import type { Textos } from '~/i18n/es';

export type { Textos };

export const IDIOMAS = [
  { codigo: 'es', nombre: 'Español' },
  { codigo: 'en', nombre: 'English' },
  { codigo: 'pt', nombre: 'Português' },
  { codigo: 'zh', nombre: '中文' },
] as const;

/**
 * La etiqueta que entiende `toLocaleDateString`.
 *
 * Va aquí y no dentro de cada tabla de textos porque no es texto: es cómo
 * escribe las fechas el sistema. Sin esto, una app en chino seguiría diciendo
 * «24 ago 2026», que es la fecha correcta escrita en el idioma equivocado.
 */
const ETIQUETA: Record<Idioma, string> = {
  es: 'es-ES',
  en: 'en-GB',
  pt: 'pt-PT',
  zh: 'zh-CN',
};

/** Para `toLocaleDateString` y compañía, dentro y fuera de React. */
export function etiquetaIdioma(): string {
  return ETIQUETA[actual];
}

export type Idioma = (typeof IDIOMAS)[number]['codigo'];

const TABLA: Record<Idioma, Textos> = { es, en, pt, zh };
const CLAVE = 'panal:idioma:v1';

function esIdioma(v: string | null): v is Idioma {
  return !!v && IDIOMAS.some((i) => i.codigo === v);
}

/**
 * El idioma del teléfono, la primera vez.
 *
 * `navigator.language` da cosas como `pt-BR` o `zh-Hans-CN`, así que se mira
 * solo la parte de delante. Si no es ninguno de los cuatro, español: la app se
 * escribió en español y es el idioma en el que está completa.
 */
function delTelefono(): Idioma {
  const raiz = (globalThis.navigator?.language ?? '').slice(0, 2).toLowerCase();
  return esIdioma(raiz) ? raiz : 'es';
}

let actual: Idioma = (() => {
  try {
    const guardado = localStorage.getItem(CLAVE);
    return esIdioma(guardado) ? guardado : delTelefono();
  } catch {
    return 'es';
  }
})();

/**
 * El `lang` del documento, desde el primer pintado.
 *
 * Se ponía solo dentro de `cambiarIdioma`, así que al abrir la app con un
 * idioma ya guardado el documento seguía diciendo `lang="es"` — lo encontró el
 * recorrido en el navegador, no el typecheck. Y no es cosmético: de ahí salen
 * el guionado, las comillas tipográficas y lo que lee en voz alta un lector de
 * pantalla.
 */
if (typeof document !== 'undefined') document.documentElement.lang = actual;

const oyentes = new Set<() => void>();

/** Estable a propósito: `useSyncExternalStore` la compara por identidad. */
function suscribir(f: () => void): () => void {
  oyentes.add(f);
  return () => {
    oyentes.delete(f);
  };
}

const leer = (): Idioma => actual;

export function idioma(): Idioma {
  return actual;
}

export function cambiarIdioma(nuevo: Idioma): void {
  if (nuevo === actual) return;
  actual = nuevo;
  try {
    localStorage.setItem(CLAVE, nuevo);
  } catch {
    /* sin disco dura lo que dure la sesión */
  }
  // El atributo `lang` del documento no es adorno: de él dependen el guionado,
  // las comillas tipográficas y cómo lee la pantalla un lector de voz.
  if (typeof document !== 'undefined') document.documentElement.lang = nuevo;
  for (const f of oyentes) f();
}

export function useIdioma(): Idioma {
  return useSyncExternalStore(suscribir, leer, leer);
}

/** Los textos, dentro de React. Cambian de idioma solos. */
export function useTextos(): Textos {
  return TABLA[useIdioma()];
}

/**
 * Los textos fuera de React: avisos del teléfono, el HTML de una copia, el
 * recibo. Todo eso se genera sin componente delante y también se lee.
 */
export function textos(): Textos {
  return TABLA[actual];
}
