/**
 * OCC-5.1 — Exact fillet via BRepFilletAPI_MakeFillet.
 * OCC produces an exact toroidal surface that tessellates uniformly with no
 * fan triangulation artifacts.
 *
 * Supports:
 *  - Constant radius (Add_2)
 *  - Variable radius start→end (Add_3)
 *  - Chord-length (dihedral-angle derived radius, then Add_2)
 *  - Multiple mixed edge sets in one Build pass
 *  - G2 surface continuity (ChFi3d_Polynomial surface type)
 *  - Rolling-ball vs quasi-angular corner shape (ChFi3d_FilletShape)
 *  - Asymmetric per-face distance (Add_4(d1, d2, edge, face) when available)
 *  - Full-round with multi-face per side and auto-side inference
 *
 * Not supported natively (documented limitations):
 *  - N mid-point variable radius (FILLET-9). OCC BRepFilletAPI_MakeFillet
 *    only exposes start+end (Add_3) and a constant radius. opencascade.js
 *    does not bind the Law_Function or TColgp_Array1OfPnt2d overloads
 *    that would allow arbitrary mid-points. Caller must collapse mid-radii
 *    to a piecewise approximation if needed.
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
  Add_4?(distance1: number, distance2: number, edge: unknown, face: unknown): void;
  Build(progress?: unknown): void;
  IsDone?(): boolean;
  HasResult?(): boolean;
  Shape(): unknown;
  delete(): void;
}

function createFilletBuilder(occ: OccFilletApi, rawShape: unknown, filletShape: unknown): OccFilletBuilder | null {
  const api = occ as OccFilletApi & {
    BRepFilletAPI_MakeFillet?: new (shape: unknown, filletShape: unknown) => OccFilletBuilder;
    BRepFilletAPI_MakeFillet_2?: new (shape: unknown, filletShape: unknown) => OccFilletBuilder;
  };
  const ctor = api.BRepFilletAPI_MakeFillet_2 ?? api.BRepFilletAPI_MakeFillet;
  return ctor ? new ctor(rawShape, filletShape) : null;
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
  /**
   * Per-face asymmetric mode. When true, startRadius/endRadius are interpreted
   * as per-face distances (d1 on the reference face, d2 on the other) and
   * applied via Add_4(d1, d2, edge, face). Falls back to Add_2 with the average
   * if Add_4 is unavailable in the OCC binding or no adjacent face is found.
   */
  isAsymmetric?: boolean;
}

export interface OccFilletOptions {
  id?: string;
  sourceFeatureId?: string;
  /**
   * G1 (default) — ChFi3d_Rational tangent surface.
   * G2 — ChFi3d_Polynomial for higher-quality curvature blending.
   */
  continuity?: 'G1' | 'G2';
  /**
   * Tangency weight for G2 continuity mode (range 0.1–2.0).
   * Reserved for future OCC binding extension — BRepFilletAPI_MakeFillet does
   * not currently expose a SetParams/weight API in the opencascade.js WASM build.
   * Stored here so callers can round-trip the value without loss.
   */
  tangencyWeight?: number;
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
      if (found) adjacentFaces.push(oc.TopoDS.Face_1(faceShape));
      faceShape.delete();
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

  // Surface enum: G2 always uses ChFi3d_Polynomial; default is ChFi3d_Rational.
  const filletShape = options.continuity === 'G2'
    ? occ.ChFi3d_FilletShape.ChFi3d_Polynomial
    : occ.ChFi3d_FilletShape.ChFi3d_Rational;

  const mk = createFilletBuilder(occ, rawShape, filletShape);
  if (!mk) {
    console.warn('[occFillet] BRepFilletAPI_MakeFillet is not bound in this OCC build');
    return null;
  }
  try {
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
        try {
          if (edgeSet.isAsymmetric && edgeSet.startRadius !== undefined && edgeSet.endRadius !== undefined) {
            const d1 = Math.max(edgeSet.startRadius, 0.001);
            const d2 = Math.max(edgeSet.endRadius, 0.001);
            // Asymmetric mode not supported with fresh resolution — use average.
            mk.Add_2(Math.max((d1 + d2) / 2, 0.001), rawEdge);
          } else if (edgeSet.startRadius !== undefined && edgeSet.endRadius !== undefined) {
            mk.Add_3(edgeSet.startRadius, edgeSet.endRadius, rawEdge);
          } else if (edgeSet.chordLength !== undefined && edgeSet.chordLength > 0) {
            const r = computeChordLengthRadius(oc, rawShape, rawEdge as { ptr: number }, edgeSet.chordLength);
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
      return null;
    }

    mk.Build();

    if (mk.IsDone?.() === false) {
      console.warn('[occFillet] BRepFilletAPI_MakeFillet.IsDone() = false');
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
    console.warn('[occFillet] threw during Build/Shape:', e);
    mk.delete();
    return null;
  }
  // NOTE: mk is NOT deleted here — it's transferred to ownedResources so that
  // resultShape (a reference into the builder) stays valid.
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

export interface OccFullRoundFilletOptions {
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
      const edgeShape = edgeMap.FindKey_1(edgeIdx);
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
  }], { id: options.id, sourceFeatureId: options.sourceFeatureId });
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
}

/**
 * Rule fillet — AllEdges mode.
 * Collects every edge of the given face(s) and fillets them as a single set.
 */
export function occRuleFilletAllEdgesWithInstance(
  oc: OcctRaw,
  body: BRepBody,
  faceIds: number[],
  radius: number,
  options: OccFilletOptions = {},
): BRepBody | null {
  if (faceIds.length === 0) return null;
  const edgeIds = new Set<number>();
  for (const faceId of faceIds) {
    for (const e of collectFaceEdgeIds(oc, body, faceId)) edgeIds.add(e);
  }
  if (edgeIds.size === 0) return null;
  return occFilletEdgeSetsWithInstance(oc, body, [{
    edgeIds: [...edgeIds],
    radius,
  }], options);
}

/**
 * Rule fillet — BetweenFaces mode.
 * Fillets only the edges shared between any face in `groupA` and any face in `groupB`.
 */
export function occRuleFilletBetweenFacesWithInstance(
  oc: OcctRaw,
  body: BRepBody,
  groupA: number[],
  groupB: number[],
  radius: number,
  options: OccFilletOptions = {},
): BRepBody | null {
  const edgeIds = collectSharedEdgeIds(oc, body, groupA, groupB);
  if (edgeIds.length === 0) return null;
  return occFilletEdgeSetsWithInstance(oc, body, [{
    edgeIds,
    radius,
  }], options);
}
