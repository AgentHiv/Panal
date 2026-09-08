import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { IS_MAINNET } from '@/contracts/config';

/**
 * PostProcessor de red: en builds mainnet reescribe las menciones a testnet
 * en TODOS los idiomas (latin, cirílico, zh, ar, bn, ur) y el Chain ID,
 * para que la UI nunca muestre "testnet" estando en producción.
 */
const NET_REPLACEMENTS: Array<[RegExp, string]> = [
  [/testnet/gi, 'mainnet'],
  [/тестнет/g, 'мейннет'],
  [/测试网/g, '主网'],
  [/التجريبية/g, 'الرئيسية'],
  [/টেস্টনেট/g, 'মেইননেট'],
  [/ٹیسٹ نیٹ/g, 'مین نیٹ'],
  [/10143/g, '143'],
];

const netfixPostProcessor = {
  type: 'postProcessor' as const,
  name: 'netfix',
  process(value: string): string {
    if (!IS_MAINNET || typeof value !== 'string') return value;
    let out = value;
    for (const [re, rep] of NET_REPLACEMENTS) out = out.replace(re, rep);
    return out;
  },
};

/**
 * SOLO EL ESPAÑOL VIENE EN EL PAQUETE. Los otros nueve se piden a demanda.
 *
 * Los diez juntos eran 787 kB del paquete inicial —el trozo más gordo de todo
 * el sitio, por delante de viem y de react-dom— para usar uno. Cada visita se
 * descargaba las traducciones de nueve idiomas que no iba a leer.
 *
 * Este se queda estático porque es el `fallbackLng`: una clave que falte en
 * cualquier otro se resuelve contra él, así que tiene que estar siempre y
 * antes que nada.
 */
import es from './locales/es.json';

/**
 * Los demás, cada uno en su propio trozo.
 *
 * El objeto literal con las funciones es lo que hace que Vite los separe: si
 * fuera `import('./locales/' + lng + '.json')` no sabría cuáles existen y los
 * metería todos en un trozo común, que es exactamente lo que se quiere evitar.
 */
const CARGADORES: Record<string, () => Promise<{ default: object }>> = {
  en: () => import('./locales/en.json'),
  zh: () => import('./locales/zh.json'),
  hi: () => import('./locales/hi.json'),
  fr: () => import('./locales/fr.json'),
  ar: () => import('./locales/ar.json'),
  pt: () => import('./locales/pt.json'),
  ru: () => import('./locales/ru.json'),
  bn: () => import('./locales/bn.json'),
  ur: () => import('./locales/ur.json'),
};

/**
 * Trae un idioma si no está ya. Nunca lanza.
 *
 * Que falle la descarga de un idioma no puede dejar el sitio en blanco: se
 * queda en español, que es peor que leerlo en el suyo y muchísimo mejor que no
 * leer nada. Pasa de verdad, con mala cobertura.
 */
export async function cargarIdioma(lng: string): Promise<void> {
  const base = (lng || 'es').split('-')[0];
  if (base === 'es' || i18n.hasResourceBundle(base, 'translation')) return;
  const cargar = CARGADORES[base];
  if (!cargar) return;
  try {
    const mod = await cargar();
    i18n.addResourceBundle(base, 'translation', mod.default, true, true);
  } catch {
    /* sin ese idioma se sigue en español */
  }
}

export const SUPPORTED_LANGS = ['es', 'en', 'zh', 'hi', 'fr', 'ar', 'pt', 'ru', 'bn', 'ur'] as const;
export type SupportedLang = (typeof SUPPORTED_LANGS)[number];

export const RTL_LANGS: ReadonlySet<string> = new Set(['ar', 'ur']);

i18n
  .use(LanguageDetector)
  .use(netfixPostProcessor)
  .use(initReactI18next)
  .init({
    postProcess: ['netfix'],
    resources: { es: { translation: es } },
    fallbackLng: 'es',
    supportedLngs: SUPPORTED_LANGS as unknown as string[],
    nonExplicitSupportedLngs: true,
    load: 'languageOnly',
    interpolation: { escapeValue: false },
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: 'panal-lang',
      caches: ['localStorage'],
    },
  });

export function applyDocumentDir(lng: string) {
  const base = lng.split('-')[0];
  document.documentElement.lang = base;
  document.documentElement.dir = RTL_LANGS.has(base) ? 'rtl' : 'ltr';
}

applyDocumentDir(i18n.language || 'es');
i18n.on('languageChanged', applyDocumentDir);

/**
 * Cambiar de idioma: primero traerlo, luego cambiar.
 *
 * Al revés se ve un parpadeo en español mientras llega el trozo, en una acción
 * —pulsar tu idioma— cuyo único punto es no leer el mío.
 */
export async function cambiarIdioma(lng: string): Promise<void> {
  await cargarIdioma(lng);
  await i18n.changeLanguage(lng);
}

/**
 * El idioma detectado, ya cargado. `main.tsx` lo espera antes de pintar.
 *
 * Sin esperarlo, quien tiene el sitio en árabe ve la primera pantalla en
 * español y luego salta. Es una espera de un trozo pequeño —los idiomas rondan
 * los 80 kB— contra los 950 kB del paquete que ya se descargó para llegar
 * hasta aquí.
 */
export const idiomaListo: Promise<void> = (async () => {
  const lng = i18n.language || 'es';
  await cargarIdioma(lng);
  if (i18n.hasResourceBundle(lng.split('-')[0], 'translation')) await i18n.changeLanguage(lng);
})();

export default i18n;
