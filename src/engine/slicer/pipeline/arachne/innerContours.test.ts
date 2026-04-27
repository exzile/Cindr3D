import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import { innerContoursToInfillRegions } from './index';

function v(x: number, y: number): THREE.Vector2 {
  return new THREE.Vector2(x, y);
}

function signedArea(points: THREE.Vector2[]): number {
  let area = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    area += (points[j].x * points[i].y) - (points[i].x * points[j].y);
  }
  return area / 2;
}

describe('innerContoursToInfillRegions', () => {
  it('converts Arachne inner contours into infill regions with holes', () => {
    const outer = [v(0, 0), v(10, 0), v(10, 10), v(0, 10)];
    const hole = [v(3, 3), v(3, 7), v(7, 7), v(7, 3)];

    const result = innerContoursToInfillRegions([outer, hole], { signedArea });

    expect(result?.infillRegions).toHaveLength(1);
    expect(result?.infillRegions[0].contour).toBe(outer);
    expect(result?.infillRegions[0].holes).toEqual([hole]);
    expect(result?.innermostHoles).toEqual([hole]);
  });

  it('returns null when no positive outer contour exists', () => {
    const holeOnly = [v(3, 3), v(3, 7), v(7, 7), v(7, 3)];

    expect(innerContoursToInfillRegions([holeOnly], { signedArea })).toBeNull();
  });
});
