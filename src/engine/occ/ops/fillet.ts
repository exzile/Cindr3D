/**
 * OCC-5.1 — Exact fillet via BRepFilletAPI_MakeFillet.
 * This is the wing-killer: OCC produces an exact toroidal surface that
 * tessellates uniformly with no fan triangulation artifacts.
 *
 * Supports:
 *  - Constant radius (Add_2)
 *  - Variable radius start→end (Add_3)
 *  - Chord-length (dihedral-angle derived radius, then Add_2)
 *  - Multiple mixed edge sets in one Build pass
 *  - G2 surface continuity (ChFi3d_Polynomial surface type)
 *
 * Supported via workaround:
 *  - Asymmetric (Fusion offsetOne/offsetTwo) — mapped to Add_3(offsetOne, offsetTwo, edge);
 *    varies radius along edge length rather than per-face, but uses both offset values.
 *  - Full-round — occFullRoundFilletWithInstance; auto-radius from boundary edge midpoints.
 * Not supported:
 *  - N mid-point variable radius — OCC Add_3 is start+end only
 */
import type { OcctRaw } from '../types';
import { makeBRepBodyFromOccShape, occDeref, type BRepBody } from '../brepBody';
import { getOcc } from '../loader';

type OccFilletApi = OcctRaw & {
  BRepFilletAPI_MakeFillet_2: new (shape: unknown, filletShape: unknown) => {
    Add_2(radius: number, edge: unknown): void;
    Add_3(startRadius: number, endRadius: number, edge: unknown): void;
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
    FindIndex_1(shape: unknown): number;
    FindKey_1(idx: number): unknown;
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
};

// ── Public types ──────────────────────────────────────────────────────────────

/** One group of edges sharing the same fillet specification. */
export interface OccFilletEdgeSet {
  edgeIds: number[];
  /** Constant radius — used when startRadius/endRadius/chordLength are absent. */
  radius?: number;
  /** Variable radius: start of edge. Requires endRadius. Uses mk.Add_3. */
  startRadius?: number;
  /** Variable radius: end of edge. Requires startRadius. Uses mk.Add_3. */
  endRadius?: number;
  /** Chord-length mode: arc chord width. Converted to equivalent radius via dihedral angle. */
  chordLength?: number;
}

/** @deprecated Use OccFilletEdgeSet instead. Kept for backward compat. */
export interface OccFilletVariableRadius {
  start: number;
  end: number;
}

export interface OccFilletOptions {
  id?: string;
  sourceFeatureId?: string;
  /**
   * G1 (default) — ChFi3d_Rational tangent surface.
   * G2 — ChFi3d_Polynomial for higher-quality blending (best-effort; OCC
   *      BRepFilletAPI_MakeFillet is always at least G1 tangent — this
   *      changes the surface parameterisation toward curvature continuity).
   */
  continuity?: 'G1' | 'G2';
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

    // Collect up to 2 faces adjacent to this edge.
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
        if (e.ptr === rawEdge.ptr) {
          found = true;
          e.delete();
          edgeExp.delete();
          break;
        }
        e.delete();
        edgeExp.Next();
      }
      if (!found) edgeExp.delete();
      if (found) adjacentFaces.push(oc.TopoDS.Face_1(faceShape));
      faceShape.delete();
      faceExp.Next();
    }
    faceExp.delete();

    if (adjacentFaces.length < 2) {
      for (const f of adjacentFaces) (f as { delete(): void }).delete();
      return fallback;
    }

    // Evaluate face normals at each face's UV centre using BRepAdaptor_Surface.
    // We sample 3 points and compute the cross product so we don't need
    // BRepLProp_SLProps (which may not be bound in older opencascade.js builds).
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

    // Interior dihedral: outward normals point away from each face interior.
    // For a convex edge the normals diverge → dot < 0; α = π − acos(dot).
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

// ── Core builder ──────────────────────────────────────────────────────────────

/**
 * Build a fillet from an ordered list of edge sets, each with its own
 * radius specification (constant / variable / chord-length).
 * All sets are added to a single BRepFilletAPI_MakeFillet builder and
 * committed in one Build() call — this is correct; OCC propagates corner
 * blending between adjacent fillets automatically.
 */
