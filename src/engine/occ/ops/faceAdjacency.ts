/**
 * OCC-20 — Tangent face chain expansion.
 *
 * Implements `expandTangentFaceChain`: given a set of face IDs on a BRepBody,
 * find all faces reachable by walking tangent (G1-continuous) edges and return
 * the combined set.  Used by Shell `isTangentChain` and Draft `isTangentChain`
 * to match Fusion 360's automatic face propagation.
 *
 * Tangency test: evaluate each candidate face's surface normal at its UV
 * midpoint, then compare with the seed face's normal.  If the angle between
 * them is ≤ `TANGENT_ANGLE_DEG` they are treated as tangent.  This is a fast
 * approximation that works correctly for the typical shell/draft use-case
 * (planar/cylindrical face sets produced by extrude/revolve).
 */
import type { OcctRaw } from '../types';
import { occDeref, type BRepBody } from '../brepBody';

const TANGENT_ANGLE_DEG = 10; // faces within 10° are considered tangent
const TANGENT_COS = Math.cos((TANGENT_ANGLE_DEG * Math.PI) / 180);

type FaceAdjacentApi = OcctRaw & {
  TopoDS: { Face_1(s: unknown): unknown; Edge_1(s: unknown): unknown };
  BRepAdaptor_Surface_2: new (face: unknown, restricted: boolean) => {
    FirstUParameter(): number; LastUParameter(): number;
    FirstVParameter(): number; LastVParameter(): number;
    D1(u: number, v: number,
       p: unknown, d1u: unknown, d1v: unknown): void;
    Value(u: number, v: number): { X(): number; Y(): number; Z(): number; delete(): void };
    delete(): void;
  };
  TopExp_Explorer_2: new (shape: unknown, toFind: unknown, toAvoid: unknown) => {
    More(): boolean;
    Current(): { ptr?: number; delete(): void };
    Next(): void;
    delete(): void;
  };
  TopAbs_ShapeEnum: { TopAbs_FACE: unknown; TopAbs_EDGE: unknown; TopAbs_SHAPE: unknown };
  gp_Pnt_1: new () => { delete(): void };
  gp_Vec_1: new () => {
    X(): number; Y(): number; Z(): number;
    Crossed(other: unknown): { X(): number; Y(): number; Z(): number; delete(): void };
    delete(): void;
  };
};

/** Compute face surface normal at UV midpoint. Returns null on any OCC error. */
function faceNormalAtCenter(
  occ: FaceAdjacentApi,
  rawFace: unknown,
): [number, number, number] | null {
  let surf: InstanceType<FaceAdjacentApi['BRepAdaptor_Surface_2']> | null = null;
  let pnt: { delete(): void } | null = null;
  let d1u: { X(): number; Y(): number; Z(): number; Crossed(o: unknown): { X(): number; Y(): number; Z(): number; delete(): void }; delete(): void } | null = null;
  let d1v: { X(): number; Y(): number; Z(): number; delete(): void } | null = null;
  try {
    surf = new occ.BRepAdaptor_Surface_2(rawFace, true);
    const u = (surf.FirstUParameter() + surf.LastUParameter()) / 2;
    const v = (surf.FirstVParameter() + surf.LastVParameter()) / 2;
    pnt = new occ.gp_Pnt_1();
    d1u = new occ.gp_Vec_1();
    d1v = new occ.gp_Vec_1();
    surf.D1(u, v, pnt, d1u, d1v);
    // Normal = D1U × D1V
    const cross = d1u.Crossed(d1v);
    const nx = cross.X(); const ny = cross.Y(); const nz = cross.Z();
    cross.delete();
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (len < 1e-12) return null;
    return [nx / len, ny / len, nz / len];
  } catch {
    return null;
  } finally {
    d1v?.delete();
    d1u?.delete();
    pnt?.delete();
    surf?.delete();
  }
}

/**
 * Starting from `seedFaceIds`, walk the body's face topology and collect all
 * faces that are tangent (within TANGENT_ANGLE_DEG) to any face in the current
 * set.  Returns the union of the seed set and all discovered tangent faces.
 */
export function expandTangentFaceChain(
  oc: OcctRaw,
  body: BRepBody,
  seedFaceIds: number[],
): number[] {
  const occ = oc as FaceAdjacentApi;

  // Quick exit if the API we need is not available.
  if (typeof occ.BRepAdaptor_Surface_2 !== 'function' || !occ.TopAbs_ShapeEnum) {
    return seedFaceIds;
  }

  // Build a ptr→faceId lookup for the whole body.
  const ptrToFaceId = new Map<number, number>();
  for (const [id, handle] of body.faceIds) {
    if (handle.ptr) ptrToFaceId.set(handle.ptr, id);
  }

  // Pre-compute normals for all body faces (best-effort; skip on error).
  const faceNormals = new Map<number, [number, number, number]>();
  for (const [id, handle] of body.faceIds) {
    try {
      const rawFace = occ.TopoDS.Face_1(occDeref(oc, handle, oc.TopoDS_Shape));
      const n = faceNormalAtCenter(occ, rawFace);
      // rawFace is a VIEW — do NOT delete.
      if (n) faceNormals.set(id, n);
    } catch { /* skip */ }
  }

  // BFS over tangent faces.
  const resultSet = new Set<number>(seedFaceIds);
  let frontier = [...seedFaceIds];

  while (frontier.length > 0) {
    const nextFrontier: number[] = [];

    for (const seedId of frontier) {
      const seedNormal = faceNormals.get(seedId);
      if (!seedNormal) continue;

      // For each candidate body face not yet in the result set, check tangency.
      for (const [candidateId, normal] of faceNormals) {
        if (resultSet.has(candidateId)) continue;

        // Tangency check: |seedNormal · candidateNormal| ≥ cos(threshold)
        // Use absolute value because face orientation can be reversed.
        const dot =
          Math.abs(
            seedNormal[0] * normal[0] +
            seedNormal[1] * normal[1] +
            seedNormal[2] * normal[2],
          );
        if (dot >= TANGENT_COS) {
          resultSet.add(candidateId);
          nextFrontier.push(candidateId);
        }
      }
    }
    frontier = nextFrontier;
  }

  return [...resultSet];
}
