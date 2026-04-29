import * as THREE from 'three';
import type { SliceMove } from '../../../../../types/slicer';
import type { GeneratedPerimeters } from '../../../../../types/slicer-pipeline.types';
import type { ContourWallData, SlicerExecutionPipeline, SliceLayerState, SliceRun } from './types';
import { lineWidthSpecForLayer } from './lineWidths';

type WallLineWidthSpec = number | number[];

interface EmitOuterLoopParams {
  pipeline: SlicerExecutionPipeline;
  run: SliceRun;
  layer: SliceLayerState;
  pp: SliceRun['pp'];
  li: number;
  layerZ: number;
  layerH: number;
  isFirstLayer: boolean;
  outerWallSpeed: number;
  gcode: string[];
  emitter: SliceRun['emitter'];
  moves: SliceMove[];
  loop: THREE.Vector2[];
  lineWidth: WallLineWidthSpec;
  isClosed?: boolean;
  comment?: string;
  allowCoasting?: boolean;
}

function representativeLineWidth(lineWidth: WallLineWidthSpec | undefined, fallback: number): number {
  if (Array.isArray(lineWidth)) {
    if (lineWidth.length === 0) return fallback;
    return lineWidth.reduce((sum, width) => sum + width, 0) / lineWidth.length;
  }
  return lineWidth ?? fallback;
}

function segmentLineWidth(lineWidth: WallLineWidthSpec, fromIndex: number, toIndex: number): number {
  if (!Array.isArray(lineWidth)) return lineWidth;
  const from = lineWidth[fromIndex] ?? lineWidth[toIndex] ?? lineWidth[0] ?? 0;
  const to = lineWidth[toIndex] ?? from;
  return (from + to) / 2;
}

function shouldPreserveVariableWallWidth(lineWidth: WallLineWidthSpec): boolean {
  return Array.isArray(lineWidth);
}

function centroid(points: THREE.Vector2[]): THREE.Vector2 {
  const center = new THREE.Vector2();
  for (const point of points) center.add(point);
  return center.multiplyScalar(1 / Math.max(1, points.length));
}

function distanceSq(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function pointToSegmentDistance(point: THREE.Vector2, a: THREE.Vector2, b: THREE.Vector2): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lenSq = abx * abx + aby * aby;
  if (lenSq <= 1e-12) return point.distanceTo(a);
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * abx + (point.y - a.y) * aby) / lenSq));
  return Math.hypot(point.x - (a.x + abx * t), point.y - (a.y + aby * t));
}

function pointToClosedLoopDistance(point: THREE.Vector2, loop: THREE.Vector2[]): number {
  if (loop.length === 0) return Infinity;
  if (loop.length === 1) return point.distanceTo(loop[0]);
  let best = Infinity;
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i];
    const b = loop[(i + 1) % loop.length];
    best = Math.min(best, pointToSegmentDistance(point, a, b));
  }
  return best;
}

function wallTracksBoundary(
  wall: THREE.Vector2[],
  boundaries: THREE.Vector2[][],
  threshold: number,
): boolean {
  if (wall.length === 0 || boundaries.length === 0 || threshold <= 0) return false;
  const step = Math.max(1, Math.floor(wall.length / 80));
  let close = 0;
  let total = 0;
  for (let i = 0; i < wall.length; i += step) {
    total++;
    let distance = Infinity;
    for (const boundary of boundaries) {
      distance = Math.min(distance, pointToClosedLoopDistance(wall[i], boundary));
    }
    if (distance <= threshold) close++;
  }
  return total > 0 && close / total >= 0.65;
}

