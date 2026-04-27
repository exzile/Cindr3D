import { describe, expect, it } from 'vitest';

import { layerProgressReportStride, shouldYieldBeforeLayer } from './runSlicePipeline';

describe('shouldYieldBeforeLayer', () => {
  it('always yields before the first layer so cancellation can land', () => {
    expect(shouldYieldBeforeLayer(0, 0)).toBe(true);
  });

  it('yields every layer after a heavy previous layer', () => {
    expect(shouldYieldBeforeLayer(3, 75)).toBe(true);
  });

  it('throttles yields for cheap layers', () => {
    expect(shouldYieldBeforeLayer(1, 5)).toBe(false);
    expect(shouldYieldBeforeLayer(7, 5)).toBe(false);
    expect(shouldYieldBeforeLayer(8, 5)).toBe(true);
  });
});

describe('layerProgressReportStride', () => {
  it('reports every layer for short prints', () => {
    expect(layerProgressReportStride(20)).toBe(1);
  });

  it('caps long prints to roughly forty layer progress updates', () => {
    expect(layerProgressReportStride(200)).toBe(5);
    expect(layerProgressReportStride(400)).toBe(10);
  });
});
