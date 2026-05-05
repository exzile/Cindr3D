import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import { findSeamPosition } from './seams';
import type { PrintProfile } from '../../../types/slicer';

const square = [
  new THREE.Vector2(0, 0),
  new THREE.Vector2(10, 0),
  new THREE.Vector2(10, 10),
  new THREE.Vector2(0, 10),
];

function profile(overrides: Partial<PrintProfile>): PrintProfile {
  return overrides as PrintProfile;
}

describe('findSeamPosition painted mode', () => {
  it('uses the painted seam hint closest to the contour', () => {
    const index = findSeamPosition(square, profile({
      zSeamPosition: 'painted',
      zSeamPaintHints: [{ x: 9.7, y: 9.4 }],
    }), 0);

    expect(index).toBe(2);
  });

  it('prefers hints nearest to the current layer Z when provided', () => {
    const index = findSeamPosition(square, profile({
      zSeamPosition: 'painted',
      zSeamPaintHints: [
        { x: 9.8, y: 9.8, z: 0.2, weight: 10 },
        { x: 0.2, y: 0.2, z: 4.8, weight: 10 },
      ],
    }), 25, undefined, undefined, { layerZ: 5 });

    expect(index).toBe(0);
  });

  it('falls back to user-specified seam placement when no painted hints exist', () => {
    const index = findSeamPosition(square, profile({
      zSeamPosition: 'painted',
      zSeamX: 10,
      zSeamY: 0,
    }), 0);

    expect(index).toBe(1);
  });
});
