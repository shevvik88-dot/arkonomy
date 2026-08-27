import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from './locales/en/translation.json';
import ru from './locales/ru/translation.json';
import es from './locales/es/translation.json';
import pt from './locales/pt/translation.json';

export const SUPPORTED_LANGS = ['en', 'ru', 'es', 'pt'];

// Last-resort guess from the browser's own language list, used only when
// the user has never made an explicit choice (no profiles.preferred_language,
// no localStorage entry yet — i.e. a fresh browser/device). An explicit
// choice (picker or DB) always wins over this; this never overrides one.
// Falls back to 'en' if nothing in navigator.languages matches a language
// we actually ship translations for.
export function detectBrowserLanguage() {
  try {
    const candidates = navigator.languages?.length ? navigator.languages : [navigator.language];
    for (const raw of candidates) {
      const code = (raw || '').slice(0, 2).toLowerCase();
      if (SUPPORTED_LANGS.includes(code)) return code;
    }
  } catch {}
  return 'en';
}

const savedLang = (() => {
  try {
    localStorage.removeItem('arkonomy_lang'); // remove auto-detected legacy key
    return localStorage.getItem('arkonomy_language') || detectBrowserLanguage();
  } catch { return 'en'; }
})();

i18n
  .use(initReactI18next)
  .init({
    lng: savedLang,
    fallbackLng: 'en',
    supportedLngs: SUPPORTED_LANGS,
    resources: {
      en: { translation: en },
      ru: { translation: ru },
      es: { translation: es },
      pt: { translation: pt },
    },
    interpolation: {
      escapeValue: false,
    },
    initImmediate: false,
    react: {
      useSuspense: false,
    },
  });

export default i18n;
