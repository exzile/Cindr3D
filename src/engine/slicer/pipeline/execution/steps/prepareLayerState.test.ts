import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import {
  isBottomSurfaceLayerForCounts,
  isTopSurfaceLayerForCounts,
  prepareLayerGeometryState,
} from './prepareLayerState';
import type { SliceGeometryRun } from './types';
import type { Triangle } from '../../../../../types/slicer-pipeline.types';

interface Contour {
  points: THREE.Vector2[];
  isOuter: boolean;
  area: number;
}

function makeSquare(size: number, isOuter: boolean): Contour {
  const half = size / 2;
  const pts = isOuter
    ? [
      new THREE.Vector2(-half, -half),
      new THREE.Vector2(half, -half),
      new THREE.Vector2(half, half),
      new THREE.Vector2(-half, half),
    ]
    : [
      // CW for hole.
      new THREE.Vector2(-half, -half),
      new THREE.Vector2(-half, half),
      new THREE.Vector2(half, half),
      new THREE.Vector2(half, -half),
    ];
  return { points: pts, isOuter, area: isOuter ? size * size : -size * size };
}

function bboxRange(points: THREE.Vector2[]): { width: number; height: number } {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
  }
  return { width: maxX - minX, height: maxY - minY };
}

function makeTriangle(z0: number, z1: number, z2: number): Triangle {
  return {
    v0: new THREE.Vector3(0, 0, z0),
    v1: new THREE.Vector3(1, 0, z1),
    v2: new THREE.Vector3(0, 1, z2),
    normal: new THREE.Vector3(0, 0, 1),
    edgeKey01: '01',
    edgeKey12: '12',
    edgeKey20: '20',
  };
}

interface TestPipeline {
  cancelled: boolean;
  yieldToUI(): Promise<void>;
  reportProgress(): void;
  sliceTrianglesAtZ(triangles?: unknown[]): unknown[];
  connectSegments(segments: unknown[]): unknown[];
  classifyContours(contours: unknown[]): Contour[];
  closeContourGaps(c: Contour[]): Contour[];
  offsetContour(points: THREE.Vector2[], offset: number): THREE.Vector2[];
}

function makePipeline(triangles: unknown[]): TestPipeline {
  return {
    cancelled: false,
    yieldToUI: async () => {},
    reportProgress: () => {},
    sliceTrianglesAtZ: () => triangles,
    connectSegments: () => [],
    classifyContours: () => [] as Contour[],
    closeContourGaps: (c: Contour[]) => c,
    /** Axis-aligned-rectangle stub matching the real `offsetContour`
     *  convention: positive offset shifts each edge along its (-dy, dx)
     *  inward normal. For a CCW outer that pulls vertices TOWARD the
     *  centroid (shrink); for a CW hole it pushes them AWAY from the
     *  centroid (grow). The stub detects winding via signed area and
     *  picks the direction accordingly so test fixtures using natural
     *  CCW/CW conventions produce intuitive results. */
    offsetContour(points: THREE.Vector2[], offset: number): THREE.Vector2[] {
      let cx = 0, cy = 0;
      for (const p of points) { cx += p.x; cy += p.y; }
      cx /= points.length; cy /= points.length;
      let area = 0;
      for (let i = 0; i < points.length; i++) {
        const a = points[i];
        const b = points[(i + 1) % points.length];
        area += a.x * b.y - b.x * a.y;
      }
      // CCW (area > 0): positive offset = shrink; sign factor = -1.
      // CW  (area < 0): positive offset = grow;   sign factor = +1.
      const dir = area > 0 ? -1 : +1;
      return points.map((p) => new THREE.Vector2(
        p.x + dir * Math.sign(p.x - cx) * offset,
        p.y + dir * Math.sign(p.y - cy) * offset,
      ));
    },
  };
}

function makeRun(pp: Record<string, unknown>, contours: Contour[]) {
  // Inject the prepared contours directly via the classifyContours hook.
  return {
    pp: { layerHeight: 0.2, ...pp },
    mat: {},
    triangles: [],
    modelBBox: { min: { z: 0 }, max: { z: 1 } },
    offsetX: 0,
    offsetY: 0,
    offsetZ: 0,
    layerZs: [0.2, 0.4],
    totalLayers: 2,
    solidBottom: 0,
    solidTop: 0,
    bedCenterX: 0,
    bedCenterY: 0,
    contours,
  };
}

