import type * as THREE from 'three';
import polygonClipping, { type MultiPolygon as PCMultiPolygon, type Ring as PCRing } from 'polygon-clipping';
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

    const insetDistance = outerWallInset + wallCount * lineWidth;
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
function computeArachneInfillGeometry(
  outerContour: THREE.Vector2[],
  holeContours: THREE.Vector2[][],
  insetDistance: number,
  deps: PerimeterDeps,
): { innermostHoles: THREE.Vector2[][]; infillRegions: InfillRegion[] } {
  const insetOuter = deps.offsetContour(outerContour, -insetDistance);
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
    const mergedHoles: PCMultiPolygon = holesMP.length === 1
      ? [holesMP[0]]
      : (booleanMultiPolygonClipper2Sync(allHolePolygons, [], 'union')
        ?? polygonClipping.union(holesMP[0], ...holesMP.slice(1)));
    const diff = booleanMultiPolygonClipper2Sync(outerMP, mergedHoles, 'difference')
      ?? polygonClipping.difference(outerMP, ...holesMP);
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
