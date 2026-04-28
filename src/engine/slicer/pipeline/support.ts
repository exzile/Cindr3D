import * as THREE from 'three';
import type { MultiPolygon as PCMultiPolygon } from 'polygon-clipping';

import type { PrintProfile, SliceMove } from '../../../types/slicer';
import type { SupportDeps } from '../../../types/slicer-pipeline-deps.types';
import type { BBox2, Contour, Triangle } from '../../../types/slicer-pipeline.types';

/**
 * Optional per-layer modifier-mesh regions consumed by the support
 * generator: `forcedSupportMP` adds support inside arbitrary volumes
 * (Cura's "Support Mesh"); `blockedSupportMP` suppresses support inside
 * arbitrary volumes (Cura's "Anti-Overhang Mesh").
 */
export interface SupportModifierRegions {
  forcedSupportMP?: PCMultiPolygon;
  blockedSupportMP?: PCMultiPolygon;
}

interface SupportIsland {
  points: THREE.Vector2[];
  centroid: THREE.Vector2;
  area: number;
  maxZ: number;
  minZ: number;
}

interface TreeAnchor {
  cx: number;
  cy: number;
  topZ: number;
  weight: number;
}

function triangleArea2D(points: THREE.Vector2[]): number {
  if (points.length < 3) return 0;
  return Math.abs(
    (points[0].x * (points[1].y - points[2].y)
    + points[1].x * (points[2].y - points[0].y)
    + points[2].x * (points[0].y - points[1].y)) / 2,
  );
}

function pointInsideMaterial(point: THREE.Vector2, contours: Contour[], deps: SupportDeps): boolean {
  let insideOuter = false;
  for (const contour of contours) {
    if (contour.isOuter && deps.pointInContour(point, contour.points)) {
      insideOuter = true;
      break;
    }
  }
  if (!insideOuter) return false;
  for (const contour of contours) {
    if (!contour.isOuter && deps.pointInContour(point, contour.points)) return false;
  }
  return true;
}

function overhangIslands(
  triangles: Triangle[],
  sliceZ: number,
  offsetX: number,
  offsetY: number,
  pp: PrintProfile,
): SupportIsland[] {
  const overhangAngleRad = (pp.supportAngle * Math.PI) / 180;
  const topGap = pp.supportTopDistance ?? pp.supportZDistance ?? 0;
  const regions: SupportIsland[] = [];

  for (const tri of triangles) {
    const dotUp = tri.normal.z;
    const clamped = Math.max(0, Math.min(1, Math.abs(dotUp)));
    const faceAngle = Math.acos(clamped);
    if (dotUp >= 0 || faceAngle <= overhangAngleRad) continue;

    const minZ = Math.min(tri.v0.z, tri.v1.z, tri.v2.z);
    const maxZ = Math.max(tri.v0.z, tri.v1.z, tri.v2.z);
    if (sliceZ < minZ || sliceZ > maxZ + pp.layerHeight - topGap) continue;

    const points = [
      new THREE.Vector2(tri.v0.x + offsetX, tri.v0.y + offsetY),
      new THREE.Vector2(tri.v1.x + offsetX, tri.v1.y + offsetY),
      new THREE.Vector2(tri.v2.x + offsetX, tri.v2.y + offsetY),
    ];
    const centroid = new THREE.Vector2(
      (points[0].x + points[1].x + points[2].x) / 3,
      (points[0].y + points[1].y + points[2].y) / 3,
    );
    regions.push({ points, centroid, area: triangleArea2D(points), minZ, maxZ });
  }

  const joinDistance = Math.max(pp.supportJoinDistance ?? 2, pp.supportLineWidth ?? pp.wallLineWidth);
  const clusters: SupportIsland[] = [];
  for (const region of regions) {
    let best: SupportIsland | null = null;
    let bestDistance = Infinity;
    for (const cluster of clusters) {
      const distance = cluster.centroid.distanceTo(region.centroid);
      if (distance <= joinDistance && distance < bestDistance) {
        best = cluster;
        bestDistance = distance;
      }
    }
    if (!best) {
      clusters.push({ ...region, points: [...region.points] });
      continue;
    }
    const nextArea = best.area + region.area;
    best.centroid.multiplyScalar(best.area / Math.max(nextArea, 1e-6));
    best.centroid.add(region.centroid.clone().multiplyScalar(region.area / Math.max(nextArea, 1e-6)));
    best.area = nextArea;
    best.minZ = Math.min(best.minZ, region.minZ);
    best.maxZ = Math.max(best.maxZ, region.maxZ);
    best.points.push(...region.points);
  }
  return clusters;
}

