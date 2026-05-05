import { describe, expect, it } from 'vitest';

import { packRectangles } from './binPacker';

describe('packRectangles', () => {
  it('uses optional placement scoring to choose among valid free regions', () => {
    const placements = packRectangles(100, 50, [
      { id: 'wide', w: 40, h: 40, fallback: { x: -1, y: -1 } },
      { id: 'small', w: 20, h: 20, fallback: { x: -1, y: -1 } },
    ], 0, {
      scorePlacement: (candidate) => candidate.input.id === 'small' && candidate.x < 40 ? 1000 : 0,
    });

    const small = placements.find((placement) => placement.id === 'small');

    expect(small?.x).toBeGreaterThanOrEqual(40);
  });
});
