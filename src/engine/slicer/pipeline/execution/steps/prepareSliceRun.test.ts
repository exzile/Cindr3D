import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import { prepareSliceGeometryRun } from './prepareSliceRun';
import type { SlicerExecutionPipeline } from './types';
import type { Triangle } from '../../../../../types/slicer-pipeline.types';

function makePipeline(): SlicerExecutionPipeline {
  let extractCalls = 0;
  let bboxCalls = 0;
  const tri: Triangle = {
    v0: new THREE.Vector3(0, 0, 0),
    v1: new THREE.Vector3(10, 0, 0),
    v2: new THREE.Vector3(0, 10, 10),
    normal: new THREE.Vector3(0, 0, 1),
    edgeKey01: 'a',
    edgeKey12: 'b',
    edgeKey20: 'c',
  };
  return {
    cancelled: false,
    printProfile: {
      adaptiveLayersEnabled: false,
      firstLayerHeight: 0.2,
      layerHeight: 0.2,
      bottomLayers: 3,
      topLayers: 3,
    },
    materialProfile: {},
    printerProfile: {
      originCenter: false,
      buildVolume: { x: 220, y: 220, z: 250 },
    },
    reportProgress: () => undefined,
    yieldToUI: async () => undefined,
    extractTriangles: () => {
      extractCalls += 1;
      return [tri];
    },
    computeBBox: () => {
      bboxCalls += 1;
      return new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(10, 10, 10));
    },
    computeAdaptiveLayerZs: () => [],
    sliceTrianglesAtZ: () => [],
    connectSegments: () => [],
    classifyContours: () => [],
    closeContourGaps: () => [],
    offsetContour: () => [],
    generateAdhesion: () => [],
    pointInContour: () => false,
    pointInRing: () => false,
    findSeamPosition: () => 0,
    reorderFromIndex: (loop: THREE.Vector2[]) => loop,
    simplifyClosedContour: (loop: THREE.Vector2[]) => loop,
    filterPerimetersByMinOdd: (perimeters: unknown) => perimeters,
    generatePerimeters: () => ({
      walls: [],
      lineWidths: [],
      outerCount: 0,
      innermostHoles: [],
      infillRegions: [],
    }),
    generateSupportForLayer: () => ({ moves: [] }),
    generateLinearInfill: () => [],
    generateScanLines: () => [],
    contourBBox: () => ({ minX: 0, minY: 0, maxX: 0, maxY: 0 }),
    contourToClosedPCRing: () => [],
    multiPolygonToRegions: () => [],
    sortInfillLines: <T,>(lines: T[]) => lines,
    sortInfillLinesNN: <T,>(lines: T[]) => lines,
    segmentInsideMaterial: () => true,
    getExtractCalls: () => extractCalls,
    getBBoxCalls: () => bboxCalls,
  } as unknown as SlicerExecutionPipeline & { getExtractCalls(): number; getBBoxCalls(): number };
}

function makeGeometry() {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
    0, 0, 0,
    10, 0, 0,
    0, 10, 10,
  ]), 3));
  return [{ geometry, transform: new THREE.Matrix4() }];
}

describe('prepareSliceGeometryRun mesh cache', () => {
  it('reuses extracted triangles and bbox for unchanged geometry inputs', () => {
    const pipeline = makePipeline() as SlicerExecutionPipeline & { getExtractCalls(): number; getBBoxCalls(): number };
    const geometries = makeGeometry();

    const first = prepareSliceGeometryRun(pipeline, geometries);
    const second = prepareSliceGeometryRun(pipeline, geometries);

    expect(first.triangles).toBe(second.triangles);
    expect(pipeline.getExtractCalls()).toBe(1);
    expect(pipeline.getBBoxCalls()).toBe(1);
  });

  it('misses the cache when the transform changes', () => {
    const pipeline = makePipeline() as SlicerExecutionPipeline & { getExtractCalls(): number };
    const geometries = makeGeometry();

    prepareSliceGeometryRun(pipeline, geometries);
    geometries[0].transform = new THREE.Matrix4().makeTranslation(1, 0, 0);
    prepareSliceGeometryRun(pipeline, geometries);

    expect(pipeline.getExtractCalls()).toBe(2);
  });
});
