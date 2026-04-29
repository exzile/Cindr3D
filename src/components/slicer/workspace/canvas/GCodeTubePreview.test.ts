import { describe, expect, it } from 'vitest';
import type { SliceMove } from '../../../../types/slicer';
import type { ShaftMoveData, TubeChain } from '../../../../types/slicer-preview.types';
import {
  appendJoinedPreviewPoint,
  canContinuePreviewChain,
  closePreviewChainIfLoop,
  inferDenseSkinPitchWidths,
  previewLineWidthFromMove,
} from './GCodeTubePreview';

function topBottomMove(_index: number, x: number, width = 0.5): SliceMove {
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

describe('previewLineWidthFromMove', () => {
  it('keeps outer-wall geometry at the slicer line width despite per-segment extrusion noise', () => {
    const quietWall: SliceMove = {
      type: 'wall-outer',
      from: { x: 0, y: 0 },
      to: { x: 1, y: 0 },
      speed: 30,
      extrusion: 0.01,
      lineWidth: 0.42,
      layerHeight: 0.2,
    };
    const noisyWall: SliceMove = { ...quietWall, extrusion: 0.08 };

    expect(previewLineWidthFromMove(quietWall, 1, 0.2, 1.75)).toBeCloseTo(0.42);
    expect(previewLineWidthFromMove(noisyWall, 1, 0.2, 1.75)).toBeCloseTo(0.42);
  });

  it('still derives non-wall preview width from extrusion volume', () => {
    const move: SliceMove = {
      type: 'infill',
      from: { x: 0, y: 0 },
      to: { x: 1, y: 0 },
      speed: 30,
      extrusion: 0.08,
      lineWidth: 0.42,
      layerHeight: 0.2,
    };

    expect(previewLineWidthFromMove(move, 1, 0.2, 1.75)).toBeGreaterThan(0.42);
  });
});

describe('appendJoinedPreviewPoint', () => {
  it('keeps the shared vertex width from the previous segment like Orca', () => {
    const ref: ShaftMoveData = {
      type: 'wall-outer',
      speed: 30,
      extrusion: 0.01,
      lineWidth: 0.4,
      length: 1,
      moveIndex: 0,
    };
    const chain: TubeChain = {
      type: 'wall-outer',
      points: [
        { x: 0, y: 0, lw: 0.4 },
        { x: 1, y: 0, lw: 0.4 },
      ],
      segColors: [[1, 0, 0]],
      moveRefs: [ref],
      isClosed: false,
    };

    appendJoinedPreviewPoint(chain, { x: 2, y: 0 }, 0.8, [1, 0, 0], { ...ref, lineWidth: 0.8, moveIndex: 1 });

    expect(chain.points[1].lw).toBeCloseTo(0.4);
    expect(chain.points[2].lw).toBeCloseTo(0.8);
    expect(chain.segColors).toHaveLength(2);
    expect(chain.moveRefs).toHaveLength(2);
  });
});

describe('canContinuePreviewChain', () => {
  it('allows continuous extrusion chains across feature-type changes like Orca', () => {
    const ref: ShaftMoveData = {
      type: 'wall-outer',
      speed: 30,
      extrusion: 0.01,
      lineWidth: 0.4,
      length: 1,
      moveIndex: 0,
    };
    const chain: TubeChain = {
      type: 'wall-outer',
      points: [
        { x: 0, y: 0, lw: 0.4 },
        { x: 1, y: 0, lw: 0.4 },
      ],
      segColors: [[1, 0, 0]],
      moveRefs: [ref],
      isClosed: false,
    };
    const nextMove: SliceMove = {
      type: 'wall-inner',
      from: { x: 1, y: 0 },
      to: { x: 2, y: 0 },
      speed: 30,
      extrusion: 0.01,
      lineWidth: 0.4,
      layerHeight: 0.2,
    };

    expect(canContinuePreviewChain(chain, nextMove)).toBe(true);
  });

  it('breaks when the next move does not start at the chain endpoint', () => {
    const ref: ShaftMoveData = {
      type: 'wall-outer',
      speed: 30,
      extrusion: 0.01,
      lineWidth: 0.4,
      length: 1,
    };
    const chain: TubeChain = {
      type: 'wall-outer',
      points: [
        { x: 0, y: 0, lw: 0.4 },
        { x: 1, y: 0, lw: 0.4 },
      ],
      segColors: [[1, 0, 0]],
      moveRefs: [ref],
      isClosed: false,
    };
    const jumpedMove: SliceMove = {
      type: 'wall-inner',
      from: { x: 1.1, y: 0 },
      to: { x: 2, y: 0 },
      speed: 30,
      extrusion: 0.01,
      lineWidth: 0.4,
      layerHeight: 0.2,
    };

    expect(canContinuePreviewChain(chain, jumpedMove)).toBe(false);
  });
});

describe('closePreviewChainIfLoop', () => {
  it('collapses duplicate G-code loop endpoints into an implicit closed preview chain', () => {
    const ref: ShaftMoveData = {
      type: 'wall-outer',
      speed: 30,
      extrusion: 0.01,
      lineWidth: 0.4,
      length: 1,
      moveIndex: 0,
    };
    const chain: TubeChain = {
      type: 'wall-outer',
      points: [
        { x: 0, y: 0, lw: 0.4 },
        { x: 10, y: 0, lw: 0.4 },
        { x: 10, y: 10, lw: 0.4 },
        { x: 0, y: 0, lw: 0.4 },
      ],
      segColors: [[1, 0, 0], [1, 0, 0], [1, 0, 0]],
      moveRefs: [ref, { ...ref, moveIndex: 1 }, { ...ref, moveIndex: 2 }],
      isClosed: false,
    };

    closePreviewChainIfLoop(chain);

    expect(chain.isClosed).toBe(true);
    expect(chain.points).toHaveLength(3);
    expect(chain.segColors).toHaveLength(3);
    expect(chain.moveRefs).toHaveLength(3);
  });

  it('leaves short backtracks open instead of inventing a loop', () => {
    const ref: ShaftMoveData = {
      type: 'wall-inner',
      speed: 30,
      extrusion: 0.01,
      lineWidth: 0.4,
      length: 1,
    };
    const chain: TubeChain = {
      type: 'wall-inner',
      points: [
        { x: 0, y: 0, lw: 0.4 },
        { x: 1, y: 0, lw: 0.4 },
        { x: 0, y: 0, lw: 0.4 },
      ],
      segColors: [[0, 1, 0], [0, 1, 0]],
      moveRefs: [ref, ref],
      isClosed: false,
    };

    closePreviewChainIfLoop(chain);

    expect(chain.isClosed).toBe(false);
    expect(chain.points).toHaveLength(3);
  });
});
