/**
 * OCC-5.1 — Exact fillet via BRepFilletAPI_MakeFillet.
 * OCC produces an exact toroidal surface that tessellates uniformly with no
 * fan triangulation artifacts.
 *
 * Supports:
 *  - Constant radius (Add_2)
 *  - Variable radius start→end (Add_3)
 *  - Variable radius N midpoints (Add_5 + TColgp_Array1OfPnt2d radius law) — OCC-14.3
 *  - Chord-length (dihedral-angle derived radius, then Add_2)
 *  - Multiple mixed edge sets in one Build pass
 *  - G2 surface continuity (ChFi3d_Polynomial surface form + best-effort SetContinuity)
 *  - Full-round with multi-face per side and auto-side inference
 */
import type { OcctRaw } from '../types';
import { makeBRepBodyFromOccShape, occDeref, type BRepBody } from '../brepBody';
import { getOcc } from '../loader';
import {
  collectFaceEdgeIds,
  collectSharedEdgeIds,
  findAdjacentFacesToFace,
  findShapeIndex,
} from './adjacency';

interface OccFilletBuilder {
  Add_2(radius: number, edge: unknown): void;
  Add_3(startRadius: number, endRadius: number, edge: unknown): void;
  /** OCC-14.3: radius-law array overload (confirmed bound in WASM build). */
  Add_5?(UandR: unknown, E: unknown): void;
  Build(progress?: unknown): void;
  IsDone?(): boolean;
  HasResult?(): boolean;
  Shape(): unknown;
  delete(): void;
}

function createFilletBuilder(occ: OccFilletApi, rawShape: unknown, filletShape: unknown): OccFilletBuilder | null {
  const api = occ as OccFilletApi & Record<string, unknown>;
  const constructors = [
    api.BRepFilletAPI_MakeFillet_2,
    api.BRepFilletAPI_MakeFillet,
  ].filter((ctor): ctor is new (...args: unknown[]) => OccFilletBuilder => typeof ctor === 'function');

  for (const ctor of constructors) {
    try {
      return new ctor(rawShape, filletShape);
    } catch {
      try {
        return new ctor(rawShape);
      } catch {
        // Try the next binding overload.
      }
    }
  }
  return null;
}

function buildFilletBuilder(occ: OccFilletApi, mk: OccFilletBuilder): void {
  if (typeof occ.Message_ProgressRange_1 === 'function') {
    const progress = new occ.Message_ProgressRange_1();
    try {
      mk.Build(progress);
      return;
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : typeof (err as { message?: unknown })?.message === 'string'
            ? (err as { message: string }).message
            : String(err);
      if (!message.includes('expected 0 args')) {
        throw err;
      }
    } finally {
      progress.delete?.();
    }
  }
  mk.Build();
}

/**
 * OCC-13.1 — best-effort G2 continuity via BRepFilletAPI_MakeFillet.SetContinuity
 * (GeomAbs_C2) when bound. opencascade.js builds vary on whether this is exposed
 * (SetContinuity / SetContinuity_1) and on its arity; any mismatch is swallowed so
 * the ChFi3d_Polynomial surface form (set by the caller) stays in effect.
 */
function trySetG2Continuity(occ: OccFilletApi, mk: OccFilletBuilder): void {
  const builder = mk as unknown as {
    SetContinuity?: (...args: unknown[]) => void;
    SetContinuity_1?: (...args: unknown[]) => void;
  };
  const setter = builder.SetContinuity ?? builder.SetContinuity_1;
  if (typeof setter !== 'function') return;
  const c2 = (occ as { GeomAbs_Shape?: { GeomAbs_C2?: unknown } }).GeomAbs_Shape?.GeomAbs_C2;
  if (c2 === undefined) return;
  try {
    setter.call(builder, c2, 1e-4);
  } catch {
    try {
      setter.call(builder, c2);
    } catch {
      /* binding mismatch — ChFi3d_Polynomial surface form remains in effect */
    }
  }
}

type OccFilletApi = OcctRaw & {
  BRepFilletAPI_MakeFillet?: new (shape: unknown, filletShape: unknown) => OccFilletBuilder;
  BRepFilletAPI_MakeFillet_2?: new (shape: unknown, filletShape: unknown) => {
    Add_2(radius: number, edge: unknown): void;
    Add_3(startRadius: number, endRadius: number, edge: unknown): void;
    /** Per-face asymmetric — optional binding; not present in all opencascade.js builds. */
    Add_4?(distance1: number, distance2: number, edge: unknown, face: unknown): void;
    Build(progress: unknown): void;
    IsDone(): boolean;
    Shape(): unknown;
    delete(): void;
  };
  ChFi3d_FilletShape: {
    ChFi3d_Rational: unknown;
    ChFi3d_QuasiAngular: unknown;
    ChFi3d_Polynomial: unknown;
  };
  Message_ProgressRange_1: new () => { delete?: () => void };
  TopExp_Explorer_2: new (shape: unknown, toFind: unknown, toAvoid: unknown) => {
    More(): boolean;
    Current(): { ptr: number; delete(): void };
    Next(): void;
    delete(): void;
  };
  TopTools_IndexedMapOfShape_1: new () => {
    FindIndex_1?(shape: unknown): number;
    FindIndex?(shape: unknown): number;
    FindKey_1?(idx: number): unknown;
    FindKey?(idx: number): unknown;
    Extent(): number;
    delete(): void;
  };
  TopExp: {
    MapShapes_1(shape: unknown, type: unknown, map: unknown): void;
  };
  BRepAdaptor_Curve_2: new (edge: unknown) => {
    FirstParameter(): number;
    LastParameter(): number;
    D0(u: number, p: unknown): void;
    delete(): void;
  };
  BRepAdaptor_Surface_2: new (face: unknown, restricted: boolean) => {
    FirstUParameter(): number;
    LastUParameter(): number;
    FirstVParameter(): number;
    LastVParameter(): number;
    Value(u: number, v: number): { X(): number; Y(): number; Z(): number; delete(): void };
    delete(): void;
  };
  gp_Pnt_1: new () => { X(): number; Y(): number; Z(): number; delete(): void };
  /**
   * OCC-14.3: 2D point array for Add_5 radius-law (confirmed bound in TKMath module).
   * Lower/upper are 1-based indices; array is OWNED — must .delete().
   */
  TColgp_Array1OfPnt2d_2: new (lower: number, upper: number) => {
    SetValue(idx: number, p: unknown): void;
    delete(): void;
  };
  /**
   * OCC-14.3: 2D point constructor for (u, radius) pairs (confirmed bound in TKMath).
   * Each gp_Pnt2d is OWNED — must .delete().
   */
  gp_Pnt2d_3: new (x: number, y: number) => { delete(): void };
};

