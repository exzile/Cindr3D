import * as THREE from 'three';
import type { Feature } from '../../../../types/cad';
import type { BRepTessellation } from '../../../../engine/occ/brepBody';

/** Find the OCC face ID whose tessellation centroid is closest to a world-space target centroid. */
export function findOccFaceIdByCentroid(
  tess: BRepTessellation,
  targetCentroid: [number, number, number],
): number | null {
  const faceCentroids = new Map<number, { sx: number; sy: number; sz: number; n: number }>();
  const numTris = tess.faceIds.length;
  for (let i = 0; i < numTris; i++) {
    const faceId = tess.faceIds[i];
    const b = i * 9;
    const cx = (tess.positions[b] + tess.positions[b + 3] + tess.positions[b + 6]) / 3;
    const cy = (tess.positions[b + 1] + tess.positions[b + 4] + tess.positions[b + 7]) / 3;
    const cz = (tess.positions[b + 2] + tess.positions[b + 5] + tess.positions[b + 8]) / 3;
    const entry = faceCentroids.get(faceId);
    if (entry) { entry.sx += cx; entry.sy += cy; entry.sz += cz; entry.n++; }
    else faceCentroids.set(faceId, { sx: cx, sy: cy, sz: cz, n: 1 });
  }
  const [tx, ty, tz] = targetCentroid;
  let bestId: number | null = null;
  let bestDist = Infinity;
  for (const [id, { sx, sy, sz, n }] of faceCentroids) {
    const d = (sx / n - tx) ** 2 + (sy / n - ty) ** 2 + (sz / n - tz) ** 2;
    if (d < bestDist) { bestDist = d; bestId = id; }
  }
  return bestId;
}

/** Guard: resolve a feature → mesh pair, calling onMissing with a status message when absent. */
export function requireMesh(
  features: Feature[],
  featureId: string,
  label: string,
  onMissing: (msg: string) => void,
): { srcFeature: Feature; srcMesh: THREE.Mesh } | null {
  const srcFeature = features.find((f) => f.id === featureId);
  const srcMesh = srcFeature?.mesh as THREE.Mesh | undefined;
  if (!srcFeature || !srcMesh?.isMesh) {
    onMissing(`${label}: no mesh found for selected feature`);
    return null;
  }
  return { srcFeature, srcMesh };
}
