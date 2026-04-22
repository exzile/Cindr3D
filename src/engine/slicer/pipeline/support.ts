import * as THREE from 'three';

import type { PrintProfile, SliceMove } from '../../../types/slicer';
import type { BBox2, Contour, Triangle } from '../types';

interface SupportDeps {
  pointInContour: (pt: THREE.Vector2, contour: THREE.Vector2[]) => boolean;
  pointsBBox: (points: THREE.Vector2[]) => BBox2;
  generateScanLines: (
    contour: THREE.Vector2[],
    density: number,
    lineWidth: number,
    angle: number,
    phaseOffset?: number,
    holes?: THREE.Vector2[][],
  ) => { from: THREE.Vector2; to: THREE.Vector2 }[];
}

function mergeTreeAnchors(
  anchors: { cx: number; cy: number; topZ: number }[],
  mergeRadius: number,
): { cx: number; cy: number; topZ: number }[] {
  const merged: { cx: number; cy: number; topZ: number; count: number }[] = [];
  for (const a of anchors) {
    let found = false;
    for (const m of merged) {
      if (Math.hypot(a.cx - m.cx, a.cy - m.cy) < mergeRadius) {
        m.cx = (m.cx * m.count + a.cx) / (m.count + 1);
        m.cy = (m.cy * m.count + a.cy) / (m.count + 1);
        m.topZ = Math.max(m.topZ, a.topZ);
        m.count++;
        found = true;
        break;
      }
    }
    if (!found) merged.push({ ...a, count: 1 });
  }
  return merged;
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

  const overhangAngleRad = (pp.supportAngle * Math.PI) / 180;
  const topGap = pp.supportTopDistance ?? pp.supportZDistance ?? 0;
  const tipR = (pp.supportTreeTipDiameter ?? 0.8) / 2;
  const maxR = (pp.supportTreeMaxBranchDiameter ?? pp.supportTreeBranchDiameter * 4) / 2;
  const growAngleRad =
    ((pp.supportTreeAngle + (pp.supportTreeBranchDiameterAngle ?? 0)) * Math.PI) / 180;
  const supLW = pp.supportLineWidth ?? pp.wallLineWidth;
  const supportSpeed = pp.supportInfillSpeed ?? pp.supportSpeed ?? pp.printSpeed * 0.8;
  const minHeight = pp.supportTreeMinHeight ?? 0;

  const rawAnchors: { cx: number; cy: number; topZ: number }[] = [];
  for (const tri of triangles) {
    const dotUp = tri.normal.z;
    const clamped = Math.max(0, Math.min(1, Math.abs(dotUp)));
    const faceAngle = Math.acos(clamped);
    if (dotUp >= 0 || faceAngle <= overhangAngleRad) continue;

    const maxZ = Math.max(tri.v0.z, tri.v1.z, tri.v2.z);
    if (maxZ - topGap <= sliceZ) continue;
    if (minHeight > 0 && maxZ - sliceZ < minHeight) continue;

    rawAnchors.push({
      cx: (tri.v0.x + tri.v1.x + tri.v2.x) / 3 + offsetX,
      cy: (tri.v0.y + tri.v1.y + tri.v2.y) / 3 + offsetY,
      topZ: maxZ,
    });
  }
  if (rawAnchors.length === 0) return moves;

  const anchors = mergeTreeAnchors(rawAnchors, pp.supportTreeBranchDiameter);

  for (const anchor of anchors) {
    const distBelow = anchor.topZ - sliceZ;
    if (distBelow <= 0) continue;

    const r = Math.min(maxR, tipR + Math.tan(growAngleRad) * distBelow);
    if (r < supLW / 2) continue;

    const centerPt = new THREE.Vector2(anchor.cx, anchor.cy);
    let inside = false;
    for (const c of modelContours) {
      if (c.isOuter && deps.pointInContour(centerPt, c.points)) { inside = true; break; }
    }
    if (inside) continue;

    const segs = Math.max(8, Math.round((2 * Math.PI * r) / supLW));
    for (let i = 0; i < segs; i++) {
      const a0 = (i / segs) * 2 * Math.PI;
      const a1 = ((i + 1) / segs) * 2 * Math.PI;
      moves.push({
        type: 'support',
        from: { x: anchor.cx + Math.cos(a0) * r, y: anchor.cy + Math.sin(a0) * r },
        to: { x: anchor.cx + Math.cos(a1) * r, y: anchor.cy + Math.sin(a1) * r },
        speed: supportSpeed, extrusion: 0, lineWidth: supLW,
      });
    }

    const circContour: THREE.Vector2[] = [];
    for (let i = 0; i < segs; i++) {
      const a = (i / segs) * 2 * Math.PI;
      circContour.push(new THREE.Vector2(anchor.cx + Math.cos(a) * r, anchor.cy + Math.sin(a) * r));
    }
    const infillAngle = layerIndex % 2 === 0 ? 0 : Math.PI / 2;
    const lines = deps.generateScanLines(circContour, pp.supportDensity, supLW, infillAngle);
    for (const line of lines) {
      moves.push({
        type: 'support',
        from: { x: line.from.x, y: line.from.y },
        to: { x: line.to.x, y: line.to.y },
        speed: supportSpeed, extrusion: 0, lineWidth: supLW,
      });
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
  const moves: SliceMove[] = [];

  if (pp.supportType === 'tree' || pp.supportType === 'organic') {
    return {
      moves: generateTreeSupportForLayer(
        triangles, sliceZ, layerIndex, offsetX, offsetY, modelContours, pp, deps,
      ),
    };
  }

  const overhangAngleRad = (pp.supportAngle * Math.PI) / 180;
  const overhangRegions: THREE.Vector2[][] = [];

  for (const tri of triangles) {
    const dotUp = tri.normal.z;
    const clamped = Math.max(0, Math.min(1, Math.abs(dotUp)));
    const faceAngle = Math.acos(clamped);

    if (dotUp < 0 && faceAngle > overhangAngleRad) {
      const minZ = Math.min(tri.v0.z, tri.v1.z, tri.v2.z);
      const maxZ = Math.max(tri.v0.z, tri.v1.z, tri.v2.z);
      const topGap = pp.supportTopDistance ?? pp.supportZDistance ?? 0;
      if (sliceZ >= minZ && sliceZ <= maxZ + pp.layerHeight - topGap) {
        overhangRegions.push([
          new THREE.Vector2(tri.v0.x + offsetX, tri.v0.y + offsetY),
          new THREE.Vector2(tri.v1.x + offsetX, tri.v1.y + offsetY),
          new THREE.Vector2(tri.v2.x + offsetX, tri.v2.y + offsetY),
        ]);
      }
    }
  }

  if (overhangRegions.length === 0) return { moves };

  const allOverhangPts: THREE.Vector2[] = [];
  for (const region of overhangRegions) allOverhangPts.push(...region);
  if (allOverhangPts.length === 0) return { moves };

  let rawBbox = deps.pointsBBox(allOverhangPts);

  if (pp.enableConicalSupport) {
    const angleRad = ((pp.conicalSupportAngle ?? 30) * Math.PI) / 180;
    const shrinkPerLayer = Math.tan(angleRad) * pp.layerHeight;
    const shrink = shrinkPerLayer * layerIndex;
    rawBbox = {
      minX: rawBbox.minX + shrink,
      maxX: rawBbox.maxX - shrink,
      minY: rawBbox.minY + shrink,
      maxY: rawBbox.maxY - shrink,
    };
    if (rawBbox.maxX <= rawBbox.minX || rawBbox.maxY <= rawBbox.minY) return { moves };
  }

  if ((pp.supportStairStepHeight ?? 0) > 0 && (pp.supportStairStepMinSlope ?? 0) > 0) {
    const stepLayers = Math.max(1, Math.ceil((pp.supportStairStepHeight ?? 0.3) / pp.layerHeight));
    if (layerIndex < stepLayers) {
      const maxW = pp.supportStairStepMaxWidth ?? 0;
      const pad = maxW > 0 ? Math.min(pp.wallLineWidth, maxW / 2) : pp.wallLineWidth;
      rawBbox = {
        minX: rawBbox.minX - pad,
        maxX: rawBbox.maxX + pad,
        minY: rawBbox.minY - pad,
        maxY: rawBbox.maxY + pad,
      };
    }
  }

  const conicalAngle = (pp.enableConicalSupport ?? false) ? (pp.conicalSupportAngle ?? 0) : 0;
  if (conicalAngle > 0 && modelHeight > 0) {
    const conicalRad = (conicalAngle * Math.PI) / 180;
    const expansion = Math.tan(conicalRad) * Math.max(0, modelHeight - layerZ);
    const minWidth = (pp.conicalSupportMinWidth ?? 0) / 2;
    const actualExp = Math.max(minWidth, expansion);
    rawBbox = {
      minX: rawBbox.minX - actualExp,
      maxX: rawBbox.maxX + actualExp,
      minY: rawBbox.minY - actualExp,
      maxY: rawBbox.maxY + actualExp,
    };
  }

  const minArea = pp.minimumSupportArea ?? 0;
  if (minArea > 0) {
    const bboxArea = (rawBbox.maxX - rawBbox.minX) * (rawBbox.maxY - rawBbox.minY);
    if (bboxArea < minArea) return { moves };
  }

  const horizExp = pp.supportHorizontalExpansion ?? 0;
  const minXYGap = Math.max(0, (pp.minSupportXYDistance ?? 0) - (pp.supportXYDistance ?? 0));
  const bbox = {
    minX: rawBbox.minX - horizExp + minXYGap,
    maxX: rawBbox.maxX + horizExp - minXYGap,
    minY: rawBbox.minY - horizExp + minXYGap,
    maxY: rawBbox.maxY + horizExp - minXYGap,
  };

  const supLW = pp.supportLineWidth ?? pp.wallLineWidth;
  const baseSpacing = (pp.supportLineDistance ?? 0) > 0
    ? (pp.supportLineDistance ?? 1)
    : supLW / (pp.supportDensity / 100);
  let spacing = (layerIndex === 0 && (pp.initialLayerSupportLineDistance ?? 0) > 0)
    ? pp.initialLayerSupportLineDistance!
    : baseSpacing;
  const gradSteps = pp.gradualSupportSteps ?? 0;
  const gradHeight = pp.gradualSupportStepHeight ?? 1.0;
  if (gradSteps > 0 && gradHeight > 0) {
    const totalGradZ = gradSteps * gradHeight;
    const fromTop = Math.max(0, totalGradZ - (layerZ - (layerZ % gradHeight)));
    const stepN = Math.min(gradSteps, Math.floor(fromTop / gradHeight));
    if (stepN > 0) spacing = baseSpacing * Math.pow(2, stepN);
  }

  const ifThickRoof = pp.supportRoofThickness ?? pp.supportInterfaceThickness ?? 0;
  const ifThickFloor = pp.supportFloorThickness ?? pp.supportInterfaceThickness ?? 0;
  const supZDist = pp.supportZDistance ?? 0;
  let isRoofLayer = false;
  let isFloorLayer = false;
  if (ifThickRoof > 0 || ifThickFloor > 0) {
    for (const tri of triangles) {
      const triMinZ = Math.min(tri.v0.z, tri.v1.z, tri.v2.z);
      const triMaxZ = Math.max(tri.v0.z, tri.v1.z, tri.v2.z);
      if (!isRoofLayer && ifThickRoof > 0) {
        if (triMinZ > sliceZ && triMinZ <= sliceZ + supZDist + ifThickRoof) isRoofLayer = true;
      }
      if (!isFloorLayer && ifThickFloor > 0) {
        if (triMaxZ < sliceZ && triMaxZ >= sliceZ - supZDist - ifThickFloor) isFloorLayer = true;
      }
      if (isRoofLayer && isFloorLayer) break;
    }
  }

  let supportSpeed = pp.supportInfillSpeed ?? pp.supportSpeed ?? pp.printSpeed * 0.8;
  if ((isRoofLayer || isFloorLayer) && (pp.supportInterfaceSpeed ?? 0) > 0) supportSpeed = pp.supportInterfaceSpeed!;
  if (isRoofLayer && (pp.supportRoofSpeed ?? 0) > 0) supportSpeed = pp.supportRoofSpeed!;
  if (isFloorLayer && (pp.supportFloorSpeed ?? 0) > 0) supportSpeed = pp.supportFloorSpeed!;

  const supportFlowOverride: number | undefined =
    isRoofLayer && (pp.supportRoofFlow ?? 0) > 0 ? pp.supportRoofFlow! / 100 :
    isFloorLayer && (pp.supportFloorFlow ?? 0) > 0 ? pp.supportFloorFlow! / 100 :
    undefined;

  if (isRoofLayer || isFloorLayer) {
    const ifHorizExp = pp.supportInterfaceHorizontalExpansion ?? 0;
    if (ifHorizExp !== 0) {
      bbox.minX -= ifHorizExp; bbox.maxX += ifHorizExp;
      bbox.minY -= ifHorizExp; bbox.maxY += ifHorizExp;
    }
    if (isRoofLayer) {
      const roofDensity = pp.supportRoofDensity ?? pp.supportDensity;
      const roofDist = (pp.supportRoofLineDistance ?? 0) > 0
        ? pp.supportRoofLineDistance!
        : supLW / (roofDensity / 100);
      spacing = roofDist;
    } else {
      const floorDensity = pp.supportFloorDensity ?? pp.supportDensity;
      const floorDist = (pp.supportFloorLineDistance ?? 0) > 0
        ? pp.supportFloorLineDistance!
        : supLW / (floorDensity / 100);
      spacing = floorDist;
    }
  }

  const activeLineDirs = (isRoofLayer || isFloorLayer)
    ? (pp.supportInterfaceLineDirections ?? pp.supportInfillLineDirections ?? null)
    : (pp.supportInfillLineDirections ?? null);
  const ifPattern = isRoofLayer
    ? (pp.supportRoofPattern ?? pp.supportPattern)
    : isFloorLayer
      ? (pp.supportFloorPattern ?? pp.supportPattern)
      : pp.supportPattern;

  let angle: number;
  if (activeLineDirs && activeLineDirs.length > 0) {
    angle = (activeLineDirs[layerIndex % activeLineDirs.length] * Math.PI) / 180;
  } else {
    switch (ifPattern) {
      case 'grid':
        angle = layerIndex % 2 === 0 ? 0 : Math.PI / 2;
        break;
      case 'zigzag':
        angle = layerIndex % 2 === 0 ? Math.PI / 4 : -Math.PI / 4;
        break;
      case 'lines':
      default:
        angle = 0;
        break;
    }
  }

  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const maxDim = Math.max(bbox.maxX - bbox.minX, bbox.maxY - bbox.minY) * 1.5;
  const centerX = (bbox.minX + bbox.maxX) / 2;
  const centerY = (bbox.minY + bbox.maxY) / 2;
  const xyDist = pp.supportXYDistance;

  const supWalls = (isRoofLayer || isFloorLayer)
    ? (pp.supportInterfaceWallCount ?? pp.supportWallLineCount ?? 0)
    : (pp.supportWallLineCount ?? 0);
  for (let w = 0; w < supWalls; w++) {
    const wallOff = w * supLW + supLW / 2;
    const wx0 = bbox.minX - wallOff;
    const wx1 = bbox.maxX + wallOff;
    const wy0 = bbox.minY - wallOff;
    const wy1 = bbox.maxY + wallOff;
    const corners = [
      { x: wx0, y: wy0 }, { x: wx1, y: wy0 },
      { x: wx1, y: wy1 }, { x: wx0, y: wy1 }, { x: wx0, y: wy0 },
    ];
    for (let ci = 1; ci < corners.length; ci++) {
      moves.push({
        type: 'support',
        from: { x: corners[ci - 1].x, y: corners[ci - 1].y },
        to: { x: corners[ci].x, y: corners[ci].y },
        speed: supportSpeed, extrusion: 0, lineWidth: supLW,
      });
    }
  }

  if (!(spacing > 0) || !isFinite(spacing)) return { moves };
  const SUPPORT_MAX_SCAN = 50000;
  let supScanCount = 0;

  for (let d = -maxDim / 2; d <= maxDim / 2; d += spacing) {
    if (++supScanCount > SUPPORT_MAX_SCAN) break;
    const p1x = centerX + cos * (-maxDim) - sin * d;
    const p1y = centerY + sin * (-maxDim) + cos * d;
    const p2x = centerX + cos * maxDim - sin * d;
    const p2y = centerY + sin * maxDim + cos * d;

    const lineMinX = Math.min(p1x, p2x);
    const lineMaxX = Math.max(p1x, p2x);
    const lineMinY = Math.min(p1y, p2y);
    const lineMaxY = Math.max(p1y, p2y);

    if (lineMaxX < bbox.minX || lineMinX > bbox.maxX) continue;
    if (lineMaxY < bbox.minY || lineMinY > bbox.maxY) continue;

    const fromX = Math.max(p1x, bbox.minX + xyDist);
    const toX = Math.min(p2x, bbox.maxX - xyDist);
    const fromY = Math.max(p1y, bbox.minY + xyDist);
    const toY = Math.min(p2y, bbox.maxY - xyDist);

    const midPt = new THREE.Vector2((fromX + toX) / 2, (fromY + toY) / 2);
    let insideModel = false;
    for (const contour of modelContours) {
      if (contour.isOuter && deps.pointInContour(midPt, contour.points)) {
        insideModel = true;
        break;
      }
    }

    if (!insideModel && (Math.abs(fromX - toX) > 0.5 || Math.abs(fromY - toY) > 0.5)) {
      moves.push({
        type: 'support',
        from: { x: fromX, y: fromY },
        to: { x: toX, y: toY },
        speed: supportSpeed,
        extrusion: 0,
        lineWidth: supLW,
      });
    }
  }

  return { moves, flowOverride: supportFlowOverride };
}
