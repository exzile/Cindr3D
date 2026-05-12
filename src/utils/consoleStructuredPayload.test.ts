import { describe, expect, it } from 'vitest';
import { getStructuredPayload } from './consoleStructuredPayload';

describe('console structured payload detection', () => {
  it('detects JSON payloads after console prefixes', () => {
    const payload = getStructuredPayload(
      '[debug] {"line":13335,"key":"volumes","flags":"vp","result":[{"path":"0:/","mounted":true}],"next":0}',
    );

    expect(payload?.kind).toBe('json');
    expect(payload?.formatted).toContain('"key": "volumes"');
    expect(payload?.formatted).toContain('"path": "0:/"');
  });

  it('detects direct JSON arrays', () => {
    const payload = getStructuredPayload('[{"path":"0:/"}]');
    expect(payload?.kind).toBe('json');
    expect(payload?.formatted).toContain('"path": "0:/"');
  });

  it('detects XML payloads after console prefixes', () => {
    const payload = getStructuredPayload('[debug] <response><code>200</code></response>');
    expect(payload?.kind).toBe('xml');
    expect(payload?.formatted).toContain('<code>200</code>');
  });
});