// ── Public types ──────────────────────────────────────────────────────────────

/** One group of edges sharing the same fillet specification. */
export interface OccFilletEdgeSet {
  edgeIds: number[];
  /** Constant radius — used when startRadius/endRadius/chordLength are absent. */
  radius?: number;
  /** Variable radius: start of edge. Requires endRadius. Uses mk.Add_3 (2 pts) or mk.Add_5 (N pts). */
  startRadius?: number;
  /** Variable radius: end of edge. Requires startRadius. Uses mk.Add_3 (2 pts) or mk.Add_5 (N pts). */
  endRadius?: number;
  /**
   * OCC-14.3: interior mid-point radius controls (u ∈ (0,1), radius in mm).
   * When present, uses mk.Add_5(TColgp_Array1OfPnt2d, edge) with startRadius@u=0,
   * midRadii interior points, and endRadius@u=1 as the radius law. Requires
   * startRadius and endRadius. Falls back to Add_3 if Add_5 is not bound.
   * Array must be sorted ascending by position; positions outside (0,1) are clamped.
   */
  midRadii?: Array<{ position: number; radius: number }>;
  /** Chord-length mode: arc chord width. Converted to equivalent radius via dihedral angle. */
  chordLength?: number;
  /**
   * Per-face asymmetric mode. When true, startRadius/endRadius are averaged via Add_2
   * (no true per-face OCC binding exists for fillet — that's a chamfer concept).
   */
  isAsymmetric?: boolean;
}

export interface OccFilletOptions {
  id?: string;
  sourceFeatureId?: string;
  /**
   * G1 (default) — ChFi3d_Rational tangent surface.
   * G2 — ChFi3d_Polynomial for higher-quality curvature blending.
   * G0 — OCC-14.4: BRepFilletAPI_MakeFillet always produces at least tangent (G1)
   *      continuity; there is no C0-only surface form. G0 maps to ChFi3d_Rational
   *      (identical to G1). This value is accepted for Fusion 360 file round-trip
   *      only — APPROXIMATED as G1 in geometry. Not exposed in the dialog UI to
   *      avoid a misleading no-op control.
   */
  continuity?: 'G1' | 'G2' | 'G0';
  /**
   * Tangency weight for G2 continuity mode (range 0.1–2.0).
   * Reserved for future OCC binding extension — BRepFilletAPI_MakeFillet does
   * not currently expose a SetParams/weight API in the opencascade.js WASM build.
   * Stored here so callers can round-trip the value without loss.
   */
  tangencyWeight?: number;
  /**
   * Corner SOLUTION request (rolling-ball vs setback). Round-trip-only:
   * BRepFilletAPI_MakeFillet computes vertex corners automatically and exposes no
   * toggle, so this is stored for Fusion 360 round-trip but does not change the
   * produced geometry. (It no longer selects the surface form — see OCC-13.1.)
   */
  isRollingBallCorner?: boolean;
}

// ── Chord-length radius computation ──────────────────────────────────────────

/**
 * Estimates the fillet radius that produces a given chord length on an edge
 * by computing the interior dihedral angle between the two adjacent faces.
 *
 * Formula: r = chordLength / (2 · cos(α / 2))
 * where α is the interior dihedral angle (e.g. 90° for a rectangular corner).
 *
 * Falls back to the 90° approximation (r = chord / √2) if OCC topology
 * traversal fails for any reason.
 */
function computeChordLengthRadius(
  oc: OcctRaw,
  rawShape: unknown,
  rawEdge: { ptr: number },
  chordLength: number,
): number {
  const fallback = chordLength / Math.SQRT2; // 90° assumption
  try {
    const occ = oc as OccFilletApi;

    const edgeMap = new occ.TopTools_IndexedMapOfShape_1();
    try {
      occ.TopExp.MapShapes_1(rawShape, oc.TopAbs_ShapeEnum.TopAbs_EDGE, edgeMap);
    } catch {
      edgeMap.delete();
      return fallback;
    }
    const targetIdx = findShapeIndex(edgeMap, rawEdge);
    if (targetIdx <= 0) {
      edgeMap.delete();
      return fallback;
    }

    const adjacentFaces: unknown[] = [];
    const faceExp = new occ.TopExp_Explorer_2(
      rawShape,
      oc.TopAbs_ShapeEnum.TopAbs_FACE,
      oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
    );
    while (faceExp.More() && adjacentFaces.length < 2) {
      const faceShape = faceExp.Current();
      const edgeExp = new occ.TopExp_Explorer_2(
        faceShape,
        oc.TopAbs_ShapeEnum.TopAbs_EDGE,
        oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
      );
      let found = false;
      while (edgeExp.More()) {
        const e = edgeExp.Current();
        const idx = findShapeIndex(edgeMap, e);
        e.delete();
        if (idx === targetIdx) {
          found = true;
          edgeExp.delete();
          break;
        }
        edgeExp.Next();
      }
      if (!found) edgeExp.delete();
      // Push the owned Current() copy into adjacentFaces so it stays alive for
      // BRepAdaptor_Surface_2 below. Face_1 is a VIEW (same ptr as faceShape) —
      // if we pushed Face_1 and immediately deleted faceShape we'd have a dangling
      // reference. Keep faceShape alive; delete it only when not needed.
      if (found) {
        adjacentFaces.push(faceShape); // faceShape ownership transferred to adjacentFaces
      } else {
        faceShape.delete();
      }
      faceExp.Next();
    }
    faceExp.delete();
    edgeMap.delete();

    if (adjacentFaces.length < 2) {
      for (const f of adjacentFaces) (f as { delete(): void }).delete();
      return fallback;
    }

    const normals: [number, number, number][] = [];
    for (const face of adjacentFaces) {
      try {
        const surf = new occ.BRepAdaptor_Surface_2(face, true);
        const u0 = surf.FirstUParameter(), u1 = surf.LastUParameter();
        const v0 = surf.FirstVParameter(), v1 = surf.LastVParameter();
        const uC = (u0 + u1) / 2, vC = (v0 + v1) / 2;
        const du = (u1 - u0) * 0.01 || 1e-4;
        const dv = (v1 - v0) * 0.01 || 1e-4;
        const p0 = surf.Value(uC, vC);
        const p1 = surf.Value(uC + du, vC);
        const p2 = surf.Value(uC, vC + dv);
        const ax = p1.X() - p0.X(), ay = p1.Y() - p0.Y(), az = p1.Z() - p0.Z();
        const bx = p2.X() - p0.X(), by = p2.Y() - p0.Y(), bz = p2.Z() - p0.Z();
        const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
        const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
        p0.delete(); p1.delete(); p2.delete();
        surf.delete();
        if (len > 1e-10) normals.push([nx / len, ny / len, nz / len]);
      } catch { /* ignore individual face failures */ }
      (face as { delete(): void }).delete();
    }

    if (normals.length < 2) return fallback;

    const dot = normals[0][0] * normals[1][0]
              + normals[0][1] * normals[1][1]
              + normals[0][2] * normals[1][2];
    const alpha = Math.PI - Math.acos(Math.max(-1, Math.min(1, dot)));
    const cosHalf = Math.cos(alpha / 2);
    if (Math.abs(cosHalf) < 1e-6) return chordLength / 2; // flat edge (180°)
    return chordLength / (2 * cosHalf);
  } catch {
    return fallback;
  }
}