async function runPrep(li: number, pp: Record<string, unknown>, contours: Contour[]) {
  const pipeline = makePipeline([]);
  // Override classifyContours to return our fixture contours so the
  // step under test sees them.
  pipeline.classifyContours = () => contours;
  // sliceTrianglesAtZ + connectSegments must produce non-empty so we
  // don't bail at the rawContours check.
  pipeline.connectSegments = () => [{}];
  const run = makeRun(pp, contours);
  const result = await prepareLayerGeometryState(pipeline, run as unknown as SliceGeometryRun, li);
  return result?.contours as Contour[] | undefined;
}

describe('prepareLayerGeometryState — XY compensation', () => {
  it('grows outer + shrinks holes when horizontalExpansion > 0', async () => {
    const outer = makeSquare(10, true);
    const hole = makeSquare(4, false);
    const result = await runPrep(1, { horizontalExpansion: 0.1 }, [outer, hole]);
    expect(result).toBeDefined();
    const outerSize = bboxRange(result![0].points);
    const holeSize = bboxRange(result![1].points);
    // Outer: 10 → 10 + 2*0.1 = 10.2
    expect(outerSize.width).toBeCloseTo(10.2, 4);
    // Hole: 4 → 4 - 2*0.1 = 3.8 (negative offset shrinks)
    expect(holeSize.width).toBeCloseTo(3.8, 4);
  });

  it('no-op when horizontalExpansion is 0', async () => {
    const outer = makeSquare(10, true);
    const result = await runPrep(1, {}, [outer]);
    expect(bboxRange(result![0].points).width).toBeCloseTo(10, 6);
  });

  it('replaces baseline on first layer with initialLayerHorizontalExpansion', async () => {
    const outer = makeSquare(10, true);
    const result = await runPrep(0, {
      horizontalExpansion: 0.1,
      initialLayerHorizontalExpansion: 0.3,
    }, [outer]);
    // Layer 0 uses 0.3 (override), not 0.1
    expect(bboxRange(result![0].points).width).toBeCloseTo(10.6, 4);
  });

  it('falls back to horizontalExpansion on first layer when override is undefined', async () => {
    const outer = makeSquare(10, true);
    const result = await runPrep(0, { horizontalExpansion: 0.05 }, [outer]);
    expect(bboxRange(result![0].points).width).toBeCloseTo(10.1, 4);
  });

  it('shrinks first-layer outer by elephantFootCompensation', async () => {
    const outer = makeSquare(10, true);
    const result = await runPrep(0, { elephantFootCompensation: 0.2 }, [outer]);
    // Layer 0 outer: 10 → 10 - 2*0.2 = 9.6
    expect(bboxRange(result![0].points).width).toBeCloseTo(9.6, 4);
  });

  it('does NOT apply elephantFootCompensation past layer 0', async () => {
    const outer = makeSquare(10, true);
    const result = await runPrep(1, { elephantFootCompensation: 0.2 }, [outer]);
    expect(bboxRange(result![0].points).width).toBeCloseTo(10, 6);
  });

  it('combines initial-layer horizontal expansion with elephant-foot shrink', async () => {
    const outer = makeSquare(10, true);
    const result = await runPrep(0, {
      initialLayerHorizontalExpansion: 0.1,
      elephantFootCompensation: 0.05,
    }, [outer]);
    // Layer 0 outer: 10 + 2*(0.1 - 0.05) = 10.1
    expect(bboxRange(result![0].points).width).toBeCloseTo(10.1, 4);
  });

  it('can defer per-layer progress and yield cadence to the outer slice loop', async () => {
    let progressReports = 0;
    let yields = 0;
    const pipeline = makePipeline([]);
    pipeline.reportProgress = () => { progressReports += 1; };
    pipeline.yieldToUI = async () => { yields += 1; };
    pipeline.connectSegments = () => [{}];
    pipeline.classifyContours = () => [makeSquare(10, true)];

    const run = makeRun({}, []);
    const result = await prepareLayerGeometryState(
      pipeline,
      run as unknown as SliceGeometryRun,
      0,
      { reportProgress: false, yieldToUI: false },
    );

    expect(result).toBeDefined();
    expect(progressReports).toBe(0);
    expect(yields).toBe(0);
  });

  it('passes only layer-active triangles to the slicer', async () => {
    let slicedTriangleCount = -1;
    const pipeline = makePipeline([]);
    pipeline.sliceTrianglesAtZ = (triangles: unknown[]) => {
      slicedTriangleCount = triangles.length;
      return [{}];
    };
    pipeline.connectSegments = () => [{}];
    pipeline.classifyContours = () => [makeSquare(10, true)];

    const run = makeRun({}, []) as unknown as SliceGeometryRun;
    run.triangles = [
      makeTriangle(0, 0.5, 1),
      makeTriangle(4, 4.5, 5),
    ];
    run.layerZs = [0.5, 4.5];
    run.totalLayers = 2;
    run.modelBBox = {
      min: new THREE.Vector3(0, 0, 0),
      max: new THREE.Vector3(0, 0, 5),
    };

    await prepareLayerGeometryState(pipeline, run, 0, {
      reportProgress: false,
      yieldToUI: false,
    });

    expect(slicedTriangleCount).toBe(1);
  });

  it('indexes only the assigned layer subset when provided by a worker', async () => {
    let slicedTriangleCount = -1;
    const pipeline = makePipeline([]);
    pipeline.sliceTrianglesAtZ = (triangles: unknown[]) => {
      slicedTriangleCount = triangles.length;
      return [{}];
    };
    pipeline.connectSegments = () => [{}];
    pipeline.classifyContours = () => [makeSquare(10, true)];

    const run = makeRun({}, []) as unknown as SliceGeometryRun & { activeLayerIndices?: number[] };
    run.triangles = [
      makeTriangle(0, 0.5, 1),
      makeTriangle(4, 4.5, 5),
    ];
    run.layerZs = [0.5, 4.5];
    run.totalLayers = 2;
    run.modelBBox = {
      min: new THREE.Vector3(0, 0, 0),
      max: new THREE.Vector3(0, 0, 5),
    };
    run.activeLayerIndices = [1];

    await prepareLayerGeometryState(pipeline, run, 1, {
      reportProgress: false,
      yieldToUI: false,
    });

    expect(slicedTriangleCount).toBe(1);
  });
});