function islandBBox(island: SupportIsland, pp: PrintProfile, layerZ: number, layerIndex: number, modelHeight: number): BBox2 | null {
  let bbox: BBox2 = {
    minX: Math.min(...island.points.map((p) => p.x)),
    maxX: Math.max(...island.points.map((p) => p.x)),
    minY: Math.min(...island.points.map((p) => p.y)),
    maxY: Math.max(...island.points.map((p) => p.y)),
  };

  if (pp.enableConicalSupport) {
    const angleRad = ((pp.conicalSupportAngle ?? 30) * Math.PI) / 180;
    const shrinkPerLayer = Math.tan(angleRad) * pp.layerHeight;
    const shrink = shrinkPerLayer * layerIndex;
    bbox = {
      minX: bbox.minX + shrink,
      maxX: bbox.maxX - shrink,
      minY: bbox.minY + shrink,
      maxY: bbox.maxY - shrink,
    };
    if (bbox.maxX <= bbox.minX || bbox.maxY <= bbox.minY) return null;
  }

  if ((pp.supportStairStepHeight ?? 0) > 0 && (pp.supportStairStepMinSlope ?? 0) > 0) {
    const stepLayers = Math.max(1, Math.ceil((pp.supportStairStepHeight ?? 0.3) / pp.layerHeight));
    if (layerIndex < stepLayers) {
      const maxW = pp.supportStairStepMaxWidth ?? 0;
      const pad = maxW > 0 ? Math.min(pp.wallLineWidth, maxW / 2) : pp.wallLineWidth;
      bbox = { minX: bbox.minX - pad, maxX: bbox.maxX + pad, minY: bbox.minY - pad, maxY: bbox.maxY + pad };
    }
  }

  const conicalAngle = pp.enableConicalSupport ? pp.conicalSupportAngle ?? 0 : 0;
  if (conicalAngle > 0 && modelHeight > 0) {
    const expansion = Math.tan((conicalAngle * Math.PI) / 180) * Math.max(0, modelHeight - layerZ);
    const actualExp = Math.max((pp.conicalSupportMinWidth ?? 0) / 2, expansion);
    bbox = { minX: bbox.minX - actualExp, maxX: bbox.maxX + actualExp, minY: bbox.minY - actualExp, maxY: bbox.maxY + actualExp };
  }

  const minArea = pp.minimumSupportArea ?? 0;
  if (minArea > 0 && (bbox.maxX - bbox.minX) * (bbox.maxY - bbox.minY) < minArea) return null;

  const horizExp = pp.supportHorizontalExpansion ?? 0;
  const minXYGap = Math.max(0, (pp.minSupportXYDistance ?? 0) - (pp.supportXYDistance ?? 0));
  bbox = {
    minX: bbox.minX - horizExp + minXYGap,
    maxX: bbox.maxX + horizExp - minXYGap,
    minY: bbox.minY - horizExp + minXYGap,
    maxY: bbox.maxY + horizExp - minXYGap,
  };
  return bbox.maxX > bbox.minX && bbox.maxY > bbox.minY ? bbox : null;
}

function supportInterfaceState(triangles: Triangle[], sliceZ: number, pp: PrintProfile): { roof: boolean; floor: boolean } {
  const legacyInterface = pp.supportInterface && (pp.supportInterfaceLayers ?? 0) > 0;
  const roofThickness = pp.supportRoofEnable || legacyInterface
    ? pp.supportRoofThickness ?? pp.supportInterfaceThickness ?? (pp.supportInterfaceLayers ?? 0) * pp.layerHeight
    : 0;
  const floorThickness = pp.supportFloorEnable || legacyInterface
    ? pp.supportFloorThickness ?? pp.supportInterfaceThickness ?? (pp.supportInterfaceLayers ?? 0) * pp.layerHeight
    : 0;
  const supZDist = pp.supportZDistance ?? 0;
  let roof = false;
  let floor = false;

  for (const tri of triangles) {
    const triMinZ = Math.min(tri.v0.z, tri.v1.z, tri.v2.z);
    const triMaxZ = Math.max(tri.v0.z, tri.v1.z, tri.v2.z);
    if (!roof && roofThickness > 0 && triMinZ > sliceZ && triMinZ <= sliceZ + supZDist + roofThickness) roof = true;
    if (!floor && floorThickness > 0 && triMaxZ < sliceZ && triMaxZ >= sliceZ - supZDist - floorThickness) floor = true;
    if (roof && floor) break;
  }
  return { roof, floor };
}

export function supportDensityForLayer(
  pp: Pick<PrintProfile, 'supportDensity' | 'supportInfillDensityMultiplierInitialLayer'>,
  layerIndex: number,
): number {
  const baseDensity = Math.max(0, pp.supportDensity ?? 0);
  if (layerIndex !== 0) return baseDensity;
  const multiplier = pp.supportInfillDensityMultiplierInitialLayer ?? 100;
  return Math.min(100, Math.max(0, baseDensity * (multiplier / 100)));
}

/**
 * Cura's "Minimum Support Interface Area" filter: when a roof/floor
 * island's expanded bbox area falls below the threshold the dense
 * interface ribbon is suppressed and the island is emitted at normal
 * (body) support settings. Returns true when the interface should be
 * demoted to non-interface; false when it should print as interface.
 */
export function shouldDemoteSupportInterface(
  bbox: { minX: number; maxX: number; minY: number; maxY: number },
  minSupportInterfaceArea: number | undefined,
): boolean {
  const threshold = minSupportInterfaceArea ?? 0;
  if (threshold <= 0) return false;
  const w = Math.max(0, bbox.maxX - bbox.minX);
  const h = Math.max(0, bbox.maxY - bbox.minY);
  return w * h < threshold;
}

