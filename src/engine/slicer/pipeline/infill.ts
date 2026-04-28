import * as THREE from 'three';
import type { MultiPolygon as PCMultiPolygon, Ring as PCRing } from 'polygon-clipping';
import type { PrintProfile } from '../../../types/slicer';
import type { InfillDeps } from '../../../types/slicer-pipeline-deps.types';
import type { InfillLine } from '../../../types/slicer-pipeline-infill.types';
import type { InfillRegion } from '../../../types/slicer-pipeline.types';
import { booleanMultiPolygonClipper2Sync } from '../geometry/clipper2Boolean';

// ARACHNE-9.4A.4: see perimeters.ts comment. Worker awaits load() before slice.
function requireMP(result: PCMultiPolygon | null, op: string): PCMultiPolygon {
  if (result === null) {
    throw new Error(`infill.${op}: Clipper2 WASM not loaded`);
  }
  return result;
}

function pcRingToV2(ring: PCRing): THREE.Vector2[] {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i < ring.length - 1; i++) pts.push(new THREE.Vector2(ring[i][0], ring[i][1]));
  return pts;
}

export function contourToClosedPCRing(contour: THREE.Vector2[]): PCRing {
  const ring: PCRing = contour.map((p) => [p.x, p.y] as [number, number]);
  if (ring.length > 0) {
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) ring.push([first[0], first[1]]);
  }
  return ring;
}

export function multiPolygonToRegions(mp: PCMultiPolygon): InfillRegion[] {
  const regions: InfillRegion[] = [];
  for (const poly of mp) {
    if (poly.length === 0) continue;
    const contour = pcRingToV2(poly[0]);
    if (contour.length < 3) continue;
    const holes = poly
      .slice(1)
      .map((ring) => pcRingToV2(ring))
      .filter((ring) => ring.length >= 3);
    regions.push({ contour, holes });
  }
  return regions;
}

function unionMultiPolygon(mp: PCMultiPolygon): PCMultiPolygon {
  if (mp.length <= 1) return mp;
  return requireMP(booleanMultiPolygonClipper2Sync(mp, [], 'union'), 'union');
}

function differenceMultiPolygon(a: PCMultiPolygon, clips: PCMultiPolygon[]): PCMultiPolygon {
  if (clips.length === 0) return a;
  const mergedClips = clips.length === 1 ? clips[0] : unionMultiPolygon(clips.flat());
  return requireMP(booleanMultiPolygonClipper2Sync(a, mergedClips, 'difference'), 'difference');
}

export function generateScanLines(
  contour: THREE.Vector2[],
  density: number,
  lineWidth: number,
  angle: number,
  phaseOffset: number,
  holes: THREE.Vector2[][],
  printProfile: PrintProfile,
  deps: InfillDeps,
): InfillLine[] {
  const results: InfillLine[] = [];
  const bbox = deps.contourBBox(contour);
  const spacing = lineWidth / (density / 100);

  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const maxDim = Math.max(bbox.maxX - bbox.minX, bbox.maxY - bbox.minY) * 1.5;
  const offX = printProfile.infillXOffset ?? 0;
  const offY = printProfile.infillYOffset ?? 0;
  const centerX = (bbox.minX + bbox.maxX) / 2 + offX;
  const centerY = (bbox.minY + bbox.maxY) / 2 + offY;

  if (!(spacing > 0) || !isFinite(spacing)) return results;
  const MAX_SCAN_LINES = 50000;
  let scanCount = 0;

  const startOffset = phaseOffset % spacing;
  for (let d = -maxDim / 2 + startOffset; d <= maxDim / 2 + startOffset; d += spacing) {
    if (++scanCount > MAX_SCAN_LINES) break;
    const p1 = new THREE.Vector2(
      centerX + cos * (-maxDim) - sin * d,
      centerY + sin * (-maxDim) + cos * d,
    );
    const p2 = new THREE.Vector2(
      centerX + cos * maxDim - sin * d,
      centerY + sin * maxDim + cos * d,
    );

    const intersections = deps.lineContourIntersections(p1, p2, contour);
    for (const h of holes) {
      if (h.length < 3) continue;
      const hi = deps.lineContourIntersections(p1, p2, h);
      for (const t of hi) intersections.push(t);
    }
    intersections.sort((a, b) => a - b);
    const deduped: number[] = [];
    for (const t of intersections) {
      if (deduped.length === 0 || Math.abs(t - deduped[deduped.length - 1]) > 1e-5) deduped.push(t);
    }

    const dirX = p2.x - p1.x;
    const dirY = p2.y - p1.y;
    for (let i = 0; i + 1 < deduped.length; i += 2) {
      const t1 = deduped[i];
      const t2 = deduped[i + 1];
      const start = new THREE.Vector2(p1.x + dirX * t1, p1.y + dirY * t1);
      const end = new THREE.Vector2(p1.x + dirX * t2, p1.y + dirY * t2);
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const mid = new THREE.Vector2((start.x + end.x) / 2, (start.y + end.y) / 2);
      const midInsideHole = holes.some((hole) => hole.length >= 3 && deps.pointInContour(mid, hole));
      if (dx * dx + dy * dy > 0.01 && deps.pointInContour(mid, contour) && !midInsideHole) {
        results.push({ from: start, to: end });
      }
    }
  }

  return results;
}

