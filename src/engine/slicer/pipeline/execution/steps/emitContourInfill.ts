import * as THREE from 'three';
import type { MultiPolygon as PCMultiPolygon, Ring as PCRing } from 'polygon-clipping';
import { booleanMultiPolygonClipper2Sync } from '../../../geometry/clipper2Boolean';
import type { ContourWallData, SlicerExecutionPipeline, SliceLayerState, SliceRun } from './types';
import type { SliceMove } from '../../../../../types/slicer';
import { lineWidthForLayer } from './lineWidths';
import { flipLine } from '../../infill';
import { subdivideInfillRegionByOverrides } from '../../modifierMeshes';

// ARACHNE-9.4A.4: worker awaits Clipper2 load before slicing — see SlicerWorker.ts.
function requireMP(result: PCMultiPolygon | null, op: string): PCMultiPolygon {
  if (result === null) throw new Error(`emitContourInfill.${op}: Clipper2 WASM not loaded`);
  return result;
}

function representativeLineWidth(lineWidth: number | number[] | undefined, fallback: number): number {
  if (Array.isArray(lineWidth)) {
    if (lineWidth.length === 0) return fallback;
    return lineWidth.reduce((sum, width) => sum + width, 0) / lineWidth.length;
  }
  return lineWidth ?? fallback;
}

function offsetContourFast(pipeline: SlicerExecutionPipeline, contour: THREE.Vector2[], offset: number): THREE.Vector2[] {
  return typeof pipeline.offsetContourFast === 'function'
    ? pipeline.offsetContourFast(contour, offset)
    : pipeline.offsetContour(contour, offset);
}

function unionMultiPolygon(mp: PCMultiPolygon): PCMultiPolygon {
  if (mp.length <= 1) return mp;
  return requireMP(booleanMultiPolygonClipper2Sync(mp, [], 'union'), 'union');
}

function intersectMultiPolygon(a: PCMultiPolygon, b: PCMultiPolygon): PCMultiPolygon {
  return requireMP(booleanMultiPolygonClipper2Sync(a, b, 'intersection'), 'intersection');
}

function differenceMultiPolygon(a: PCMultiPolygon, b: PCMultiPolygon): PCMultiPolygon {
  return requireMP(booleanMultiPolygonClipper2Sync(a, b, 'difference'), 'difference');
}

function offsetByAreaIntent(
  pipeline: SlicerExecutionPipeline,
  contour: THREE.Vector2[],
  distance: number,
  intent: 'shrink' | 'grow',
): THREE.Vector2[] {
  // Hot path: this fires for every infill region's outer + every hole
  // on every solid layer, so an extra Clipper2 round-trip per call
  // multiplies into hundreds of WASM crossings on a typical print.
  // Previous implementation tried BOTH `+distance` and `-distance` and
  // picked the result by area afterward, paying for two offset ops to
  // resolve a single sign question.
  //
  // We can derive the correct sign deterministically from the contour's
  // winding. `pipeline.offsetContourFast` already does winding-aware
  // sign-flipping internally so that `+distance` always means "inset
  // toward solid" — a CCW outer shrinks (smaller |area|), a CW hole
  // expands its enclosed-area magnitude (visually shrinks the hole).
  // So:
  //   intent=shrink (smaller |area| wanted) → call(+distance) on CCW,
  //                                            call(-distance) on CW.
  //   intent=grow                            → opposite sign per case.
  //
  // Encoding both axes: dirSign = signedAreaPos ? +1 : -1, and
  //   shrink → +dirSign * distance
  //   grow   → -dirSign * distance.
  // One WASM call. If the result degenerates (length < 3) we fall back
  // to the other direction — same edge-case behaviour as before, just
  // without paying for both calls in the common path.
  let signed2 = 0;
  for (let i = 0; i < contour.length; i++) {
    const a = contour[i];
    const b = contour[(i + 1) % contour.length];
    signed2 += a.x * b.y - b.x * a.y;
  }
  const dirSign = signed2 >= 0 ? 1 : -1;
  const primarySign = intent === 'shrink' ? dirSign : -dirSign;
  const primary = offsetContourFast(pipeline, contour, primarySign * distance);
  if (primary.length >= 3) return primary;
  // Rare degenerate fallback: original tried both directions, so do
  // the same here to preserve behaviour parity for the test suite.
  return offsetContourFast(pipeline, contour, -primarySign * distance);
}

function insetFillCenterlineRegion(
  pipeline: SlicerExecutionPipeline,
  contour: THREE.Vector2[],
  holes: THREE.Vector2[][],
  lineWidth: number,
  centerlineInset = lineWidth * 0.5,
): { contour: THREE.Vector2[]; holes: THREE.Vector2[][] } | null {
  const inset = Math.max(0, centerlineInset);
  const safeContour = inset > 0 ? offsetByAreaIntent(pipeline, contour, inset, 'shrink') : contour;
  if (safeContour.length < 3) return null;
  const safeHoles = holes
    .map((hole) => (inset > 0 ? offsetByAreaIntent(pipeline, hole, inset, 'grow') : hole))
    .filter((hole) => hole.length >= 3);
  return { contour: safeContour, holes: safeHoles };
}

/** Profile fields read by `pickBridgeFanSpeed` — typed locally so the
 *  helper has zero dependency on the full `PrintProfile` shape. */
export interface BridgeFanProfile {
  bridgeFanSpeed?: number;
  bridgeFanSpeed2?: number;
  bridgeFanSpeed3?: number;
  bridgeEnableMoreLayers?: boolean;
  bridgeHasMultipleLayers?: boolean;
}

/**
 * Pick the fan speed % for a bridge move based on how many consecutive
 * layers (incl. this one) have had bridges so far. Mirrors Cura's
 * `bridge_fan_speed` / `bridge_fan_speed_2` / `bridge_fan_speed_3`
 * cascade gated by `bridge_enable_more_layers`.
 *
 * `priorConsecutive` is the value of `run.consecutiveBridgeLayers` BEFORE
 * `finalizeLayer` runs for the current layer — i.e. the count of bridge
 * layers that have already finished. The current layer is `priorConsecutive + 1`.
 *
 * Default fan speed (100 %) is returned when nothing in the profile says
 * otherwise. Each tier falls back through `bridgeFanSpeed2 → bridgeFanSpeed`
 * etc. so partially-configured profiles still produce a sane value.
 */
