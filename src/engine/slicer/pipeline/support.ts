import * as THREE from 'three';

import type { PrintProfile, SliceMove } from '../../../types/slicer';
import type { SupportDeps } from '../../../types/slicer-pipeline-deps.types';
import type { BBox2, Contour, Triangle } from '../../../types/slicer-pipeline.types';

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
  if (isRoof || isFloor) {
    const ifHorizExp = pp.supportInterfaceHorizontalExpansion ?? 0;
    bbox = { minX: bbox.minX - ifHorizExp, maxX: bbox.maxX + ifHorizExp, minY: bbox.minY - ifHorizExp, maxY: bbox.maxY + ifHorizExp };
  }

  const settings = supportLineSettings(pp, layerIndex, isRoof, isFloor);
  const { supLW, spacing, pattern, speed, flowOverride } = settings;
  if (!(spacing > 0) || !isFinite(spacing)) return flowOverride;

  const wallCount = isRoof || isFloor
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

  const angle = patternAngle(pp, layerIndex, pattern, isRoof || isFloor);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const maxDim = Math.max(bbox.maxX - bbox.minX, bbox.maxY - bbox.minY) * 1.5;
  const centerX = (bbox.minX + bbox.maxX) / 2;
  const centerY = (bbox.minY + bbox.maxY) / 2;
  const xyDist = pp.supportXYDistance;
  let scanCount = 0;

  for (let d = -maxDim / 2; d <= maxDim / 2; d += spacing) {
    if (++scanCount > 50000) break;
    const p1x = centerX + cos * (-maxDim) - sin * d;
    const p1y = centerY + sin * (-maxDim) + cos * d;
    const p2x = centerX + cos * maxDim - sin * d;
    const p2y = centerY + sin * maxDim + cos * d;
    const fromX = Math.max(Math.min(p1x, p2x), bbox.minX + xyDist);
    const toX = Math.min(Math.max(p1x, p2x), bbox.maxX - xyDist);
    const fromY = Math.max(Math.min(p1y, p2y), bbox.minY + xyDist);
    const toY = Math.min(Math.max(p1y, p2y), bbox.maxY - xyDist);
    if (Math.abs(fromX - toX) <= 0.5 && Math.abs(fromY - toY) <= 0.5) continue;

    const midPt = new THREE.Vector2((fromX + toX) / 2, (fromY + toY) / 2);
    if (pointInsideMaterial(midPt, modelContours, deps)) continue;
    moves.push({
      type: 'support',
      from: { x: fromX, y: fromY },
      to: { x: toX, y: toY },
      speed,
      extrusion: 0,
      lineWidth: supLW,
    });
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
): { moves: SliceMove[]; flowOverride?: number } {
  if (pp.supportType === 'tree' || pp.supportType === 'organic') {
    return { moves: generateTreeSupportForLayer(triangles, sliceZ, layerIndex, offsetX, offsetY, modelContours, pp, deps) };
  }

  const moves: SliceMove[] = [];
  const islands = overhangIslands(triangles, sliceZ, offsetX, offsetY, pp);
  if (islands.length === 0) return { moves };

  const { roof, floor } = supportInterfaceState(triangles, sliceZ, pp);
  let flowOverride: number | undefined;
  for (const island of islands) {
    const bbox = islandBBox(island, pp, layerZ, layerIndex, modelHeight);
    if (!bbox) continue;
    const islandFlow = emitSupportIsland(moves, bbox, layerIndex, pp, modelContours, deps, roof, floor);
    if (islandFlow !== undefined) flowOverride = islandFlow;
  }

  return { moves, flowOverride };
}