function generateGyroidInfill(
  contour: THREE.Vector2[],
  density: number,
  lineWidth: number,
  layerIndex: number,
  holes: THREE.Vector2[][],
  deps: InfillDeps,
): InfillLine[] {
  const results: InfillLine[] = [];
  const bbox = deps.contourBBox(contour);
  const spacing = lineWidth / (density / 100);
  const amplitude = spacing * 0.4;
  const period = spacing * 2;
  const phaseShift = (layerIndex * Math.PI) / 3;

  const inMaterial = (p: THREE.Vector2): boolean => {
    if (!deps.pointInContour(p, contour)) return false;
    for (const h of holes) if (h.length >= 3 && deps.pointInContour(p, h)) return false;
    return true;
  };

  for (let y = bbox.minY; y <= bbox.maxY; y += spacing) {
    const linePoints: THREE.Vector2[] = [];
    const steps = Math.max(1, Math.ceil((bbox.maxX - bbox.minX) / 0.5));
    for (let s = 0; s <= steps; s++) {
      const x = bbox.minX + (s / steps) * (bbox.maxX - bbox.minX);
      const yOff = y + amplitude * Math.sin((2 * Math.PI * x) / period + phaseShift);
      linePoints.push(new THREE.Vector2(x, yOff));
    }
    for (let i = 0; i + 1 < linePoints.length; i++) {
      const a = linePoints[i];
      const b = linePoints[i + 1];
      if (inMaterial(a) && inMaterial(b)) results.push({ from: a, to: b });
    }
  }

  return results;
}

function generateHoneycombInfill(
  contour: THREE.Vector2[],
  density: number,
  lineWidth: number,
  holes: THREE.Vector2[][],
  deps: InfillDeps,
): InfillLine[] {
  const results: InfillLine[] = [];
  const bbox = deps.contourBBox(contour);
  const spacing = lineWidth / (density / 100);
  const hexHeight = spacing * Math.sqrt(3);
  const hexWidth = spacing * 2;

  const inMaterial = (p: THREE.Vector2): boolean => {
    if (!deps.pointInContour(p, contour)) return false;
    for (const h of holes) if (h.length >= 3 && deps.pointInContour(p, h)) return false;
    return true;
  };

  for (let row = bbox.minY - hexHeight; row <= bbox.maxY + hexHeight; row += hexHeight) {
    const isOddRow = Math.round((row - bbox.minY) / hexHeight) % 2 !== 0;
    const xOffset = isOddRow ? hexWidth * 0.5 : 0;
    for (let col = bbox.minX - hexWidth + xOffset; col <= bbox.maxX + hexWidth; col += hexWidth) {
      const hexPts: THREE.Vector2[] = [];
      for (let a = 0; a < 6; a++) {
        const angle = (Math.PI / 3) * a + Math.PI / 6;
        hexPts.push(new THREE.Vector2(col + spacing * Math.cos(angle), row + spacing * Math.sin(angle)));
      }
      for (let i = 0; i < hexPts.length; i++) {
        const from = hexPts[i];
        const to = hexPts[(i + 1) % hexPts.length];
        if (inMaterial(from) && inMaterial(to)) results.push({ from, to });
      }
    }
  }

  return results;
}