function orcaOrderedWallIndices(
  wallSets: THREE.Vector2[][],
  wallDepths: number[],
  wallSources: Array<'outer' | 'hole' | 'gapfill'> | undefined,
  wallClosed: boolean[] | undefined,
  startPosition: { x: number; y: number },
  outerWallFirst: boolean,
): number[] {
  const sourceWeight = (s?: 'outer' | 'hole' | 'gapfill') =>
    s === 'gapfill' ? 2 : s === 'hole' ? 1 : 0;
  const indices = Array.from({ length: wallSets.length - 1 }, (_, i) => i + 1);
  const walls = indices;
  const blocked = new Map<number, number>();
  const blocking = new Map<number, number[]>();
  for (const idx of walls) {
    blocked.set(idx, 0);
    blocking.set(idx, []);
  }

  // Orca asks Arachne for region-order constraints, then repeatedly picks
  // the nearest unblocked extrusion from the current nozzle position. We
  // mirror that scheduler using the wall depth metadata exported by our
  // Arachne backend: outer-first blocks deeper walls behind shallower
  // walls; inner-first blocks shallower walls behind deeper walls.
  for (const before of walls) {
    for (const after of walls) {
      if (before === after) continue;
      const beforeDepth = wallDepths[before] ?? 1;
      const afterDepth = wallDepths[after] ?? 1;
      if (beforeDepth === afterDepth) continue;
      const mustPrecede = outerWallFirst
        ? beforeDepth < afterDepth
        : beforeDepth > afterDepth;
      if (!mustPrecede) continue;
      blocking.get(before)?.push(after);
      blocked.set(after, (blocked.get(after) ?? 0) + 1);
    }
  }

  const ordered: number[] = [];
  const processed = new Set<number>();
  let current = startPosition;
  while (ordered.length < walls.length) {
    const available = walls
      .filter((idx) => !processed.has(idx) && (blocked.get(idx) ?? 0) === 0)
      .sort((a, b) => Number(wallClosed?.[a] ?? true) - Number(wallClosed?.[b] ?? true));
    if (available.length === 0) {
      const remaining = walls.filter((idx) => !processed.has(idx));
      remaining.sort((a, b) => {
        const da = wallDepths[a] ?? 1;
        const db = wallDepths[b] ?? 1;
        if (da !== db) return outerWallFirst ? da - db : db - da;
        return sourceWeight(wallSources?.[a]) - sourceWeight(wallSources?.[b]);
      });
      available.push(...remaining);
    }

    let best = available[0];
    let bestDist = Infinity;
    let bestClosed = false;
    for (const candidate of available) {
      const loop = wallSets[candidate];
      if (!loop || loop.length === 0) continue;
      const closed = wallClosed?.[candidate] ?? true;
      const d = distanceSq(current, loop[0]);
      if (d < bestDist && (closed || bestDist !== Infinity || !bestClosed)) {
        best = candidate;
        bestDist = d;
        bestClosed = closed;
      }
    }

    ordered.push(best);
    processed.add(best);
    for (const unlocked of blocking.get(best) ?? []) {
      blocked.set(unlocked, Math.max(0, (blocked.get(unlocked) ?? 0) - 1));
    }
    const loop = wallSets[best];
    if (loop && loop.length > 0) {
      current = (wallClosed?.[best] ?? true) ? loop[0] : loop[loop.length - 1];
    }
  }

  return ordered;
}

function wallStartPoint(item: ContourWallData): THREE.Vector2 | null {
  let best: THREE.Vector2 | null = null;
  for (const wall of item.wallSets) {
    if (wall.length === 0) continue;
    if (!best) best = wall[0];
    if (item.wallClosed?.[item.wallSets.indexOf(wall)] === false) return wall[0];
  }
  return best ?? item.contour.points[0] ?? null;
}

function wallEndPoint(item: ContourWallData): THREE.Vector2 | null {
  for (let i = item.wallSets.length - 1; i >= 0; i--) {
    const wall = item.wallSets[i];
    if (!wall || wall.length === 0) continue;
    return item.wallClosed?.[i] === false ? wall[wall.length - 1] : wall[0];
  }
  return item.contour.points[0] ?? null;
}

function orcaOrderedContourWallData(
  items: ContourWallData[],
  startPosition: { x: number; y: number },
): ContourWallData[] {
  if (items.length <= 1) return items;
  const remaining = [...items];
  const ordered: ContourWallData[] = [];
  let current = startPosition;

  while (remaining.length > 0) {
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const point = wallStartPoint(remaining[i]);
      if (!point) continue;
      const dist = distanceSq(current, point);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    }
    const [next] = remaining.splice(bestIdx, 1);
    ordered.push(next);
    const end = wallEndPoint(next);
    if (end) current = end;
  }

  return ordered;
}

function beginSeamLayer(run: SliceRun, li: number) {
  if (run.seamMemoryLayer === li) return;
  if (run.seamMemoryLayer !== undefined) run.previousSeamPoints = run.currentSeamPoints ?? [];
  run.currentSeamPoints = [];
  run.seamMemoryLayer = li;
}

function nearestPreviousSeam(run: SliceRun, loop: THREE.Vector2[], tolerance: number): THREE.Vector2 | null {
  const previous: THREE.Vector2[] = run.previousSeamPoints ?? [];
  if (previous.length === 0 || loop.length === 0) return null;
  const center = centroid(loop);
  let best: THREE.Vector2 | null = null;
  let bestDistance = Infinity;
  for (const point of previous) {
    const distance = point.distanceTo(center);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = point;
    }
  }
  return bestDistance <= Math.max(tolerance * 8, 10) ? best : null;
}

/**
 * Cura "Fuzzy Skin" — resample the wall at `pointDist` intervals and
 * displace each point by a random offset (±thickness/2) along its outward
 * normal. Result is a roughened wall surface (Cura's textured/matte effect).
 *
 * Uses a per-layer deterministic seed so re-slicing the same model produces
 * the same fuzzy pattern (otherwise cache hits would visibly change every
 * preview render). Mulberry32 PRNG seeded with the layer index.
 */
