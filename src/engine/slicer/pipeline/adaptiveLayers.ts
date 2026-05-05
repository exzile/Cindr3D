import type { Triangle } from '../../../types/slicer-pipeline.types';

export function computeAdaptiveLayerZs(
  triangles: Triangle[],
  modelHeight: number,
  firstLayerHeight: number,
  baseLayerHeight: number,
  maxVariation: number,
  variationStep: number,
  zScale: number,
  topographySize: number = 0,
  minLayerHeight?: number,
  maxLayerHeight?: number,
): number[] {
  const variationMinH = Math.max(0.04, baseLayerHeight - maxVariation);
  const variationMaxH = Math.max(variationMinH + 0.01, baseLayerHeight + maxVariation);
  const requestedMinH = typeof minLayerHeight === 'number' && minLayerHeight > 0
    ? minLayerHeight
    : variationMinH;
  const requestedMaxH = typeof maxLayerHeight === 'number' && maxLayerHeight > 0
    ? maxLayerHeight
    : variationMaxH;
  const minH = Math.min(requestedMinH, requestedMaxH);
  const maxH = Math.max(minH + 0.01, requestedMaxH);

  let modelMinZ = Infinity;
  for (const tri of triangles) {
    const z = Math.min(tri.v0.z, tri.v1.z, tri.v2.z);
    if (z < modelMinZ) modelMinZ = z;
  }
  if (!isFinite(modelMinZ)) modelMinZ = 0;

  const binSize = Math.max(0.025, minH / 2);
  const numBins = Math.max(1, Math.ceil(modelHeight / binSize) + 2);
  const maxPenalty = new Float32Array(numBins);
  // Cura "Adaptive Layers Topography Size" — for each bin, compute the
  // shallowest slope angle present in any triangle that touches the bin.
  // The final ideal height is capped at `topographySize / sin(slope)` so
  // the visible step on a slope never exceeds `topographySize` mm.
  // Storing min |nz| (most-vertical normal) per bin gives the steepest
  // slope from horizontal in that bin; a high value means the bin contains
  // a near-flat surface that needs thin layers to keep step size small.
  // We default to 1.0 (flat) which would cap to 0 — guard with a flag bin.
  const topoEnabled = topographySize > 0;
  const minHorizNz = topoEnabled ? new Float32Array(numBins) : null;
  if (minHorizNz) {
    for (let b = 0; b < numBins; b++) minHorizNz[b] = -1; // sentinel = no slope contributing
  }

  for (const tri of triangles) {
    const nz = Math.abs(tri.normal.z);
    const penalty = 2 * nz * Math.sqrt(Math.max(0, 1 - nz * nz));
    const zMinT = Math.min(tri.v0.z, tri.v1.z, tri.v2.z) - modelMinZ;
    const zMaxT = Math.max(tri.v0.z, tri.v1.z, tri.v2.z) - modelMinZ;
    const bStart = Math.max(0, Math.floor(zMinT / binSize));
    const bEnd = Math.min(numBins - 1, Math.ceil(zMaxT / binSize));
    if (penalty > 0) {
      for (let b = bStart; b <= bEnd; b++) {
        if (penalty > maxPenalty[b]) maxPenalty[b] = penalty;
      }
    }
    // Track shallowest non-vertical slope for topography. A surface with
    // small but non-zero `nz` (very vertical) projects an invisible step;
    // surfaces with larger `nz` project a longer visible step that we want
    // to constrain. Skip nz~0 (vertical walls) and nz~1 (flat tops/bottoms,
    // no visible "step" issue). We track the LARGEST nz<1 (most-flat,
    // most-stepping-prone) for the cap.
    if (minHorizNz && nz > 0.05 && nz < 0.999) {
      for (let b = bStart; b <= bEnd; b++) {
        if (nz > minHorizNz[b]) minHorizNz[b] = nz;
      }
    }
  }

  const idealH = new Float32Array(numBins);
  for (let b = 0; b < numBins; b++) {
    idealH[b] = maxH - (maxH - minH) * Math.min(1, maxPenalty[b]);
    if (minHorizNz && minHorizNz[b] > 0) {
      // Visible step per layer = layerHeight * |nz| / sqrt(1 - nz²)
      // (where nz is normal's vertical component — small nz means vertical
      //  wall, no visible step; large nz means near-flat slope).
      // Solving step ≤ topographySize for layerHeight:
      // layerHeight ≤ topographySize * sqrt(1 - nz²) / nz
      const nz = minHorizNz[b];
      const sinSlope = Math.sqrt(Math.max(0, 1 - nz * nz));
      const topoMaxH = nz > 0 ? (topographySize * sinSlope) / nz : maxH;
      if (topoMaxH < idealH[b]) idealH[b] = Math.max(minH, topoMaxH);
    }
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
