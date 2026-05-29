/**
 * Authoritative OCC shape validity check via BRepCheck_Analyzer — the same checker
 * OpenCASCADE uses internally to decide whether a shape is a valid, watertight,
 * manifold solid (no free bounds, no self-intersections, consistent orientation).
 *
 * This is far more reliable than hand-rolled edge-incidence counting (which cannot
 * tell a seam/degenerate edge from a genuine open boundary) or tessellation-based
 * boundary-edge counting (which false-flags T-junctions in OCC's mesh even on valid
 * solids). Fillet/chamfer ops use it to decide whether to accept a build or fall
 * back to a different strategy.
 */
import type { OcctRaw } from '../types';

interface BRepAnalyzer {
  IsValid_2(): boolean;
  delete?(): void;
}

interface OccValidityApi {
  // opencascade.js may expose the single constructor bare or with the _1 suffix.
  BRepCheck_Analyzer_1?: new (shape: unknown, geomControls: boolean) => BRepAnalyzer;
  BRepCheck_Analyzer?: new (shape: unknown, geomControls: boolean) => BRepAnalyzer;
}

/**
 * True when `shape` is a valid solid per BRepCheck_Analyzer (geometry checks on).
 *
 * Returns `true` when the checker binding is unavailable or throws — callers must
 * NOT treat "checker could not run" as "invalid", since a downstream guard (the
 * store's mesh check) still backstops genuinely-broken results.
 */
export function isOccShapeValid(oc: OcctRaw, shape: unknown): boolean {
  const api = oc as unknown as OccValidityApi;
  const Ctor = api.BRepCheck_Analyzer_1 ?? api.BRepCheck_Analyzer;
  if (typeof Ctor !== 'function') return true;
  let analyzer: BRepAnalyzer | null = null;
  try {
    analyzer = new Ctor(shape, true);
    return analyzer.IsValid_2();
  } catch {
    return true; // checker unavailable / threw — do not block on our account
  } finally {
    analyzer?.delete?.();
  }
}
