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

// Ramer-Douglas-Peucker on an open point list: return indices of points to
// keep so that every dropped point lies within `tolerance` of the polyline
// formed by kept points. Works iteratively with an explicit stack to avoid
// recursion blow-ups on long contours.
function dpKeepIndices(points: THREE.Vector2[], start: number, end: number, tolerance: number, keep: Uint8Array): void {
  const stack: Array<[number, number]> = [[start, end]];
  while (stack.length > 0) {
    const [lo, hi] = stack.pop()!;
    if (hi <= lo + 1) continue;
    const a = points[lo];
    const b = points[hi];
    let maxDist = -1;
    let maxIdx = -1;
    for (let i = lo + 1; i < hi; i++) {
      const d = distancePointToSegment2D(points[i], a, b);
      if (d > maxDist) { maxDist = d; maxIdx = i; }
    }
    if (maxDist > tolerance && maxIdx > 0) {
      keep[maxIdx] = 1;
      stack.push([lo, maxIdx]);
      stack.push([maxIdx, hi]);
    }
  }
}

export function simplifyClosedContour(points: THREE.Vector2[], tolerance: number): THREE.Vector2[] {
  if (points.length <= 3 || !(tolerance > 0)) return points.slice();

  // Dedupe coincident points but keep the tolerance tight here — we only want
  // to collapse true duplicates, not start eating actual geometry.
  const deduped: THREE.Vector2[] = [];
  const dedupTol = Math.min(tolerance * 0.1, 0.005);
  for (const pt of points) {
    const prev = deduped[deduped.length - 1];
    if (!prev || prev.distanceTo(pt) > dedupTol) deduped.push(pt);
  }
  if (deduped.length > 1 && deduped[0].distanceTo(deduped[deduped.length - 1]) <= dedupTol) {
    deduped.pop();
  }
  if (deduped.length <= 3) return deduped;

  // Split the closed contour at two antipodal anchors so DP runs on two open
  // polylines. Without anchors, a closed loop has no natural endpoints for DP
  // and greedy per-triple removal wildly over-simplifies small circles (a
  // 424-point 5mm-diameter circle collapses to ~6 points instead of ~24).
  const n = deduped.length;
  const anchor0 = 0;
  const anchor1 = Math.floor(n / 2);
  const keep = new Uint8Array(n);
  keep[anchor0] = 1;
  keep[anchor1] = 1;
  dpKeepIndices(deduped, anchor0, anchor1, tolerance, keep);
  // Second half: anchor1 → end → anchor0 (wrap). Build a temporary view that
  // maps contiguous indices [0..half2Len) back to deduped indices without
  // allocating a Vector2 array — use an index-remap approach with a wrapper.
  const half2Len = n - anchor1 + 1; // anchor1..n-1 plus anchor0
  const half2View: THREE.Vector2[] = new Array(half2Len);
  for (let i = 0; i < n - anchor1; i++) half2View[i] = deduped[anchor1 + i];
  half2View[half2Len - 1] = deduped[anchor0];
  const keep2 = new Uint8Array(half2Len);
  keep2[0] = 1;
  keep2[half2Len - 1] = 1;
  dpKeepIndices(half2View, 0, half2Len - 1, tolerance, keep2);
  for (let i = 0; i < half2Len - 1; i++) if (keep2[i]) keep[anchor1 + i] = 1;

  const out: THREE.Vector2[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(deduped[i]);
  return out.length >= 3 ? out : deduped;
}
