import { describe, expect, it } from 'vitest';
import { enGenerated } from './locales/en.generated';

describe('generated UI string catalog', () => {
  it('externalizes extracted UI strings into the English bundle', () => {
    expect(Object.keys(enGenerated).length).toBeGreaterThan(2500);
    expect(Object.values(enGenerated)).toContain('AI Assistant');
    expect(Object.values(enGenerated)).toContain('Advanced Settings');
  });
});
