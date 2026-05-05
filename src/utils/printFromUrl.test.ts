import { describe, expect, it } from 'vitest';
import { filenameFromModelUrl, isSupportedModelUrl } from './printFromUrl';

describe('printFromUrl helpers', () => {
  it('accepts direct model URLs', () => {
    expect(isSupportedModelUrl('https://example.com/model.stl')).toBe(true);
    expect(isSupportedModelUrl('https://example.com/download/part.3mf?token=123')).toBe(true);
  });

  it('rejects marketplace pages that are not direct files', () => {
    expect(isSupportedModelUrl('https://www.printables.com/model/123-example')).toBe(false);
  });

  it('uses content-disposition filenames when present', () => {
    expect(filenameFromModelUrl(
      'https://example.com/download?id=1',
      'attachment; filename="benchy.stl"',
    )).toBe('benchy.stl');
  });
});