export function pickBridgeFanSpeed(
  pp: BridgeFanProfile,
  priorConsecutive: number,
): number {
  const moreLayers = pp.bridgeEnableMoreLayers ?? pp.bridgeHasMultipleLayers ?? false;
  const consecutive = (priorConsecutive ?? 0) + 1;
  if (!moreLayers || consecutive <= 1) return pp.bridgeFanSpeed ?? 100;
  if (consecutive === 2) return pp.bridgeFanSpeed2 ?? pp.bridgeFanSpeed ?? 100;
  return pp.bridgeFanSpeed3 ?? pp.bridgeFanSpeed2 ?? pp.bridgeFanSpeed ?? 100;
}

type InfillMoveType = Extract<SliceMove['type'], 'infill' | 'top-bottom' | 'bridge'>;
type InfillLineSegment = {
  from: THREE.Vector2;
  to: THREE.Vector2;
  boundaryContour?: THREE.Vector2[];
  boundaryHoles?: THREE.Vector2[][];
};
type RingProjection = { ring: THREE.Vector2[]; seg: number; t: number; point: THREE.Vector2; distSq: number };
type SolidSkinOrderOptions = {
  canTransition?: (
    from: THREE.Vector2,
    to: THREE.Vector2,
    previous: InfillLineSegment,
    next: InfillLineSegment,
  ) => boolean;
  transitionPenaltySq?: number;
};

export function solidSkinCenterlineInset(lineWidth: number, skinOverlap: number): number {
  return Math.max(0, lineWidth * 0.5 - skinOverlap);
}

export function skinRemovalWidthForLayer(
  pp: Pick<SliceRun['pp'], 'skinRemovalWidth' | 'topSkinRemovalWidth' | 'bottomSkinRemovalWidth'>,
  isSolidTop: boolean,
  isSolidBottom: boolean,
): number {
  if (isSolidTop) return pp.topSkinRemovalWidth ?? pp.skinRemovalWidth ?? 0;
  if (isSolidBottom) return pp.bottomSkinRemovalWidth ?? pp.skinRemovalWidth ?? 0;
  return pp.skinRemovalWidth ?? 0;
}

/**
 * Cura's "Small Top/Bottom Width": when the smaller bbox dimension of a
 * skin region is below the threshold the region is too narrow to print a
 * clean solid skin (would just be a single short scanline), so skin
 * emission is skipped for that region. Sparse infill emitted afterward
 * still fills the area, matching Cura's behavior.
 *
 * Returns true when the region should be skipped (region is too small).
 */
export function skipSkinForSmallRegion(
  bbox: { minX: number; maxX: number; minY: number; maxY: number },
  smallTopBottomWidth: number | undefined,
): boolean {
  const threshold = smallTopBottomWidth ?? 0;
  if (threshold <= 0) return false;
  const minSpan = Math.min(bbox.maxX - bbox.minX, bbox.maxY - bbox.minY);
  return minSpan < threshold;
}

/**
 * Cura's "Minimum Skin Width for Expansion": the skin-expansion offset
 * (`topSkinExpandDistance` / `bottomSkinExpandDistance` /
 * `topSurfaceSkinExpansion`) is only applied to skin regions whose
 * smaller bbox dimension meets this threshold. For tiny regions the
 * expansion would either eat the entire region or push the bead out
 * past the wall, so we leave them at their native size and just emit
 * the standard skin overlap.
 *
 * Returns true when expansion SHOULD be applied; false when it should
 * be skipped for this region. A threshold of 0 (or undefined) keeps
 * the legacy behavior — every region gets expansion.
 */
export function shouldExpandSkinForRegion(
  bbox: { minX: number; maxX: number; minY: number; maxY: number },
  minSkinWidthForExpansion: number | undefined,
): boolean {
  const threshold = minSkinWidthForExpansion ?? 0;
  if (threshold <= 0) return true;
  const minSpan = Math.min(bbox.maxX - bbox.minX, bbox.maxY - bbox.minY);
  return minSpan >= threshold;
}