/**
 * Cura's "Use Towers" eligibility check: when `useTowers` is on AND the
 * overhang island is small enough that a tower would cover it, the
 * island is replaced by a circular tower of `towerDiameter` (with a
 * roof flare governed by `towerRoofAngle`) instead of the normal
 * scanline support pattern. Returns true when the island should print
 * as a tower.
 *
 * The threshold is the larger of the two bbox dimensions: we route any
 * island whose largest extent fits within the tower diameter through
 * the tower path. Mirrors Cura's `support_minimal_diameter` default of
 * `support_tower_diameter`.
 */
export function shouldEmitSupportTower(
  bbox: { minX: number; maxX: number; minY: number; maxY: number },
  useTowers: boolean | undefined,
  towerDiameter: number | undefined,
): boolean {
  if (!useTowers) return false;
  const d = towerDiameter ?? 0;
  if (d <= 0) return false;
  const w = Math.max(0, bbox.maxX - bbox.minX);
  const h = Math.max(0, bbox.maxY - bbox.minY);
  return Math.max(w, h) <= d;
}

/**
 * Cura's tower roof flare: the tower's effective radius widens from
 * `baseRadius` (the column radius, `towerDiameter / 2`) up to
 * `islandRadius` (just enough to cover the overhang) over a roof of
 * height `(islandRadius - baseRadius) * tan(towerRoofAngle)` measured
 * from horizontal. Layers below the flare zone use `baseRadius`; layers
 * inside the flare zone interpolate linearly toward `islandRadius` at
 * the top.
 *
 * `distFromTop` is the vertical distance from the current layer up to
 * the topmost overhang surface (`island.maxZ - layerZ`).
 */
export function towerRadiusForLayer(
  baseRadius: number,
  islandRadius: number,
  towerRoofAngleDeg: number | undefined,
  distFromTop: number,
): number {
  if (islandRadius <= baseRadius) return baseRadius;
  const angleRad = ((towerRoofAngleDeg ?? 65) * Math.PI) / 180;
  // tan(angle) maps a delta-radius to the flare height. Higher angle =
  // taller flare per unit of widening (Cura: "higher value will result
  // in pointed tower roofs" — pointed because the flare is taller, the
  // taper happens over more layers, and the column stays narrow longer).
  const flareHeight = (islandRadius - baseRadius) * Math.tan(angleRad);
  const dz = Math.max(0, distFromTop);
  if (flareHeight <= 0 || dz >= flareHeight) return baseRadius;
  const t = 1 - dz / flareHeight; // 0 at the bottom of the flare, 1 at the top
  return baseRadius + t * (islandRadius - baseRadius);
}

/**
 * Cura's "Break Up Support In Chunks": instead of a single dense pattern
 * that runs the full width of an island, the scanline emitter walks N
 * lines (`chunkLineCount`), then jumps a `chunkSize`-mm gap before the
 * next chunk starts. This keeps the support easier to remove and makes
 * cooler regions of the print less likely to lift off the bed during
 * the support pass.
 *
 * Returns the d-axis advance to apply after the just-emitted line and
 * whether the per-chunk line counter should reset. When chunking is
 * disabled (or any required parameter is missing/non-positive) the
 * advance is just the regular scanline `spacing` and the counter never
 * resets — equivalent to the legacy behavior.
 */
export interface ChunkStepResult { advance: number; resetCount: boolean; }
export function chunkStep(
  spacing: number,
  linesEmittedInChunk: number,
  chunkLineCount: number | undefined,
  chunkSize: number | undefined,
  enabled: boolean | undefined,
): ChunkStepResult {
  const N = chunkLineCount ?? 0;
  const gap = chunkSize ?? 0;
  if (!enabled || N <= 0 || gap <= 0 || linesEmittedInChunk < N) {
    return { advance: spacing, resetCount: false };
  }
  return { advance: gap, resetCount: true };
}

/**
 * Cura's "Support Distance Priority": resolves the conflict between the
 * XY-clearance gap (`supportXYDistance`) and the vertical Z-gap
 * (`supportZDistance` / `supportTopDistance`) when they overlap at a
 * model corner.
 *
 * - `xy_overrides_z` (default): XY clearance always wins; the support
 *   stays away from the model walls in XY even at the cost of less
 *   vertical coverage. This is our existing behavior — the helper
 *   returns the user's `supportXYDistance` unchanged.
 * - `z_overrides_xy`: the Z gap does the separation work, so XY
 *   clearance is relaxed to 0 in the layers where the Z gap is
 *   actively in play (roof / floor interface bands). Result: support
 *   covers more of the overhang at the cost of touching walls in XY.
 *
 * `isInterfaceLayer` is true when the current layer is a roof or floor
 * band (the Z-gap zone). Body layers always keep the full XY clearance
 * regardless of priority — there's no "Z gap" actively in play down
 * there to take over the separation duty.
 */