// ── Seam-edge detection ───────────────────────────────────────────────────────

/**
 * Counts the number of distinct faces in `rawShape` that contain `rawEdge`
 * in their wire boundary.
 *
 * Regular corner edges are shared by exactly 2 faces.
 * Seam edges on analytic surfaces (cylinders, tori) appear in only 1 face's
 * wire (the face wraps around and re-uses the same parametric seam). OCC's
 * BRepFilletAPI_MakeFillet cannot fillet seam edges — Build() throws.
 *
 * Returns 2 on any topology error so the caller never skips a valid edge.
 */
function countAdjacentFacesForEdge(
  occ: OccFilletApi,
  oc: OcctRaw,
  rawShape: unknown,
  edgeMap: { FindIndex_1?(s: unknown): number; FindIndex?(s: unknown): number; Extent(): number },
  rawEdge: { ptr: number },
): number {
  try {
    const targetIdx = findShapeIndex(edgeMap as Parameters<typeof findShapeIndex>[0], rawEdge);
    if (targetIdx <= 0) return 2; // can't detect — assume fillable

    let count = 0;
    const faceExp = new occ.TopExp_Explorer_2(
      rawShape,
      oc.TopAbs_ShapeEnum.TopAbs_FACE,
      oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
    );
    try {
      while (faceExp.More()) {
        const faceShape = faceExp.Current();
        const edgeExp = new occ.TopExp_Explorer_2(
          faceShape,
          oc.TopAbs_ShapeEnum.TopAbs_EDGE,
          oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
        );
        let found = false;
        try {
          while (edgeExp.More()) {
            const e = edgeExp.Current();
            const idx = findShapeIndex(edgeMap as Parameters<typeof findShapeIndex>[0], e);
            e.delete();
            if (idx === targetIdx) {
              found = true;
              break;
            }
            edgeExp.Next();
          }
        } finally {
          edgeExp.delete();
        }
        faceShape.delete();
        if (found) count++;
        faceExp.Next();
      }
    } finally {
      faceExp.delete();
    }
    return count;
  } catch {
    return 2; // assume fillable on error — never skip a valid edge
  }
}

// ── Radius pre-validation (OCC-13.2) ──────────────────────────────────────────

/**
 * Pre-validate fillet radii against local topology so an over-large radius is
 * clamped to a valid value instead of throwing inside Build() (the dominant
 * cause of adjacent-corner failures).
 *
 * For each filleted edge we measure the chord length of every edge sharing one
 * of its endpoints. The limiting dimension is:
 *   - a NON-filleted neighbour of chord length L → the fillet can consume almost
 *     all of L (cap 0.95·L);
 *   - a co-filleted neighbour of chord length L → two fillets eat into L from
 *     both ends, so each is capped at ~0.49·L.
 * Closed edges (circle seams/caps, chord ≈ 0) do not participate — their
 * over-radius failures are caught post-hoc by the open-mesh guard.
 *
 * Returns edgeId → maxSafeRadius only where a finite limit exists. Never throws.
 */
