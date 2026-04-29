import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import {
  buildContiguousLayerBatches,
  buildInterleavedLayerBatches,
  chooseLayerPrepWorkerCount,
  serializeGeometryRun,
  triangleIntersectsLayerBatch,
} from './runSlicePipeline';
import type { SliceRun } from './types';
import type { ModifierMesh, Triangle } from '../../../../../types/slicer-pipeline.types';

function makeRun(
  totalLayers: number,
  triangleCount: number,
  pp: Record<string, unknown> = {},
): Pick<SliceRun, 'totalLayers' | 'triangles' | 'pp'> {
  return {
    totalLayers,
    triangles: new Array(triangleCount),
    pp,
  } as unknown as Pick<SliceRun, 'totalLayers' | 'triangles' | 'pp'>;
}

describe('chooseLayerPrepWorkerCount', () => {
  it('keeps short prints on the sequential path', () => {
    expect(chooseLayerPrepWorkerCount(makeRun(47, 1_000), 8)).toBe(0);
  });

  it('respects the print-profile opt out', () => {
    expect(chooseLayerPrepWorkerCount(makeRun(120, 1_000, { parallelLayerPreparation: false }), 8)).toBe(0);
  });

  it('caps small meshes at the layer-prep worker maximum', () => {
    expect(chooseLayerPrepWorkerCount(makeRun(120, 10_000), 16)).toBe(8);
  });

  it('reserves one core for the parent worker and UI responsiveness', () => {
    expect(chooseLayerPrepWorkerCount(makeRun(120, 10_000), 4)).toBe(3);
  });

  it('reduces worker fanout for medium meshes', () => {
    expect(chooseLayerPrepWorkerCount(makeRun(120, 25_000), 8)).toBe(6);
    expect(chooseLayerPrepWorkerCount(makeRun(120, 50_000), 8)).toBe(5);
  });

  it('uses extra workers for large meshes without exceeding the global cap', () => {
    expect(chooseLayerPrepWorkerCount(makeRun(120, 80_000), 8)).toBe(6);
    expect(chooseLayerPrepWorkerCount(makeRun(120, 120_000), 16)).toBe(6);
  });

  it('avoids cloning huge meshes into a worker pool', () => {
    expect(chooseLayerPrepWorkerCount(makeRun(120, 200_000), 8)).toBe(0);
    expect(chooseLayerPrepWorkerCount(makeRun(120, 300_000), 16)).toBe(0);
  });
});

describe('triangleIntersectsLayerBatch', () => {
  const run = {
    layerZs: [0.2, 0.4, 0.6, 0.8],
    modelBBox: { min: { z: 10 } },
  } as unknown as Pick<SliceRun, 'layerZs' | 'modelBBox'>;

  function triangle(minZ: number, maxZ: number): SliceRun['triangles'][number] {
    return {
      v0: { z: 10 + minZ },
      v1: { z: 10 + maxZ },
      v2: { z: 10 + minZ },
    } as SliceRun['triangles'][number];
  }

  it('keeps triangles that can intersect any assigned worker layer', () => {
    expect(triangleIntersectsLayerBatch(run, triangle(0.35, 0.45), [0, 1])).toBe(true);
  });

  it('filters triangles outside the assigned worker layer batch', () => {
    expect(triangleIntersectsLayerBatch(run, triangle(0.7, 0.9), [0, 1])).toBe(false);
  });
});

describe('buildContiguousLayerBatches', () => {
  it('splits layers into contiguous worker-owned z bands', () => {
    expect(buildContiguousLayerBatches(10, 3)).toEqual([
      [0, 1, 2],
      [3, 4, 5],
      [6, 7, 8, 9],
    ]);
  });

  it('does not create empty batches when there are more workers than layers', () => {
    expect(buildContiguousLayerBatches(3, 8)).toEqual([[0], [1], [2]]);
  });
});

describe('buildInterleavedLayerBatches', () => {
  it('distributes early layers across workers so sequential emission is not gated by one batch', () => {
    expect(buildInterleavedLayerBatches(10, 3)).toEqual([
      [0, 3, 6, 9],
      [1, 4, 7],
      [2, 5, 8],
    ]);
  });

  it('does not create empty batches when there are more workers than layers', () => {
    expect(buildInterleavedLayerBatches(3, 8)).toEqual([[0], [1], [2]]);
  });
});

