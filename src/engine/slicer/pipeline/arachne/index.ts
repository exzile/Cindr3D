import type * as THREE from 'three';
import type { MultiPolygon as PCMultiPolygon, Ring as PCRing } from 'polygon-clipping';
import type { PrintProfile } from '../../../../types/slicer';
import type { PerimeterDeps } from '../../../../types/slicer-pipeline-deps.types';
import type { GeneratedPerimeters, InfillRegion } from '../../../../types/slicer-pipeline.types';
import { booleanMultiPolygonClipper2Sync } from '../../geometry/clipper2Boolean';
import { strokeOpenPathsClipper2Sync } from '../../geometry/clipper2Wasm';
import { generatePerimetersEx } from '../perimeters';
import { resolveArachneBackend } from './backend';
import type { ArachneBackendName, ArachneGenerationContext, ArachnePathResult, VariableWidthPath } from './types';

function toRing(pts: THREE.Vector2[]): PCRing {
  const ring: PCRing = pts.map((p) => [p.x, p.y] as [number, number]);
  if (ring.length > 0) {
    const f = ring[0];
    const l = ring[ring.length - 1];
    if (f[0] !== l[0] || f[1] !== l[1]) ring.push([f[0], f[1]]);
  }
  return ring;
}

function pointInPolygon(point: THREE.Vector2, polygon: THREE.Vector2[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if (((a.y > point.y) !== (b.y > point.y))
      && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

export function innerContoursToInfillRegions(
  innerContours: THREE.Vector2[][],
  deps: Pick<PerimeterDeps, 'signedArea'>,
): { innermostHoles: THREE.Vector2[][]; infillRegions: InfillRegion[] } | null {
  const rings = innerContours.filter((ring) => ring.length >= 3);
  if (rings.length === 0) return null;

  const outers = rings
    .map((contour) => ({ contour, area: deps.signedArea(contour), holes: [] as THREE.Vector2[][] }))
    .filter((ring) => ring.area > 0);
  if (outers.length === 0) return null;

  const holes = rings.filter((ring) => deps.signedArea(ring) < 0);
  for (const hole of holes) {
    const probe = hole[0];
    let owner: typeof outers[number] | null = null;
    for (const outer of outers) {
      if (!pointInPolygon(probe, outer.contour)) continue;
      if (!owner || Math.abs(outer.area) < Math.abs(owner.area)) owner = outer;
    }
    owner?.holes.push(hole);
  }

  const infillRegions = outers
    .map(({ contour, holes: contourHoles }) => ({ contour, holes: contourHoles }))
    .filter((region) => region.contour.length >= 3);
  if (infillRegions.length === 0) return null;
  return {
    innermostHoles: infillRegions.flatMap((region) => region.holes),
    infillRegions,
  };
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
  context: ArachneGenerationContext = {},
): GeneratedPerimeters {
  const debug = (globalThis as Record<string, unknown>)[ARACHNE_DEBUG_GLOBAL_KEY] === true;
  const statsBag = debug ? getStats() : null;
  const totalEdges = outerContour.length + holeContours.reduce((s, h) => s + h.length, 0);
  const selectedBackend = resolveArachneBackend(printProfile.arachneBackend ?? 'wasm');

  try {
    const t0 = debug ? performance.now() : 0;
    const generated: ArachnePathResult = selectedBackend.generatePathsWithInnerContours
      ? selectedBackend.generatePathsWithInnerContours(
        outerContour,
        holeContours,
        wallCount,
        lineWidth,
        outerWallInset,
        printProfile,
        context,
      )
      : {
        paths: selectedBackend.generatePaths(
          outerContour,
          holeContours,
          wallCount,
          lineWidth,
          outerWallInset,
          printProfile,
          context,
        ),
        innerContours: [],
      };
    const paths = generated.paths.filter((path) =>
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

    // Compute the leftover region available for infill. The preferred
    // path (Clipper2 loaded) is the same algorithm CuraEngine ships in
    // `WallToolPaths::computeInnerContour()`: stroke each emitted
    // variable-width wall path into its actual polygon footprint, union
    // the footprints, and subtract from the body region. This handles
    // libArachne's non-uniform wall placement exactly — narrow features
    // where beads sit further inside, transition zones where two beads
    // overlap, and asymmetric tapers — none of which a single scalar
    // inset can represent.
    //
    // If Clipper2 isn't loaded yet, fall back to the legacy scalar
    // `computeMaxPathInset` approach with a generous safety pad.
    let innermostHoles: THREE.Vector2[][];
    let infillRegions: InfillRegion[];
    const nativeInner = innerContoursToInfillRegions(generated.innerContours, deps);
    const stroked = nativeInner ?? computeArachneInfillFromStroke(
      paths, outerContour, holeContours, lineWidth, deps,
    );
    if (stroked) {
      ({ innermostHoles, infillRegions } = stroked);
    } else {
      const measuredCoverage = computeMaxPathInset(paths, outerContour, holeContours);
      const fallbackCoverage = (wallCount + 0.5) * lineWidth;
      const insetDistance = outerWallInset
        + Math.max(measuredCoverage, fallbackCoverage)
        + lineWidth * 0.5;
      ({ innermostHoles, infillRegions } = computeArachneInfillGeometry(
        outerContour, holeContours, insetDistance, deps,
      ));
    }
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
 * Compute infill geometry by **stroking** each variable-width Arachne
 * wall path into its actual polygon footprint and subtracting the
 * union of footprints from the body region (`outer − holes`).
 *
 * This is the algorithm CuraEngine uses in
 * `WallToolPaths::computeInnerContour()`. It handles the cases that a
 * scalar inset cannot:
 *
 *   • Non-uniform wall placement — libArachne deliberately positions
 *     beads further inward in narrow regions, so a single offset over-
 *     shrinks wide regions or under-shrinks narrow ones.
 *   • Asymmetric tapers — a path tip ending mid-feature has a circular
 *     end-cap that protrudes inward beyond what a centerline-sample
 *     measurement would predict.
 *   • Transition zones — overlapping bead footprints in regions where
 *     wall count changes are correctly merged by the Clipper2 union.
 *
 * Returns null when Clipper2 isn't loaded (caller should fall back to
 * the scalar `computeArachneInfillGeometry`).
 */
export function computeArachneInfillFromStroke(
  paths: VariableWidthPath[],
  outerContour: THREE.Vector2[],
  holeContours: THREE.Vector2[][],
  lineWidth: number,
  deps: PerimeterDeps,
): { innermostHoles: THREE.Vector2[][]; infillRegions: InfillRegion[] } | null {
  // Stroke each path with its per-vertex widths into a coverage
  // multipolygon. Empty `paths` shouldn't happen (the caller bails on
  // 0-length paths upstream), but guard for robustness.
  if (paths.length === 0) return null;

  // For closed paths, append a duplicate of the first vertex so the
  // stroker emits the closing segment from p[N-1] back to p[0]. Without
  // this, libArachne's closed walls have a small uncovered arc where
  // the loop wraps — leaving a sliver of infill INSIDE the wall.
  // We detect already-closed inputs (first == last) so we don't double
  // the duplicate.
  const strokeInput = paths.map((p) => {
    const pts = p.points;
    const widths = p.widths;
    if (!p.isClosed || pts.length < 2) return { points: pts, widths };
    const first = pts[0];
    const last = pts[pts.length - 1];
    if (first.x === last.x && first.y === last.y) return { points: pts, widths };
    return {
      points: [...pts, first],
      widths: [...widths, widths[0]],
    };
  });
  // Coverage = stroked walls + a uniform safety pad to absorb libArachne's
  // non-uniform bead placement (geometrically-identical features can have
  // ~30µm radial drift between them, plus per-segment width variance can
  // leave the stroke 100-200µm short in sectors). We fold the pad into
  // each segment's delta inside the stroke itself (the C++ `pad` param)
  // so we don't pay for a separate post-stroke `InflatePaths` pass —
  // saves one Clipper2 round-trip per layer at zero geometric cost.
  // Pad is 25% of lineWidth: enough to cover Arachne variance, small
  // enough that narrow features still get legitimate infill area.
  const coverageSafetyPad = lineWidth * 0.25;
  let safeCoverage: THREE.Vector2[][] | null;
  try {
    // Tight `arcTolerance` (sub-micron) so the polygonal approximation
    // of round caps doesn't underestimate the bead radius. With the
    // default tolerance, disk approximations can be ~20µm short of the
    // true radius, leaving a sliver of infill inside the bead.
    safeCoverage = strokeOpenPathsClipper2Sync(strokeInput, {
      pad: coverageSafetyPad,
      precision: 4,
      arcTolerance: 1e-4,
    });
  } catch {
    return null;
  }
  if (safeCoverage === null) return null;  // Clipper2 not loaded yet
  if (safeCoverage.length === 0) return null;  // degenerate — let scalar path handle it

  // Inset the BODY by `lineWidth/2` before subtracting coverage. This
  // mirrors CuraEngine's `outline.offset(-outermost_wall_inset_distance)`
  // step in `WallToolPaths::computeInnerContour`. Without it, the thin
  // band between the body boundary and the outermost wall (the band
  // that the outer wall sits ON) survives `body - coverage` as a
  // degenerate infill region — which is wrong: that band IS the wall.
  const insetOuter = deps.offsetContour(outerContour, lineWidth * 0.5);
  if (insetOuter.length < 3) return { innermostHoles: [], infillRegions: [] };
  const insetHoles = holeContours
    .map((h) => deps.offsetContour(h, lineWidth * 0.5))
    .filter((h) => h.length >= 3);

  // body = inset_outer - inset_holes
  const outerMP: PCMultiPolygon = [[toRing(insetOuter)]];
  const holesMP: PCMultiPolygon = insetHoles.map((h) => [toRing(h)]);
  const bodyMP = holesMP.length > 0
    ? booleanMultiPolygonClipper2Sync(outerMP, holesMP, 'difference')
    : outerMP;
  if (bodyMP === null) return null;

  // infill = body - coverage_inflated
  const coverageMP: PCMultiPolygon = safeCoverage.map((ring) => [toRing(ring)]);
  const infillMP = booleanMultiPolygonClipper2Sync(bodyMP, coverageMP, 'difference');
  if (infillMP === null) return null;

  // A tiny inward cleanup absorbs polygonal arc/chord approximation error
  // from the stroke operation. This stays in the single-digit micron range
  // for normal nozzle sizes, so it prevents accidental wall overlap without
  // creating a visible Cura/Orca-style gap.
  const numericCleanup = Math.max(lineWidth * 0.02, 0.005);
  const shrinkRegionContour = (contour: THREE.Vector2[]): THREE.Vector2[] =>
    deps.offsetContour(contour, deps.signedArea(contour) >= 0 ? numericCleanup : -numericCleanup);
  const trimmedRegions = deps.multiPolygonToRegions(infillMP)
    .map((r) => ({
      contour: shrinkRegionContour(r.contour),
      holes: r.holes,
    }))
    .filter((r) => r.contour.length >= 3);

  // `innermostHoles` (consumed downstream as `infillHoles` for skin/
  // ironing routing) is the union of all hole rings across infill
  // regions — i.e. the inner-wall-side boundary of every void inside
  // the body, expressed in the same shrunken frame as the regions.
  const innermostHoles = trimmedRegions.flatMap((r) => r.holes);

  return { innermostHoles, infillRegions: trimmedRegions };
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
  const wallSources: Array<'outer' | 'hole' | 'gapfill'> = [];
  let outerCount = 0;

  // Order: outer-contour walls first, hole walls next, gap-fill paths
  // LAST. This mirrors CuraEngine's `InsetOrderOptimizer`: gap-fill
  // beads run after the wall structure they live inside, because (a)
  // they lock in dimensional accuracy of the surrounding walls, and
  // (b) putting them at the end means the next move likely starts a
  // travel into a different region anyway, so the open-path tip of
  // the gap-fill bead doesn't disrupt a clean wall seam.
  const sortKey = (s: 'outer' | 'hole' | 'gapfill') =>
    s === 'outer' ? 0 : s === 'hole' ? 1 : 2;
  const sorted = [...paths].sort((a, b) => sortKey(a.source) - sortKey(b.source));

  for (const path of sorted) {
    if (path.points.length < 2) continue;
    walls.push(path.points);
    lineWidths.push(path.widths);
    wallClosed.push(path.isClosed);
    wallDepths.push(path.depth);
    wallSources.push(path.source);
    if (path.source === 'outer') outerCount++;
  }

  return {
    walls,
    lineWidths,
    wallClosed,
    wallDepths,
    wallSources,
    outerCount,
    innermostHoles: [],
    infillRegions: [],
  };
}
