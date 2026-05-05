import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import { generateSupportForLayer } from './support';
import type { PrintProfile } from '../../../types/slicer';
import type { SupportDeps } from '../../../types/slicer-pipeline-deps.types';
import type { Contour, Triangle } from '../../../types/slicer-pipeline.types';

const deps: SupportDeps = {
  pointInContour: () => false,
  pointsBBox: (points) => ({
    minX: Math.min(...points.map((point) => point.x)),
    maxX: Math.max(...points.map((point) => point.x)),
    minY: Math.min(...points.map((point) => point.y)),
    maxY: Math.max(...points.map((point) => point.y)),
  }),
  generateScanLines: (contour) => {
    const minX = Math.min(...contour.map((point) => point.x));
    const maxX = Math.max(...contour.map((point) => point.x));
    const y = contour.reduce((sum, point) => sum + point.y, 0) / contour.length;
    return [{ from: new THREE.Vector2(minX, y), to: new THREE.Vector2(maxX, y) }];
  },
};

function overhangTriangle(): Triangle {
  return {
    v0: new THREE.Vector3(0, 0, 5),
    v1: new THREE.Vector3(10, 0, 5),
    v2: new THREE.Vector3(5, 8, 5),
    normal: new THREE.Vector3(0.87, 0, -0.5).normalize(),
    edgeKey01: 'a',
    edgeKey12: 'b',
    edgeKey20: 'c',
  };
}

function profile(overrides: Partial<PrintProfile> = {}): PrintProfile {
  return {
    supportType: 'tree',
    supportAngle: 45,
    supportTopDistance: 0,
    supportZDistance: 0,
    supportTreeMinHeight: 0,
    supportTreeBranchDiameter: 2,
    supportTreeMaxBranchDiameter: 8,
    supportTreeTipDiameter: 1,
    supportTreeAngle: 35,
    supportTreeBranchDiameterAngle: 0,
    supportXYDistance: 0.5,
    supportLineWidth: 0.4,
    wallLineWidth: 0.4,
    supportDensity: 20,
    supportInfillDensityMultiplierInitialLayer: 100,
    supportInfillSpeed: 40,
    supportSpeed: 40,
    printSpeed: 60,
    supportJoinDistance: 2,
    layerHeight: 0.2,
    ...overrides,
  } as PrintProfile;
}

describe('tree support preview moves', () => {
  it('emits tree supports as a distinct preview feature type', () => {
    const result = generateSupportForLayer(
      [overhangTriangle()],
      3,
      3,
      10,
      0,
      0,
      5,
      [] as Contour[],
      profile(),
      deps,
    );

    expect(result.moves.length).toBeGreaterThan(0);
    expect(result.moves.every((move) => move.type === 'support-tree')).toBe(true);
  });
});
