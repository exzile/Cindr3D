import type { Triangle } from '../types';

export function computeAdaptiveLayerZs(
  triangles: Triangle[],
  modelHeight: number,
  firstLayerHeight: number,
  baseLayerHeight: number,
  maxVariation: number,
  variationStep: number,
  zScale: number,
): number[] {
  const minH = Math.max(0.04, baseLayerHeight - maxVariation);
  const maxH = Math.max(minH + 0.01, baseLayerHeight + maxVariation);

  let modelMinZ = Infinity;
  for (const tri of triangles) {
    const z = Math.min(tri.v0.z, tri.v1.z, tri.v2.z);
    if (z < modelMinZ) modelMinZ = z;
  }
  if (!isFinite(modelMinZ)) modelMinZ = 0;

  const binSize = Math.max(0.025, minH / 2);
  const numBins = Math.max(1, Math.ceil(modelHeight / binSize) + 2);
  const maxPenalty = new Float32Array(numBins);

  for (const tri of triangles) {
    const nz = Math.abs(tri.normal.z);
    const penalty = 2 * nz * Math.sqrt(Math.max(0, 1 - nz * nz));
    if (penalty <= 0) continue;
    const zMinT = Math.min(tri.v0.z, tri.v1.z, tri.v2.z) - modelMinZ;
    const zMaxT = Math.max(tri.v0.z, tri.v1.z, tri.v2.z) - modelMinZ;
    const bStart = Math.max(0, Math.floor(zMinT / binSize));
    const bEnd = Math.min(numBins - 1, Math.ceil(zMaxT / binSize));
    for (let b = bStart; b <= bEnd; b++) {
      if (penalty > maxPenalty[b]) maxPenalty[b] = penalty;
    }
  }

  const idealH = new Float32Array(numBins);
  for (let b = 0; b < numBins; b++) {
    idealH[b] = maxH - (maxH - minH) * Math.min(1, maxPenalty[b]);
  }

  for (let b = 1; b < numBins; b++) {
    if (idealH[b] > idealH[b - 1] + variationStep) {
      idealH[b] = idealH[b - 1] + variationStep;
    }
  }
  for (let b = numBins - 2; b >= 0; b--) {
    if (idealH[b] > idealH[b + 1] + variationStep) {
      idealH[b] = idealH[b + 1] + variationStep;
    }
  }

  const layerZs: number[] = [];
  let z = firstLayerHeight;
  layerZs.push(z * zScale);
  while (z < modelHeight - 1e-4) {
    const bin = Math.min(numBins - 1, Math.max(0, Math.floor(z / binSize)));
    const h = Math.max(minH, Math.min(maxH, idealH[bin]));
    z = Math.min(modelHeight, z + h);
    layerZs.push(z * zScale);
  }
  return layerZs;
}
