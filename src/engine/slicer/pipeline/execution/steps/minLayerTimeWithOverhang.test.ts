import { describe, expect, it } from 'vitest';

import { minimumLayerTimeForLayer } from './finalizeLayer';

describe('minimumLayerTimeForLayer', () => {
  it('uses the normal minimum for non-overhang layers', () => {
    expect(minimumLayerTimeForLayer({
      minLayerTime: 6,
      minLayerTimeWithOverhang: 12,
    }, false)).toBe(6);
  });

  it('uses the overhang minimum when it is higher', () => {
    expect(minimumLayerTimeForLayer({
      minLayerTime: 6,
      minLayerTimeWithOverhang: 12,
    }, true)).toBe(12);
  });

  it('does not let the overhang minimum lower the normal minimum', () => {
    expect(minimumLayerTimeForLayer({
      minLayerTime: 8,
      minLayerTimeWithOverhang: 4,
    }, true)).toBe(8);
  });
});
