import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import { generateLinearInfill } from './infill';
import type { PrintProfile } from '../../../types/slicer';
import type { InfillDeps } from '../../../types/slicer-pipeline-deps.types';

function square(min: number, max: number): THREE.Vector2[] {
  return [
    new THREE.Vector2(min, min),
    new THREE.Vector2(max, min),
    new THREE.Vector2(max, max),
    new THREE.Vector2(min, max),
  ];
}

function pointInContour(point: THREE.Vector2, contour: THREE.Vector2[]): boolean {
  let inside = false;
  for (let i = 0, j = contour.length - 1; i < contour.length; j = i++) {
    const a = contour[i];
    const b = contour[j];
    const intersects = ((a.y > point.y) !== (b.y > point.y)) &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

const deps: InfillDeps = {
  contourBBox(contour) {
    return contour.reduce(
      (box, point) => ({
        minX: Math.min(box.minX, point.x),
        minY: Math.min(box.minY, point.y),
        maxX: Math.max(box.maxX, point.x),
        maxY: Math.max(box.maxY, point.y),
      }),
      { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
    );
  },
  pointInContour,
  lineContourIntersections() {
    return [];
  },
  offsetContour(contour) {
    return contour;
  },
};

const printProfile = {
  infillXOffset: 0,
  infillYOffset: 0,
  randomInfillStart: false,
} as PrintProfile;

describe('generateLinearInfill organic pattern', () => {
  it('emits wavy branching segments inside material and avoids holes', () => {
    const contour = square(0, 30);
    const hole = square(11, 19);

    const lines = generateLinearInfill(contour, 18, 0.45, 4, 'organic', [hole], printProfile, deps);

    expect(lines.length).toBeGreaterThan(20);
    expect(lines.some((line) => Math.abs(line.from.y - line.to.y) > 0.01)).toBe(true);

    for (const line of lines) {
      const midpoint = new THREE.Vector2((line.from.x + line.to.x) / 2, (line.from.y + line.to.y) / 2);
      expect(pointInContour(line.from, contour)).toBe(true);
      expect(pointInContour(line.to, contour)).toBe(true);
      expect(pointInContour(midpoint, contour)).toBe(true);
      expect(pointInContour(line.from, hole)).toBe(false);
      expect(pointInContour(line.to, hole)).toBe(false);
      expect(pointInContour(midpoint, hole)).toBe(false);
    }
  });
});
