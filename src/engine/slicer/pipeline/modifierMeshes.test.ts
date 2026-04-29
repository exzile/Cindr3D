import { describe, expect, beforeAll, it } from 'vitest';
import * as THREE from 'three';
import type { MultiPolygon as PCMultiPolygon } from 'polygon-clipping';

import { loadClipper2Module } from '../geometry/clipper2Wasm';
import {
  filterMovesByBlockedMP,
  forcedSupportIslandsFromMP,
} from './support';
import { subdivideInfillRegionByOverrides } from './modifierMeshes';
import { contourToClosedPCRing, multiPolygonToRegions } from './infill';
import type { SliceMove } from '../../../types/slicer';

// 10x10 square at origin, CCW outer ring, closed.
function squareMP(minX: number, minY: number, size: number): PCMultiPolygon {
  return [
    [
      [
        [minX, minY],
        [minX + size, minY],
        [minX + size, minY + size],
        [minX, minY + size],
        [minX, minY],
      ],
    ],
  ];
}

function supportMove(fromX: number, fromY: number, toX: number, toY: number): SliceMove {
  return {
    type: 'support',
    from: { x: fromX, y: fromY },
    to: { x: toX, y: toY },
    speed: 60,
    extrusion: 0,
    lineWidth: 0.4,
  };
}

describe('forcedSupportIslandsFromMP (Cura "Support Mesh")', () => {
  it('returns one island per outer polygon', () => {
    const mp: PCMultiPolygon = [
      ...squareMP(0, 0, 10),
      ...squareMP(50, 50, 5),
    ];
    const islands = forcedSupportIslandsFromMP(mp, 0.2, 0.2);
    expect(islands).toHaveLength(2);
  });

  it('skips degenerate (<3 vertex) outer rings', () => {
    const mp: PCMultiPolygon = [
      [
        [
          [0, 0],
          [1, 0],
          [0, 0],
        ],
      ],
    ];
    expect(forcedSupportIslandsFromMP(mp, 0.2, 0.2)).toHaveLength(0);
  });

  it('island carries the outer ring as points and a non-zero area', () => {
    const islands = forcedSupportIslandsFromMP(squareMP(0, 0, 10), 0.2, 0.2);
    expect(islands[0].points.length).toBeGreaterThanOrEqual(3);
    expect(islands[0].area).toBeGreaterThan(0);
  });
});

const v2 = (x: number, y: number) => new THREE.Vector2(x, y);

