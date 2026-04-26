import type * as THREE from 'three';
import type { MultiPolygon as PCMultiPolygon, Ring as PCRing } from 'polygon-clipping';
import type { PrintProfile } from '../../../../types/slicer';
import type { PerimeterDeps } from '../../../../types/slicer-pipeline-deps.types';
import type { GeneratedPerimeters, InfillRegion } from '../../../../types/slicer-pipeline.types';
import { booleanMultiPolygonClipper2Sync } from '../../geometry/clipper2Boolean';
import { generatePerimetersEx } from '../perimeters';
import { resolveArachneBackend } from './backend';
import type { ArachneBackendName, VariableWidthPath } from './types';

function toRing(pts: THREE.Vector2[]): PCRing {
  const ring: PCRing = pts.map((p) => [p.x, p.y] as [number, number]);
  if (ring.length > 0) {
    const f = ring[0];
    const l = ring[ring.length - 1];
    if (f[0] !== l[0] || f[1] !== l[1]) ring.push([f[0], f[1]]);
  }
  return ring;
}

/** Squared distance from a point to a line segment (or to the segment's
 *  closest endpoint when the foot of perpendicular falls outside).
 *  Returns squared distance to avoid sqrt in the inner loop. */
function pointToSegSqDist(px: number, py: number,
                          ax: number, ay: number,
                          bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 1e-12 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  if (t < 0) t = 0; else if (t > 1) t = 1;
  const cx = ax + t * dx, cy = ay + t * dy;
  const ex = px - cx, ey = py - cy;
  return ex * ex + ey * ey;
}

/** For each point on each Arachne wall path, find the distance to the
 *  nearest segment of the input boundary (outer + holes), then add
 *  half the local wall width. The MAX over all points is the real
 *  inward extent of the wall coverage — what the infill region must
 *  stay clear of. */
export function computeMaxPathInset(
  paths: VariableWidthPath[],
  outer: THREE.Vector2[],
  holes: THREE.Vector2[][],
): number {
  // Pre-flatten boundary segments into a flat double[] for cache-locality
  // in the O(P×B) inner loop. P = path points, B = boundary segments.
  const segs: number[] = [];
  const pushRing = (ring: THREE.Vector2[]) => {
    const n = ring.length;
    if (n < 2) return;
    for (let i = 0; i < n; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % n];
      segs.push(a.x, a.y, b.x, b.y);
    }
  };
  pushRing(outer);
  for (const hole of holes) pushRing(hole);
  const segCount = segs.length / 4;
  if (segCount === 0) return 0;

  let maxInset = 0;
  for (const path of paths) {
    const pts = path.points;
    const widths = path.widths;
    for (let i = 0; i < pts.length; i++) {
      const px = pts[i].x, py = pts[i].y;
      const halfW = (widths[i] ?? 0) * 0.5;
      let bestSq = Infinity;
      for (let s = 0; s < segCount; s++) {
        const sq = pointToSegSqDist(px, py,
          segs[s * 4], segs[s * 4 + 1], segs[s * 4 + 2], segs[s * 4 + 3]);
        if (sq < bestSq) bestSq = sq;
      }
      const inset = Math.sqrt(bestSq) + halfW;
      if (inset > maxInset) maxInset = inset;
    }
  }
  return maxInset;
}

export type { VariableWidthPath } from './types';
export type { ArachneBackend, ArachneBackendName } from './types';
export { getArachneBackend, registerArachneBackend, resolveArachneBackend, arachneWasmBackend } from './backend';
export {
  generateArachnePathsWasm,
  generateArachnePathsWasmSync,
  loadArachneModule,
} from './arachneWasm';
export type { VoronoiEdge, VoronoiGraph, VoronoiSourceEdge, VoronoiVertex } from './voronoiWasm';

/**
 * Top-level Arachne wall generator entry point.
 *
 * Runs the full Voronoi → trapezoidation → bead-distribution → path-
 * extraction pipeline (ARACHNE-1..4) and converts the resulting
 * `VariableWidthPath[]` into the `GeneratedPerimeters` shape the rest
 * of the slicer consumes. Falls back to the classic fixed-width-offset
 * generator only when Arachne returns no usable paths or a stage
 * throws — that path is purely a safety net, not a hot code path.
 */
/** Set to `true` (e.g. via DevTools `(globalThis as any).__arachneDebug = true`)
 *  to log per-stage timing on every region. Off by default so production
 *  slicing doesn't spam the console. */
const ARACHNE_DEBUG_GLOBAL_KEY = '__arachneDebug';

/** Worker-side accumulator for layer-by-layer Arachne diagnostics. Populated
 *  whenever `__arachneDebug` is on. The slicer worker can postMessage this
 *  back to the main thread on slice completion for inspection. */