export function computeSafeFilletRadii(
  oc: OcctRaw,
  body: BRepBody,
  rawShape: unknown,
  filletedEdgeIds: Set<number>,
): Map<number, number> {
  const result = new Map<number, number>();
  const occ = oc as OccFilletApi;

  const edgeMap = new occ.TopTools_IndexedMapOfShape_1();
  const vertMap = new occ.TopTools_IndexedMapOfShape_1();
  try {
    occ.TopExp.MapShapes_1(rawShape, oc.TopAbs_ShapeEnum.TopAbs_EDGE, edgeMap);
    occ.TopExp.MapShapes_1(rawShape, oc.TopAbs_ShapeEnum.TopAbs_VERTEX, vertMap);
  } catch {
    edgeMap.delete();
    vertMap.delete();
    return result;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const findKey = ((edgeMap as any).FindKey_1 ?? (edgeMap as any).FindKey)?.bind(edgeMap) as
    | ((i: number) => unknown)
    | undefined;

  interface EdgeGeom { len: number; verts: number[]; bodyEdgeId: number; canonical: number }
  const byCanonical = new Map<number, EdgeGeom>();
  const vertexToCanonical = new Map<number, number[]>();
  const filletedCanonical = new Set<number>();

  for (const [bodyEdgeId, edgeHandle] of body.edgeIds) {
    const raw = occDeref(oc, edgeHandle, oc.TopoDS_Shape) as { ptr: number };
    const canonical = findShapeIndex(edgeMap as Parameters<typeof findShapeIndex>[0], raw);
    if (canonical <= 0) continue;

    // Chord length via curve endpoints; closed edges (≈0) are non-constraining.
    let len = Infinity;
    try {
      // rawEdge is a VIEW (TopoDS.Edge_1 of the occDeref VIEW) — do NOT delete.
      const rawEdge = oc.TopoDS.Edge_1(raw);
      const curve = new occ.BRepAdaptor_Curve_2(rawEdge);
      const p0 = new occ.gp_Pnt_1();
      const p1 = new occ.gp_Pnt_1();
      try {
        const t0 = curve.FirstParameter();
        const t1 = curve.LastParameter();
        curve.D0(t0, p0);
        curve.D0(t1, p1);
        const dx = p1.X() - p0.X(), dy = p1.Y() - p0.Y(), dz = p1.Z() - p0.Z();
        const chord = Math.sqrt(dx * dx + dy * dy + dz * dz);
        len = chord > 1e-6 ? chord : Infinity;
      } finally {
        p0.delete?.();
        p1.delete?.();
        curve.delete?.();
      }
    } catch {
      len = Infinity;
    }

    // Endpoint vertices (canonical indices).
    const verts: number[] = [];
    try {
      // rawEdge VIEW again — do NOT delete.
      const rawEdge = oc.TopoDS.Edge_1(raw);
      const vexp = new occ.TopExp_Explorer_2(rawEdge, oc.TopAbs_ShapeEnum.TopAbs_VERTEX, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
      try {
        while (vexp.More() && verts.length < 2) {
          const v = vexp.Current();
          const vi = findShapeIndex(vertMap as Parameters<typeof findShapeIndex>[0], v);
          v.delete();
          if (vi > 0 && !verts.includes(vi)) verts.push(vi);
          vexp.Next();
        }
      } finally {
        vexp.delete();
      }
    } catch { /* leave verts as found */ }

    byCanonical.set(canonical, { len, verts, bodyEdgeId, canonical });
    if (filletedEdgeIds.has(bodyEdgeId)) filletedCanonical.add(canonical);
    for (const v of verts) {
      const list = vertexToCanonical.get(v);
      if (list) list.push(canonical); else vertexToCanonical.set(v, [canonical]);
    }
  }

  // Keep the FindKey reference reachable for type-checkers (used implicitly via
  // canonical indices); no FindKey lookups are needed beyond MapShapes ordering.
  void findKey;

  for (const geom of byCanonical.values()) {
    if (!filletedCanonical.has(geom.canonical)) continue;
    let limit = Infinity;
    for (const v of geom.verts) {
      for (const n of vertexToCanonical.get(v) ?? []) {
        if (n === geom.canonical) continue;
        const nb = byCanonical.get(n);
        if (!nb || !Number.isFinite(nb.len)) continue;
        // co-filleted factor: 0.37 stays safely below the (√2−1)·L ≈ 0.414·L
        // theoretical maximum for a 3-way orthogonal corner blend, with enough
        // headroom that OCC's corner-patch algorithm doesn't produce crease
        // artifacts even on complex topology (boolean-subtracted faces nearby).
        // 0.40 was too close to the limit on some models — small residual creases
        // appeared at the transition from clamped to unclamped corners.
        // non-filleted factor: 0.85 leaves 15% of the neighbour unconsumed.
        const contribution = filletedCanonical.has(n) ? nb.len * 0.37 : nb.len * 0.85;
        // Skip degenerate junction edges (boolean-op artefacts at curve/line transitions)
        // whose tiny chord would falsely cap the fillet below any useful radius.
        // OCC's corner-blend algorithm handles these junctions on its own.
        if (contribution < 0.2) continue;
        if (contribution < limit) limit = contribution;
      }
    }
    if (Number.isFinite(limit)) result.set(geom.bodyEdgeId, limit);
  }

  // Phase 2: corner consistency — propagate the tightest cap to ALL co-filleted
  // edges that share a corner vertex.
  //
  // Without this, a corner where edge A is clamped (e.g. 1.131) but adjacent
  // co-filleted edge B has no cap runs edge A at 1.131 and edge B at the full
  // requested radius (e.g. 2).  OCC's 3-way corner-blend algorithm receives
  // mismatched radii, produces a degenerate self-intersecting surface, and the
  // resulting tessellation looks wrinkled/corrupted.
  //
  // Strategy: iterate until stable (handles transitive chains — A clamps B,
  // B then clamps C at a different vertex).
  let anyTightened = true;
  while (anyTightened) {
    anyTightened = false;
    for (const canonicals of vertexToCanonical.values()) {
      const filletedAtV = canonicals.filter(c => filletedCanonical.has(c));
      if (filletedAtV.length < 2) continue;

      // Tightest cap already recorded for any filleted edge at this vertex.
      let minCap = Infinity;
      for (const c of filletedAtV) {
        const edge = byCanonical.get(c);
        if (!edge) continue;
        const cap = result.get(edge.bodyEdgeId);
        if (cap !== undefined && cap < minCap) minCap = cap;
      }
      if (!Number.isFinite(minCap)) continue;

      // Apply that tightest cap to every filleted edge at this vertex.
      for (const c of filletedAtV) {
        const edge = byCanonical.get(c);
        if (!edge) continue;
        const existing = result.get(edge.bodyEdgeId);
        if (existing === undefined || existing > minCap) {
          result.set(edge.bodyEdgeId, minCap);
          anyTightened = true;
        }
      }
    }
  }

  edgeMap.delete();
  vertMap.delete();
  return result;
}

// ── Core builder ──────────────────────────────────────────────────────────────

/**
 * Build a fillet from an ordered list of edge sets, each with its own
 * radius specification (constant / variable / chord-length / asymmetric).
 * All sets are added to a single BRepFilletAPI_MakeFillet builder and
 * committed in one Build() call.
 */
export function occFilletEdgeSetsWithInstance(
  oc: OcctRaw,
  body: BRepBody,
  edgeSets: OccFilletEdgeSet[],
  options: OccFilletOptions = {},
): BRepBody | null {
  if (edgeSets.length === 0) return null;

  const occ = oc as OccFilletApi;

  // Resolve the body shape — try stored handle first, fall back to fresh dereference.
  let rawShape: unknown;
  try {
    rawShape = occDeref(oc, body.shape, oc.TopoDS_Shape);
    // Verify the shape is still alive (embind objects have isDeleted)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (typeof (rawShape as any)?.isDeleted === 'function' && (rawShape as any).isDeleted()) {
      throw new Error('shape is deleted');
    }
  } catch {
    console.warn('[occFillet] body.shape handle is stale');
    return null;
  }

  // OCC-13.1 — ChFi3d_FilletShape is the SURFACE cross-section form, NOT the
  // corner solution. It must be chosen from CONTINUITY only:
  //   G2 → ChFi3d_Polynomial (curvature-continuous blend)
  //   G1 → ChFi3d_Rational   (tangent-continuous, OCC default)
  //   G0 → ChFi3d_Rational   (OCC-14.4: APPROXIMATED as G1 — BRepFilletAPI_MakeFillet
  //          always produces at least tangent continuity; no C0-only surface form exists)
  // isRollingBallCorner controls the VERTEX corner solution (rolling-ball vs
  // setback), which BRepFilletAPI_MakeFillet computes automatically and exposes
  // no toggle for — so it is round-trip-only (stored, no geometric effect today).
  // The previous code mapped isRollingBallCorner→ChFi3d_QuasiAngular, conflating
  // the corner solution with the surface form and giving a false impression that
  // the corner toggle was wired.
  const filletShape = options.continuity === 'G2'
    ? occ.ChFi3d_FilletShape.ChFi3d_Polynomial
    : occ.ChFi3d_FilletShape.ChFi3d_Rational; // G1 and G0 both use Rational

  // OCC-13.2 (revised) — attempt the fillet with the USER-REQUESTED radii first so
  // a valid fillet is never silently capped (Fusion 360 does not cap, and the old
  // unconditional pre-clamp also produced mismatched co-filleted corner radii →
  // crease artifacts). Only if OCC genuinely cannot build do we retry with radii
  // clamped to the local corner geometry, turning a hard failure into a slightly
  // smaller valid blend instead of nothing.
  const runAttempt = (useClamp: boolean): BRepBody | null => {
    const mk = createFilletBuilder(occ, rawShape, filletShape);
    if (!mk) {
      console.warn('[occFillet] BRepFilletAPI_MakeFillet is not bound in this OCC build');
      return null;
    }

    // Prefer the explicit continuity API for G2 when this opencascade.js build
    // binds it — it controls the approximation continuity directly rather than via
    // the surface-form enum. Best-effort: any binding-shape mismatch is swallowed
    // and the ChFi3d_Polynomial surface form above remains in effect.
    if (options.continuity === 'G2') {
      trySetG2Continuity(occ, mk);
    }
    // Build a shape→index map once for seam-edge detection.
    // Seam edges (cylinder/torus parametric seam) are adjacent to < 2 faces
    // and cause BRepFilletAPI_MakeFillet.Build() to throw. We skip them here
    // so Build() never sees them, producing a clean null rather than an exception.
    const seamDetectMap = new occ.TopTools_IndexedMapOfShape_1();
    let seamDetectReady = false;
    try {
      occ.TopExp.MapShapes_1(rawShape, oc.TopAbs_ShapeEnum.TopAbs_EDGE, seamDetectMap);
      seamDetectReady = seamDetectMap.Extent() > 0;
    } catch {
      // Non-fatal: seam detection degrades gracefully (we'll attempt Build() anyway).
    }
    try {

    // The clamp map is built ONLY on the retry pass; the first pass uses the exact
    // requested radii so valid fillets are never silently shrunk (the user's value
    // is honoured, matching Fusion). On retry, an over-large radius is capped to the
    // local corner geometry as a recovery for a build that already hard-failed.
    let safeRadii: Map<number, number> = new Map();
    if (useClamp) {
      try {
        const filletedEdgeIds = new Set<number>();
        for (const es of edgeSets) for (const id of es.edgeIds) filletedEdgeIds.add(id);
        safeRadii = computeSafeFilletRadii(oc, body, rawShape, filletedEdgeIds);
      } catch {
        safeRadii = new Map();
      }
    }
    let clampWarned = false;
    const clampRadius = (edgeId: number, requested: number): number => {
      if (!useClamp) return requested;
      const cap = safeRadii.get(edgeId);
      if (cap !== undefined && requested > cap) {
        if (!clampWarned) {
          console.log(
            `[occFillet] retry: radius ${requested} clamped to ${cap.toFixed(3)} (edge ${edgeId} corner geometry limit)`,
          );
          clampWarned = true;
        }
        return cap;
      }
      return requested;
    };

    let addedAny = false;
    for (const edgeSet of edgeSets) {
      for (const edgeId of edgeSet.edgeIds) {
        const edgeHandle = body.edgeIds.get(edgeId);
        if (!edgeHandle) continue;
        // Use the body's stored edge handle directly — it's the authoritative
        // reference from the original topology walk. occDeref returns a VIEW
        // into the retained IndexedMap. Cast to TopoDS_Edge for the fillet API.
        let rawEdge: unknown;
        try {
          const rawEdgeShape = occDeref(oc, edgeHandle, oc.TopoDS_Shape);
          // Edge_1 is a wrapPointer VIEW (same ptr) — do NOT delete rawEdge.
          rawEdge = oc.TopoDS.Edge_1(rawEdgeShape);
        } catch {
          console.warn(`[occFillet] could not deref edge ${edgeId}`);
          continue;
        }

        // Skip seam/boundary edges — they cause Build() to throw.
        if (seamDetectReady) {
          const adjFaces = countAdjacentFacesForEdge(occ, oc, rawShape, seamDetectMap, rawEdge as { ptr: number });
          if (adjFaces < 2) {
            console.warn(`[occFillet] skipping edge ${edgeId}: seam or boundary edge (adjacent to ${adjFaces} face(s))`);
            continue;
          }
        }

        try {
          if (edgeSet.isAsymmetric && edgeSet.startRadius !== undefined && edgeSet.endRadius !== undefined) {
            const d1 = Math.max(edgeSet.startRadius, 0.001);
            const d2 = Math.max(edgeSet.endRadius, 0.001);
            // Asymmetric fillet has no per-face OCC overload — average as Add_2.
            mk.Add_2(Math.max(clampRadius(edgeId, (d1 + d2) / 2), 0.001), rawEdge);
          } else if (
            edgeSet.midRadii && edgeSet.midRadii.length > 0 &&
            edgeSet.startRadius !== undefined && edgeSet.endRadius !== undefined
          ) {
            // OCC-14.3: N midpoints via Add_5(TColgp_Array1OfPnt2d, edge).
            // Build array: [startR@u=0, ...midRadii sorted by position, endR@u=1].
            // All points are OWNED and must be deleted after Add_5 returns.
            const add5 = mk.Add_5?.bind(mk);
            if (
              add5 &&
              typeof (occ as unknown as Record<string, unknown>).TColgp_Array1OfPnt2d_2 === 'function' &&
              typeof (occ as unknown as Record<string, unknown>).gp_Pnt2d_3 === 'function'
            ) {
              const sorted = [...edgeSet.midRadii].sort((a, b) => a.position - b.position);
              const allPts: Array<{ position: number; radius: number }> = [
                { position: 0, radius: edgeSet.startRadius },
                ...sorted.map((m) => ({
                  position: Math.max(0.001, Math.min(0.999, m.position)),
                  radius: m.radius,
                })),
                { position: 1, radius: edgeSet.endRadius },
              ];
              const n = allPts.length;
              const arr = new occ.TColgp_Array1OfPnt2d_2(1, n);
              const pts: Array<{ delete(): void }> = [];
              try {
                for (let pi = 0; pi < n; pi++) {
                  const r = Math.max(clampRadius(edgeId, allPts[pi].radius), 0.001);
                  const pt = new occ.gp_Pnt2d_3(allPts[pi].position, r);
                  pts.push(pt);
                  arr.SetValue(pi + 1, pt);
                }
                add5(arr, rawEdge);
                addedAny = true;
              } catch (midErr) {
                console.warn(`[occFillet] Add_5 midpoints failed for edge ${edgeId}, falling back to Add_3:`, midErr);
                // Fall back to two-point variable radius (loses midpoints).
                mk.Add_3(
                  Math.max(clampRadius(edgeId, edgeSet.startRadius), 0.001),
                  Math.max(clampRadius(edgeId, edgeSet.endRadius), 0.001),
                  rawEdge,
                );
                addedAny = true;
              } finally {
                for (const pt of pts) { try { pt.delete(); } catch { /* ignore */ } }
                try { arr.delete(); } catch { /* ignore */ }
              }
            } else {
              // Add_5 not bound in this WASM build — degrade to Add_3.
              console.warn(`[occFillet] Add_5 not bound; using Add_3 (no midpoints) for edge ${edgeId}`);
              mk.Add_3(
                Math.max(clampRadius(edgeId, edgeSet.startRadius), 0.001),
                Math.max(clampRadius(edgeId, edgeSet.endRadius), 0.001),
                rawEdge,
              );
              addedAny = true;
            }
          } else if (edgeSet.startRadius !== undefined && edgeSet.endRadius !== undefined) {
            mk.Add_3(
              Math.max(clampRadius(edgeId, edgeSet.startRadius), 0.001),
              Math.max(clampRadius(edgeId, edgeSet.endRadius), 0.001),
              rawEdge,
            );
          } else if (edgeSet.chordLength !== undefined && edgeSet.chordLength > 0) {
            const r = computeChordLengthRadius(oc, rawShape, rawEdge as { ptr: number }, edgeSet.chordLength);
            mk.Add_2(Math.max(clampRadius(edgeId, r), 0.001), rawEdge);
          } else {
            mk.Add_2(Math.max(clampRadius(edgeId, edgeSet.radius ?? 2), 0.001), rawEdge);
          }
          if (!edgeSet.midRadii?.length) addedAny = true; // midRadii path sets addedAny internally
        } catch (e) {
          console.warn(`[occFillet] could not add edge ${edgeId}:`, e);
        }
      }
    }

    seamDetectMap.delete();

    if (!addedAny) {
      mk.delete();
      return null;
    }

    try {
      buildFilletBuilder(occ, mk);
    } catch (buildErr) {
      // OCC can expose HasResult() after a failed Build(), but that partial
      // shape may be an open or missing-face solid. Never install partial
      // fillets into the model; let the caller preserve the previous body.
      console.warn('[occFillet] Build() threw; rejecting partial result. Error:', buildErr);
      mk.delete();
      return null;
    }

    if (mk.IsDone?.() === false) {
      console.warn('[occFillet] BRepFilletAPI_MakeFillet.IsDone() = false; rejecting partial result');
      mk.delete();
      return null;
    }

    const resultShape = mk.Shape();
    // Keep the fillet builder alive — resultShape is a reference into it.
    return makeBRepBodyFromOccShape(oc, resultShape, {
      id: options.id,
      sourceFeatureId: options.sourceFeatureId,
      ownedResources: [mk],
    });
    } catch (e) {
      console.warn('[occFillet] threw outside Build/Shape:', e);
      // Guard against double-free: the happy path already deleted seamDetectMap at
      // this point only if we reached it — on a throw before that, free it here.
      try { seamDetectMap.delete(); } catch { /* already freed on happy path */ }
      mk.delete();
      return null;
    }
    // NOTE: mk is NOT deleted here — it's transferred to ownedResources so that
    // resultShape (a reference into the builder) stays valid.
  };

  // Attempt 1: exact requested radii (no capping — Fusion-like). Attempt 2 runs
  // only if OCC could not build at the requested size, retrying with radii clamped
  // to local corner geometry so a hard failure degrades to a smaller valid blend.
  return runAttempt(false) ?? runAttempt(true);
}

// ── Convenience wrappers (backward-compatible) ────────────────────────────────

export async function occFillet(
  body: BRepBody,
  edgeIds: number[],
  radius: number,
  options: OccFilletOptions = {},
): Promise<BRepBody | null> {
  const { oc } = await getOcc();
  return occFilletWithInstance(oc, body, edgeIds, radius, options);
}

export function occFilletWithInstance(
  oc: OcctRaw,
  body: BRepBody,
  edgeIds: number[],
  radius: number,
  options: OccFilletOptions = {},
): BRepBody | null {
  if (edgeIds.length === 0) return null;
  if (radius <= 0) return null;
  return occFilletEdgeSetsWithInstance(oc, body, [{
    edgeIds,
    radius,
  }], options);
}

// ── Full-round fillet ─────────────────────────────────────────────────────────

export interface OccFullRoundFilletOptions extends OccFilletOptions {
  id?: string;
  sourceFeatureId?: string;
}

/**
 * Side-face specification for full-round fillets.
 * Accepts a single face id (legacy) or an array of face ids per side group.
 */
export type FullRoundSideFaces =
  | [number, number]            // legacy: one face per side
  | [number[], number[]]        // multi-face per side
  | null;                       // auto-detect from center face's adjacency

/**
 * Full-round fillet: replaces a narrow center face with a circular arc blend
 * tangent to both adjacent side faces. Equivalent to Fusion 360's
 * FullRoundFilletFaceSets.
 *
 * - `sideFaces=[a, b]`: single side face per side (legacy behaviour).
 * - `sideFaces=[[a, b], [c, d]]`: multiple side faces per side; all shared
 *   boundary edges across each side group are collected.
 * - `sideFaces=null`: auto-detect — find all faces adjacent to the center face
 *   and split them into two groups via topology graph 2-coloring (best-effort).
 */
export function occFullRoundFilletWithInstance(
  oc: OcctRaw,
  body: BRepBody,
  centerFaceId: number,
  sideFaces: FullRoundSideFaces,
  options: OccFullRoundFilletOptions = {},
): BRepBody | null {
  const centerHandle = body.faceIds.get(centerFaceId);
  if (!centerHandle) {
    console.warn('[occFullRoundFillet] center face id not found in body');
    return null;
  }

  // Normalise sideFaces to [number[], number[]].
  let sideGroups: [number[], number[]] | null;
  if (sideFaces === null) {
    sideGroups = autoInferSideFaceGroups(oc, body, centerFaceId);
    if (!sideGroups) {
      console.warn('[occFullRoundFillet] auto-side-face inference failed');
      return null;
    }
  } else if (Array.isArray(sideFaces[0])) {
    sideGroups = sideFaces as [number[], number[]];
  } else {
    const [a, b] = sideFaces as [number, number];
    sideGroups = [[a], [b]];
  }

  const [side1Group, side2Group] = sideGroups;
  if (side1Group.length === 0 || side2Group.length === 0) {
    console.warn('[occFullRoundFillet] one or both side-face groups are empty');
    return null;
  }

  const occ = oc as OccFilletApi;
  const rawShape = occDeref(oc, body.shape, oc.TopoDS_Shape);
  const centerShapeRaw = occDeref(oc, centerHandle, oc.TopoDS_Shape);
  const centerFaceRaw = oc.TopoDS.Face_1(centerShapeRaw);

  const edgeMap = new occ.TopTools_IndexedMapOfShape_1();
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    edgeMap.delete();
    // centerFaceRaw is a TopoDS.Face_1 cast of an occDeref view; do not delete.
    // centerShapeRaw/rawShape are occDeref views; do not delete.
  };

  try {
    occ.TopExp.MapShapes_1(rawShape, oc.TopAbs_ShapeEnum.TopAbs_EDGE, edgeMap);
  } catch (e) {
    console.warn('[occFullRoundFillet] TopExp.MapShapes failed:', e);
    cleanup();
    return null;
  }

  if (edgeMap.Extent() === 0) {
    cleanup();
    return null;
  }

  function faceEdgeIndicesById(faceId: number): Set<number> {
    const handle = body.faceIds.get(faceId);
    if (!handle) return new Set();
    const sRaw = occDeref(oc, handle, oc.TopoDS_Shape);
    const fRaw = oc.TopoDS.Face_1(sRaw);
    // sRaw and fRaw are occDeref VIEW / TopoDS.Face_1 VIEW — do NOT delete.
    const result = new Set<number>();
    const exp = new occ.TopExp_Explorer_2(fRaw, oc.TopAbs_ShapeEnum.TopAbs_EDGE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
    try {
      while (exp.More()) {
        const e = exp.Current();
        const idx = findShapeIndex(edgeMap, e);
        e.delete();
        if (idx > 0) result.add(idx);
        exp.Next();
      }
    } finally {
      exp.delete();
    }
    return result;
  }

  const centerExp = new occ.TopExp_Explorer_2(centerFaceRaw, oc.TopAbs_ShapeEnum.TopAbs_EDGE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
  const centerIndices = new Set<number>();
  while (centerExp.More()) {
    const e = centerExp.Current();
    const idx = findShapeIndex(edgeMap, e);
    e.delete();
    if (idx > 0) centerIndices.add(idx);
    centerExp.Next();
  }
  centerExp.delete();

  const side1Indices = new Set<number>();
  for (const id of side1Group) for (const i of faceEdgeIndicesById(id)) side1Indices.add(i);
  const side2Indices = new Set<number>();
  for (const id of side2Group) for (const i of faceEdgeIndicesById(id)) side2Indices.add(i);

  const shared1 = [...centerIndices].filter(i => side1Indices.has(i));
  const shared2 = [...centerIndices].filter(i => side2Indices.has(i));

  if (shared1.length === 0 || shared2.length === 0) {
    console.warn('[occFullRoundFillet] no shared edges found between center and side faces');
    cleanup();
    return null;
  }

  function edgeMidpoint(edgeIdx: number): [number, number, number] | null {
    let curve: { FirstParameter(): number; LastParameter(): number; D0(u: number, p: unknown): void; delete?: () => void } | null = null;
    let pt: { X(): number; Y(): number; Z(): number; delete?: () => void } | null = null;
    try {
      const findKeyFn = edgeMap.FindKey_1 ?? edgeMap.FindKey;
      if (!findKeyFn) return null;
      const edgeShape = findKeyFn.call(edgeMap, edgeIdx);
      const rawEdge = oc.TopoDS.Edge_1(edgeShape);
      const c = new occ.BRepAdaptor_Curve_2(rawEdge);
      curve = c;
      const t0 = c.FirstParameter(), t1 = c.LastParameter();
      const tMid = (t0 + t1) / 2;
      const p = new occ.gp_Pnt_1();
      pt = p;
      c.D0(tMid, p);
      return [p.X(), p.Y(), p.Z()];
    } catch {
      return null;
    } finally {
      pt?.delete?.();
      curve?.delete?.();
    }
  }

  const mp1 = edgeMidpoint(shared1[0]);
  const mp2 = edgeMidpoint(shared2[0]);
  let autoRadius = 2; // fallback
  if (mp1 && mp2) {
    const dx = mp2[0] - mp1[0], dy = mp2[1] - mp1[1], dz = mp2[2] - mp1[2];
    autoRadius = Math.max(0.001, Math.sqrt(dx * dx + dy * dy + dz * dz) / 2);
  }

  const sharedSet = new Set<number>([...shared1, ...shared2]);
  const bodyEdgeIds: number[] = [];
  for (const [bodyEdgeId, edgeHandle] of body.edgeIds) {
    try {
      // rawEdge is a VIEW from occDeref — do NOT delete.
      const rawEdge = occDeref(oc, edgeHandle, oc.TopoDS_Shape);
      const idx = findShapeIndex(edgeMap, rawEdge);
      if (sharedSet.has(idx)) bodyEdgeIds.push(bodyEdgeId);
    } catch { /* skip */ }
  }

  cleanup();

  if (bodyEdgeIds.length === 0) {
    console.warn('[occFullRoundFillet] could not map canonical edge indices to body edge IDs');
    return null;
  }

  return occFilletEdgeSetsWithInstance(oc, body, [{
    edgeIds: bodyEdgeIds,
    radius: autoRadius,
  }], options);
}

/**
 * Best-effort auto-detect of side-face groups for full-round fillet.
 * Strategy: collect all faces adjacent to the center face, then partition by
 * which boundary edge of the center face they share. Faces that touch the
 * same boundary edge group together.
 */
function autoInferSideFaceGroups(
  oc: OcctRaw,
  body: BRepBody,
  centerFaceId: number,
): [number[], number[]] | null {
  const occ = oc as OccFilletApi;
  const adjacent = findAdjacentFacesToFace(oc, body, occDeref(oc, body.shape, oc.TopoDS_Shape), centerFaceId);
  if (adjacent.length < 2) return null;

  // rawShape/centerRaw/fRaw are all occDeref wrapPointer VIEWs — do NOT delete.
  const rawShape = occDeref(oc, body.shape, oc.TopoDS_Shape);
  const edgeMap = new occ.TopTools_IndexedMapOfShape_1();
  try {
    occ.TopExp.MapShapes_1(rawShape, oc.TopAbs_ShapeEnum.TopAbs_EDGE, edgeMap);
  } catch {
    edgeMap.delete();
    return null;
  }

  const centerHandle = body.faceIds.get(centerFaceId);
  if (!centerHandle) { edgeMap.delete(); return null; }
  const centerRaw = occDeref(oc, centerHandle, oc.TopoDS_Shape);
  const centerEdgeList: number[] = [];
  const centerExp = new occ.TopExp_Explorer_2(centerRaw, oc.TopAbs_ShapeEnum.TopAbs_EDGE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
  try {
    while (centerExp.More()) {
      const e = centerExp.Current();
      const idx = findShapeIndex(edgeMap, e);
      e.delete();
      if (idx > 0 && !centerEdgeList.includes(idx)) centerEdgeList.push(idx);
      centerExp.Next();
    }
  } finally {
    centerExp.delete();
  }

  if (centerEdgeList.length < 2) {
    edgeMap.delete();
    return null;
  }

  // For each adjacent face, find which center-edge index it shares.
  const faceToEdgeIdx = new Map<number, number>();
  for (const adjFaceId of adjacent) {
    const handle = body.faceIds.get(adjFaceId);
    if (!handle) continue;
    const fRaw = occDeref(oc, handle, oc.TopoDS_Shape);
    const exp = new occ.TopExp_Explorer_2(fRaw, oc.TopAbs_ShapeEnum.TopAbs_EDGE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
    try {
      while (exp.More()) {
        const e = exp.Current();
        const idx = findShapeIndex(edgeMap, e);
        e.delete();
        if (centerEdgeList.includes(idx)) {
          faceToEdgeIdx.set(adjFaceId, idx);
          break;
        }
        exp.Next();
      }
    } finally {
      exp.delete();
    }
  }

  edgeMap.delete();

  // Bucket faces by edge index, pick the two largest buckets as the side groups.
  const buckets = new Map<number, number[]>();
  for (const [faceId, edgeIdx] of faceToEdgeIdx) {
    const list = buckets.get(edgeIdx);
    if (list) list.push(faceId); else buckets.set(edgeIdx, [faceId]);
  }
  if (buckets.size < 2) return null;
  const sorted = [...buckets.values()].sort((a, b) => b.length - a.length);
  return [sorted[0], sorted[1]];
}

// ── Rule fillet (Fusion RuleFilletFeature) ───────────────────────────────────

export interface OccRuleFilletOptions extends OccFilletOptions {
  /** Fillet radius applied to all collected edges. */
  radius?: number;
  /**
   * Fusion RuleFilletTopologyTypes filter: 'convex' = RoundsOnly (outside corners),
   * 'concave' = FilletsOnly (inside corners), 'all' = RoundsAndFillets (default).
   * Edges with convex=null (boundary / indeterminate) are always included.
   */
  topologyFilter?: 'all' | 'convex' | 'concave';
  /**
   * Selectable-edge metadata map for the source body, used to apply topologyFilter.
   * Pass the result of getSelectableEdges(). Only the `convex` field is read.
   */
  edgeMeta?: ReadonlyMap<number, { convex: boolean | null }>;
}

/** Filter edge IDs by topology (convex/concave) when a filter and meta are provided. */
function applyTopologyFilter(
  edgeIds: number[],
  options: OccRuleFilletOptions,
): number[] {
  const { topologyFilter, edgeMeta } = options;
  if (!topologyFilter || topologyFilter === 'all' || !edgeMeta) return edgeIds;
  const wantConvex = topologyFilter === 'convex';
  return edgeIds.filter((id) => {
    const m = edgeMeta.get(id);
    // Edges with convex=null (boundary/seam/indeterminate) are always included.
    if (!m || m.convex === null) return true;
    return wantConvex ? m.convex : !m.convex;
  });
}

/**
 * Rule fillet — AllEdges mode.
 * Collects every edge of the given face(s) and fillets them as a single set.
 * Pass `options.topologyFilter` + `options.edgeMeta` to restrict to convex or
 * concave edges (Fusion RuleFilletTopologyTypes: RoundsOnly / FilletsOnly).
 */
export function occRuleFilletAllEdgesWithInstance(
  oc: OcctRaw,
  body: BRepBody,
  faceIds: number[],
  radius: number,
  options: OccRuleFilletOptions = {},
): BRepBody | null {
  if (faceIds.length === 0) return null;
  const raw = new Set<number>();
  for (const faceId of faceIds) {
    for (const e of collectFaceEdgeIds(oc, body, faceId)) raw.add(e);
  }
  if (raw.size === 0) return null;
  const edgeIds = applyTopologyFilter([...raw], options);
  if (edgeIds.length === 0) return null;
  return occFilletEdgeSetsWithInstance(oc, body, [{ edgeIds, radius }], options);
}

/**
 * Rule fillet — BetweenFaces mode.
 * Fillets only the edges shared between any face in `groupA` and any face in `groupB`.
 * Pass `options.topologyFilter` + `options.edgeMeta` to restrict to convex or concave edges.
 */
export function occRuleFilletBetweenFacesWithInstance(
  oc: OcctRaw,
  body: BRepBody,
  groupA: number[],
  groupB: number[],
  radius: number,
  options: OccRuleFilletOptions = {},
): BRepBody | null {
  const raw = collectSharedEdgeIds(oc, body, groupA, groupB);
  if (raw.length === 0) return null;
  const edgeIds = applyTopologyFilter(raw, options);
  if (edgeIds.length === 0) return null;
  return occFilletEdgeSetsWithInstance(oc, body, [{ edgeIds, radius }], options);
}
