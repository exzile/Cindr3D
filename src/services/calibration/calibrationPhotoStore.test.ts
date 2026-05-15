import { describe, expect, it } from 'vitest';
import { dataUrlToBlob } from './calibrationPhotoStore';

describe('dataUrlToBlob', () => {
  it('decodes a base64 JPEG data URL into a Blob with the correct mime type', () => {
    // "AA==" decodes to a single zero byte.
    const blob = dataUrlToBlob('data:image/jpeg;base64,AA==');
    expect(blob.type).toBe('image/jpeg');
    expect(blob.size).toBe(1);
  });

  it('throws on a malformed data URL', () => {
    expect(() => dataUrlToBlob('not-a-data-url')).toThrowError(/Invalid data URL/);
  });
});