export function occFilletEdgeSetsWithInstance(
  oc: OcctRaw,
  body: BRepBody,
  edgeSets: OccFilletEdgeSet[],
  options: OccFilletOptions = {},
): BRepBody | null {
  if (edgeSets.length === 0) return null;

  const occ = oc as OccFilletApi;
  const rawShape = occDeref(oc, body.shape, oc.TopoDS_Shape);

  // G2 uses polynomial parameterisation (higher-quality blending).
  const filletShape = options.continuity === 'G2'
    ? occ.ChFi3d_FilletShape.ChFi3d_Polynomial
    : occ.ChFi3d_FilletShape.ChFi3d_Rational;

  const mk = new occ.BRepFilletAPI_MakeFillet_2(rawShape, filletShape);

  let addedAny = false;
  for (const edgeSet of edgeSets) {
    for (const edgeId of edgeSet.edgeIds) {
      const handle = body.edgeIds.get(edgeId);
      if (!handle) continue;
      const rawEdge = occDeref(oc, handle, oc.TopoDS_Edge) as { ptr: number };
      try {
        if (edgeSet.startRadius !== undefined && edgeSet.endRadius !== undefined) {
          // Variable radius: different at each end of the edge.
          mk.Add_3(edgeSet.startRadius, edgeSet.endRadius, rawEdge);
        } else if (edgeSet.chordLength !== undefined && edgeSet.chordLength > 0) {
          // Chord-length: derive radius from the edge's dihedral angle.
          const r = computeChordLengthRadius(oc, rawShape, rawEdge, edgeSet.chordLength);
          mk.Add_2(Math.max(r, 0.001), rawEdge);
        } else {
          mk.Add_2(Math.max(edgeSet.radius ?? 2, 0.001), rawEdge);
        }
        addedAny = true;
      } catch (e) {
        console.warn(`[occFillet] could not add edge ${edgeId}:`, e);
      }
    }
  }

  if (!addedAny) {
    mk.delete();
    return null;
  }

  try {
    const progress = new occ.Message_ProgressRange_1();
    try {
      mk.Build(progress);
    } finally {
      progress.delete?.();
    }

    if (!mk.IsDone()) {
      console.warn('[occFillet] BRepFilletAPI_MakeFillet.IsDone() = false');
      return null;
    }

    const resultShape = mk.Shape();
    return makeBRepBodyFromOccShape(oc, resultShape, {
      id: options.id,
      sourceFeatureId: options.sourceFeatureId,
    });
  } catch (e) {
    console.warn('[occFillet] threw during Build/Shape:', e);
    return null;
  } finally {
    mk.delete();
  }
}

// ── Convenience wrappers (backward-compatible) ────────────────────────────────

export async function occFillet(
  body: BRepBody,
  edgeIds: number[],
  radius: number,
  variableRadius?: OccFilletVariableRadius,
  options: OccFilletOptions = {},
): Promise<BRepBody | null> {
  const { oc } = await getOcc();
  return occFilletWithInstance(oc, body, edgeIds, radius, variableRadius, options);
}

export function occFilletWithInstance(
  oc: OcctRaw,
  body: BRepBody,
  edgeIds: number[],
  radius: number,
  variableRadius?: OccFilletVariableRadius,
  options: OccFilletOptions = {},
): BRepBody | null {
  if (edgeIds.length === 0) return null;
  if (!variableRadius && radius <= 0) return null;
  return occFilletEdgeSetsWithInstance(oc, body, [{
    edgeIds,
    radius: variableRadius ? undefined : radius,
    startRadius: variableRadius?.start,
    endRadius: variableRadius?.end,
  }], options);
}

// ── Full-round fillet ─────────────────────────────────────────────────────────

export interface OccFullRoundFilletOptions {
  id?: string;
  sourceFeatureId?: string;
}

/**
 * Full-round fillet: replaces a narrow center face with a circular arc blend
 * tangent to both adjacent side faces. Equivalent to Fusion 360's
 * FullRoundFilletFaceSets.
 *
 * Algorithm:
 * 1. Build a canonical edge index over the whole shape (TopTools_IndexedMapOfShape).
 * 2. Walk center-face edges → record their canonical indices.
 * 3. Walk side-face edges → intersect with center-face edge indices to find the
 *    two shared boundary edges (one per side).
 * 4. Estimate the fillet radius from the edge midpoint separation (≈ half the
 *    distance between the two boundary lines), which is the inscribed-circle radius.
 * 5. Apply BRepFilletAPI_MakeFillet_2 to both boundary edges simultaneously —
 *    OCC resolves the full-round blend automatically when both edges are filleted
 *    with a radius that spans the center face.
 */
