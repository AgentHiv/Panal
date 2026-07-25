import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import es from './locales/es.json';
import en from './locales/en.json';
import zh from './locales/zh.json';
import hi from './locales/hi.json';
import fr from './locales/fr.json';
import ar from './locales/ar.json';
import pt from './locales/pt.json';
import ru from './locales/ru.json';
import bn from './locales/bn.json';
import ur from './locales/ur.json';

export const SUPPORTED_LANGS = ['es', 'en', 'zh', 'hi', 'fr', 'ar', 'pt', 'ru', 'bn', 'ur'] as const;
export type SupportedLang = (typeof SUPPORTED_LANGS)[number];

export const RTL_LANGS: ReadonlySet<string> = new Set(['ar', 'ur']);

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      es: { translation: es },
      en: { translation: en },
      zh: { translation: zh },
      hi: { translation: hi },
      fr: { translation: fr },
      ar: { translation: ar },
      pt: { translation: pt },
      ru: { translation: ru },
      bn: { translation: bn },
      ur: { translation: ur },
    },
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

export default i18n;