function generateConcentricInfill(
  contour: THREE.Vector2[],
  lineWidth: number,
  holes: THREE.Vector2[][],
  deps: InfillDeps,
): InfillLine[] {
  const results: InfillLine[] = [];
  const MAX_ITER = 500;

  if (holes.length === 0) {
    let current = contour;
    let iter = 0;
    let prevBbox = deps.contourBBox(current);
    while (current.length >= 3 && iter++ < MAX_ITER) {
      const next = deps.offsetContour(current, -lineWidth);
      if (next.length < 3) break;
      const nextBbox = deps.contourBBox(next);
      const shrinkX = Math.abs((prevBbox.maxX - prevBbox.minX) - (nextBbox.maxX - nextBbox.minX));
      const shrinkY = Math.abs((prevBbox.maxY - prevBbox.minY) - (nextBbox.maxY - nextBbox.minY));
      if (shrinkX < 0.01 && shrinkY < 0.01) break;
      prevBbox = nextBbox;
      for (let i = 0; i < next.length; i++) results.push({ from: next[i], to: next[(i + 1) % next.length] });
      current = next;
    }
    return results;
  }

  const ringToSegs = (ring: PCRing) => {
    for (let i = 0; i < ring.length - 1; i++) {
      results.push({
        from: new THREE.Vector2(ring[i][0], ring[i][1]),
        to: new THREE.Vector2(ring[i + 1][0], ring[i + 1][1]),
      });
    }
  };

  for (let step = 1; step < MAX_ITER; step++) {
    const depth = step * lineWidth;
    const outerShrunk = deps.offsetContour(contour, depth);
    if (outerShrunk.length < 3) break;
    const holesExpanded = holes.map((h) => deps.offsetContour(h, depth)).filter((h) => h.length >= 3);
    let region: PCMultiPolygon = [[contourToClosedPCRing(outerShrunk)]];
    if (holesExpanded.length > 0) {
      const holeMPs: PCMultiPolygon[] = holesExpanded.map((h) => [[contourToClosedPCRing([...h].reverse())]]);
      try {
        region = differenceMultiPolygon(region, holeMPs);
      } catch {
        break;
      }
    }
    if (region.length === 0) break;
    for (const poly of region) for (const ring of poly) ringToSegs(ring);
  }

  return results;
}

function generateCubicInfill(
  contour: THREE.Vector2[],
  density: number,
  lineWidth: number,
  layerIndex: number,
  holes: THREE.Vector2[][],
  printProfile: PrintProfile,
  deps: InfillDeps,
): InfillLine[] {
  const angleOffset = ((layerIndex % 3) * Math.PI) / 3;
  return [
    ...generateScanLines(contour, density, lineWidth, angleOffset, 0, holes, printProfile, deps),
    ...generateScanLines(contour, density, lineWidth, angleOffset + Math.PI / 3, 0, holes, printProfile, deps),
    ...generateScanLines(contour, density, lineWidth, angleOffset + (2 * Math.PI) / 3, 0, holes, printProfile, deps),
  ];
}

function generateZigzagLines(
  contour: THREE.Vector2[],
  density: number,
  lineWidth: number,
  layerIndex: number,
  printProfile: PrintProfile,
  deps: InfillDeps,
): InfillLine[] {
  const angle = layerIndex % 2 === 0 ? 0 : Math.PI / 2;
  const scanLines = generateScanLines(contour, density, lineWidth, angle, 0, [], printProfile, deps);
  if (scanLines.length < 2) return scanLines;

  const results: InfillLine[] = [];
  for (let i = 0; i < scanLines.length; i++) {
    const line = scanLines[i];
    results.push(i % 2 === 0 ? line : { from: line.to, to: line.from });
    if (i + 1 < scanLines.length) {
      const nextLine = scanLines[i + 1];
      const currentEnd = i % 2 === 0 ? line.to : line.from;
      const nextStart = (i + 1) % 2 === 0 ? nextLine.from : nextLine.to;
      if (currentEnd.distanceTo(nextStart) > 0.1) results.push({ from: currentEnd, to: nextStart });
    }
  }
  return results;
}

