import { describe, expect, it } from 'vitest';
import { layerFromPercent, parseMarlinProgress } from '../services/gcode/marlinProgressParser';

describe('parseMarlinProgress', () => {
  it('returns null on empty / non-progress lines', () => {
    expect(parseMarlinProgress('')).toBeNull();
    expect(parseMarlinProgress('ok')).toBeNull();
    expect(parseMarlinProgress('ok T:200/200 B:60/60')).toBeNull();
  });

  it('parses M73 P<n> R<m>', () => {
    expect(parseMarlinProgress('M73 P50 R30')).toEqual({ percent: 50, remainingSeconds: 1800 });
  });

  it('parses echoed M73 receipts', () => {
    expect(parseMarlinProgress('echo: M73 P75 R12')).toEqual({ percent: 75, remainingSeconds: 720 });
  });

  it('parses Q<n> S<sec> (Prusa preview)', () => {
    expect(parseMarlinProgress('M73 Q42 S900')).toEqual({ percent: 42, remainingSeconds: 900 });
  });

  it('clamps percent above 100 to 100', () => {
    expect(parseMarlinProgress('M73 P150 R0')?.percent).toBe(100);
  });

  it('parses LCD-style "echo:Layer 5/100"', () => {
    expect(parseMarlinProgress('echo:Layer 5/100')).toMatchObject({ layer: 5, totalLayers: 100 });
  });

  it('parses "; LAYER:42" slicer comment', () => {
    expect(parseMarlinProgress('; LAYER:42')).toMatchObject({ layer: 42 });
  });

  it('parses combined M73 + layer line', () => {
    const r = parseMarlinProgress('echo: M73 P50 R10 layer:25');
    expect(r).toMatchObject({ percent: 50, remainingSeconds: 600, layer: 25 });
  });
});

describe('layerFromPercent', () => {
  it('returns 0 for invalid totals', () => {
    expect(layerFromPercent(50, 0)).toBe(0);
    expect(layerFromPercent(50, -10)).toBe(0);
  });

  it('clamps below 0 and above 100', () => {
    expect(layerFromPercent(-10, 100)).toBe(0);
    expect(layerFromPercent(150, 100)).toBe(99);
  });

  it('maps proportionally', () => {
    expect(layerFromPercent(0, 100)).toBe(0);
    expect(layerFromPercent(50, 100)).toBe(50);
    expect(layerFromPercent(99.9, 100)).toBe(99);
    expect(layerFromPercent(100, 100)).toBe(99);
  });
});