export function effectiveSupportXYDistance(
  baseXYDistance: number,
  priority: PrintProfile['supportDistancePriority'] | undefined,
  isInterfaceLayer: boolean,
): number {
  if (priority === 'z_overrides_xy' && isInterfaceLayer) return 0;
  return baseXYDistance;
}

function supportLineSettings(pp: PrintProfile, layerIndex: number, isRoof: boolean, isFloor: boolean) {
  const supLW = pp.supportLineWidth ?? pp.wallLineWidth;
  const supportDensity = supportDensityForLayer(pp, layerIndex);
  const baseSpacing = (pp.supportLineDistance ?? 0) > 0
    ? pp.supportLineDistance ?? 1
    : supLW / Math.max(0.01, supportDensity / 100);
  let spacing = layerIndex === 0 && (pp.initialLayerSupportLineDistance ?? 0) > 0
    ? pp.initialLayerSupportLineDistance!
    : baseSpacing;
  let pattern: string = pp.supportPattern;
  let speed = pp.supportInfillSpeed ?? pp.supportSpeed ?? pp.printSpeed * 0.8;
  let flowOverride: number | undefined;

  if (isRoof || isFloor) {
    if ((pp.supportInterfaceSpeed ?? 0) > 0) speed = pp.supportInterfaceSpeed!;
    if (isRoof) {
      if ((pp.supportRoofSpeed ?? 0) > 0) speed = pp.supportRoofSpeed!;
      if ((pp.supportRoofFlow ?? 0) > 0) flowOverride = pp.supportRoofFlow! / 100;
      const density = pp.supportRoofDensity ?? pp.supportInterfaceDensity ?? pp.supportDensity;
      spacing = (pp.supportRoofLineDistance ?? 0) > 0 ? pp.supportRoofLineDistance! : supLW / Math.max(0.01, density / 100);
      pattern = pp.supportRoofPattern ?? pp.supportInterfacePattern ?? pattern;
    } else {
      if ((pp.supportFloorSpeed ?? 0) > 0) speed = pp.supportFloorSpeed!;
      if ((pp.supportFloorFlow ?? 0) > 0) flowOverride = pp.supportFloorFlow! / 100;
      const density = pp.supportFloorDensity ?? pp.supportInterfaceDensity ?? pp.supportDensity;
      spacing = (pp.supportFloorLineDistance ?? 0) > 0 ? pp.supportFloorLineDistance! : supLW / Math.max(0.01, density / 100);
      pattern = pp.supportFloorPattern ?? pp.supportInterfacePattern ?? pattern;
    }
  } else {
    const gradSteps = pp.gradualSupportSteps ?? 0;
    const gradHeight = pp.gradualSupportStepHeight ?? 1.0;
    if (gradSteps > 0 && gradHeight > 0) {
      const totalGradZ = gradSteps * gradHeight;
      const fromTop = Math.max(0, totalGradZ - (layerIndex * pp.layerHeight) % totalGradZ);
      const stepN = Math.min(gradSteps, Math.floor(fromTop / gradHeight));
      if (stepN > 0) spacing = baseSpacing * Math.pow(2, stepN);
    }
  }
  return { supLW, spacing, pattern, speed, flowOverride };
}

function patternAngle(pp: PrintProfile, layerIndex: number, pattern: string, isInterface: boolean): number {
  const dirs = isInterface
    ? pp.supportInterfaceLineDirections ?? pp.supportInfillLineDirections ?? null
    : pp.supportInfillLineDirections ?? null;
  if (dirs && dirs.length > 0) return (dirs[layerIndex % dirs.length] * Math.PI) / 180;
  if (pattern === 'grid') return layerIndex % 2 === 0 ? 0 : Math.PI / 2;
  if (pattern === 'zigzag') return layerIndex % 2 === 0 ? Math.PI / 4 : -Math.PI / 4;
  return 0;
}

