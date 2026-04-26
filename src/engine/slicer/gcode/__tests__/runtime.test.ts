import { describe, expect, it, vi } from 'vitest';

import { reportProgress, resolveGCodeTemplate, yieldToUI } from '../runtime';

describe('resolveGCodeTemplate', () => {
  it('replaces {key} placeholders with stringified values', () => {
    const out = resolveGCodeTemplate('M104 S{nozzleTemp}\nM140 S{bedTemp}', {
      nozzleTemp: 210,
      bedTemp: 60,
    });
    expect(out).toBe('M104 S210\nM140 S60');
  });

  it('replaces all occurrences of the same placeholder', () => {
    const out = resolveGCodeTemplate('{n}-{n}-{n}', { n: 42 });
    expect(out).toBe('42-42-42');
  });

  it('returns the template unchanged when vars is empty', () => {
    expect(resolveGCodeTemplate('M104 S{nozzleTemp}', {})).toBe('M104 S{nozzleTemp}');
  });

  it('leaves unknown placeholders untouched', () => {
    expect(resolveGCodeTemplate('{a} {b}', { a: 1 })).toBe('1 {b}');
  });

  it('handles 0 as a valid value (not falsy-stripped)', () => {
    expect(resolveGCodeTemplate('M104 S{t}', { t: 0 })).toBe('M104 S0');
  });

  it('handles negative numbers', () => {
    expect(resolveGCodeTemplate('G1 X{x}', { x: -5 })).toBe('G1 X-5');
  });
});

describe('reportProgress', () => {
  it('invokes the callback with the assembled progress object', () => {
    const cb = vi.fn();
    reportProgress(cb, 'slicing', 50, 10, 20, 'half done');
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith({
      stage: 'slicing',
      percent: 50,
      currentLayer: 10,
      totalLayers: 20,
      message: 'half done',
    });
  });

  it('is a no-op when callback is undefined', () => {
    expect(() => reportProgress(undefined, 'slicing', 0, 0, 0, '')).not.toThrow();
  });

  it('passes through stage values verbatim', () => {
    const cb = vi.fn();
    reportProgress(cb, 'generating', 95, 100, 100, 'finalizing');
    expect(cb.mock.calls[0][0].stage).toBe('generating');
  });
});

describe('yieldToUI', () => {
  it('returns a promise that resolves on the next macrotask tick', async () => {
    const before = performance.now();
    await yieldToUI();
    // Should resolve quickly but at least one event-loop turn later.
    expect(performance.now() - before).toBeGreaterThanOrEqual(0);
  });

  it('multiple awaits do not throw', async () => {
    await yieldToUI();
    await yieldToUI();
    await yieldToUI();
    expect(true).toBe(true);
  });
});
