import * as THREE from 'three';

function distancePointToSegment2D(
  p: THREE.Vector2,
  a: THREE.Vector2,
  b: THREE.Vector2,
): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lenSq = abx * abx + aby * aby;
  if (lenSq <= 1e-12) return p.distanceTo(a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / lenSq));
  const projX = a.x + abx * t;
  const projY = a.y + aby * t;
  return Math.hypot(p.x - projX, p.y - projY);
}

function lineLineIntersection2D(
  p1: THREE.Vector2,
  p2: THREE.Vector2,
  p3: THREE.Vector2,
  p4: THREE.Vector2,
): THREE.Vector2 | null {
  const d1x = p2.x - p1.x;
  const d1y = p2.y - p1.y;
  const d2x = p4.x - p3.x;
  const d2y = p4.y - p3.y;

  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < 1e-10) return null;

  const t = ((p3.x - p1.x) * d2y - (p3.y - p1.y) * d2x) / denom;
  return new THREE.Vector2(p1.x + t * d1x, p1.y + t * d1y);
}

function cleanOffsetContour(
  contour: THREE.Vector2[],
  signedArea: (points: THREE.Vector2[]) => number,
): THREE.Vector2[] {
  if (contour.length < 3) return contour;

  const n = contour.length;
  const cleaned: THREE.Vector2[] = [];
  for (let i = 0; i < n; i++) {
    const curr = contour[i];
    const prev = cleaned.length > 0 ? cleaned[cleaned.length - 1] : contour[n - 1];
    if (curr.distanceTo(prev) > 0.001) {
      cleaned.push(curr);
    }
  }

  const originalArea = signedArea(cleaned);
  if (Math.abs(originalArea) < 0.1) return [];

  return cleaned;
}

export function offsetContour(
  contour: THREE.Vector2[],
  offset: number,
  signedArea: (points: THREE.Vector2[]) => number,
): THREE.Vector2[] {
  if (contour.length < 3) return [];

  const n = contour.length;
  const result: THREE.Vector2[] = [];
  const offsetEdges: { a: THREE.Vector2; b: THREE.Vector2 }[] = [];
  for (let i = 0; i < n; i++) {
    const curr = contour[i];
    const next = contour[(i + 1) % n];
    const dx = next.x - curr.x;
    const dy = next.y - curr.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1e-8) continue;

    const nx = -dy / len;
    const ny = dx / len;

    offsetEdges.push({
      a: new THREE.Vector2(curr.x + nx * offset, curr.y + ny * offset),
      b: new THREE.Vector2(next.x + nx * offset, next.y + ny * offset),
    });
  }

  if (offsetEdges.length < 3) return [];

  const maxReach = Math.abs(offset) * 10 + 1;
  for (let i = 0; i < offsetEdges.length; i++) {
    const e1 = offsetEdges[i];
    const e2 = offsetEdges[(i + 1) % offsetEdges.length];

    const refPt = e1.b;
    const pt = lineLineIntersection2D(e1.a, e1.b, e2.a, e2.b);
    if (pt && pt.distanceTo(refPt) <= maxReach) {
      result.push(pt);
    } else {
      result.push(
        new THREE.Vector2(
          (e1.b.x + e2.a.x) / 2,
          (e1.b.y + e2.a.y) / 2,
        ),
      );
    }
  }

  return cleanOffsetContour(result, signedArea);
}

export function simplifyClosedContour(points: THREE.Vector2[], tolerance: number): THREE.Vector2[] {
  if (points.length <= 3 || !(tolerance > 0)) return points.slice();

  const deduped: THREE.Vector2[] = [];
  for (const pt of points) {
    const prev = deduped[deduped.length - 1];
    if (!prev || prev.distanceTo(pt) > tolerance * 0.25) deduped.push(pt);
  }
  if (deduped.length > 1 && deduped[0].distanceTo(deduped[deduped.length - 1]) <= tolerance * 0.25) {
    deduped.pop();
  }
  if (deduped.length <= 3) return deduped;

  const simplified = deduped.slice();
  let changed = true;
  let guard = 0;
  while (changed && simplified.length > 3 && guard++ < deduped.length * 4) {
    changed = false;
    for (let i = 0; i < simplified.length; i++) {
      const prev = simplified[(i - 1 + simplified.length) % simplified.length];
      const curr = simplified[i];
      const next = simplified[(i + 1) % simplified.length];
      if (prev.distanceTo(curr) <= tolerance * 0.25 || curr.distanceTo(next) <= tolerance * 0.25) {
        simplified.splice(i, 1);
        changed = true;
        break;
      }
      if (distancePointToSegment2D(curr, prev, next) <= tolerance) {
        simplified.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  return simplified;
}