function applyFuzzySkin(
  loop: THREE.Vector2[],
  thickness: number,
  pointDist: number,
  isCCW: boolean,
  layerIndex: number,
): THREE.Vector2[] {
  if (loop.length < 3 || thickness <= 0 || pointDist <= 0) return loop;
  // Mulberry32 — small fast deterministic PRNG. Seed is the layer index
  // so the same layer always rolls the same fuzz pattern.
  let seed = (layerIndex * 0x9E3779B1) >>> 0;
  const rand = (): number => {
    seed = (seed + 0x6D2B79F5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (((t ^ (t >>> 14)) >>> 0) % 100000) / 100000;
  };
  const result: THREE.Vector2[] = [];
  let leftover = 0;
  const half = thickness / 2;
  for (let i = 0; i < loop.length; i++) {
    const curr = loop[i];
    const next = loop[(i + 1) % loop.length];
    const dx = next.x - curr.x;
    const dy = next.y - curr.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1e-9) continue;
    const ux = dx / len;
    const uy = dy / len;
    // Outward normal: for a CCW polygon the outward direction is the edge
    // tangent rotated 90° clockwise, i.e. (uy, -ux). For CW it's flipped.
    const nx = isCCW ? uy : -uy;
    const ny = isCCW ? -ux : ux;
    let pos = pointDist - leftover;
    while (pos < len) {
      const r = (rand() * 2 - 1) * half;
      result.push(new THREE.Vector2(curr.x + ux * pos + nx * r, curr.y + uy * pos + ny * r));
      pos += pointDist;
    }
    leftover = len - (pos - pointDist);
  }
  return result.length >= 3 ? result : loop;
}

function reorderOuterLoop(
  pp: SliceRun['pp'],
  pipeline: SlicerExecutionPipeline,
  run: SliceRun,
  layer: SliceLayerState,
  emitter: SliceRun['emitter'],
  loop: THREE.Vector2[],
  lineWidth: number,
  li: number,
): THREE.Vector2[] {
  const continuityTolerance = pp.zSeamContinuityDistance ?? 2;
  const seamIdx = pipeline.findSeamPosition(loop, pp, li, emitter.currentX, emitter.currentY, {
    previousSeam: nearestPreviousSeam(run, loop, continuityTolerance),
    continuityTolerance,
    userSpecifiedRadius: pp.zSeamUserSpecifiedRadius ?? 0,
    isSupported: layer.hasBridgeRegions
      ? (point: THREE.Vector2) => !layer.isInBridgeRegion(point.x, point.y)
      : undefined,
  });
  run.currentSeamPoints.push(loop[seamIdx].clone());
  let reordered = pipeline.reorderFromIndex(loop, seamIdx);
  if (pp.fluidMotionEnable && reordered.length >= 3) {
    const fmAngle = ((pp.fluidMotionAngle ?? 15) * Math.PI) / 180;
    const fmSmall = pp.fluidMotionSmallDistance ?? 0.01;
    const smoothed: THREE.Vector2[] = [];
    for (let i = 0; i < reordered.length; i++) {
      const prev = reordered[(i - 1 + reordered.length) % reordered.length];
      const curr = reordered[i];
      const next = reordered[(i + 1) % reordered.length];
      const d1 = prev.distanceTo(curr);
      const d2 = next.distanceTo(curr);
      if (d1 < fmSmall || d2 < fmSmall) { smoothed.push(curr); continue; }
      const v1 = new THREE.Vector2().subVectors(prev, curr).normalize();
      const v2 = new THREE.Vector2().subVectors(next, curr).normalize();
      const turn = Math.PI - Math.acos(Math.max(-1, Math.min(1, v1.dot(v2))));
      if (turn > fmAngle) {
        const off = Math.min(d1, d2) * 0.25;
        smoothed.push(new THREE.Vector2(curr.x - v1.x * -off, curr.y - v1.y * -off), curr, new THREE.Vector2(curr.x - v2.x * -off, curr.y - v2.y * -off));
      } else smoothed.push(curr);
    }
    reordered = smoothed;
  }
  if ((pp.alternateWallDirections ?? false) && li % 2 === 1) reordered = [reordered[0], ...reordered.slice(1).reverse()];
  // Microscopic-noise simplification only — collapse vertices within a
  // tight chord tolerance (matches the extrude-time `circleSegments`
  // chord tolerance of ~20 µm). The old `lineWidth * 0.5` tolerance was
  // a pre-libArachne workaround for narrow-finger collapse; libArachne
  // now handles those via transition zones, and an aggressive RDP here
  // turns smooth circles (with our adaptive curveSegments) into visibly
  // polygonal walls.
  let simplified = pipeline.simplifyClosedContour(reordered, Math.max(0.005, lineWidth * 0.05));
  // Cura "Fuzzy Skin" — applied AFTER simplification so the random offsets
  // aren't smoothed back out. Skipped on first layer (would compromise bed
  // adhesion) and in vase mode (would jitter the spiral Z ramp). Also
  // skipped when `fuzzySkinOutsideOnly` is true and this is being called
  // from an inner-wall path — the param controls whether the outer-only
  // restriction applies, but reorderOuterLoop is only invoked for outer
  // walls today, so the flag is informational here. Inner-wall fuzzy
  // would need a parallel hook in the inner-wall emission loop.
  if (
    (pp.fuzzySkinsEnabled ?? false)
    && !layer.isFirstLayer
    && !(pp.spiralizeContour ?? false)
    && simplified.length >= 3
  ) {
    const isCCW = pipeline.signedArea(simplified) > 0;
    simplified = applyFuzzySkin(
      simplified,
      pp.fuzzySkinThickness ?? 0.3,
      pp.fuzzySkinPointDist ?? 0.8,
      isCCW,
      li,
    );
  }
  return simplified;
}

