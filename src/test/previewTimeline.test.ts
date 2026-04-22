import { describe, expect, it } from 'vitest';
import type { SliceResult } from '../types/slicer';
import { buildMoveTimeline } from '../components/slicer/workspace/canvas/previewTimeline';

function makeSliceResult(layers: SliceResult['layers']): SliceResult {
  return {
    gcode: '',
    printTime: 0,
    filamentUsed: 0,
    filamentWeight: 0,
    filamentCost: 0,
    layerCount: layers.length,
    layers,
  };
}

describe('buildMoveTimeline', () => {
  it('includes explicit layer-change Z travel time before layer moves', () => {
    const sliceResult = makeSliceResult([
      {
        z: 0.3,
        layerIndex: 0,
        layerTime: 0,
        moves: [
          {
            type: 'travel',
            from: { x: 0, y: 0 },
            to: { x: 10, y: 0 },
            speed: 10,
            extrusion: 0,
            lineWidth: 0.4,
          },
        ],
      },
      {
        z: 0.5,
        layerIndex: 1,
        layerTime: 0,
        moves: [
          {
            type: 'travel',
            from: { x: 10, y: 0 },
            to: { x: 20, y: 0 },
            speed: 10,
            extrusion: 0,
            lineWidth: 0.4,
          },
        ],
      },
    ]);

    const timeline = buildMoveTimeline(sliceResult, {
      filamentDiameter: 1.75,
      travelSpeed: 10,
    });

    expect(timeline.cumulative[0]).toBeCloseTo(1.03, 5);
    expect(timeline.cumulative[1]).toBeCloseTo(2.05, 5);
  });

  it('adds retract, hop, and unretract timing around qualifying travels', () => {
    const sliceResult = makeSliceResult([
      {
        z: 0.2,
        layerIndex: 0,
        layerTime: 0,
        moves: [
          {
            type: 'wall-outer',
            from: { x: 0, y: 0 },
            to: { x: 20, y: 0 },
            speed: 20,
            extrusion: 1,
            lineWidth: 0.4,
          },
          {
            type: 'travel',
            from: { x: 20, y: 0 },
            to: { x: 40, y: 0 },
            speed: 10,
            extrusion: 0,
            lineWidth: 0.4,
          },
          {
            type: 'wall-inner',
            from: { x: 40, y: 0 },
            to: { x: 50, y: 0 },
            speed: 20,
            extrusion: 0.5,
            lineWidth: 0.4,
          },
        ],
      },
    ]);

    const timeline = buildMoveTimeline(sliceResult, {
      filamentDiameter: 1.75,
      travelSpeed: 10,
      retractionDistance: 2,
      retractionSpeed: 20,
      retractionMinTravel: 0,
      zHopWhenRetracted: true,
      zHopHeight: 0.4,
      zHopSpeed: 8,
    });

    expect(timeline.cumulative[1]).toBeGreaterThan(timeline.cumulative[0] + 2);
    expect(timeline.cumulative[2] - timeline.cumulative[1]).toBeGreaterThan(0.1);
    expect(timeline.moves[1].z).toBeCloseTo(0.6, 5);
  });
});