function emitSupportIsland(
  moves: SliceMove[],
  bboxIn: BBox2,
  layerIndex: number,
  pp: PrintProfile,
  modelContours: Contour[],
  deps: SupportDeps,
  isRoof: boolean,
  isFloor: boolean,
): number | undefined {
  let bbox = { ...bboxIn };
  let effRoof = isRoof;
  let effFloor = isFloor;
  if (effRoof || effFloor) {
    const ifHorizExp = pp.supportInterfaceHorizontalExpansion ?? 0;
    bbox = { minX: bbox.minX - ifHorizExp, maxX: bbox.maxX + ifHorizExp, minY: bbox.minY - ifHorizExp, maxY: bbox.maxY + ifHorizExp };

    // Drop interface (roof/floor) regions that fall below the user's
    // minimum interface area. Mirrors `minimumSupportArea` but applies
    // only to the dense interface band — tiny dense patches over a
    // small overhang would otherwise blob and are generally unhelpful.
    // The body of the support (non-interface) still emits at normal
    // density; we just demote this island to non-interface settings.
    if (shouldDemoteSupportInterface(bbox, pp.minSupportInterfaceArea)) {
      bbox = { ...bboxIn };
      effRoof = false;
      effFloor = false;
    }
  }

  const settings = supportLineSettings(pp, layerIndex, effRoof, effFloor);
  const { supLW, spacing, pattern, speed, flowOverride } = settings;
  if (!(spacing > 0) || !isFinite(spacing)) return flowOverride;

  const wallCount = effRoof || effFloor
    ? pp.supportInterfaceWallCount ?? pp.supportWallLineCount ?? pp.supportWallCount ?? 0
    : pp.supportWallLineCount ?? pp.supportWallCount ?? 0;
  for (let w = 0; w < wallCount; w++) {
    const wallOff = w * supLW + supLW / 2;
    const corners = [
      { x: bbox.minX - wallOff, y: bbox.minY - wallOff },
      { x: bbox.maxX + wallOff, y: bbox.minY - wallOff },
      { x: bbox.maxX + wallOff, y: bbox.maxY + wallOff },
      { x: bbox.minX - wallOff, y: bbox.maxY + wallOff },
      { x: bbox.minX - wallOff, y: bbox.minY - wallOff },
    ];
    for (let ci = 1; ci < corners.length; ci++) {
      moves.push({ type: 'support', from: corners[ci - 1], to: corners[ci], speed, extrusion: 0, lineWidth: supLW });
    }
  }

  const angle = patternAngle(pp, layerIndex, pattern, effRoof || effFloor);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const maxDim = Math.max(bbox.maxX - bbox.minX, bbox.maxY - bbox.minY) * 1.5;
  const centerX = (bbox.minX + bbox.maxX) / 2;
  const centerY = (bbox.minY + bbox.maxY) / 2;
  const xyDist = effectiveSupportXYDistance(
    pp.supportXYDistance,
    pp.supportDistancePriority,
    effRoof || effFloor,
  );
  let scanCount = 0;

  // Chunked scanline emission — when `breakUpSupportInChunks` is on,
  // every `breakUpSupportChunkLineCount` lines we jump ahead by
  // `breakUpSupportChunkSize` mm in the d-axis to leave a gap. Roof and
  // floor interface bands NEVER chunk: those need to stay continuous so
  // the model surface above/below them sees a solid bed of support.
  const chunkEnabled = !(effRoof || effFloor) && (pp.breakUpSupportInChunks ?? false);
  let linesInChunk = 0;
  let d = -maxDim / 2;
  while (d <= maxDim / 2) {
    if (++scanCount > 50000) break;
    const p1x = centerX + cos * (-maxDim) - sin * d;
    const p1y = centerY + sin * (-maxDim) + cos * d;
    const p2x = centerX + cos * maxDim - sin * d;
    const p2y = centerY + sin * maxDim + cos * d;
    const fromX = Math.max(Math.min(p1x, p2x), bbox.minX + xyDist);
    const toX = Math.min(Math.max(p1x, p2x), bbox.maxX - xyDist);
    const fromY = Math.max(Math.min(p1y, p2y), bbox.minY + xyDist);
    const toY = Math.min(Math.max(p1y, p2y), bbox.maxY - xyDist);
    const tooShort = Math.abs(fromX - toX) <= 0.5 && Math.abs(fromY - toY) <= 0.5;
    let emitted = false;
    if (!tooShort) {
      const midPt = new THREE.Vector2((fromX + toX) / 2, (fromY + toY) / 2);
      if (!pointInsideMaterial(midPt, modelContours, deps)) {
        moves.push({
          type: 'support',
          from: { x: fromX, y: fromY },
          to: { x: toX, y: toY },
          speed,
          extrusion: 0,
          lineWidth: supLW,
        });
        emitted = true;
      }
    }

    if (emitted) linesInChunk += 1;
    const step = chunkStep(
      spacing,
      linesInChunk,
      pp.breakUpSupportChunkLineCount,
      pp.breakUpSupportChunkSize,
      chunkEnabled,
    );
    d += step.advance;
    if (step.resetCount) linesInChunk = 0;
  }

  return flowOverride;
}

function collectTreeAnchors(triangles: Triangle[], sliceZ: number, offsetX: number, offsetY: number, pp: PrintProfile): TreeAnchor[] {
  const overhangAngleRad = (pp.supportAngle * Math.PI) / 180;
  const topGap = pp.supportTopDistance ?? pp.supportZDistance ?? 0;
  const minHeight = pp.supportTreeMinHeight ?? 0;
  const anchors: TreeAnchor[] = [];
  for (const tri of triangles) {
    const dotUp = tri.normal.z;
    const faceAngle = Math.acos(Math.max(0, Math.min(1, Math.abs(dotUp))));
    if (dotUp >= 0 || faceAngle <= overhangAngleRad) continue;
    const maxZ = Math.max(tri.v0.z, tri.v1.z, tri.v2.z);
    if (maxZ - topGap <= sliceZ) continue;
    if (minHeight > 0 && maxZ - sliceZ < minHeight) continue;
    const points = [
      new THREE.Vector2(tri.v0.x + offsetX, tri.v0.y + offsetY),
      new THREE.Vector2(tri.v1.x + offsetX, tri.v1.y + offsetY),
      new THREE.Vector2(tri.v2.x + offsetX, tri.v2.y + offsetY),
    ];
    anchors.push({
      cx: (points[0].x + points[1].x + points[2].x) / 3,
      cy: (points[0].y + points[1].y + points[2].y) / 3,
      topZ: maxZ,
      weight: Math.max(triangleArea2D(points), 0.1),
    });
  }
  return anchors;
}