export interface ArachneRegionStat {
  layerIndex: number;
  outcome: 'arachne' | 'classic-fallback-no-paths' | 'classic-fallback-error';
  totalEdges: number;
  backend?: ArachneBackendName;
  paths?: number;
  pathMs?: number;
}

interface ArachneStatsBag { layerIndex: number; entries: ArachneRegionStat[] }
const STATS_KEY = '__arachneStats';

function getStats(): ArachneStatsBag {
  const g = globalThis as Record<string, unknown>;
  let bag = g[STATS_KEY] as ArachneStatsBag | undefined;
  if (!bag) {
    bag = { layerIndex: -1, entries: [] };
    g[STATS_KEY] = bag;
  }
  return bag;
}

/** Slicer pipeline can call this each layer so the per-region entries
 *  carry the right index. */
export function setArachneStatsLayer(layerIndex: number): void {
  getStats().layerIndex = layerIndex;
}

/** Read + clear the accumulated stats. Call from the worker right before
 *  posting the slice result back to the main thread. */
export function drainArachneStats(): ArachneRegionStat[] {
  const bag = getStats();
  const out = bag.entries;
  bag.entries = [];
  return out;
}

export function generatePerimetersArachne(
  outerContour: THREE.Vector2[],
  holeContours: THREE.Vector2[][],
  wallCount: number,
  lineWidth: number,
  outerWallInset: number,
  printProfile: PrintProfile,
  deps: PerimeterDeps,
): GeneratedPerimeters {
  const debug = (globalThis as Record<string, unknown>)[ARACHNE_DEBUG_GLOBAL_KEY] === true;
  const statsBag = debug ? getStats() : null;
  const totalEdges = outerContour.length + holeContours.reduce((s, h) => s + h.length, 0);
  const selectedBackend = resolveArachneBackend(printProfile.arachneBackend ?? 'wasm');

  try {
    const t0 = debug ? performance.now() : 0;
    const paths = selectedBackend.generatePaths(
      outerContour,
      holeContours,
      wallCount,
      lineWidth,
      outerWallInset,
      printProfile,
    ).filter((path) =>
      path.points.length >= 2 && path.depth < wallCount && path.widths.length === path.points.length,
    );
    const t1 = debug ? performance.now() : 0;

    if (paths.length === 0) {
      if (statsBag) statsBag.entries.push({
        layerIndex: statsBag.layerIndex,
        outcome: 'classic-fallback-no-paths',
        backend: selectedBackend.name,
        totalEdges,
        paths: 0,
        pathMs: t1 - t0,
      });
      return generatePerimetersEx(
        outerContour, holeContours, wallCount, lineWidth, outerWallInset,
        printProfile, deps,
      );
    }

    if (statsBag) statsBag.entries.push({
      layerIndex: statsBag.layerIndex, outcome: 'arachne',
      backend: selectedBackend.name,
      totalEdges, paths: paths.length,
      pathMs: t1 - t0,
    });

    // Arachne emits variable-width walls placed by libArachne's
    // skeletal-trapezoidation, NOT at fixed `depth × lineWidth` offsets.
    // For example a depth-2 wall in a thin section can sit further from
    // the boundary than a depth-2 wall in a wide section. So the only
    // reliable measure of the wall envelope is the actual emitted-path
    // geometry: for each point on each path, distance from that point
    // to the nearest input-boundary segment, plus half the local wall
    // width at that point.
    //
    // We compute that envelope and inset the body geometry by it. Falls
    // back to `(wallCount + 0.5) × lineWidth` if no usable points.
    const measuredCoverage = computeMaxPathInset(paths, outerContour, holeContours);
    const fallbackCoverage = (wallCount + 0.5) * lineWidth;
    const insetDistance = outerWallInset
      + Math.max(measuredCoverage, fallbackCoverage)
      + lineWidth * 0.05; // small safety pad to avoid touching the wall
    const { innermostHoles, infillRegions } = computeArachneInfillGeometry(
      outerContour, holeContours, insetDistance, deps,
    );
    return {
      ...variableWidthPathsToPerimeters(paths),
      innermostHoles,
      infillRegions,
    };
  } catch {
    if (statsBag) statsBag.entries.push({
      layerIndex: statsBag.layerIndex,
      outcome: 'classic-fallback-error',
      totalEdges,
      backend: selectedBackend.name,
    });
    return generatePerimetersEx(
      outerContour, holeContours, wallCount, lineWidth, outerWallInset,
      printProfile, deps,
    );
  }
}

/**
 * Compute infill geometry directly from the input polygon at the given
 * inset depth, bypassing the classic generator's per-depth wall offset
 * cascade.
 *
 * Classic computes `infillRegions` and `innermostHoles` as a side effect
 * of generating walls — for each depth `d` from 1..wallCount it offsets,
 * differences holes, and stores the last result. Arachne walls don't
 * produce that geometry, so we'd otherwise have to invoke classic just
 * for these two outputs (~30-50% extra cost per layer).
 *
 * Equivalent to a single `(outer ⊖ insetDistance) − ⋃(hole ⊕ insetDistance)`
 * — the polygon's interior at the innermost wall depth.
 */