export function occFullRoundFilletWithInstance(
  oc: OcctRaw,
  body: BRepBody,
  centerFaceId: number,
  sideFaceIds: [number, number],
  options: OccFullRoundFilletOptions = {},
): BRepBody | null {
  const centerHandle = body.faceIds.get(centerFaceId);
  const side1Handle = body.faceIds.get(sideFaceIds[0]);
  const side2Handle = body.faceIds.get(sideFaceIds[1]);
  if (!centerHandle || !side1Handle || !side2Handle) {
    console.warn('[occFullRoundFillet] one or more face IDs not found in body');
    return null;
  }

  const occ = oc as OccFilletApi;
  const rawShape = occDeref(oc, body.shape, oc.TopoDS_Shape);
  const centerFaceRaw = oc.TopoDS.Face_1(occDeref(oc, centerHandle, oc.TopoDS_Shape));
  const side1FaceRaw = oc.TopoDS.Face_1(occDeref(oc, side1Handle, oc.TopoDS_Shape));
  const side2FaceRaw = oc.TopoDS.Face_1(occDeref(oc, side2Handle, oc.TopoDS_Shape));

  // Build a canonical edge index so we can compare edge identity across
  // different TopExp_Explorer passes (ptr comparison is unreliable due to
  // orientation wrappers; FindIndex_1 uses IsSame under the hood).
  const edgeMap = new occ.TopTools_IndexedMapOfShape_1();
  try {
    occ.TopExp.MapShapes_1(rawShape, oc.TopAbs_ShapeEnum.TopAbs_EDGE, edgeMap);
  } catch (e) {
    edgeMap.delete();
    console.warn('[occFullRoundFillet] TopExp.MapShapes failed:', e);
    return null;
  }

  // Collect canonical edge indices for each face.
  function faceEdgeIndices(faceShape: unknown): Set<number> {
    const result = new Set<number>();
    const exp = new occ.TopExp_Explorer_2(faceShape, oc.TopAbs_ShapeEnum.TopAbs_EDGE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
    while (exp.More()) {
      const e = exp.Current();
      const idx = edgeMap.FindIndex_1(e);
      if (idx > 0) result.add(idx);
      e.delete();
      exp.Next();
    }
    exp.delete();
    return result;
  }

  const centerIndices = faceEdgeIndices(centerFaceRaw);
  const side1Indices = faceEdgeIndices(side1FaceRaw);
  const side2Indices = faceEdgeIndices(side2FaceRaw);

  // Shared edges: center∩side1 and center∩side2
  const shared1 = [...centerIndices].filter(i => side1Indices.has(i));
  const shared2 = [...centerIndices].filter(i => side2Indices.has(i));

  if (shared1.length === 0 || shared2.length === 0) {
    edgeMap.delete();
    console.warn('[occFullRoundFillet] no shared edges found between center and side faces');
    return null;
  }

  // Estimate auto-radius: midpoint of edge1 ↔ midpoint of edge2, half that distance.
  function edgeMidpoint(edgeIdx: number): [number, number, number] | null {
    try {
      const edgeShape = edgeMap.FindKey_1(edgeIdx);
      const rawEdge = oc.TopoDS.Edge_1(edgeShape);
      const curve = new occ.BRepAdaptor_Curve_2(rawEdge);
      const t0 = curve.FirstParameter(), t1 = curve.LastParameter();
      const tMid = (t0 + t1) / 2;
      const pt = new occ.gp_Pnt_1();
      curve.D0(tMid, pt);
      const result: [number, number, number] = [pt.X(), pt.Y(), pt.Z()];
      pt.delete();
      curve.delete();
      return result;
    } catch {
      return null;
    }
  }

  const mp1 = edgeMidpoint(shared1[0]);
  const mp2 = edgeMidpoint(shared2[0]);
  let autoRadius = 2; // fallback
  if (mp1 && mp2) {
    const dx = mp2[0] - mp1[0], dy = mp2[1] - mp1[1], dz = mp2[2] - mp1[2];
    autoRadius = Math.max(0.001, Math.sqrt(dx * dx + dy * dy + dz * dz) / 2);
  }

  // Build edge set for both boundary edges (all canonical indices, first match each)
  // Use BRepBody edgeIds that correspond to these OCC indices.
  // We need the BRepBody integer ids for occFilletEdgeSetsWithInstance.
  // Walk body.edgeIds to find which body edge ids match our canonical indices.
  const bodyEdge1Ids: number[] = [];
  const bodyEdge2Ids: number[] = [];

  for (const [bodyEdgeId, edgeHandle] of body.edgeIds) {
    try {
      const rawEdge = occDeref(oc, edgeHandle, oc.TopoDS_Shape);
      const idx = edgeMap.FindIndex_1(rawEdge);
      if (shared1.includes(idx)) bodyEdge1Ids.push(bodyEdgeId);
      if (shared2.includes(idx)) bodyEdge2Ids.push(bodyEdgeId);
    } catch { /* skip */ }
  }

  edgeMap.delete();

  const allBodyEdgeIds = [...bodyEdge1Ids, ...bodyEdge2Ids];
  if (allBodyEdgeIds.length === 0) {
    console.warn('[occFullRoundFillet] could not map canonical edge indices to body edge IDs');
    return null;
  }

  return occFilletEdgeSetsWithInstance(oc, body, [{
    edgeIds: allBodyEdgeIds,
    radius: autoRadius,
  }], { id: options.id, sourceFeatureId: options.sourceFeatureId });
}