export function generateLinearInfill(
  contour: THREE.Vector2[],
  density: number,
  lineWidth: number,
  layerIndex: number,
  pattern: string,
  holes: THREE.Vector2[][],
  printProfile: PrintProfile,
  deps: InfillDeps,
): InfillLine[] {
  if (contour.length < 3 || density <= 0) return [];
  const spacing = lineWidth / (density / 100);
  const phase = printProfile.randomInfillStart ? Math.abs(Math.sin(layerIndex * 127.1 + 43.7)) * spacing : 0;

  switch (pattern) {
    case 'grid': {
      const gridAngle = layerIndex % 2 === 0 ? 0 : Math.PI / 4;
      return [
        ...generateScanLines(contour, density, lineWidth, gridAngle, phase, holes, printProfile, deps),
        ...generateScanLines(contour, density, lineWidth, gridAngle + Math.PI / 2, phase, holes, printProfile, deps),
      ];
    }
    case 'lines':
      return generateScanLines(contour, density, lineWidth, layerIndex % 2 === 0 ? Math.PI / 4 : -Math.PI / 4, phase, holes, printProfile, deps);
    case 'triangles': {
      const triAngle = ((layerIndex % 3) * Math.PI) / 3;
      return [
        ...generateScanLines(contour, density, lineWidth, triAngle, phase, holes, printProfile, deps),
        ...generateScanLines(contour, density, lineWidth, triAngle + Math.PI / 3, phase, holes, printProfile, deps),
        ...generateScanLines(contour, density, lineWidth, triAngle + (2 * Math.PI) / 3, phase, holes, printProfile, deps),
      ];
    }
    case 'gyroid':
      return generateGyroidInfill(contour, density, lineWidth, layerIndex, holes, deps);
    case 'honeycomb':
      return generateHoneycombInfill(contour, density, lineWidth, holes, deps);
    case 'concentric':
      return generateConcentricInfill(contour, lineWidth, holes, deps);
    case 'cubic':
      return generateCubicInfill(contour, density, lineWidth, layerIndex, holes, printProfile, deps);
    case 'lightning': {
      const lightningOverhangAngle = (printProfile.lightningInfillOverhangAngle ?? 40) / 90;
      const prune = printProfile.lightningPruneAngle ?? 40;
      const straight = printProfile.lightningStraighteningAngle ?? 40;
      const sparsity = 1 - ((prune + straight) / 180);
      const lightDensity = Math.max(density * 0.5 * Math.max(0.2, sparsity) * Math.max(0.2, lightningOverhangAngle), 2);
      return generateScanLines(
        contour,
        lightDensity,
        lineWidth,
        layerIndex % 3 === 0 ? 0 : layerIndex % 3 === 1 ? Math.PI / 3 : (2 * Math.PI) / 3,
        0,
        [],
        printProfile,
        deps,
      );
    }
    case 'zigzag':
      return generateZigzagLines(contour, density, lineWidth, layerIndex, printProfile, deps);
    default:
      return generateScanLines(contour, density, lineWidth, layerIndex % 2 === 0 ? 0 : Math.PI / 2, 0, [], printProfile, deps);
  }
}

export function sortInfillLines<T extends InfillLine>(lines: T[]): T[] {
  if (lines.length <= 1) return lines;
  return lines.map((line, i) => (i % 2 === 0 ? line : { ...line, from: line.to, to: line.from }));
}

export function sortInfillLinesNN<T extends InfillLine>(
  lines: T[],
  startX: number,
  startY: number,
): T[] {
  if (lines.length <= 1) return lines;
  const remaining = lines.slice();
  const result: T[] = [];
  let rx = startX, ry = startY;
  while (remaining.length > 0) {
    let bestIdx = 0;
    let bestDist = Infinity;
    let bestFlip = false;
    for (let i = 0; i < remaining.length; i++) {
      const { from, to } = remaining[i];
      const df = Math.hypot(from.x - rx, from.y - ry);
      const dt = Math.hypot(to.x - rx, to.y - ry);
      if (df < bestDist) { bestDist = df; bestIdx = i; bestFlip = false; }
      if (dt < bestDist) { bestDist = dt; bestIdx = i; bestFlip = true; }
    }
    const line = remaining.splice(bestIdx, 1)[0];
    const ordered: T = bestFlip ? { ...line, from: line.to, to: line.from } : line;
    result.push(ordered);
    rx = ordered.to.x;
    ry = ordered.to.y;
  }
  return result;
}
