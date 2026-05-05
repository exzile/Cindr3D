import { describe, expect, it } from 'vitest';
import { detectBrowserLanguage, translate } from './index';

describe('i18n', () => {
  it('falls back unsupported browser locales to English', () => {
    expect(detectBrowserLanguage('fr-FR')).toBe('en');
  });

  it('detects English variants', () => {
    expect(detectBrowserLanguage('en-US')).toBe('en');
  });

  it('translates bundled English keys', () => {
    expect(translate('en', 'settings.language')).toBe('Language');
  });
});