export function sortSolidSkinLinesForEmission(
  lines: InfillLineSegment[],
  lineWidth: number,
  startPosition?: { x: number; y: number },
  options: SolidSkinOrderOptions = {},
): InfillLineSegment[] {
  if (lines.length <= 1) return lines;

  let longest = lines[0];
  let longestLenSq = -1;
  for (const line of lines) {
    const dx = line.to.x - line.from.x;
    const dy = line.to.y - line.from.y;
    const lenSq = dx * dx + dy * dy;
    if (lenSq > longestLenSq) {
      longest = line;
      longestLenSq = lenSq;
    }
  }
  if (longestLenSq <= 1e-9) return lines;

  const len = Math.sqrt(longestLenSq);
  const ux = (longest.to.x - longest.from.x) / len;
  const uy = (longest.to.y - longest.from.y) / len;
  const nx = -uy;
  const ny = ux;
  const rowTolerance = Math.max(1e-4, lineWidth * 0.35);

  const rows: Array<{ coord: number; lines: InfillLineSegment[] }> = [];
  for (const line of lines) {
    const mx = (line.from.x + line.to.x) * 0.5;
    const my = (line.from.y + line.to.y) * 0.5;
    const rowCoord = mx * nx + my * ny;
    let row = rows.find((candidate) => Math.abs(candidate.coord - rowCoord) <= rowTolerance);
    if (!row) {
      row = { coord: rowCoord, lines: [] };
      rows.push(row);
    }
    row.coord = (row.coord * row.lines.length + rowCoord) / (row.lines.length + 1);
    row.lines.push(line);
  }

  rows.sort((a, b) => a.coord - b.coord);

  const sorted: InfillLineSegment[] = [];
  const projectedStart = (line: InfillLineSegment) => line.from.x * ux + line.from.y * uy;
  const projectedEnd = (line: InfillLineSegment) => line.to.x * ux + line.to.y * uy;
  const projectedMin = (line: InfillLineSegment) => Math.min(projectedStart(line), projectedEnd(line));
  const projectedMax = (line: InfillLineSegment) => Math.max(projectedStart(line), projectedEnd(line));

  rows.forEach((row, rowIndex) => {
    const forward = rowIndex % 2 === 0;
    row.lines.sort((a, b) => forward
      ? projectedMin(a) - projectedMin(b)
      : projectedMax(b) - projectedMax(a));

    for (const line of row.lines) {
      const start = projectedStart(line);
      const end = projectedEnd(line);
      const isForward = start <= end;
      sorted.push(forward === isForward ? line : flipLine(line));
    }
  });

  const remaining = sorted.slice();
  const ordered: InfillLineSegment[] = [];
  let cursor = startPosition ?? remaining[0].from;
  let previousLine: InfillLineSegment | undefined;
  const transitionPenaltySq = options.transitionPenaltySq ?? Math.max(lineWidth * 80, 20) ** 2;
  const transitionScore = (line: InfillLineSegment, flip: boolean): number => {
    const candidate = flip ? flipLine(line) : line;
    const distSq = candidate.from.distanceToSquared(cursor);
    if (!previousLine || !options.canTransition) return distSq;
    const from = cursor instanceof THREE.Vector2 ? cursor : new THREE.Vector2(cursor.x, cursor.y);
    return options.canTransition(from, candidate.from, previousLine, candidate)
      ? distSq
      : distSq + transitionPenaltySq;
  };

  while (remaining.length > 0) {
    let bestIdx = 0;
    let bestScore = Infinity;
    let bestFlip = false;
    for (let i = 0; i < remaining.length; i++) {
      const line = remaining[i];
      const fromScore = transitionScore(line, false);
      const toScore = transitionScore(line, true);
      if (fromScore < bestScore) {
        bestScore = fromScore;
        bestIdx = i;
        bestFlip = false;
      }
      if (toScore < bestScore) {
        bestScore = toScore;
        bestIdx = i;
        bestFlip = true;
      }
    }
    const [line] = remaining.splice(bestIdx, 1);
    const next = bestFlip ? flipLine(line) : line;
    ordered.push(next);
    cursor = next.to;
    previousLine = next;
  }

  return ordered;
}

export function shouldConnectInfillLinesForEmission(
  isSolid: boolean,
  connectTopBottomPolygons: boolean | undefined,
  connectInfillLines: boolean | undefined,
  infillRegionCount: number,
): boolean {
  return isSolid
    ? (connectTopBottomPolygons ?? connectInfillLines ?? false)
    : (connectInfillLines ?? false) && infillRegionCount <= 1;
}

export function solidSkinConnectorLinkLimit(lineWidth: number): number {
  // Orca's rectilinear/monotonic fill can accept long links because
  // `polylines_from_paths()` emits the connector along validated
  // contour/perimeter segments. Our current connector is a direct
  // straight extrusion between scanline endpoints, so keep it limited to
  // neighboring rows plus a little room for first-layer widened beads.
  // Longer hole-edge transitions are handled by contour-walk connectors.
  return lineWidth * 3.25;
}

export function sparseInfillConnectorLinkLimit(lineWidth: number): number {
  return lineWidth * 1.5;
}

function closestPointOnRing(point: THREE.Vector2, ring: THREE.Vector2[]): RingProjection | null {
  if (ring.length < 3) return null;
  let best: RingProjection | null = null;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    if (lenSq <= 1e-12) continue;
    const rawT = ((point.x - a.x) * dx + (point.y - a.y) * dy) / lenSq;
    const t = Math.max(0, Math.min(1, rawT));
    const projected = new THREE.Vector2(a.x + dx * t, a.y + dy * t);
    const distSq = projected.distanceToSquared(point);
    if (!best || distSq < best.distSq) {
      best = { ring, seg: i, t, point: projected, distSq };
    }
  }
  return best;
}

function removeNearDuplicateConnectorPoints(points: THREE.Vector2[]): THREE.Vector2[] {
  const out: THREE.Vector2[] = [];
  for (const point of points) {
    const prev = out[out.length - 1];
    if (!prev || prev.distanceToSquared(point) > 1e-8) out.push(point);
  }
  return out;
}

function attachSkinBoundary(
  lines: InfillLineSegment[],
  contour: THREE.Vector2[],
  holes: THREE.Vector2[][],
): InfillLineSegment[] {
  return lines.map((line) => ({
    ...line,
    boundaryContour: contour,
    boundaryHoles: holes,
  }));
}

function ringPathForward(from: RingProjection, to: RingProjection): THREE.Vector2[] {
  const ring = from.ring;
  const n = ring.length;
  const points = [from.point.clone()];
  if (from.seg === to.seg && to.t >= from.t) {
    points.push(to.point.clone());
    return removeNearDuplicateConnectorPoints(points);
  }
  let idx = (from.seg + 1) % n;
  let guard = 0;
  while (guard++ <= n) {
    points.push(ring[idx].clone());
    if (idx === to.seg) break;
    idx = (idx + 1) % n;
  }
  points.push(to.point.clone());
  return removeNearDuplicateConnectorPoints(points);
}

function polylineLength(points: THREE.Vector2[]): number {
  let length = 0;
  for (let i = 1; i < points.length; i++) length += points[i - 1].distanceTo(points[i]);
  return length;
}

function ringPointAtDistance(
  from: RingProjection,
  distance: number,
  clockwise: boolean,
): THREE.Vector2[] {
  const ring = from.ring;
  const n = ring.length;
  const points = [from.point.clone()];
  let remaining = distance;
  let seg = from.seg;
  let t = from.t;
  let guard = 0;

  while (remaining > 1e-6 && guard++ <= n + 1) {
    const a = ring[seg];
    const b = ring[(seg + 1) % n];
    const segLen = a.distanceTo(b);
    if (segLen <= 1e-9) break;

    const available = clockwise ? t * segLen : (1 - t) * segLen;
    if (available >= remaining) {
      const nextT = clockwise
        ? t - remaining / segLen
        : t + remaining / segLen;
      points.push(new THREE.Vector2(
        a.x + (b.x - a.x) * nextT,
        a.y + (b.y - a.y) * nextT,
      ));
      break;
    }

    points.push((clockwise ? a : b).clone());
    remaining -= available;
    if (clockwise) {
      seg = (seg - 1 + n) % n;
      t = 1;
    } else {
      seg = (seg + 1) % n;
      t = 0;
    }
  }

  return removeNearDuplicateConnectorPoints(points);
}

