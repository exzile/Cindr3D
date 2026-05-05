import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { detectBrowserLanguage, type LanguageCode } from '../i18n';

export interface LanguageStore {
  language: LanguageCode;
  setLanguage: (language: LanguageCode) => void;
}

export const useLanguageStore = create<LanguageStore>()(
  persist(
    (set) => ({
      language: detectBrowserLanguage(),
      setLanguage: (language) => set({ language }),
    }),
    {
      name: 'cindr3d-language',
      version: 1,
    },
  ),
);
