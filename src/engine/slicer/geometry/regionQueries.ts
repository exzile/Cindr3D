import * as THREE from 'three';
import type { Ring as PCRing } from 'polygon-clipping';

export function pointInRing(x: number, y: number, ring: PCRing): boolean {
  let inside = false;
  const n = ring.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    if (
      yi > y !== yj > y &&
      x < ((xj - xi) * (y - yi)) / (yj - yi) + xi
    ) {
      inside = !inside;
    }
  }
  return inside;
}

export function segmentInsideMaterial(
  from: THREE.Vector2,
  to: THREE.Vector2,
  contour: THREE.Vector2[],
  holes: THREE.Vector2[][],
  pointInContour: (pt: THREE.Vector2, contour: THREE.Vector2[]) => boolean,
): boolean {
  const inMaterial = (p: THREE.Vector2): boolean => {
    if (!pointInContour(p, contour)) return false;
    for (const hole of holes) {
      if (hole.length >= 3 && pointInContour(p, hole)) return false;
    }
    return true;
  };

  if (!inMaterial(from) || !inMaterial(to)) return false;
  const samples = 5;
  for (let i = 1; i < samples; i++) {
    const t = i / samples;
    const p = new THREE.Vector2(
      from.x + (to.x - from.x) * t,
      from.y + (to.y - from.y) * t,
    );
    if (!inMaterial(p)) return false;
  }
  return true;
}