function shortestRingPath(from: RingProjection, to: RingProjection): THREE.Vector2[] {
  const forward = ringPathForward(from, to);
  const backward = ringPathForward(to, from).reverse();
  return polylineLength(forward) <= polylineLength(backward) ? forward : backward;
}

export function findSolidSkinContourConnectorPath(
  from: THREE.Vector2,
  to: THREE.Vector2,
  outer: THREE.Vector2[],
  holes: THREE.Vector2[][],
  lineWidth: number,
): THREE.Vector2[] | null {
  const maxProjectionDistSq = (lineWidth * 1.35) ** 2;
  // Contour-walk connectors are not straight chords: they follow the same
  // validated boundary arcs Orca's monotonic fill uses between clipped
  // scanline ends. Give them enough room to wrap around small circular
  // features, while still rejecting opposite-side walks around larger holes.
  const maxWalkLength = Math.max(lineWidth * 24, 6);
  let bestPath: THREE.Vector2[] | null = null;
  let bestLength = Infinity;

  for (const ring of [outer, ...holes]) {
    const a = closestPointOnRing(from, ring);
    const b = closestPointOnRing(to, ring);
    if (!a || !b || a.distSq > maxProjectionDistSq || b.distSq > maxProjectionDistSq) continue;
    const path = shortestRingPath(a, b);
    const length = polylineLength(path);
    if (length > maxWalkLength || length >= bestLength) continue;
    bestPath = removeNearDuplicateConnectorPoints([from.clone(), ...path, to.clone()]);
    bestLength = length;
  }

  return bestPath && bestPath.length >= 2 ? bestPath : null;
}

export function findSolidSkinContourAnchorPath(
  from: THREE.Vector2,
  incomingDir: THREE.Vector2,
  outer: THREE.Vector2[],
  holes: THREE.Vector2[][],
  lineWidth: number,
): THREE.Vector2[] | null {
  const maxProjectionDistSq = (lineWidth * 1.35) ** 2;
  let best: RingProjection | null = null;
  for (const ring of [outer, ...holes]) {
    const projection = closestPointOnRing(from, ring);
    if (!projection || projection.distSq > maxProjectionDistSq) continue;
    if (!best || projection.distSq < best.distSq) best = projection;
  }
  if (!best) return null;

  const ring = best.ring;
  const a = ring[best.seg];
  const b = ring[(best.seg + 1) % ring.length];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len <= 1e-9) return null;

  const inLen = incomingDir.length();
  const ix = inLen > 1e-9 ? incomingDir.x / inLen : 0;
  const iy = inLen > 1e-9 ? incomingDir.y / inLen : 0;
  const forwardDot = ix * (dx / len) + iy * (dy / len);
  const clockwise = forwardDot < 0;
  const anchorLength = Math.max(lineWidth, lineWidth * 0.5);
  const path = removeNearDuplicateConnectorPoints([
    from.clone(),
    ...ringPointAtDistance(best, anchorLength, clockwise),
  ]);
  return path.length >= 2 && polylineLength(path) > 1e-6 ? path : null;
}

