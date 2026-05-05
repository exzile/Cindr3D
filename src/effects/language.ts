import { useLanguageStore } from '../store/languageStore';

function applyDocumentLanguage(language: string): void {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = language;
}

applyDocumentLanguage(useLanguageStore.getState().language);

useLanguageStore.subscribe((state) => {
  applyDocumentLanguage(state.language);
});
