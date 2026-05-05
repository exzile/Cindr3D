import { en } from './locales/en';

export const translations = {
  en,
} as const;

export type LanguageCode = keyof typeof translations;
export type TranslationKey = keyof typeof en;

export const SUPPORTED_LANGUAGES: Array<{ code: LanguageCode; labelKey: TranslationKey }> = [
  { code: 'en', labelKey: 'settings.languageEnglish' },
];

export function detectBrowserLanguage(locale = typeof navigator !== 'undefined' ? navigator.language : 'en'): LanguageCode {
  const base = locale.toLowerCase().split('-')[0];
  return base in translations ? base as LanguageCode : 'en';
}

export function translate(language: LanguageCode, key: TranslationKey): string {
  return translations[language]?.[key] ?? translations.en[key];
}
