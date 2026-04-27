import { describe, expect, it } from 'vitest';

import { pickBridgeFanSpeed } from './emitContourInfill';

describe('pickBridgeFanSpeed', () => {
  it('returns bridgeFanSpeed on the first bridge layer (priorConsecutive=0)', () => {
    expect(pickBridgeFanSpeed(
      { bridgeFanSpeed: 80, bridgeFanSpeed2: 60, bridgeFanSpeed3: 40, bridgeEnableMoreLayers: true },
      0,
    )).toBe(80);
  });

  it('returns bridgeFanSpeed2 on the second consecutive bridge layer', () => {
    expect(pickBridgeFanSpeed(
      { bridgeFanSpeed: 80, bridgeFanSpeed2: 60, bridgeFanSpeed3: 40, bridgeEnableMoreLayers: true },
      1,
    )).toBe(60);
  });

  it('returns bridgeFanSpeed3 on the third consecutive bridge layer', () => {
    expect(pickBridgeFanSpeed(
      { bridgeFanSpeed: 80, bridgeFanSpeed2: 60, bridgeFanSpeed3: 40, bridgeEnableMoreLayers: true },
      2,
    )).toBe(40);
  });

  it('keeps using bridgeFanSpeed3 on the 4th+ consecutive bridge layer', () => {
    expect(pickBridgeFanSpeed(
      { bridgeFanSpeed: 80, bridgeFanSpeed2: 60, bridgeFanSpeed3: 40, bridgeEnableMoreLayers: true },
      3,
    )).toBe(40);
    expect(pickBridgeFanSpeed(
      { bridgeFanSpeed: 80, bridgeFanSpeed2: 60, bridgeFanSpeed3: 40, bridgeEnableMoreLayers: true },
      10,
    )).toBe(40);
  });

  it('ignores bridgeFanSpeed2/3 when bridgeEnableMoreLayers is false (default)', () => {
    // priorConsecutive 5 would normally pick speed3, but the toggle is off.
    expect(pickBridgeFanSpeed(
      { bridgeFanSpeed: 80, bridgeFanSpeed2: 60, bridgeFanSpeed3: 40 },
      5,
    )).toBe(80);
  });

  it('uses bridgeHasMultipleLayers as the legacy alias for multi-layer bridge settings', () => {
    expect(pickBridgeFanSpeed(
      { bridgeFanSpeed: 80, bridgeFanSpeed2: 60, bridgeFanSpeed3: 40, bridgeHasMultipleLayers: true },
      1,
    )).toBe(60);
  });

  it('lets bridgeEnableMoreLayers override the legacy bridgeHasMultipleLayers alias', () => {
    expect(pickBridgeFanSpeed(
      { bridgeFanSpeed: 80, bridgeFanSpeed2: 60, bridgeHasMultipleLayers: true, bridgeEnableMoreLayers: false },
      1,
    )).toBe(80);
  });

  it('ignores bridgeFanSpeed2/3 when bridgeEnableMoreLayers is explicitly false', () => {
    expect(pickBridgeFanSpeed(
      { bridgeFanSpeed: 80, bridgeFanSpeed2: 60, bridgeFanSpeed3: 40, bridgeEnableMoreLayers: false },
      2,
    )).toBe(80);
  });

  it('falls back from bridgeFanSpeed3 → bridgeFanSpeed2 → bridgeFanSpeed when later tiers are missing', () => {
    expect(pickBridgeFanSpeed(
      { bridgeFanSpeed: 80, bridgeFanSpeed2: 60, bridgeEnableMoreLayers: true },
      2,
    )).toBe(60);
    expect(pickBridgeFanSpeed(
      { bridgeFanSpeed: 80, bridgeEnableMoreLayers: true },
      2,
    )).toBe(80);
    expect(pickBridgeFanSpeed(
      { bridgeFanSpeed: 80, bridgeEnableMoreLayers: true },
      1,
    )).toBe(80);
  });

  it('defaults to 100% when no bridgeFanSpeed at all is set', () => {
    expect(pickBridgeFanSpeed({}, 0)).toBe(100);
    expect(pickBridgeFanSpeed({ bridgeEnableMoreLayers: true }, 5)).toBe(100);
  });

  it('treats undefined priorConsecutive as 0 (first bridge layer)', () => {
    expect(pickBridgeFanSpeed(
      { bridgeFanSpeed: 80, bridgeEnableMoreLayers: true },
      undefined as unknown as number,
    )).toBe(80);
  });
});