/**
 * Subdivide loop segments longer than `maxSegLen` mm into smaller pieces.
 * Used by spiralize + smoothSpiralizedContours so the Z ramp updates more
 * frequently across each long segment, avoiding visible step-bands on
 * coarse-tessellated walls (e.g. straight box sides).
 */
function subdivideLoop(loop: THREE.Vector2[], maxSegLen: number): THREE.Vector2[] {
  if (loop.length < 2 || maxSegLen <= 0) return loop;
  const out: THREE.Vector2[] = [];
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i];
    const b = loop[(i + 1) % loop.length];
    out.push(a);
    const len = a.distanceTo(b);
    if (len <= maxSegLen) continue;
    const n = Math.ceil(len / maxSegLen);
    for (let s = 1; s < n; s++) {
      const t = s / n;
      out.push(new THREE.Vector2(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t));
    }
  }
  return out;
}

function emitOuterLoop(params: EmitOuterLoopParams): number {
  const { pp, li, layerZ, layerH, isFirstLayer, outerWallSpeed, gcode, emitter, moves } = params;
  const isClosed = params.isClosed ?? true;
  const outerNominalLineWidth = isFirstLayer
    ? representativeLineWidth(params.lineWidth, pp.wallLineWidth)
    : (pp.outerWallLineWidth ?? pp.wallLineWidth);
  const variableLineWidth = shouldPreserveVariableWallWidth(params.lineWidth);
  const fallbackLineWidth = variableLineWidth
    ? representativeLineWidth(params.lineWidth, outerNominalLineWidth)
    : outerNominalLineWidth;
  let reordered = variableLineWidth
    ? params.loop
    : reorderOuterLoop(pp, params.pipeline, params.run, params.layer, emitter, params.loop, fallbackLineWidth, li);
  // Cura "Smooth Spiralized Contours" — subdivide long edges before the
  // spiral Z ramp so the layer's vertical climb is distributed across many
  // small Z increments instead of being concentrated at long-segment ends.
  // Without this, a 20mm flat side gets only one big Z-up move (visible
  // step), while a curved side with many short edges stays smooth.
  if (
    (pp.spiralizeContour ?? false)
    && (pp.smoothSpiralizedContours ?? false)
    && !params.layer.isSolidBottom
    && reordered.length >= 3
  ) {
    reordered = subdivideLoop(reordered, 0.5);
  }
  if (reordered.length < 2) return 0;
  emitter.setAccel(isFirstLayer ? pp.accelerationInitialLayer : (pp.accelerationOuterWall ?? pp.accelerationWall), pp.accelerationPrint);
  emitter.setJerk(isFirstLayer ? pp.jerkInitialLayer : (pp.jerkOuterWall ?? pp.jerkWall), pp.jerkPrint);
  emitter.travelTo(reordered[0].x, reordered[0].y, moves);
  gcode.push(`; ${params.comment ?? 'Outer wall'}`);
  // Spiralize / vase-mode Z ramp: ramp Z from prevLayerZ → layerZ smoothly
  // across the outer-wall perimeter so the head climbs continuously instead
  // of stepping at the layer change. The ramp is active only ABOVE the
  // solid-bottom band — below that we still print flat layers as the base
  // floor (matches Cura: solid base, then spiral above). isClosed is
  // required because an open path can't carry a continuous spiral.
  const spiralActive = (pp.spiralizeContour ?? false) && !params.layer.isSolidBottom && isClosed && reordered.length >= 3;
  let perimeter = 0;
  if (spiralActive) {
    for (let pi = 1; pi < reordered.length; pi++) perimeter += reordered[pi - 1].distanceTo(reordered[pi]);
    perimeter += reordered[reordered.length - 1].distanceTo(reordered[0]);
  }
  const prevLayerZ = (params.run.spiralPrevLayerZ ?? layerZ - layerH);
  const spiralStartZ = prevLayerZ;
  const spiralEndZ = layerZ;
  let traveled = 0;
  const scarfLen = pp.scarfSeamLength ?? 0;
  const scarfActive = scarfLen > 0 && (pp.scarfSeamStartHeight === undefined || layerZ >= pp.scarfSeamStartHeight);
  const scarfStepLen = pp.scarfSeamStepLength ?? 0;
  let scarfRemaining = scarfActive ? scarfLen : 0;
  let layerTime = 0;
  for (let pi = 1; pi < reordered.length; pi++) {
    const from = reordered[pi - 1], to = reordered[pi];
    const segLen = from.distanceTo(to);
    let segLW = variableLineWidth ? segmentLineWidth(params.lineWidth, pi - 1, pi) : fallbackLineWidth;
    const baseSegLW = segLW;
    let segSpeed = outerWallSpeed;
    if (scarfRemaining > 0) {
      const done = scarfLen - scarfRemaining;
      const tRaw = done / scarfLen;
      const t = Math.min(1, scarfStepLen > 0 ? Math.floor(done / scarfStepLen) * scarfStepLen / scarfLen : tRaw);
      segLW = baseSegLW * t;
      const speedRatio = pp.scarfSeamStartSpeedRatio ?? 1.0;
      segSpeed = outerWallSpeed * (speedRatio + (1.0 - speedRatio) * t);
      scarfRemaining = Math.max(0, scarfRemaining - segLen);
    }
    let segZ: number | undefined;
    if (spiralActive && perimeter > 0) {
      traveled += segLen;
      const t = Math.min(1, traveled / perimeter);
      segZ = spiralStartZ + (spiralEndZ - spiralStartZ) * t;
    }
    layerTime += emitter.extrudeTo(to.x, to.y, segSpeed, segLW, layerH, segZ).time;
    moves.push({ type: 'wall-outer', from: { x: from.x, y: from.y }, to: { x: to.x, y: to.y }, speed: segSpeed, extrusion: emitter.calculateExtrusion(segLen, segLW, layerH), lineWidth: segLW });
  }
  if (isClosed && reordered.length > 2) {
    const lastPt = reordered[reordered.length - 1], firstPt = reordered[0], segLen = lastPt.distanceTo(firstPt);
    const coastVol = params.allowCoasting ? (pp.coastingEnabled ? (pp.coastingVolume ?? 0) : 0) : 0;
    const minCoastVol = pp.minVolumeBeforeCoasting ?? 0;
    const loopVol = minCoastVol > 0 ? (() => {
      let perim = segLen;
      for (let ri = 1; ri < reordered.length - 1; ri++) perim += reordered[ri].distanceTo(reordered[ri + 1]);
      return perim * fallbackLineWidth * layerH;
    })() : Infinity;
    const closingLineWidth = variableLineWidth ? segmentLineWidth(params.lineWidth, reordered.length - 1, 0) : fallbackLineWidth;
    // Spiralize disables coasting on the closing segment — a coast move
    // would leave the head dwelling at varying Z mid-ramp and skip the
    // final Z increment. Force a clean Z-up close instead.
    const coastDist = (!spiralActive && coastVol > 0 && loopVol >= minCoastVol) ? coastVol / (closingLineWidth * layerH) : 0;
    if (coastDist > 0 && segLen > coastDist + 1e-3) {
      const t = 1 - coastDist / segLen;
      const midX = lastPt.x + (firstPt.x - lastPt.x) * t, midY = lastPt.y + (firstPt.y - lastPt.y) * t;
      layerTime += emitter.extrudeTo(midX, midY, outerWallSpeed, closingLineWidth, layerH).time;
      moves.push({ type: 'wall-outer', from: { x: lastPt.x, y: lastPt.y }, to: { x: midX, y: midY }, speed: outerWallSpeed, extrusion: emitter.calculateExtrusion(segLen * t, closingLineWidth, layerH), lineWidth: closingLineWidth });
      const coastSpeed = outerWallSpeed * ((pp.coastingSpeed ?? 90) / 100);
      gcode.push(`G0 X${firstPt.x.toFixed(3)} Y${firstPt.y.toFixed(3)} F${(coastSpeed * 60).toFixed(0)} ; Coast`);
      emitter.currentX = firstPt.x; emitter.currentY = firstPt.y;
    } else {
      let closeZ: number | undefined;
      if (spiralActive && perimeter > 0) {
        traveled += segLen;
        const t = Math.min(1, traveled / perimeter);
        closeZ = spiralStartZ + (spiralEndZ - spiralStartZ) * t;
      }
      layerTime += emitter.extrudeTo(firstPt.x, firstPt.y, outerWallSpeed, closingLineWidth, layerH, closeZ).time;
      moves.push({ type: 'wall-outer', from: { x: lastPt.x, y: lastPt.y }, to: { x: firstPt.x, y: firstPt.y }, speed: outerWallSpeed, extrusion: emitter.calculateExtrusion(segLen, closingLineWidth, layerH), lineWidth: closingLineWidth });
    }
  }
  if (spiralActive) params.run.spiralPrevLayerZ = spiralEndZ;
  return layerTime;
}