describe('isTopSurfaceLayerForCounts (Cura: Top Surface Skin Layers)', () => {
  it('returns false when count is undefined', () => {
    expect(isTopSurfaceLayerForCounts(99, 100, undefined)).toBe(false);
  });

  it('returns false when count is zero (Cura default)', () => {
    expect(isTopSurfaceLayerForCounts(99, 100, 0)).toBe(false);
  });

  it('flags only the topmost layer when count is 1', () => {
    expect(isTopSurfaceLayerForCounts(99, 100, 1)).toBe(true);
    expect(isTopSurfaceLayerForCounts(98, 100, 1)).toBe(false);
  });

  it('flags the topmost N layers when count is N', () => {
    expect(isTopSurfaceLayerForCounts(99, 100, 3)).toBe(true);
    expect(isTopSurfaceLayerForCounts(98, 100, 3)).toBe(true);
    expect(isTopSurfaceLayerForCounts(97, 100, 3)).toBe(true);
    expect(isTopSurfaceLayerForCounts(96, 100, 3)).toBe(false);
  });

  it('handles count >= totalLayers without underflow', () => {
    expect(isTopSurfaceLayerForCounts(0, 5, 10)).toBe(true);
    expect(isTopSurfaceLayerForCounts(4, 5, 10)).toBe(true);
  });

  it('returns false when totalLayers is zero (defensive)', () => {
    expect(isTopSurfaceLayerForCounts(0, 0, 1)).toBe(false);
  });
});

describe('isBottomSurfaceLayerForCounts (Cura: Bottom Surface Skin Layers)', () => {
  it('returns false when count is undefined', () => {
    expect(isBottomSurfaceLayerForCounts(0, undefined)).toBe(false);
  });

  it('returns false when count is zero', () => {
    expect(isBottomSurfaceLayerForCounts(0, 0)).toBe(false);
  });

  it('flags only the bottommost layer when count is 1', () => {
    expect(isBottomSurfaceLayerForCounts(0, 1)).toBe(true);
    expect(isBottomSurfaceLayerForCounts(1, 1)).toBe(false);
  });

  it('flags the bottommost N layers when count is N', () => {
    expect(isBottomSurfaceLayerForCounts(0, 3)).toBe(true);
    expect(isBottomSurfaceLayerForCounts(1, 3)).toBe(true);
    expect(isBottomSurfaceLayerForCounts(2, 3)).toBe(true);
    expect(isBottomSurfaceLayerForCounts(3, 3)).toBe(false);
  });
});

