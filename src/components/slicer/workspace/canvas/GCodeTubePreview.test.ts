import { describe, expect, it } from 'vitest';
import type { SliceMove } from '../../../../types/slicer';
import { inferDenseSkinPitchWidths } from './GCodeTubePreview';

function topBottomMove(index: number, x: number, width = 0.5): SliceMove {
  return {
    type: 'top-bottom',
    from: { x, y: 0 },
    to: { x, y: 20 },
    speed: 30,
    extrusion: 1,
    lineWidth: width,
    layerHeight: 0.2,
  };
}

describe('inferDenseSkinPitchWidths', () => {
  it('widens dense skin roads to their real centerline pitch when they should touch', () => {
    const moves = [
      topBottomMove(0, 0),
      topBottomMove(1, 0.5),
      topBottomMove(2, 1.0),
      topBottomMove(3, 1.5),
    ];

    const widths = inferDenseSkinPitchWidths(moves);

    expect(widths.size).toBe(4);
    for (const width of widths.values()) {
      expect(width).toBeGreaterThan(0.5);
      expect(width).toBeLessThan(0.52);
    }
  });

  it('leaves real sparse gaps alone when the line pitch is meaningfully larger than width', () => {
    const moves = [
      topBottomMove(0, 0),
      topBottomMove(1, 0.7),
      topBottomMove(2, 1.4),
      topBottomMove(3, 2.1),
    ];

    expect(inferDenseSkinPitchWidths(moves).size).toBe(0);
  });
});
