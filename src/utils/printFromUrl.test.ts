import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchModelUrlToFile, filenameFromModelUrl, isSupportedModelUrl } from './printFromUrl';

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('printFromUrl helpers', () => {
  it('accepts direct model URLs', () => {
    expect(isSupportedModelUrl('https://example.com/model.stl')).toBe(true);
    expect(isSupportedModelUrl('https://example.com/download/part.3mf?token=123')).toBe(true);
  });

  it('keeps direct model detection scoped to model files', () => {
    expect(isSupportedModelUrl('https://www.printables.com/model/123-example')).toBe(false);
  });

  it('uses content-disposition filenames when present', () => {
    expect(filenameFromModelUrl(
      'https://example.com/download?id=1',
      'attachment; filename="benchy.stl"',
    )).toBe('benchy.stl');
  });

  it('resolves marketplace pages to their first model link and preserves attribution', async () => {
    const html = `
      <html>
        <head>
          <meta name="author" content="Ada Maker">
          <meta name="license" content="CC BY 4.0">
        </head>
        <body>
          <a href="/assets/readme.txt">Readme</a>
          <a href="https://files.printables.com/models/widget.3mf">Download model</a>
        </body>
      </html>
    `;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        text: async () => html,
      })
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers(),
        blob: async () => new Blob(['3mf'], { type: 'model/3mf' }),
      });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('caches', undefined);

    const result = await fetchModelUrlToFile('https://www.printables.com/model/123-widget');

    expect(fetchMock).toHaveBeenNthCalledWith(1, 'https://www.printables.com/model/123-widget', { cache: 'no-cache' });
    expect(result.file.name).toBe('widget.3mf');
    expect(result.sourceMetadata).toMatchObject({
      url: 'https://www.printables.com/model/123-widget',
      sourceSite: 'printables',
      author: 'Ada Maker',
      license: 'CC BY 4.0',
    });
  });
});