describe('subdivideInfillRegionByOverrides (Cura "Infill Mesh")', () => {
  beforeAll(async () => {
    await loadClipper2Module();
  });

  // The subdivide helper only needs two slicer methods: contourToClosedPCRing
  // (V2[] → PCRing) and multiPolygonToRegions (MP → InfillRegion[]). We
  // wire those up directly to the real `infill.ts` exports rather than
  // bringing the full SlicePipelineFill into the test.
  const makeSlicer = () =>
    ({
      contourToClosedPCRing,
      multiPolygonToRegions,
    } as unknown as import('./execution/steps/types').SlicerExecutionPipeline);

  const baseRegion = {
    // 20x20 square at origin
    contour: [v2(0, 0), v2(20, 0), v2(20, 20), v2(0, 20)],
    holes: [],
  };

  it('passes through unchanged when overrides is undefined', () => {
    const out = subdivideInfillRegionByOverrides(baseRegion, undefined, 20, 'lines', makeSlicer());
    expect(out).toHaveLength(1);
    expect(out[0].density).toBe(20);
    expect(out[0].pattern).toBe('lines');
    expect(out[0].fromOverride).toBe(false);
    expect(out[0].regions[0]).toBe(baseRegion);
  });

  it('passes through unchanged when overrides is empty', () => {
    const out = subdivideInfillRegionByOverrides(baseRegion, [], 20, 'lines', makeSlicer());
    expect(out).toHaveLength(1);
    expect(out[0].fromOverride).toBe(false);
  });

  it('splits the region into override + leftover when one infill_mesh overlaps half', () => {
    // 10x20 rectangle covering the LEFT half of baseRegion.
    const overrideMP: PCMultiPolygon = [
      [
        [
          [0, 0], [10, 0], [10, 20], [0, 20], [0, 0],
        ],
      ],
    ];
    const out = subdivideInfillRegionByOverrides(
      baseRegion,
      [{ region: overrideMP, settings: { infillDensity: 80, infillPattern: 'gyroid' }, meshIndex: 0 }],
      20,
      'lines',
      makeSlicer(),
    );
    expect(out).toHaveLength(2);
    // Higher-priority entries come first.
    const [override, leftover] = out;
    expect(override.fromOverride).toBe(true);
    expect(override.density).toBe(80);
    expect(override.pattern).toBe('gyroid');
    expect(override.regions.length).toBeGreaterThan(0);
    expect(leftover.fromOverride).toBe(false);
    expect(leftover.density).toBe(20);
    expect(leftover.pattern).toBe('lines');
  });

  it('falls back to default density/pattern when an override leaves a setting unset', () => {
    const overrideMP: PCMultiPolygon = [
      [
        [
          [0, 0], [10, 0], [10, 20], [0, 20], [0, 0],
        ],
      ],
    ];
    const out = subdivideInfillRegionByOverrides(
      baseRegion,
      // settings.infillPattern is unset — keep the default.
      [{ region: overrideMP, settings: { infillDensity: 80 }, meshIndex: 0 }],
      20,
      'lines',
      makeSlicer(),
    );
    const override = out.find((entry) => entry.fromOverride)!;
    expect(override.density).toBe(80);
    expect(override.pattern).toBe('lines');
  });

  it('does not produce overlapping override entries when two infill_mesh overlap', () => {
    // First override (highest priority): left half (x in [0, 10]).
    const leftMP: PCMultiPolygon = [
      [
        [
          [0, 0], [10, 0], [10, 20], [0, 20], [0, 0],
        ],
      ],
    ];
    // Second override: ALL of baseRegion (x in [0, 20]) — but the left
    // half is already taken by the first override, so this entry
    // should only carve out the RIGHT half.
    const allMP: PCMultiPolygon = [
      [
        [
          [0, 0], [20, 0], [20, 20], [0, 20], [0, 0],
        ],
      ],
    ];
    const out = subdivideInfillRegionByOverrides(
      baseRegion,
      [
        { region: leftMP, settings: { infillDensity: 80 }, meshIndex: 0 },
        { region: allMP, settings: { infillDensity: 50 }, meshIndex: 1 },
      ],
      20,
      'lines',
      makeSlicer(),
    );
    // No leftover entry — overrides cover the whole region.
    const overrides = out.filter((entry) => entry.fromOverride);
    expect(overrides).toHaveLength(2);
    expect(overrides[0].density).toBe(80);
    expect(overrides[1].density).toBe(50);
    // Two non-overlapping entries together cover the whole region: the
    // total area should ~= base area (400). We approximate via bbox of
    // each sub-region.
    let totalArea = 0;
    for (const entry of overrides) {
      for (const region of entry.regions) {
        const xs = region.contour.map((p) => p.x);
        const ys = region.contour.map((p) => p.y);
        totalArea += (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
      }
    }
    expect(totalArea).toBeCloseTo(400, 0);
  });
});

describe('filterMovesByBlockedMP (Cura "Anti-Overhang Mesh")', () => {
  it('returns the moves untouched when the blocked region is empty', () => {
    const moves = [supportMove(0, 0, 10, 0)];
    expect(filterMovesByBlockedMP(moves, [])).toEqual(moves);
  });

  it('drops support moves whose midpoint is inside the blocked region', () => {
    const blocked = squareMP(0, 0, 10);
    const inside = supportMove(2, 5, 8, 5);   // midpoint (5, 5) inside
    const outside = supportMove(20, 5, 30, 5); // midpoint (25, 5) outside
    expect(filterMovesByBlockedMP([inside, outside], blocked)).toEqual([outside]);
  });

  it('preserves non-support moves regardless of region', () => {
    const blocked = squareMP(0, 0, 10);
    const move: SliceMove = {
      type: 'wall-outer',
      from: { x: 5, y: 5 },
      to: { x: 6, y: 5 },
      speed: 30,
      extrusion: 0.1,
      lineWidth: 0.4,
    };
    expect(filterMovesByBlockedMP([move], blocked)).toEqual([move]);
  });
});
