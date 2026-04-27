import { describe, expect, it } from 'vitest';

import { skinRemovalWidthForLayer } from './emitContourInfill';

describe('skinRemovalWidthForLayer', () => {
  it('uses the generic skin removal width by default', () => {
    expect(skinRemovalWidthForLayer({ skinRemovalWidth: 0.2 }, false, false)).toBe(0.2);
  });

  it('lets top skin removal width override the generic value', () => {
    expect(skinRemovalWidthForLayer({
      skinRemovalWidth: 0.2,
      topSkinRemovalWidth: 0.45,
    }, true, false)).toBe(0.45);
  });

  it('lets bottom skin removal width override the generic value', () => {
    expect(skinRemovalWidthForLayer({
      skinRemovalWidth: 0.2,
      bottomSkinRemovalWidth: 0.35,
    }, false, true)).toBe(0.35);
  });

  it('falls back to zero when no skin removal width is configured', () => {
    expect(skinRemovalWidthForLayer({}, true, false)).toBe(0);
  });
});