function mergeTreeAnchorsForLayer(anchors: TreeAnchor[], sliceZ: number, pp: PrintProfile): TreeAnchor[] {
  const baseMerge = Math.max(pp.supportTreeBranchDiameter, pp.supportJoinDistance ?? 2);
  const merged: TreeAnchor[] = [];
  for (const anchor of anchors) {
    const distBelow = Math.max(0, anchor.topZ - sliceZ);
    const mergeRadius = baseMerge + distBelow * Math.tan(((pp.supportTreeAngle ?? 60) * Math.PI) / 180) * 0.25;
    let target: TreeAnchor | null = null;
    for (const item of merged) {
      if (Math.hypot(anchor.cx - item.cx, anchor.cy - item.cy) <= mergeRadius) {
        target = item;
        break;
      }
    }
    if (!target) {
      merged.push({ ...anchor });
      continue;
    }
    const totalWeight = target.weight + anchor.weight;
    target.cx = (target.cx * target.weight + anchor.cx * anchor.weight) / totalWeight;
    target.cy = (target.cy * target.weight + anchor.cy * anchor.weight) / totalWeight;
    target.topZ = Math.max(target.topZ, anchor.topZ);
    target.weight = totalWeight;
  }
  return merged;
}

function nudgeTreeCenter(center: THREE.Vector2, radius: number, modelContours: Contour[], deps: SupportDeps): THREE.Vector2 | null {
  if (!pointInsideMaterial(center, modelContours, deps)) return center;
  const searchRadius = radius + 1;
  for (let ring = 1; ring <= 6; ring++) {
    const r = searchRadius * ring;
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const candidate = new THREE.Vector2(center.x + Math.cos(a) * r, center.y + Math.sin(a) * r);
      if (!pointInsideMaterial(candidate, modelContours, deps)) return candidate;
    }
  }
  return null;
}

function generateTreeSupportForLayer(
  triangles: Triangle[],
  sliceZ: number,
  layerIndex: number,
  offsetX: number,
  offsetY: number,
  modelContours: Contour[],
  pp: PrintProfile,
  deps: SupportDeps,
): SliceMove[] {
  const moves: SliceMove[] = [];
  const anchors = mergeTreeAnchorsForLayer(collectTreeAnchors(triangles, sliceZ, offsetX, offsetY, pp), sliceZ, pp);
  if (anchors.length === 0) return moves;

  const tipR = (pp.supportTreeTipDiameter ?? 0.8) / 2;
  const maxR = (pp.supportTreeMaxBranchDiameter ?? pp.supportTreeBranchDiameter * 4) / 2;
  const growAngleRad = ((pp.supportTreeAngle + (pp.supportTreeBranchDiameterAngle ?? 0)) * Math.PI) / 180;
  const supLW = pp.supportLineWidth ?? pp.wallLineWidth;
  const supportSpeed = pp.supportInfillSpeed ?? pp.supportSpeed ?? pp.printSpeed * 0.8;

  for (const anchor of anchors) {
    const distBelow = anchor.topZ - sliceZ;
    if (distBelow <= 0) continue;
    const r = Math.min(maxR, tipR + Math.tan(growAngleRad) * distBelow);
    if (r < supLW / 2) continue;
    const center = nudgeTreeCenter(new THREE.Vector2(anchor.cx, anchor.cy), r + pp.supportXYDistance, modelContours, deps);
    if (!center) continue;

    const segs = Math.max(8, Math.round((2 * Math.PI * r) / supLW));
    const contour: THREE.Vector2[] = [];
    for (let i = 0; i < segs; i++) {
      const a = (i / segs) * 2 * Math.PI;
      contour.push(new THREE.Vector2(center.x + Math.cos(a) * r, center.y + Math.sin(a) * r));
    }
    for (let i = 0; i < segs; i++) {
      moves.push({ type: 'support', from: contour[i], to: contour[(i + 1) % segs], speed: supportSpeed, extrusion: 0, lineWidth: supLW });
    }
    const lines = deps.generateScanLines(contour, supportDensityForLayer(pp, layerIndex), supLW, layerIndex % 2 === 0 ? 0 : Math.PI / 2);
    for (const line of lines) {
      const mid = new THREE.Vector2((line.from.x + line.to.x) / 2, (line.from.y + line.to.y) / 2);
      if (pointInsideMaterial(mid, modelContours, deps)) continue;
      moves.push({ type: 'support', from: line.from, to: line.to, speed: supportSpeed, extrusion: 0, lineWidth: supLW });
    }
  }
  return moves;
}

function rawIslandBBox(island: SupportIsland): BBox2 {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of island.points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, maxX, minY, maxY };
}

