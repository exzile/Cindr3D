import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import { extractTriangles, removeAllHoles, sliceTrianglesAtZ } from './coreGeometry';
import type { Triangle } from '../../../types/slicer-pipeline.types';

describe('coreGeometry triangle slicing', () => {
  it('skips triangles outside the requested Z plane', () => {
    const triangles = extractTriangles([{
      geometry: new THREE.BoxGeometry(10, 10, 10),
      transform: new THREE.Matrix4().makeTranslation(0, 0, 5),
    }]);

    expect(sliceTrianglesAtZ(triangles, 11, 0, 0)).toHaveLength(0);
    expect(sliceTrianglesAtZ(triangles, 5, 0, 0).length).toBeGreaterThan(0);
  });

  it('still slices caller-created triangles without cached bounds', () => {
    const triangle: Triangle = {
      v0: new THREE.Vector3(0, 0, 0),
      v1: new THREE.Vector3(1, 0, 1),
      v2: new THREE.Vector3(0, 1, 1),
      normal: new THREE.Vector3(0, 0, 1),
      edgeKey01: '01',
      edgeKey12: '12',
      edgeKey20: '20',
    };

    const segments = sliceTrianglesAtZ([triangle], 0.5, 0, 0);

    expect(segments).toHaveLength(1);
    expect(segments[0].a.x).toBeCloseTo(0.5, 6);
    expect(segments[0].b.y).toBeCloseTo(0.5, 6);
  });
});

describe('removeAllHoles mesh repair', () => {
  it('returns unchanged result on a fully-manifold cube', () => {
    const triangles = extractTriangles([{
      geometry: new THREE.BoxGeometry(10, 10, 10),
      transform: new THREE.Matrix4(),
    }]);
    const result = removeAllHoles(triangles);
    expect(result.added).toBe(0);
    expect(result.triangles.length).toBe(triangles.length);
  });

  it('fan-triangulates a single-triangle loop into a closed shell', () => {
    // A single triangle has all 3 edges boundary — they form a 3-vertex
    // closed loop. Fan-triangulation seals the back side with 1 fill tri.
    const tri: Triangle = {
      v0: new THREE.Vector3(0, 0, 0),
      v1: new THREE.Vector3(1, 0, 0),
      v2: new THREE.Vector3(1, 1, 0),
      normal: new THREE.Vector3(0, 0, 1),
      edgeKey01: '01', edgeKey12: '12', edgeKey20: '20',
    };
    const result = removeAllHoles([tri]);
    expect(result.added).toBe(1);
    expect(result.triangles).toHaveLength(2);
  });
});
