/**
 * Shared BRep adjacency helpers used by fillet, chamfer, and other edge-mod ops.
 *
 * Identity comparison uses TopTools_IndexedMapOfShape canonical indices, not
 * raw ptr comparison — orientation wrappers produce different ptrs for the
 * same underlying shape.
 */
import type { OcctRaw } from '../types';
import { occDeref, type BRepBody, type BRepTopologyHandle } from '../brepBody';

type OccShapeRef = { ptr: number; delete(): void };

type OccAdjacencyApi = OcctRaw & {
  TopExp_Explorer_2: new (shape: unknown, toFind: unknown, toAvoid: unknown) => {
    More(): boolean;
    Current(): OccShapeRef;
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
  gp_Pnt_1: new () => { X(): number; Y(): number; Z(): number; delete(): void };
};

type IndexedShapeMap = {
  FindIndex_1?(shape: unknown): number;
  FindIndex?(shape: unknown): number;
};

export function findShapeIndex(map: IndexedShapeMap, shape: unknown): number {
  const fn = map.FindIndex_1 ?? map.FindIndex;
  return fn ? fn.call(map, shape) : 0;
}

type IndexedShapeMapWithFindKey = {
  FindKey_1?(idx: number): unknown;
  FindKey?(idx: number): unknown;
};

/** Defensive FindKey — opencascade.js WASM builds expose either FindKey_1 or FindKey. */
function findShapeByKey(map: IndexedShapeMapWithFindKey, idx: number): unknown | null {
  const fn = map.FindKey_1 ?? map.FindKey;
  return fn ? fn.call(map, idx) : null;
}

/**
 * Find a face in `body.faceIds` that shares the given edge.
 * Returns the BRepTopologyHandle (caller must deref to get raw face).
 * Used for two-distance chamfer + asymmetric fillet reference face selection.
 */
export function findAdjacentFace(
  oc: OcctRaw,
  body: BRepBody,
  rawShape: unknown,
  rawEdge: OccShapeRef,
): BRepTopologyHandle | undefined {
  const occ = oc as OccAdjacencyApi;

  const edgeMap = new occ.TopTools_IndexedMapOfShape_1();
  const faceMap = new occ.TopTools_IndexedMapOfShape_1();
  try {
    occ.TopExp.MapShapes_1(rawShape, oc.TopAbs_ShapeEnum.TopAbs_EDGE, edgeMap);
    occ.TopExp.MapShapes_1(rawShape, oc.TopAbs_ShapeEnum.TopAbs_FACE, faceMap);
  } catch {
    edgeMap.delete();
    faceMap.delete();
    return undefined;
  }

  const targetEdgeIdx = findShapeIndex(edgeMap, rawEdge);
  if (targetEdgeIdx <= 0) {
    edgeMap.delete();
    faceMap.delete();
    return undefined;
  }

  let faceExplorer: InstanceType<OccAdjacencyApi['TopExp_Explorer_2']> | null = null;
  try {
    faceExplorer = new occ.TopExp_Explorer_2(
      rawShape,
      oc.TopAbs_ShapeEnum.TopAbs_FACE,
      oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
    );
    while (faceExplorer.More()) {
      const faceShape = faceExplorer.Current();
      const edgeExp = new occ.TopExp_Explorer_2(
        faceShape,
        oc.TopAbs_ShapeEnum.TopAbs_EDGE,
        oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
      );
      let edgeFound = false;
      while (edgeExp.More()) {
        const e = edgeExp.Current();
        const idx = findShapeIndex(edgeMap, e);
        e.delete();
        if (idx === targetEdgeIdx) {
          edgeFound = true;
          edgeExp.delete();
          break;
        }
        edgeExp.Next();
      }
      if (!edgeFound) {
        edgeExp.delete();
        faceShape.delete();
        faceExplorer.Next();
        continue;
      }

      const targetFaceIdx = findShapeIndex(faceMap, faceShape);
      faceShape.delete();

      if (targetFaceIdx > 0) {
        for (const [, handle] of body.faceIds) {
          // rawFaceHandle is a VIEW from occDeref — do NOT delete.
          const rawFaceHandle = occDeref(oc, handle, oc.TopoDS_Shape) as OccShapeRef;
          const handleIdx = findShapeIndex(faceMap, rawFaceHandle);
          if (handleIdx === targetFaceIdx) {
            return handle;
          }
        }
      }

      faceExplorer.Next();
    }
  } catch { /* topology walk failed */ }
  finally {
    faceExplorer?.delete();
    edgeMap.delete();
    faceMap.delete();
  }
  return undefined;
}

/**
 * Walk the BRep topology and return all face handles in `body.faceIds` that
 * are adjacent to the center face (share at least one edge with it).
 * Used by full-round auto-side-face inference.
 */
export function findAdjacentFacesToFace(
  oc: OcctRaw,
  body: BRepBody,
  rawShape: unknown,
  centerFaceId: number,
): number[] {
  const occ = oc as OccAdjacencyApi;
  const centerHandle = body.faceIds.get(centerFaceId);
  if (!centerHandle) return [];

  const edgeMap = new occ.TopTools_IndexedMapOfShape_1();
  const faceMap = new occ.TopTools_IndexedMapOfShape_1();
  try {
    occ.TopExp.MapShapes_1(rawShape, oc.TopAbs_ShapeEnum.TopAbs_EDGE, edgeMap);
    occ.TopExp.MapShapes_1(rawShape, oc.TopAbs_ShapeEnum.TopAbs_FACE, faceMap);
  } catch {
    edgeMap.delete();
    faceMap.delete();
    return [];
  }

  // centerRaw is a VIEW from occDeref — do NOT delete.
  const centerRaw = occDeref(oc, centerHandle, oc.TopoDS_Shape) as OccShapeRef;
  const centerEdgeIndices = new Set<number>();
  let centerFaceIdx = -1;
  centerFaceIdx = findShapeIndex(faceMap, centerRaw);
  const centerExp = new occ.TopExp_Explorer_2(centerRaw, oc.TopAbs_ShapeEnum.TopAbs_EDGE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
  try {
    while (centerExp.More()) {
      const e = centerExp.Current();
      const idx = findShapeIndex(edgeMap, e);
      e.delete();
      if (idx > 0) centerEdgeIndices.add(idx);
      centerExp.Next();
    }
  } finally {
    centerExp.delete();
  }

  const adjacentBodyFaceIds: number[] = [];
  if (centerEdgeIndices.size === 0) {
    edgeMap.delete();
    faceMap.delete();
    return adjacentBodyFaceIds;
  }

  for (const [bodyFaceId, handle] of body.faceIds) {
    if (bodyFaceId === centerFaceId) continue;
    // faceRaw is a VIEW from occDeref — do NOT delete.
    const faceRaw = occDeref(oc, handle, oc.TopoDS_Shape) as OccShapeRef;
    const thisIdx = findShapeIndex(faceMap, faceRaw);
    if (thisIdx === centerFaceIdx) continue;
    const exp = new occ.TopExp_Explorer_2(faceRaw, oc.TopAbs_ShapeEnum.TopAbs_EDGE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
    let touches = false;
    while (exp.More()) {
      const e = exp.Current();
      const idx = findShapeIndex(edgeMap, e);
      e.delete();
      if (idx > 0 && centerEdgeIndices.has(idx)) {
        touches = true;
        exp.delete();
        break;
      }
      exp.Next();
    }
    if (!touches) exp.delete();
    if (touches) adjacentBodyFaceIds.push(bodyFaceId);
  }

  edgeMap.delete();
  faceMap.delete();
  return adjacentBodyFaceIds;
}

/**
 * Returns the set of edges tangentially connected to the given seed edges.
 * Two edges are "tangentially connected" when they share a vertex and their
 * curve tangents at that vertex are parallel within `tolerance` (|cos θ| > tol).
 *
 * BFS until no new edges are added. Returns the union seed ∪ tangent-chain
 * as body-edge IDs.
 */
export function collectTangentChainEdges(
  oc: OcctRaw,
  body: BRepBody,
  seedEdgeIds: number[],
  tolerance = 0.995,
): number[] {
  if (seedEdgeIds.length === 0) return seedEdgeIds;
  const occ = oc as OccAdjacencyApi;

  const rawShape = occDeref(oc, body.shape, oc.TopoDS_Shape);
  const edgeMap = new occ.TopTools_IndexedMapOfShape_1();
  const vertMap = new occ.TopTools_IndexedMapOfShape_1();
  try {
    occ.TopExp.MapShapes_1(rawShape, oc.TopAbs_ShapeEnum.TopAbs_EDGE, edgeMap);
    occ.TopExp.MapShapes_1(rawShape, oc.TopAbs_ShapeEnum.TopAbs_VERTEX, vertMap);
  } catch {
    edgeMap.delete();
    vertMap.delete();
    // rawShape is a VIEW from occDeref — do NOT delete.
    return [...new Set(seedEdgeIds)];
  }

  // Map bodyEdgeId ↔ canonical edge index.
  const bodyIdToCanonical = new Map<number, number>();
  const canonicalToBodyId = new Map<number, number>();
  let mapMisses = 0;
  for (const [bodyEdgeId, edgeHandle] of body.edgeIds) {
    const raw = occDeref(oc, edgeHandle, oc.TopoDS_Shape) as OccShapeRef;
    // raw is a VIEW from occDeref — do NOT delete.
    const idx = findShapeIndex(edgeMap, raw);
    if (idx > 0) {
      bodyIdToCanonical.set(bodyEdgeId, idx);
      canonicalToBodyId.set(idx, bodyEdgeId);
    } else {
      mapMisses++;
    }
  }
  // For each canonical edge index, compute endpoint vertex indices and tangents.
  interface EdgeInfo {
    vStart: number;
    vEnd: number;
    tangentStart: [number, number, number];
    tangentEnd: [number, number, number];
  }
  const edgeInfo = new Map<number, EdgeInfo>();

  function getEdgeInfo(canonicalIdx: number): EdgeInfo | null {
    const cached = edgeInfo.get(canonicalIdx);
    if (cached) return cached;
    const trash: Array<{ delete?: () => void }> = [];
    const dispose = () => {
      for (let i = trash.length - 1; i >= 0; i--) {
        try { trash[i].delete?.(); } catch { /* already freed */ }
      }
    };
    try {
      const edgeShape = findShapeByKey(edgeMap, canonicalIdx) as { delete?: () => void } | null;
      if (!edgeShape) return null;
      trash.push(edgeShape);
      const rawEdge = oc.TopoDS.Edge_1(edgeShape) as { delete?: () => void };
      trash.push(rawEdge);
      const curve = new occ.BRepAdaptor_Curve_2(rawEdge);
      trash.push(curve);
      const t0 = curve.FirstParameter();
      const t1 = curve.LastParameter();
      const dt = Math.max(1e-6, (t1 - t0) * 0.01);
      const p0 = new occ.gp_Pnt_1(); trash.push(p0); curve.D0(t0, p0);
      const p1 = new occ.gp_Pnt_1(); trash.push(p1); curve.D0(t0 + dt, p1);
      const p2 = new occ.gp_Pnt_1(); trash.push(p2); curve.D0(t1 - dt, p2);
      const p3 = new occ.gp_Pnt_1(); trash.push(p3); curve.D0(t1, p3);
      const tsx = p1.X() - p0.X(), tsy = p1.Y() - p0.Y(), tsz = p1.Z() - p0.Z();
      const tex = p3.X() - p2.X(), tey = p3.Y() - p2.Y(), tez = p3.Z() - p2.Z();
      const lenS = Math.sqrt(tsx * tsx + tsy * tsy + tsz * tsz) || 1;
      const lenE = Math.sqrt(tex * tex + tey * tey + tez * tez) || 1;

      let vStart = -1, vEnd = -1;
      const vexp = new occ.TopExp_Explorer_2(rawEdge, oc.TopAbs_ShapeEnum.TopAbs_VERTEX, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
      trash.push(vexp);
      const verts: number[] = [];
      while (vexp.More() && verts.length < 2) {
        const v = vexp.Current();
        const vIdx = findShapeIndex(vertMap, v);
        v.delete();
        if (vIdx > 0) verts.push(vIdx);
        vexp.Next();
      }
      if (verts.length >= 1) vStart = verts[0];
      if (verts.length >= 2) vEnd = verts[1]; else vEnd = vStart;

      const info: EdgeInfo = {
        vStart,
        vEnd,
        tangentStart: [tsx / lenS, tsy / lenS, tsz / lenS],
        tangentEnd: [tex / lenE, tey / lenE, tez / lenE],
      };
      edgeInfo.set(canonicalIdx, info);
      return info;
    } catch (err) {
      if (!getEdgeInfo._warned) {
        console.warn(`[tangentChain] getEdgeInfo(${canonicalIdx}) threw:`, err);
        getEdgeInfo._warned = true;
      }
      return null;
    } finally {
      dispose();
    }
  }
  getEdgeInfo._warned = false;

  // Build a vertex → incident edges index over all body edges.
  const vertexToEdges = new Map<number, number[]>();
  for (const canonicalIdx of canonicalToBodyId.keys()) {
    const info = getEdgeInfo(canonicalIdx);
    if (!info) continue;
    for (const v of [info.vStart, info.vEnd]) {
      if (v < 0) continue;
      const list = vertexToEdges.get(v);
      if (list) list.push(canonicalIdx);
      else vertexToEdges.set(v, [canonicalIdx]);
    }
  }

  function isTangentAtVertex(infoA: EdgeInfo, infoB: EdgeInfo, sharedVertex: number): boolean {
    const ta = sharedVertex === infoA.vStart ? infoA.tangentStart : infoA.tangentEnd;
    const tb = sharedVertex === infoB.vStart ? infoB.tangentStart : infoB.tangentEnd;
    const dot = ta[0] * tb[0] + ta[1] * tb[1] + ta[2] * tb[2];
    return Math.abs(dot) > tolerance;
  }

  // BFS over the tangent-chain graph.
  const visited = new Set<number>();
  const queue: number[] = [];
  for (const bodyEdgeId of seedEdgeIds) {
    const cIdx = bodyIdToCanonical.get(bodyEdgeId);
    if (cIdx !== undefined && !visited.has(cIdx)) {
      visited.add(cIdx);
      queue.push(cIdx);
    }
  }

  while (queue.length > 0) {
    const cur = queue.shift()!;
    const info = getEdgeInfo(cur);
    if (!info) continue;
    for (const v of [info.vStart, info.vEnd]) {
      if (v < 0) continue;
      const neighbors = vertexToEdges.get(v);
      if (!neighbors) continue;
      for (const nb of neighbors) {
        if (visited.has(nb)) continue;
        const nbInfo = getEdgeInfo(nb);
        if (!nbInfo) continue;
        if (isTangentAtVertex(info, nbInfo, v)) {
          visited.add(nb);
          queue.push(nb);
        }
      }
    }
  }

  edgeMap.delete();
  vertMap.delete();
  // rawShape is a VIEW from occDeref — do NOT delete.

  const result: number[] = [];
  for (const cIdx of visited) {
    const bodyId = canonicalToBodyId.get(cIdx);
    if (bodyId !== undefined) result.push(bodyId);
  }
  return result;
}

/**
 * Returns all body-edge IDs that belong to the given face.
 * Used by rule-fillet AllEdges mode.
 */
export function collectFaceEdgeIds(
  oc: OcctRaw,
  body: BRepBody,
  faceId: number,
): number[] {
  const occ = oc as OccAdjacencyApi;
  const faceHandle = body.faceIds.get(faceId);
  if (!faceHandle) return [];

  // rawShape and faceRaw are VIEWs from occDeref — do NOT delete.
  const rawShape = occDeref(oc, body.shape, oc.TopoDS_Shape);
  const faceRaw = occDeref(oc, faceHandle, oc.TopoDS_Shape) as OccShapeRef;
  const edgeMap = new occ.TopTools_IndexedMapOfShape_1();

  try {
    occ.TopExp.MapShapes_1(rawShape, oc.TopAbs_ShapeEnum.TopAbs_EDGE, edgeMap);
  } catch {
    edgeMap.delete();
    return [];
  }

  const faceEdgeIndices = new Set<number>();
  const exp = new occ.TopExp_Explorer_2(faceRaw, oc.TopAbs_ShapeEnum.TopAbs_EDGE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
  try {
    while (exp.More()) {
      const e = exp.Current();
      const idx = findShapeIndex(edgeMap, e);
      e.delete();
      if (idx > 0) faceEdgeIndices.add(idx);
      exp.Next();
    }
  } finally {
    exp.delete();
  }

  const result: number[] = [];
  for (const [bodyEdgeId, edgeHandle] of body.edgeIds) {
    // raw is a VIEW from occDeref — do NOT delete.
    const raw = occDeref(oc, edgeHandle, oc.TopoDS_Shape) as OccShapeRef;
    const idx = findShapeIndex(edgeMap, raw);
    if (idx > 0 && faceEdgeIndices.has(idx)) result.push(bodyEdgeId);
  }

  edgeMap.delete();
  return result;
}

/**
 * Returns body-edge IDs that are shared between any face in `groupA` and any face in `groupB`.
 * Used by rule-fillet BetweenFaces mode.
 */
export function collectSharedEdgeIds(
  oc: OcctRaw,
  body: BRepBody,
  groupA: number[],
  groupB: number[],
): number[] {
  if (groupA.length === 0 || groupB.length === 0) return [];
  const occ = oc as OccAdjacencyApi;

  // rawShape is a VIEW from occDeref — do NOT delete.
  const rawShape = occDeref(oc, body.shape, oc.TopoDS_Shape);
  const edgeMap = new occ.TopTools_IndexedMapOfShape_1();
  try {
    occ.TopExp.MapShapes_1(rawShape, oc.TopAbs_ShapeEnum.TopAbs_EDGE, edgeMap);
  } catch {
    edgeMap.delete();
    return [];
  }

  function faceEdgeIndices(faceId: number): Set<number> {
    const handle = body.faceIds.get(faceId);
    if (!handle) return new Set();
    // faceRaw is a VIEW from occDeref — do NOT delete.
    const faceRaw = occDeref(oc, handle, oc.TopoDS_Shape) as OccShapeRef;
    const set = new Set<number>();
    const exp = new occ.TopExp_Explorer_2(faceRaw, oc.TopAbs_ShapeEnum.TopAbs_EDGE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
    try {
      while (exp.More()) {
        const e = exp.Current();
        const idx = findShapeIndex(edgeMap, e);
        e.delete();
        if (idx > 0) set.add(idx);
        exp.Next();
      }
    } finally {
      exp.delete();
    }
    return set;
  }

  const aIndices = new Set<number>();
  for (const f of groupA) for (const i of faceEdgeIndices(f)) aIndices.add(i);
  const bIndices = new Set<number>();
  for (const f of groupB) for (const i of faceEdgeIndices(f)) bIndices.add(i);

  const sharedCanonical = new Set<number>();
  for (const i of aIndices) if (bIndices.has(i)) sharedCanonical.add(i);

  const result: number[] = [];
  for (const [bodyEdgeId, edgeHandle] of body.edgeIds) {
    // raw is a VIEW from occDeref — do NOT delete.
    const raw = occDeref(oc, edgeHandle, oc.TopoDS_Shape) as OccShapeRef;
    const idx = findShapeIndex(edgeMap, raw);
    if (idx > 0 && sharedCanonical.has(idx)) result.push(bodyEdgeId);
  }

  edgeMap.delete();
  return result;
}