function emitTowerSupport(
  moves: SliceMove[],
  island: SupportIsland,
  layerIndex: number,
  layerZ: number,
  pp: PrintProfile,
  modelContours: Contour[],
  deps: SupportDeps,
): void {
  const supLW = pp.supportLineWidth ?? pp.wallLineWidth;
  const speed = pp.supportInfillSpeed ?? pp.supportSpeed ?? pp.printSpeed * 0.8;
  const baseR = Math.max(supLW, (pp.towerDiameter ?? 3) / 2);

  // Effective overhang radius — half the larger bbox dimension.
  const bb = rawIslandBBox(island);
  const islandR = Math.max((bb.maxX - bb.minX), (bb.maxY - bb.minY)) / 2;

  const distFromTop = Math.max(0, island.maxZ - layerZ);
  const r = towerRadiusForLayer(baseR, islandR, pp.towerRoofAngle, distFromTop);
  if (r < supLW * 0.5) return;

  // Outer wall: one circular loop at radius r centered on the island
  // centroid. Segment count keeps each side ~one line-width long, with a
  // floor of 12 to keep tiny columns visibly round.
  const center = island.centroid;
  const segs = Math.max(12, Math.round((2 * Math.PI * r) / supLW));
  const ring: THREE.Vector2[] = [];
  for (let i = 0; i < segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    ring.push(new THREE.Vector2(center.x + Math.cos(a) * r, center.y + Math.sin(a) * r));
  }
  for (let i = 0; i < segs; i++) {
    moves.push({
      type: 'support',
      from: ring[i],
      to: ring[(i + 1) % segs],
      speed,
      extrusion: 0,
      lineWidth: supLW,
    });
  }

  // Optional inner walls so the tower has a solid cross-section above
  // tiny diameters. Cap at supportInterfaceWallCount/supportWallLineCount,
  // matching how scanline support handles the wall count.
  const wallCount = Math.max(0, (pp.supportInterfaceWallCount ?? pp.supportWallLineCount ?? pp.supportWallCount ?? 0) - 1);
  for (let w = 1; w <= wallCount; w++) {
    const wr = r - w * supLW;
    if (wr < supLW * 0.5) break;
    const innerSegs = Math.max(8, Math.round((2 * Math.PI * wr) / supLW));
    const innerRing: THREE.Vector2[] = [];
    for (let i = 0; i < innerSegs; i++) {
      const a = (i / innerSegs) * Math.PI * 2;
      innerRing.push(new THREE.Vector2(center.x + Math.cos(a) * wr, center.y + Math.sin(a) * wr));
    }
    for (let i = 0; i < innerSegs; i++) {
      moves.push({
        type: 'support',
        from: innerRing[i],
        to: innerRing[(i + 1) % innerSegs],
        speed,
        extrusion: 0,
        lineWidth: supLW,
      });
    }
  }

  // Fill the column interior with parallel scanlines at the layer's
  // density. Reuses generateScanLines so the existing support-density
  // ramp / first-layer override apply identically.
  const density = supportDensityForLayer(pp, layerIndex);
  if (density > 0) {
    const angle = layerIndex % 2 === 0 ? 0 : Math.PI / 2;
    const lines = deps.generateScanLines(ring, density, supLW, angle);
    for (const line of lines) {
      const mid = new THREE.Vector2((line.from.x + line.to.x) / 2, (line.from.y + line.to.y) / 2);
      if (pointInsideMaterial(mid, modelContours, deps)) continue;
      moves.push({
        type: 'support',
        from: line.from,
        to: line.to,
        speed,
        extrusion: 0,
        lineWidth: supLW,
      });
    }
  }
}

/**
 * Synthesize support islands from a forced-support MultiPolygon (used
 * by Cura's "Support Mesh" feature). One island per outer ring; the
 * island carries the bbox of that ring as both `points` (for downstream
 * `rawIslandBBox`) and as a centroid/area pair so the generator can
 * apply the same conical/stair-step/horizontal-expansion logic as
 * triangle-derived overhang islands.
 */
export function forcedSupportIslandsFromMP(mp: PCMultiPolygon, sliceZ: number, layerH: number): SupportIsland[] {
  const islands: SupportIsland[] = [];
  for (const polygon of mp) {
    if (polygon.length === 0) continue;
    const outerRing = polygon[0];
    if (outerRing.length < 4) continue;
    const points: THREE.Vector2[] = [];
    let cx = 0; let cy = 0;
    for (let i = 0; i < outerRing.length - 1; i++) {
      const [x, y] = outerRing[i];
      points.push(new THREE.Vector2(x, y));
      cx += x;
      cy += y;
    }
    if (points.length < 3) continue;
    const inv = 1 / points.length;
    const centroid = new THREE.Vector2(cx * inv, cy * inv);
    let area = 0;
    for (let i = 0; i < points.length; i++) {
      const j = (i + 1) % points.length;
      area += points[i].x * points[j].y - points[j].x * points[i].y;
    }
    islands.push({
      points,
      centroid,
      area: Math.abs(area / 2),
      // Forced-support volume reaches up to (and beyond) sliceZ. The body
      // doesn't drive interface detection — that comes from triangles.
      maxZ: sliceZ + layerH,
      minZ: sliceZ,
    });
  }
  return islands;
}

