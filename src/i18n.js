import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from './locales/en/translation.json';
import ru from './locales/ru/translation.json';
import es from './locales/es/translation.json';

const savedLang = (() => {
  try {
    return localStorage.getItem('arkonomy_language')
      || localStorage.getItem('arkonomy_lang')  // migrate old key
      || 'en';
  } catch { return 'en'; }
})();

i18n
  .use(initReactI18next)
  .init({
    lng: savedLang,
    fallbackLng: 'en',
    supportedLngs: ['en', 'ru', 'es'],
    resources: {
      en: { translation: en },
      ru: { translation: ru },
      es: { translation: es },
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