function generatedPerimetersForContour(
  slicer: SlicerExecutionPipeline,
  pp: SliceRun['pp'],
  layer: SliceLayerState,
  contour: SliceLayerState['contours'][number],
  containedHoles: THREE.Vector2[][],
  arachneContext: { sectionType: 'wall'; isTopOrBottomLayer: boolean },
): GeneratedPerimeters {
  const contourIndex = layer.contours?.indexOf(contour) ?? -1;
  const precomputed = contourIndex >= 0
    ? layer.precomputedContourWalls?.find((item) => item.contourIndex === contourIndex)
    : undefined;
  if (precomputed) return precomputed.perimeters;
  const wallLineWidth = lineWidthSpecForLayer(pp.wallLineWidth, pp, layer.isFirstLayer) as number;
  return slicer.filterPerimetersByMinOdd(
    slicer.generatePerimeters(contour.points, containedHoles, pp.wallCount, wallLineWidth, pp.outerWallInset ?? 0, arachneContext),
    pp.minOddWallLineWidth ?? 0,
  );
}

export function emitGroupedAndContourWalls(
  pipeline: unknown,
  run: SliceRun,
  layer: SliceLayerState,
): ContourWallData[] {
  const slicer = pipeline as SlicerExecutionPipeline;
  const { pp, emitter, gcode } = run;
  const { li, layerZ, layerH, isFirstLayer, outerWallSpeed, innerWallSpeed, workContours, holesByOuterContour, moves } = layer;
  const groupOW = pp.groupOuterWalls ?? false;
  const perContour: ContourWallData[] = [];
  const arachneContext = {
    sectionType: 'wall' as const,
    isTopOrBottomLayer: layer.isSolidTop || layer.isSolidBottom,
    isFirstLayer: layer.isFirstLayer,
  };
  beginSeamLayer(run, li);

  if (groupOW) {
    for (const contour of workContours) {
      if (!contour.isOuter) continue;
      const containedHoles = holesByOuterContour.get(contour) ?? [];
      const perimeters = generatedPerimetersForContour(slicer, pp, layer, contour, containedHoles, arachneContext);
      perContour.push({ contour, exWalls: perimeters, wallSets: perimeters.walls, wallLineWidths: perimeters.lineWidths, wallClosed: perimeters.wallClosed, outerWallCount: perimeters.outerCount, infillHoles: perimeters.innermostHoles, containedHoles });
    }
    for (const item of perContour) {
      const outerWall = item.wallSets[0];
      if (!outerWall || outerWall.length < 2) continue;
      layer.layerTime += emitOuterLoop({ pipeline: slicer, run, layer, pp, li, layerZ, layerH, isFirstLayer, outerWallSpeed, gcode, emitter, moves, loop: outerWall, lineWidth: item.wallLineWidths[0] ?? pp.wallLineWidth, isClosed: item.wallClosed?.[0] ?? true, comment: 'Outer wall (grouped)', allowCoasting: false });
    }
  }

  const contourWallData = groupOW ? perContour : workContours
    .filter((contour) => contour.isOuter)
    .map((contour): ContourWallData => {
      const containedHoles = holesByOuterContour.get(contour) ?? [];
      const exWalls = generatedPerimetersForContour(slicer, pp, layer, contour, containedHoles, arachneContext);
      return {
        contour,
        exWalls,
        wallSets: exWalls.walls,
        wallLineWidths: exWalls.lineWidths,
        wallClosed: exWalls.wallClosed,
        outerWallCount: exWalls.outerCount,
        infillHoles: exWalls.innermostHoles,
        containedHoles,
      };
    });

  const orderedContourWallData = orcaOrderedContourWallData(
    contourWallData,
    { x: emitter.currentX, y: emitter.currentY },
  );

  for (const contourData of orderedContourWallData) {
    const { exWalls, wallSets, wallLineWidths, wallClosed } = contourData;
    const externalBoundaries = [contourData.contour.points, ...(contourData.containedHoles ?? [])];
    if (!groupOW) perContour.push(contourData);

    if (!groupOW && wallSets.length > 0 && pp.outerWallFirst) {
      if (isFirstLayer && pp.initialLayerOuterWallFlow != null) emitter.currentLayerFlow = pp.initialLayerOuterWallFlow / 100;
      layer.layerTime += emitOuterLoop({ pipeline: slicer, run, layer, pp, li, layerZ, layerH, isFirstLayer, outerWallSpeed, gcode, emitter, moves, loop: wallSets[0], lineWidth: wallLineWidths[0] ?? pp.wallLineWidth, isClosed: wallClosed?.[0] ?? true, allowCoasting: true });
    }

    const initialLayerFlow = pp.initialLayerFlow ?? 0;
    emitter.currentLayerFlow = isFirstLayer && initialLayerFlow > 0 ? (initialLayerFlow / 100) : 1.0;
    const innerLW = pp.innerWallLineWidth ?? pp.wallLineWidth;
    if (isFirstLayer && pp.initialLayerInnerWallFlow != null) emitter.currentLayerFlow = pp.initialLayerInnerWallFlow / 100;
    const wallDepths: number[] = exWalls.wallDepths ?? [];
    const wallSources = exWalls.wallSources;

    // Build the emission order for inner walls (everything past index 0,
    // which is the outer wall already handled separately above).
    //
    // Inset-order optimizer (Cura `InsetOrderOptimizer` parity): order
    // the inner walls by depth, NOT by libArachne's emission order.
    //   • `outerWallFirst === true` → ascending depth (depth 1, 2, 3 …):
    //     each inset is emitted before the next one further inside, so
    //     bridges over voids (e.g. the lip of a horizontal hole) anchor
    //     to the outermost inset that's already laid down.
    //   • `outerWallFirst === false` → descending depth (deepest first):
    //     surface finish improves because the outer wall is the LAST
    //     thing extruded against still-loose plastic — same trade-off
    //     Cura/Orca document under "Outside Before Inside Walls".
    //
    // Orca-style region scheduling: depth constraints decide which walls
    // are currently unblocked, then the next path is the nearest available
    // start point from the nozzle. Arachne odd/open paths stay in this same
    // wall scheduler; Orca emits them as variable-width inner walls rather
    // than splitting them into a separate gap-fill phase.
    // Spiralize / vase mode: above the solid bottom layers, emit only the
    // outer wall — no inner walls, no gap-fill, no hole-outer walls. This
    // is what produces the single-pass hollow shell. The bottom layers
    // (li < bottomLayers, marked isSolidBottom) still get full wall stacks
    // so the base prints as a normal solid floor. Emit the outer wall
    // unconditionally for spiralize layers (ignoring `outerWallFirst`
    // since there are no inner walls to sequence with), then skip the
    // inner-wall block + outer-wall-after block by `continue`-ing.
    if (pp.spiralizeContour && !layer.isSolidBottom) {
      if (!groupOW && wallSets.length > 0) {
        layer.layerTime += emitOuterLoop({ pipeline: slicer, run, layer, pp, li, layerZ, layerH, isFirstLayer, outerWallSpeed, gcode, emitter, moves, loop: wallSets[0], lineWidth: wallLineWidths[0] ?? pp.wallLineWidth, isClosed: wallClosed?.[0] ?? true, allowCoasting: false });
      }
      continue;
    }
    const innerOrder = orcaOrderedWallIndices(
      wallSets,
      wallDepths,
      wallSources,
      wallClosed,
      { x: emitter.currentX, y: emitter.currentY },
      pp.outerWallFirst !== false,
    );

    for (const wi of innerOrder) {
      // wallDepths[wi] === 0 means this is the outermost wall of its
      // contour — for hole loops, this is the wall closest to the hole's
      // empty space, which is topologically the wall-OUTER of that hole.
      // Tag it accordingly so the preview renders it in the outer colour
      // (red) next to the empty hole, matching how OrcaSlicer / Cura render.
      const wallSource = wallSources?.[wi];
      const isGapFill = wallSource === 'gapfill';
      const isDepthZeroWall = (wallDepths[wi] ?? 1) === 0;
      const rawWallLWSpec: WallLineWidthSpec = wallLineWidths[wi] ?? pp.wallLineWidth;
      const rawWallLW = representativeLineWidth(rawWallLWSpec, pp.wallLineWidth);
      const boundaryThreshold = Math.max(0.08, rawWallLW * 0.9 + Math.abs(pp.outerWallInset ?? 0));
      const isBoundaryExternalWall = isDepthZeroWall
        && wallTracksBoundary(wallSets[wi], externalBoundaries, boundaryThreshold);
      const isExternalWall = !isGapFill
        && isDepthZeroWall
        && (wallSource === 'hole' || isBoundaryExternalWall);
      // Orca labels Arachne odd/open paths as inner-wall extrusion in G-code.
      // Keeping that classification prevents a separate visible "gap-fill"
      // path from being appended over the wall band in preview/simulation.
      const moveType: 'wall-outer' | 'wall-inner' = isExternalWall ? 'wall-outer' : 'wall-inner';
      // Arachne odd/open paths print at inner-wall speed; they're short,
      // narrow variable-width wall beads and pushing them at outer-wall
      // speed risks under-extrusion at the medial-axis tips.
      const wallSpeed = isGapFill ? innerWallSpeed
        : isExternalWall ? outerWallSpeed : innerWallSpeed;
      const isClosed = wallClosed?.[wi] ?? true;
      const nominalWallLW = isExternalWall ? (pp.outerWallLineWidth ?? pp.wallLineWidth) : innerLW;
      // Orca converts regular closed Arachne walls into stable wall paths
      // before preview/G-code, while odd/open transition beads keep their
      // variable width. If we emit every closed wall vertex/width directly,
      // tiny Arachne jogs become visible dents on round outer walls. Preserve
      // variable widths for first-layer squish and true odd/open beads; route
      // regular closed walls through the nominal-width simplification path.
      const wallLWSpec: WallLineWidthSpec = shouldPreserveVariableWallWidth(rawWallLWSpec)
        ? rawWallLWSpec
        : nominalWallLW;
      const wallLW = representativeLineWidth(wallLWSpec, nominalWallLW);
      // Aggressive simplification (≈half the line width) acts as a poor-
      // man's Arachne for narrow regions: any perimeter "finger" or notch
      // narrower than ~lw/2 gets straightened out by RDP, so the wall no
      // longer snakes into thin breakthroughs around mounting holes. Real
      // curvature on the boundary (radius >> lw/2) is preserved because
      // those vertices deviate from the chord by more than the tolerance.
      // Walls that are intentional sharp corners (rectangles, slot ends)
      // also keep their corners — RDP only collapses points within the
      // tolerance, never adds vertices.
      //
      // NOTE: tolerance must stay consistent with the infill-region's
      // boundary geometry, since the infill is clipped to the un-simplified
      // region. If walls are smoothed more aggressively than the infill
      // region, infill lines extend into the zigzag corners where walls
      // no longer go — visible as "infill crossing walls" in the preview.
      // See note on outer-wall simplification — tight chord tolerance to
      // preserve design curves; libArachne handles narrow-finger
      // collapse separately via transition zones.
      const simplifyTol = Math.max(0.005, wallLW * 0.05);
      const wallLoop = Array.isArray(wallLWSpec) || !isClosed ? wallSets[wi] : slicer.simplifyClosedContour(wallSets[wi], simplifyTol);
      if (wallLoop.length < 2) continue;
      emitter.setAccel(
        isFirstLayer ? pp.accelerationInitialLayer
          : isExternalWall ? (pp.accelerationOuterWall ?? pp.accelerationWall)
          : (pp.accelerationInnerWall ?? pp.accelerationWall),
        pp.accelerationPrint,
      );
      emitter.setJerk(
        isFirstLayer ? pp.jerkInitialLayer
          : isExternalWall ? (pp.jerkOuterWall ?? pp.jerkWall)
          : (pp.jerkInnerWall ?? pp.jerkWall),
        pp.jerkPrint,
      );
      emitter.travelTo(wallLoop[0].x, wallLoop[0].y, moves);
      gcode.push(`; ${isExternalWall ? 'Outer wall' : 'Inner wall'} ${wi}`);
      for (let pi = 1; pi < wallLoop.length; pi++) {
        const from = wallLoop[pi - 1], to = wallLoop[pi];
        const segLW = segmentLineWidth(wallLWSpec, pi - 1, pi);
        layer.layerTime += emitter.extrudeTo(to.x, to.y, wallSpeed, segLW, layerH).time;
        moves.push({ type: moveType, from: { x: from.x, y: from.y }, to: { x: to.x, y: to.y }, speed: wallSpeed, extrusion: emitter.calculateExtrusion(from.distanceTo(to), segLW, layerH), lineWidth: segLW });
      }
      if (isClosed && wallLoop.length > 2) {
        const lastPt = wallLoop[wallLoop.length - 1], firstPt = wallLoop[0];
        const segLW = segmentLineWidth(wallLWSpec, wallLoop.length - 1, 0);
        layer.layerTime += emitter.extrudeTo(firstPt.x, firstPt.y, wallSpeed, segLW, layerH).time;
        moves.push({ type: moveType, from: { x: lastPt.x, y: lastPt.y }, to: { x: firstPt.x, y: firstPt.y }, speed: wallSpeed, extrusion: emitter.calculateExtrusion(lastPt.distanceTo(firstPt), segLW, layerH), lineWidth: segLW });
      }
    }

    emitter.currentLayerFlow = isFirstLayer && initialLayerFlow > 0 ? (initialLayerFlow / 100) : 1.0;
    if (!groupOW && wallSets.length > 0 && !pp.outerWallFirst) {
      if (isFirstLayer && pp.initialLayerOuterWallFlow != null) emitter.currentLayerFlow = pp.initialLayerOuterWallFlow / 100;
      layer.layerTime += emitOuterLoop({ pipeline: slicer, run, layer, pp, li, layerZ, layerH, isFirstLayer, outerWallSpeed, gcode, emitter, moves, loop: wallSets[0], lineWidth: wallLineWidths[0] ?? pp.wallLineWidth, isClosed: wallClosed?.[0] ?? true, allowCoasting: true });
      emitter.currentLayerFlow = isFirstLayer && initialLayerFlow > 0 ? (initialLayerFlow / 100) : 1.0;
    }
  }

  return perContour.filter((item) => item.contour?.isOuter);
}