function pointInPCMultiPolygon(x: number, y: number, mp: PCMultiPolygon): boolean {
  for (const polygon of mp) {
    if (polygon.length === 0) continue;
    const outerRing = polygon[0];
    if (!pointInRingPC(x, y, outerRing)) continue;
    let insideHole = false;
    for (let i = 1; i < polygon.length; i++) {
      if (pointInRingPC(x, y, polygon[i])) { insideHole = true; break; }
    }
    if (!insideHole) return true;
  }
  return false;
}

function pointInRingPC(x: number, y: number, ring: ReadonlyArray<readonly [number, number]>): boolean {
  // Ray-cast point-in-polygon. Ring is closed (last point == first); we
  // iterate edges between consecutive points up to length-1.
  let inside = false;
  const n = ring.length - 1;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = ring[i][0]; const yi = ring[i][1];
    const xj = ring[j][0]; const yj = ring[j][1];
    if (((yi > y) !== (yj > y)) && x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-12) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

export function filterMovesByBlockedMP(moves: SliceMove[], blocked: PCMultiPolygon): SliceMove[] {
  if (blocked.length === 0 || moves.length === 0) return moves;
  const out: SliceMove[] = [];
  for (const move of moves) {
    if (move.type !== 'support') {
      out.push(move);
      continue;
    }
    const midX = (move.from.x + move.to.x) * 0.5;
    const midY = (move.from.y + move.to.y) * 0.5;
    if (pointInPCMultiPolygon(midX, midY, blocked)) continue;
    out.push(move);
  }
  return out;
}

export function generateSupportForLayer(
  triangles: Triangle[],
  sliceZ: number,
  layerZ: number,
  layerIndex: number,
  offsetX: number,
  offsetY: number,
  modelHeight: number,
  modelContours: Contour[],
  pp: PrintProfile,
  deps: SupportDeps,
  modifierRegions?: SupportModifierRegions,
): { moves: SliceMove[]; flowOverride?: number } {
  if (pp.supportType === 'tree' || pp.supportType === 'organic') {
    let moves = generateTreeSupportForLayer(triangles, sliceZ, layerIndex, offsetX, offsetY, modelContours, pp, deps);
    if (modifierRegions?.blockedSupportMP) moves = filterMovesByBlockedMP(moves, modifierRegions.blockedSupportMP);
    return { moves };
  }

  const moves: SliceMove[] = [];
  const triangleIslands = overhangIslands(triangles, sliceZ, offsetX, offsetY, pp);
  // Cura's "Support Mesh" — append synthetic islands for forced-support
  // volumes so the generator covers them regardless of triangle overhang.
  // Forced islands skip the tower path (their shape is user-defined) and
  // route straight through the bbox-scanline body emitter so they get
  // the standard conical / stair-step / horizontal-expansion modifiers.
  const forcedIslands = modifierRegions?.forcedSupportMP
    ? forcedSupportIslandsFromMP(modifierRegions.forcedSupportMP, sliceZ, pp.layerHeight)
    : [];
  if (triangleIslands.length === 0 && forcedIslands.length === 0) return { moves };

  const { roof, floor } = supportInterfaceState(triangles, sliceZ, pp);
  let flowOverride: number | undefined;
  for (const island of triangleIslands) {
    // Tower path: small islands print as circular columns with a flared
    // roof instead of bbox-scanline support. Bypasses the conical /
    // stair-step / horizontal-expansion modifiers — those don't apply
    // to a single-column tower whose width is already user-controlled
    // via `towerDiameter`.
    if (shouldEmitSupportTower(rawIslandBBox(island), pp.useTowers, pp.towerDiameter)) {
      emitTowerSupport(moves, island, layerIndex, layerZ, pp, modelContours, deps);
      continue;
    }
    const bbox = islandBBox(island, pp, layerZ, layerIndex, modelHeight);
    if (!bbox) continue;
    const islandFlow = emitSupportIsland(moves, bbox, layerIndex, pp, modelContours, deps, roof, floor);
    if (islandFlow !== undefined) flowOverride = islandFlow;
  }
  for (const island of forcedIslands) {
    const bbox = islandBBox(island, pp, layerZ, layerIndex, modelHeight);
    if (!bbox) continue;
    // Forced-support volumes are body-mode only — they don't define a
    // floor or roof of their own (the roof/floor concept is tied to the
    // model's overhang triangles, not to user-painted support volumes).
    const islandFlow = emitSupportIsland(moves, bbox, layerIndex, pp, modelContours, deps, false, false);
    if (islandFlow !== undefined) flowOverride = islandFlow;
  }

  const finalMoves = modifierRegions?.blockedSupportMP
    ? filterMovesByBlockedMP(moves, modifierRegions.blockedSupportMP)
    : moves;
  return { moves: finalMoves, flowOverride };
}
