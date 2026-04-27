import { describe, expect, it } from 'vitest';

import { supportDensityForLayer } from './support';

describe('supportDensityForLayer', () => {
  it('uses the base support density after the first layer', () => {
    expect(supportDensityForLayer({
      supportDensity: 20,
      supportInfillDensityMultiplierInitialLayer: 200,
    }, 1)).toBe(20);
  });

  it('multiplies support density on the first layer', () => {
    expect(supportDensityForLayer({
      supportDensity: 20,
      supportInfillDensityMultiplierInitialLayer: 150,
    }, 0)).toBe(30);
  });

  it('defaults the first-layer multiplier to 100 percent', () => {
    expect(supportDensityForLayer({ supportDensity: 20 }, 0)).toBe(20);
  });

  it('clamps the effective density between 0 and 100 percent', () => {
    expect(supportDensityForLayer({
      supportDensity: 80,
      supportInfillDensityMultiplierInitialLayer: 200,
    }, 0)).toBe(100);
    expect(supportDensityForLayer({
      supportDensity: 20,
      supportInfillDensityMultiplierInitialLayer: -10,
    }, 0)).toBe(0);
  });
});