export function computeArachneInfillGeometry(
  outerContour: THREE.Vector2[],
  holeContours: THREE.Vector2[][],
  insetDistance: number,
  deps: PerimeterDeps,
): { innermostHoles: THREE.Vector2[][]; infillRegions: InfillRegion[] } {
  // offsetContour convention (matches `perimeters.ts:241`):
  //   positive offset = inset toward solid material
  //     - on a CCW outer ring, that SHRINKS the outer (good for infill)
  //     - on a CW hole ring, that EXPANDS the hole boundary into solid
  //
  // The previous `-insetDistance` here EXPANDED the outer outward —
  // making `insetOuter` bigger than the body. The bug got proportionally
  // worse when the inset grew (which is how the user's "infill in walls"
  // got more visible after we tightened the envelope calc above).
  const insetOuter = deps.offsetContour(outerContour, insetDistance);
  if (insetOuter.length < 3) {
    return { innermostHoles: [], infillRegions: [] };
  }

  const innermostHoles = holeContours
    .map((hole) => deps.offsetContour(hole, insetDistance))
    .filter((hole) => hole.length >= 3);

  // Polygon-clipping difference handles the breakthrough case (a hole
  // expansion that overlaps the outer boundary) — falling back to the
  // simple "outer with holes" representation when no clipping is needed
  // would mis-represent breakthroughs.
  const outerMP: PCMultiPolygon = [[toRing(insetOuter)]];
  if (innermostHoles.length === 0) {
    return { innermostHoles: [], infillRegions: deps.multiPolygonToRegions(outerMP) };
  }

  try {
    const holesMP: PCMultiPolygon = innermostHoles.map((hole) => [toRing(hole)]);
    const allHolePolygons = holesMP.reduce<PCMultiPolygon>((acc, polygon) => {
      acc.push(polygon);
      return acc;
    }, []);
    // ARACHNE-9.4A.4: worker pre-awaits Clipper2 load. Throw on null
    // (caught by outer try/catch which falls back to insetOuter).
    const mergedHolesResult: PCMultiPolygon | null = holesMP.length === 1
      ? holesMP
      : booleanMultiPolygonClipper2Sync(allHolePolygons, [], 'union');
    if (mergedHolesResult === null) throw new Error('arachne: Clipper2 union not loaded');
    const mergedHoles = mergedHolesResult;
    const diff = booleanMultiPolygonClipper2Sync(outerMP, mergedHoles, 'difference');
    if (diff === null) throw new Error('arachne: Clipper2 difference not loaded');
    return { innermostHoles, infillRegions: deps.multiPolygonToRegions(diff) };
  } catch {
    // Degenerate input — fall back to the simple representation. Worst
    // case the slicer fills slightly into a breakthrough region; better
    // than throwing.
    return {
      innermostHoles,
      infillRegions: [{ contour: insetOuter, holes: innermostHoles }],
    };
  }
}

/**
 * Convert a list of variable-width Arachne paths into the existing
 * `GeneratedPerimeters` shape so the rest of the slicer can consume them.
 *
 * Per-vertex line widths are preserved in `lineWidths[i]` as a `number[]`
 * so the emit step can compute extrusion from each segment's local width.
 * Open medial-axis paths are also preserved in `wallClosed[i]`; this keeps
 * branch and breakthrough paths from being incorrectly closed as loops.
 */
export function variableWidthPathsToPerimeters(
  paths: VariableWidthPath[],
): GeneratedPerimeters {
  const walls: THREE.Vector2[][] = [];
  const lineWidths: number[][] = [];
  const wallClosed: boolean[] = [];
  const wallDepths: number[] = [];
  let outerCount = 0;

  // Sort outer-contour walls before hole walls (matches existing convention
  // in `perimeters.ts` where `walls = [...outerLoops, ...holeLoops]`).
  const sorted = [...paths].sort((a, b) => {
    const aOuter = a.source === 'outer' ? 0 : 1;
    const bOuter = b.source === 'outer' ? 0 : 1;
    return aOuter - bOuter;
  });

  for (const path of sorted) {
    if (path.points.length < 2) continue;
    walls.push(path.points);
    lineWidths.push(path.widths);
    wallClosed.push(path.isClosed);
    wallDepths.push(path.depth);
    if (path.source === 'outer') outerCount++;
  }

  return {
    walls,
    lineWidths,
    wallClosed,
    wallDepths,
    outerCount,
    innermostHoles: [],
    infillRegions: [],
  };
}