export function emitContourInfill(
  pipeline: unknown,
  run: SliceRun,
  layer: SliceLayerState,
  contoursData: ContourWallData[],
): void {
  const slicer = pipeline as SlicerExecutionPipeline;
  const { pp, mat, triangles, offsetX, offsetY, emitter, gcode } = run;
  const { li, layerH, isFirstLayer, isSolid, isSolidBottom, isSolidTop, isTopSurfaceLayer, infillSpeed, topBottomSpeed, hasBridgeRegions, isInBridgeRegion, moves } = layer;

  // Spiralize / vase mode: keep solid bottom skin (the "base") for the first
  // `bottomLayers` layers so the part has a flat floor, then suppress all
  // infill, top skin, and sparse fill above that — vase mode prints a single
  // hollow shell. Walls are still emitted (single outer wall, no inner walls
  // see emitGroupedAndContourWalls.ts spiralize gating).
  if (pp.spiralizeContour && !isSolidBottom) {
    return;
  }

  for (const item of contoursData) {
    const { contour, exWalls, wallSets, wallLineWidths, outerWallCount, infillHoles } = item;
    const layerWallLineWidth = lineWidthForLayer(pp.wallLineWidth, pp, isFirstLayer);
    const adaptiveOuterFilled = outerWallCount === 1 && representativeLineWidth(wallLineWidths[0], layerWallLineWidth) > layerWallLineWidth + 1e-6;
    const innermostWall = adaptiveOuterFilled ? [] : outerWallCount > 0 ? wallSets[outerWallCount - 1] : contour.points;
    const infillRegions = adaptiveOuterFilled ? [] : (exWalls.infillRegions.length > 0 ? exWalls.infillRegions : (innermostWall.length >= 3 ? [{ contour: innermostWall, holes: infillHoles }] : []));
    if (infillRegions.length === 0) continue;

    let infillLines: InfillLineSegment[] = [];
    let infillMoveType: InfillMoveType = 'infill';
    let speed = infillSpeed;
    // Top-surface ultra-quality overrides apply ONLY to the topmost
    // `topSurfaceSkinLayers` layers (Cura's semantics). Solid-top layers
    // below that band still get solid skin, but use regular topBottom
    // settings — which fall through to infillLineWidth via the normal
    // skin pipeline. When `topSurfaceSkinLayers` is 0 (default), no
    // layer is flagged as a top-surface layer.
    const baseLineWidth = isTopSurfaceLayer
      ? (pp.topSurfaceSkinLineWidth ?? pp.topBottomLineWidth ?? pp.infillLineWidth)
      : isSolidTop
        ? (pp.topBottomLineWidth ?? pp.infillLineWidth)
        : pp.infillLineWidth;
    const lineWidth = lineWidthForLayer(baseLineWidth, pp, isFirstLayer);

    if (isFirstLayer && isSolid && pp.initialLayerBottomFlow != null) emitter.currentLayerFlow = pp.initialLayerBottomFlow / 100;

    if (isSolid) {
      // Skin/wall bonding: the scanline centerline boundary needs to
      // sit slightly INSIDE the wall stroke band so the bead's printed
      // edge touches the inner-wall ring instead of leaving a visible
      // gap in the preview (and a real gap in the print). We push the
      // skin region outward by `skinOverlapPercent` × lineWidth (Cura
      // / Orca call this `infill_wall_overlap` / `skin_overlap`).
      //
      // On the FIRST layer we previously forced this to zero, fearing
      // that any creep onto the walls would print as visible blob on
      // the bed. Result: the bottom skin floats unattached to walls
      // (visible white gap between the blue scanlines and the green
      // inner-wall ring). With our stroke-subtract pipeline the body
      // is already inset by halfWidth + a 25% safety pad, so the skin
      // centerline sits well clear of the actual bead — applying the
      // normal overlap on layer 0 closes the gap without bulging onto
      // the bed beyond the wall's footprint. Default `skinOverlapPercent`
      // of 23% (Orca's standard) gives ~0.10 mm overlap at lineWidth
      // 0.45 mm — enough to bond, not enough to print past the wall.
      const skinOverlap = ((pp.skinOverlapPercent ?? 23) / 100) * lineWidth;
      const topSurfaceExpand = pp.topSurfaceSkinExpansion ?? pp.topSkinExpandDistance ?? 0;
      // `topSurfaceSkinExpansion` only grows the topmost-N "top-surface"
      // layers; lower solid-top layers fall back to `topSkinExpandDistance`
      // via the same field (already merged above).
      const totalExpand = skinOverlap + (isTopSurfaceLayer ? topSurfaceExpand : 0) + (isSolidBottom ? (pp.bottomSkinExpandDistance ?? 0) : 0);
      // Cura's "Small Top/Bottom Width" — when the smaller bbox dimension
      // of a skin region is below this threshold, the region is too narrow
      // to print a clean solid skin (would just be a single short line),
      // so we skip skin emission for that region. Sparse infill emitted
      // afterward still fills it, which is the same behavior Cura ships.
      for (const region of infillRegions) {
        const regionBBox = slicer.contourBBox(region.contour);
        if (skipSkinForSmallRegion(regionBBox, pp.smallTopBottomWidth)) continue;
        // Cura's "Minimum Skin Width for Expansion" — keep the skin
        // overlap (so the skin still bonds to the wall) but drop the
        // top/bottom expansion offset for regions narrower than the
        // user's threshold. The expansion would otherwise eat tiny
        // regions or push them past the wall.
        const allowExpand = shouldExpandSkinForRegion(regionBBox, pp.minSkinWidthForExpansion);
        const regionExpand = allowExpand ? totalExpand : skinOverlap;
        let skinContour = regionExpand > 0 ? offsetContourFast(slicer, region.contour, -regionExpand) : region.contour;
        const srw = skinRemovalWidthForLayer(pp, isSolidTop, isSolidBottom);
        if (srw > 0 && skinContour.length >= 3) {
          const eroded = offsetContourFast(slicer, skinContour, srw);
          if (eroded.length >= 3) {
            const dilated = offsetContourFast(slicer, eroded, -srw);
            if (dilated.length >= 3) skinContour = dilated;
          } else skinContour = [];
        }
        const skinInput = skinContour.length >= 3 ? skinContour : region.contour;
        if (skinInput.length < 3) continue;
        const safeSkinInput = insetFillCenterlineRegion(
          slicer,
          skinInput,
          region.holes,
          lineWidth,
          solidSkinCenterlineInset(lineWidth, skinOverlap),
        );
        if (!safeSkinInput) continue;
        const skinPattern = isTopSurfaceLayer
          ? (pp.topSurfaceSkinPattern ?? pp.topBottomPattern ?? 'lines')
          : isSolidTop
            ? (pp.topBottomPattern === 'concentric' ? 'concentric' : 'lines')
            : (li === 0 && pp.bottomPatternInitialLayer)
              ? pp.bottomPatternInitialLayer
              : (pp.topBottomPattern === 'concentric' ? 'concentric' : 'lines');
        if (pp.topBottomLineDirections && pp.topBottomLineDirections.length > 0) {
          const angleDeg = pp.topBottomLineDirections[li % pp.topBottomLineDirections.length];
          infillLines.push(...attachSkinBoundary(
            slicer.generateScanLines(safeSkinInput.contour, 100, lineWidth, (angleDeg * Math.PI) / 180, 0, safeSkinInput.holes),
            safeSkinInput.contour,
            safeSkinInput.holes,
          ));
        } else {
          infillLines.push(...attachSkinBoundary(
            slicer.generateLinearInfill(safeSkinInput.contour, 100, lineWidth, li, skinPattern, safeSkinInput.holes),
            safeSkinInput.contour,
            safeSkinInput.holes,
          ));
        }
      }
      infillMoveType = 'top-bottom';
      speed = topBottomSpeed;
    } else if (pp.infillDensity > 0 || (pp.infillLineDistance ?? 0) > 0) {
      let effectiveDensity = (pp.infillLineDistance ?? 0) > 0 ? Math.min(100, Math.max(0.1, (pp.infillLineWidth / (pp.infillLineDistance ?? 1)) * 100)) : pp.infillDensity;
      const gSteps = pp.gradualInfillSteps ?? 0;
      if (gSteps > 0) {
        const stepH = pp.gradualInfillStepHeight ?? 1.5;
        const stepLayers = Math.max(1, Math.round(stepH / pp.layerHeight));
        const firstTopSolid = run.totalLayers - run.solidTop;
        const distFromTopSolid = firstTopSolid - li;
        if (distFromTopSolid > 0) {
          const stepIdx = Math.ceil(distFromTopSolid / stepLayers);
          if (stepIdx >= 1 && stepIdx <= gSteps) effectiveDensity = Math.min(100, effectiveDensity * Math.pow(2, gSteps - stepIdx + 1));
        }
      }
      let overhangShadowMP: PCMultiPolygon = [];
      const infillOverhangAngle = pp.infillOverhangAngle ?? 0;
      if (infillOverhangAngle > 0) {
        const thr = (infillOverhangAngle * Math.PI) / 180;
        const shadowTris: PCMultiPolygon = [];
        for (const tri of triangles) {
          const dotUp = tri.normal.z;
          if (dotUp >= 0) continue;
          const a = Math.acos(Math.max(0, Math.min(1, Math.abs(dotUp))));
          if (a <= thr) continue;
          const tMaxZ = Math.max(tri.v0.z, tri.v1.z, tri.v2.z);
          if (tMaxZ < layer.sliceZ - pp.layerHeight) continue;
          const ring: PCRing = [[tri.v0.x + offsetX, tri.v0.y + offsetY], [tri.v1.x + offsetX, tri.v1.y + offsetY], [tri.v2.x + offsetX, tri.v2.y + offsetY], [tri.v0.x + offsetX, tri.v0.y + offsetY]];
          shadowTris.push([ring]);
        }
        if (shadowTris.length > 0) {
          try { overhangShadowMP = unionMultiPolygon(shadowTris); } catch { overhangShadowMP = []; }
        }
      }
      const infillOverlapMm = ((pp.infillOverlap ?? 10) / 100) * lineWidth;
      // Cura's "Infill Mesh" — each baseRegion is split by the layer's
      // `infillOverrides` list (already sorted by `infillMeshOrder`).
      // Each sub-region picks up the override's density/pattern; the
      // leftover (no override applies) emits at the profile's defaults.
      // When no infill_mesh overlaps this layer, `subdivideInfillRegionByOverrides`
      // returns the baseRegion unchanged with the default settings — fast path.
      const infillOverrides = layer.modifierRegions?.infillOverrides;
      for (const baseRegion of infillRegions) {
        const subRegions = subdivideInfillRegionByOverrides(
          baseRegion,
          infillOverrides,
          effectiveDensity,
          pp.infillPattern,
          slicer,
        );
        for (const sub of subRegions) {
          const subPattern = sub.pattern;
          const subDensity = sub.density;
          for (const subRegion of sub.regions) {
            const infillRegion = infillOverlapMm > 0 ? offsetContourFast(slicer, subRegion.contour, -infillOverlapMm) : subRegion.contour;
            const safeInfillRegion = insetFillCenterlineRegion(slicer, infillRegion, subRegion.holes, lineWidth);
            if (!safeInfillRegion) continue;
            const minInfFill = pp.minInfillArea ?? 0;
            const infillRegionOk = minInfFill <= 0 || (() => { const b = slicer.contourBBox(safeInfillRegion.contour); return (b.maxX - b.minX) * (b.maxY - b.minY) >= minInfFill; })();
            if (!infillRegionOk) continue;
            const genPattern = (region: THREE.Vector2[], density: number, holes: THREE.Vector2[][]) => {
              if (pp.infillLineDirections && pp.infillLineDirections.length > 0) {
                const angleDeg = pp.infillLineDirections[li % pp.infillLineDirections.length];
                const spacing = lineWidth / (density / 100);
                const phase = pp.randomInfillStart ? Math.abs(Math.sin(li * 127.1 + 43.7)) * spacing : 0;
                return slicer.generateScanLines(region, density, lineWidth, (angleDeg * Math.PI) / 180, phase, holes);
              }
              return slicer.generateLinearInfill(region, density, lineWidth, li, subPattern, holes);
            };
            if (overhangShadowMP.length === 0) {
              infillLines.push(...genPattern(safeInfillRegion.contour, subDensity, safeInfillRegion.holes));
            } else {
              const infillRegionMP: PCMultiPolygon = [[slicer.contourToClosedPCRing(safeInfillRegion.contour), ...safeInfillRegion.holes.map((hole) => slicer.contourToClosedPCRing(hole))]];
              let boostedMP: PCMultiPolygon = [];
              let normalMP: PCMultiPolygon = infillRegionMP;
              try {
                boostedMP = intersectMultiPolygon(infillRegionMP, overhangShadowMP);
                normalMP = differenceMultiPolygon(infillRegionMP, overhangShadowMP);
              } catch { boostedMP = []; normalMP = infillRegionMP; }
              const boostedDensity = Math.min(100, subDensity * 1.5);
              for (const region of slicer.multiPolygonToRegions(boostedMP)) infillLines.push(...genPattern(region.contour, boostedDensity, region.holes));
              for (const region of slicer.multiPolygonToRegions(normalMP)) infillLines.push(...genPattern(region.contour, subDensity, region.holes));
            }
          }
        }
      }
      const infillMult = Math.max(1, Math.round(pp.multiplyInfill ?? 1));
      if (infillMult > 1 && infillLines.length > 0) {
        const base = [...infillLines];
        for (let m = 1; m < infillMult; m++) infillLines = [...infillLines, ...base];
      }
    }

    if (!isSolid && (pp.infillLayerThickness ?? 0) > 0) {
      const thickMul = Math.max(1, Math.round((pp.infillLayerThickness ?? 0) / pp.layerHeight));
      if (thickMul > 1 && li % thickMul !== 0) infillLines = [];
    }

    if (isSolid && (pp.extraSkinWallCount ?? 0) > 0) {
      gcode.push(`; Extra skin walls (${pp.extraSkinWallCount})`);
      for (let ew = 0; ew < (pp.extraSkinWallCount ?? 0); ew++) {
        const baseLoop = (item.outerWallCount > 0 ? item.wallSets[item.outerWallCount - 1] : contour.points);
        const loop = ew === 0 ? baseLoop : offsetContourFast(slicer, baseLoop, ew * pp.infillLineWidth);
        if (loop.length < 3) break;
        emitter.travelTo(loop[0].x, loop[0].y, moves);
        for (let pi = 1; pi < loop.length; pi++) {
          const from = loop[pi - 1], to = loop[pi];
          layer.layerTime += emitter.extrudeTo(to.x, to.y, topBottomSpeed, lineWidth, layerH).time;
          moves.push({ type: 'top-bottom', from: { x: from.x, y: from.y }, to: { x: to.x, y: to.y }, speed: topBottomSpeed, extrusion: emitter.calculateExtrusion(from.distanceTo(to), lineWidth, layerH), lineWidth });
        }
      }
    }

    if (infillLines.length === 0) continue;
    if (isSolid) {
      emitter.setAccel(isFirstLayer ? pp.accelerationInitialLayer : pp.accelerationTopBottom, pp.accelerationPrint);
      emitter.setJerk(isFirstLayer ? pp.jerkInitialLayer : pp.jerkTopBottom, pp.jerkPrint);
    } else {
      emitter.setAccel(isFirstLayer ? pp.accelerationInitialLayer : pp.accelerationInfill, pp.accelerationPrint);
      emitter.setJerk(isFirstLayer ? pp.jerkInitialLayer : pp.jerkInfill, pp.jerkPrint);
    }
    gcode.push(`; ${isSolid ? 'Solid fill' : 'Infill'}`);
    const connect = shouldConnectInfillLinesForEmission(
      isSolid,
      pp.connectTopBottomPolygons,
      pp.connectInfillLines,
      infillRegions.length,
    );
    const connectTol = isSolid
      ? solidSkinConnectorLinkLimit(lineWidth)
      : sparseInfillConnectorLinkLimit(lineWidth);
    const sorted = isSolid
      ? sortSolidSkinLinesForEmission(infillLines, lineWidth, { x: emitter.currentX, y: emitter.currentY }, {
        canTransition: (from, to, previous, next) => {
          const canUseSkinBoundary = previous.boundaryContour !== undefined
            && previous.boundaryContour === next.boundaryContour;
          const boundary = canUseSkinBoundary ? next.boundaryContour! : contour.points;
          const holes = canUseSkinBoundary ? (next.boundaryHoles ?? []) : infillHoles;
          if (connect && findSolidSkinContourConnectorPath(from, to, boundary, holes, lineWidth)) return true;
          return connect
            && from.distanceTo(to) < connectTol
            && slicer.segmentInsideMaterial(from, to, boundary, holes);
        },
      })
      : (pp.infillTravelOptimization ?? false)
        ? slicer.sortInfillLinesNN(infillLines, emitter.currentX, emitter.currentY)
        : slicer.sortInfillLines(infillLines);
    const startExt = pp.infillStartMoveInwardsLength ?? 0;
    const endExt = pp.infillEndMoveInwardsLength ?? 0;
    // Cura "Bridge Skin Density" — apply to bridge lines only (not non-bridge
    // skin in the same layer). Default 100 = no thinning. Implemented as
    // proportional drop of bridge lines: density 50 keeps every other bridge
    // line, density 33 keeps every third. Non-bridge skin lines pass through
    // unchanged so the rest of the top/bottom band stays solid.
    const bridgeSkinDensityPct = Math.max(1, Math.min(100, pp.bridgeSkinDensity ?? 100));
    const bridgeKeepStride = bridgeSkinDensityPct >= 100 ? 1 : Math.max(1, Math.round(100 / bridgeSkinDensityPct));
    let bridgeLineCounter = 0;
    // Cura "Interlace Bridge Lines" — when consecutive bridge layers stack,
    // alternate the printed bridge angle by 90° on every other bridge layer.
    // We approximate this by dropping bridge lines whose direction matches the
    // previous bridge layer's direction every other layer; the missed lines
    // would have stacked atop the last layer instead of crossing it.
    const interlaceOn = (pp.interlaceBridgeLines ?? false)
      && hasBridgeRegions
      && ((run.consecutiveBridgeLayers ?? 0) >= 1)
      // Alternate every other bridge layer: keep odd layer's lines, skip
      // bridge lines on even layers (they'd repeat the prior direction).
      && (((run.consecutiveBridgeLayers ?? 0) + 1) % 2 === 0);
    for (let idx = 0; idx < sorted.length; idx++) {
      const line = sorted[idx];
      const dx = line.to.x - line.from.x, dy = line.to.y - line.from.y, len = Math.sqrt(dx * dx + dy * dy);
      const ux = len > 0 ? dx / len : 0, uy = len > 0 ? dy / len : 0;
      const effFrom = startExt > 0 && len > 0 ? new THREE.Vector2(line.from.x - ux * startExt, line.from.y - uy * startExt) : line.from;
      const effTo = endExt > 0 && len > 0 ? new THREE.Vector2(line.to.x + ux * endExt, line.to.y + uy * endExt) : line.to;
      let thisMoveType: InfillMoveType = infillMoveType;
      let thisSpeed = speed;
      const thisLineWidth = lineWidth;
      let thisFlowScale = isTopSurfaceLayer ? (pp.topSurfaceSkinFlow ?? 100) / 100 : 1.0;
      const bridgeSettingsOn = pp.enableBridgeSettings !== false;
      if (hasBridgeRegions && bridgeSettingsOn && infillMoveType === 'top-bottom') {
        const midX = (effFrom.x + effTo.x) / 2, midY = (effFrom.y + effTo.y) / 2;
        if (isInBridgeRegion(midX, midY)) {
          // Skip every other bridge layer's lines when interlacing is on so
          // the alternating layer prints crossing bridge support.
          if (interlaceOn) continue;
          // Skip bridge lines based on bridgeSkinDensity (every Nth kept).
          const lineIdx = bridgeLineCounter++;
          if (lineIdx % bridgeKeepStride !== 0) continue;
          thisMoveType = 'bridge';
          thisSpeed = pp.bridgeSkinSpeed ?? speed;
          thisFlowScale = (pp.bridgeSkinFlow ?? 100) / 100;
          run.layerHadBridge = true;
        }
      }
      const bridgeFanSpeed = pickBridgeFanSpeed(pp, run.consecutiveBridgeLayers ?? 0);
      const needBridgeFan = pp.enableBridgeFan && thisMoveType === 'bridge' && !run.bridgeFanActive;
      const needFanRestore = !needBridgeFan && thisMoveType !== 'bridge' && run.bridgeFanActive;
      if (needBridgeFan) {
        gcode.push(`M106 S${emitter.fanSpeedArg(bridgeFanSpeed)} ; Bridge fan`);
        run.bridgeFanActive = true;
      } else if (needFanRestore) {
        gcode.push(`M106 S${emitter.fanSpeedArg(mat.fanSpeedMin ?? 100)} ; Restore fan after bridge`);
        run.bridgeFanActive = false;
      }
      const fromDist = Math.hypot(effFrom.x - emitter.currentX, effFrom.y - emitter.currentY);
      // Boundary used for the connector "stays inside material" check.
      // `innermostWall` is too tight when `skinOverlapPercent > 0` —
      // skin scanline endpoints deliberately overshoot it into the
      // wall band, so the segment-inside test would reject every
      // connector even though the hop itself stays inside the body
      // outline. Using `contour.points` (the layer outline) gives the
      // hop the wall band's full thickness to live in. Fixes the
      // "no boustrophedon zigzag visible" symptom on solid-skin
      // layers with the OrcaSlicer-default 23% skin overlap.
      const prevLine = idx > 0 ? sorted[idx - 1] : undefined;
      const canUseSkinBoundary = isSolid
        && prevLine?.boundaryContour !== undefined
        && prevLine.boundaryContour === line.boundaryContour;
      const contourConnectBoundary = canUseSkinBoundary ? line.boundaryContour! : contour.points;
      const contourConnectHoles = canUseSkinBoundary ? (line.boundaryHoles ?? []) : infillHoles;
      const connectBoundary = isSolid ? contourConnectBoundary : innermostWall;
      const connectorFrom = new THREE.Vector2(emitter.currentX, emitter.currentY);
      const contourPath = connect && isSolid && idx > 0
        ? findSolidSkinContourConnectorPath(connectorFrom, effFrom, contourConnectBoundary, contourConnectHoles, thisLineWidth)
        : null;
      const emitContourPath = (path: THREE.Vector2[]) => {
        for (let ci = 1; ci < path.length; ci++) {
          const hopFrom = path[ci - 1];
          const hopTo = path[ci];
          const hopLen = hopFrom.distanceTo(hopTo);
          if (hopLen <= 1e-6) continue;
          layer.layerTime += emitter.extrudeTo(hopTo.x, hopTo.y, thisSpeed, thisLineWidth, layerH).time;
          moves.push({
            type: thisMoveType,
            from: { x: hopFrom.x, y: hopFrom.y },
            to: { x: hopTo.x, y: hopTo.y },
            speed: thisSpeed,
            extrusion: emitter.calculateExtrusion(hopLen, thisLineWidth, layerH),
            lineWidth: thisLineWidth,
          });
        }
      };
      if (contourPath) {
        emitContourPath(contourPath);
      } else if (connect && idx > 0 && fromDist < connectTol && slicer.segmentInsideMaterial(connectorFrom, effFrom, connectBoundary, contourConnectHoles)) {
        // Boustrophedon connector hop — extrude a short bead at the
        // wall instead of travelling, then push it as a move so the
        // preview tube renderer shows the continuous zigzag (Cura /
        // Orca style) and the per-move extrusion total matches
        // `emitter.totalExtruded`. Without this push, the hop's
        // extrusion vanished from the SliceMove[] stream.
        const hopFromX = emitter.currentX, hopFromY = emitter.currentY;
        layer.layerTime += emitter.extrudeTo(effFrom.x, effFrom.y, thisSpeed, thisLineWidth, layerH).time;
        moves.push({
          type: thisMoveType,
          from: { x: hopFromX, y: hopFromY },
          to: { x: effFrom.x, y: effFrom.y },
          speed: thisSpeed,
          extrusion: emitter.calculateExtrusion(fromDist, thisLineWidth, layerH),
          lineWidth: thisLineWidth,
        });
      } else {
        if (connect && isSolid && idx > 0 && prevLine) {
          const prevDx = prevLine.to.x - prevLine.from.x;
          const prevDy = prevLine.to.y - prevLine.from.y;
          const anchorPath = findSolidSkinContourAnchorPath(
            connectorFrom,
            new THREE.Vector2(prevDx, prevDy),
            prevLine.boundaryContour ?? contour.points,
            prevLine.boundaryHoles ?? infillHoles,
            thisLineWidth,
          );
          if (anchorPath) emitContourPath(anchorPath);
        }
        emitter.travelTo(effFrom.x, effFrom.y, moves, {
          avoidPrintedParts: !(isSolid && idx > 0),
        });
      }
      const flowSaved = emitter.currentLayerFlow;
      emitter.currentLayerFlow = flowSaved * thisFlowScale;
      layer.layerTime += emitter.extrudeTo(effTo.x, effTo.y, thisSpeed, thisLineWidth, layerH).time;
      moves.push({ type: thisMoveType, from: { x: effFrom.x, y: effFrom.y }, to: { x: effTo.x, y: effTo.y }, speed: thisSpeed, extrusion: emitter.calculateExtrusion(effFrom.distanceTo(effTo), thisLineWidth, layerH), lineWidth: thisLineWidth });
      emitter.currentLayerFlow = flowSaved;
      if (connect && isSolid && idx === sorted.length - 1) {
        const finalAnchorPath = findSolidSkinContourAnchorPath(
          effTo,
          new THREE.Vector2(effTo.x - effFrom.x, effTo.y - effFrom.y),
          line.boundaryContour ?? contour.points,
          line.boundaryHoles ?? infillHoles,
          thisLineWidth,
        );
        if (finalAnchorPath) emitContourPath(finalAnchorPath);
      }
      const infillWipeDistance = pp.infillWipeDistance ?? 0;
      if (infillWipeDistance > 0 && len > 0) {
        const wx = effTo.x + ux * infillWipeDistance, wy = effTo.y + uy * infillWipeDistance;
        gcode.push(`G0 X${wx.toFixed(3)} Y${wy.toFixed(3)} F${(speed * 60).toFixed(0)} ; Infill wipe`);
        emitter.currentX = wx; emitter.currentY = wy;
      }
    }
  }
}
