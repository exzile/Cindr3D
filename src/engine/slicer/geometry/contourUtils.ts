import * as THREE from 'three';

import type { BBox2 } from '../../../types/slicer-pipeline.types';

export function signedArea(points: ReadonlyArray<{ x: number; y: number }>): number {
  let area = 0;
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += points[i].x * points[j].y;
    area -= points[j].x * points[i].y;
  }
  return area / 2;
}

export function reorderFromIndex(contour: THREE.Vector2[], startIdx: number): THREE.Vector2[] {
  const n = contour.length;
  const result: THREE.Vector2[] = [];
  for (let i = 0; i < n; i++) {
    result.push(contour[(startIdx + i) % n]);
  }
  return result;
}

export function segSegIntersectionT(
  p1: THREE.Vector2,
  p2: THREE.Vector2,
  p3: THREE.Vector2,
  p4: THREE.Vector2,
): number | null {
  const d1x = p2.x - p1.x;
  const d1y = p2.y - p1.y;
  const d2x = p4.x - p3.x;
  const d2y = p4.y - p3.y;

  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < 1e-10) return null;

  const t = ((p3.x - p1.x) * d2y - (p3.y - p1.y) * d2x) / denom;
  const u = ((p3.x - p1.x) * d1y - (p3.y - p1.y) * d1x) / denom;

  if (u >= 0 && u <= 1 && t >= 0 && t <= 1) return t;
  return null;
}

export function lineContourIntersections(
  p1: THREE.Vector2,
  p2: THREE.Vector2,
  contour: THREE.Vector2[],
): number[] {
  const results: number[] = [];
  const n = contour.length;

  for (let i = 0; i < n; i++) {
    const a = contour[i];
    const b = contour[(i + 1) % n];
    const t = segSegIntersectionT(p1, p2, a, b);
    if (t !== null) results.push(t);
  }

  return results;
}

export function pointInContour(pt: THREE.Vector2, contour: THREE.Vector2[]): boolean {
  let inside = false;
  const n = contour.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = contour[i].x;
    const yi = contour[i].y;
    const xj = contour[j].x;
    const yj = contour[j].y;

    if (
      yi > pt.y !== yj > pt.y &&
      pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi
    ) {
      inside = !inside;
    }
  }
  return inside;
}

export function contourBBox(contour: THREE.Vector2[]): BBox2 {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of contour) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}