describe('serializeGeometryRun (modifier meshes)', () => {
  function tri(minZ: number, maxZ: number): Triangle {
    // The serializer keys triangle filtering off layer-Z relative to
    // modelBBox.min.z (the SliceRun convention). Anchoring at z=10 here
    // matches the run fixture below.
    return {
      v0: new THREE.Vector3(0, 0, 10 + minZ),
      v1: new THREE.Vector3(1, 0, 10 + maxZ),
      v2: new THREE.Vector3(0, 1, 10 + minZ),
      normal: new THREE.Vector3(0, 0, 1),
      edgeKey01: 'a',
      edgeKey12: 'b',
      edgeKey20: 'c',
    };
  }

  function makeRunWithModifiers(modifierMeshes: ModifierMesh[]): SliceRun {
    return {
      pp: {} as never,
      mat: {} as never,
      triangles: [tri(0.0, 0.5), tri(0.6, 0.9)],
      modifierMeshes,
      modelBBox: {
        min: new THREE.Vector3(0, 0, 10),
        max: new THREE.Vector3(10, 10, 11),
      },
      modelHeight: 1,
      bedCenterX: 0,
      bedCenterY: 0,
      offsetX: 0,
      offsetY: 0,
      offsetZ: -10,
      layerZs: [0.2, 0.4, 0.6, 0.8],
      totalLayers: 4,
      solidBottom: 1,
      solidTop: 1,
    } as unknown as SliceRun;
  }

  it('round-trips modifier-mesh role, settings, and meshIndex', () => {
    const cuttingMesh: ModifierMesh = {
      role: 'cutting_mesh',
      meshIndex: 0,
      triangles: [tri(0.1, 0.3)],
    };
    const infillMesh: ModifierMesh = {
      role: 'infill_mesh',
      meshIndex: 1,
      triangles: [tri(0.2, 0.4)],
      settings: { infillDensity: 80, infillPattern: 'gyroid', infillMeshOrder: 5 },
    };
    const out = serializeGeometryRun(makeRunWithModifiers([cuttingMesh, infillMesh]));
    expect(out.modifierMeshes).toHaveLength(2);
    expect(out.modifierMeshes[0]).toMatchObject({
      role: 'cutting_mesh',
      meshIndex: 0,
    });
    expect(out.modifierMeshes[0].triangles).toHaveLength(1);
    expect(out.modifierMeshes[1]).toMatchObject({
      role: 'infill_mesh',
      meshIndex: 1,
      settings: { infillDensity: 80, infillPattern: 'gyroid', infillMeshOrder: 5 },
    });
  });

  it('filters modifier triangles by layer batch when layerIndices is provided', () => {
    const mesh: ModifierMesh = {
      role: 'cutting_mesh',
      meshIndex: 0,
      // Two triangles: one in the first half, one in the second half.
      triangles: [tri(0.1, 0.3), tri(0.7, 0.9)],
    };
    const fullRun = serializeGeometryRun(makeRunWithModifiers([mesh]));
    expect(fullRun.modifierMeshes[0].triangles).toHaveLength(2);

    // Layer indices 0..1 cover Z in [0.2, 0.4] — only the first
    // triangle's [0.1, 0.3] band intersects.
    const filtered = serializeGeometryRun(makeRunWithModifiers([mesh]), [0, 1]);
    expect(filtered.modifierMeshes[0].triangles).toHaveLength(1);
  });

  it('preserves meshIndex even when no triangles intersect a batch', () => {
    const mesh: ModifierMesh = {
      role: 'cutting_mesh',
      meshIndex: 0,
      triangles: [tri(0.7, 0.9)],
    };
    // Layers 0..1 only cover [0.2, 0.4] — no triangle intersects.
    const filtered = serializeGeometryRun(makeRunWithModifiers([mesh]), [0, 1]);
    // The mesh entry stays in place (so meshIndex semantics survive
    // across workers) even with zero serialized triangles.
    expect(filtered.modifierMeshes).toHaveLength(1);
    expect(filtered.modifierMeshes[0].meshIndex).toBe(0);
    expect(filtered.modifierMeshes[0].triangles).toHaveLength(0);
  });

  it('emits an empty modifierMeshes array when the run has none', () => {
    const out = serializeGeometryRun(makeRunWithModifiers([]));
    expect(out.modifierMeshes).toEqual([]);
  });
});
