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
 * Counts how many distinct faces of `rawShape` contain `rawEdge` in their wire.
 * Regular corner edges → 2; seam edges on analytic surfaces (cylinder/torus) → 1;
 * free boundary edges → 1 (open shells). BRepFilletAPI_Make* throws on < 2.
 * Returns 2 on any topology error so a valid edge is never skipped.
 *
 * `edgeMap` must already be populated via TopExp.MapShapes(rawShape, EDGE, edgeMap).
 */
export function countAdjacentFacesForEdge(
  oc: OcctRaw,
  rawShape: unknown,
  edgeMap: IndexedShapeMap,
  rawEdge: unknown,
): number {
  const occ = oc as OccAdjacencyApi;
  try {
    const targetIdx = findShapeIndex(edgeMap, rawEdge);
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
            const idx = findShapeIndex(edgeMap, e);
            e.delete();
            if (idx === targetIdx) { found = true; break; }
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
    return 2;
  }
}

/**
 * Run BRepFilletAPI_Make{Fillet,Chamfer}.Build() across opencascade.js binding
 * variants: some builds require a Message_ProgressRange argument, others reject
 * it ("expected 0 args"). Tries the progress form first, then the no-arg form.
 */
export function runEdgeOpBuild(
  oc: OcctRaw,
  mk: { Build(progress?: unknown): void },
): void {
  const occ = oc as OcctRaw & { Message_ProgressRange_1?: new () => { delete?: () => void } };
  if (typeof occ.Message_ProgressRange_1 === 'function') {
    const progress = new occ.Message_ProgressRange_1();
    try {
      mk.Build(progress);
      return;
    } catch (err) {
      const message = err instanceof Error ? err.message : String((err as { message?: unknown })?.message ?? err);
      if (!message.includes('expected 0 args')) throw err;
    } finally {
      progress.delete?.();
    }
  }
  mk.Build();
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
  const centerFaceIdx = findShapeIndex(faceMap, centerRaw);
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
  for (const [bodyEdgeId, edgeHandle] of body.edgeIds) {
    const raw = occDeref(oc, edgeHandle, oc.TopoDS_Shape) as OccShapeRef;
    // raw is a VIEW from occDeref — do NOT delete.
    const idx = findShapeIndex(edgeMap, raw);
    if (idx > 0) {
      bodyIdToCanonical.set(bodyEdgeId, idx);
      canonicalToBodyId.set(idx, bodyEdgeId);
    } // else: edge not in map (expected for degenerate edges)
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
      // Keep vertex shapes alive so we can look up positions for correct t0/t1 assignment.
      // TopExp walk order is NOT guaranteed to match parameter order; we sort by comparing
      // vertex positions (via BRep_Tool.Pnt) with the already-computed D0(t0) endpoint.
      const vertShapes: Array<{ idx: number; shape: { delete(): void } }> = [];
      while (vexp.More() && vertShapes.length < 2) {
        const v = vexp.Current(); // OWNED
        const vIdx = findShapeIndex(vertMap, v);
        if (vIdx > 0) vertShapes.push({ idx: vIdx, shape: v });
        else v.delete();
        vexp.Next();
      }
      if (vertShapes.length >= 1) {
        const brep = oc as OcctRaw & {
          BRep_Tool?: { Pnt(v: unknown): { X(): number; Y(): number; Z(): number; delete(): void } };
        };
        let assigned = false;
        if (vertShapes.length === 2 && typeof brep.BRep_Tool?.Pnt === 'function') {
          try {
            // TopoDS.Vertex_1 returns a VIEW (same ptr) — do NOT delete.
            const vs1: unknown = oc.TopoDS.Vertex_1 ? oc.TopoDS.Vertex_1(vertShapes[0].shape) : vertShapes[0].shape;
            const vs2: unknown = oc.TopoDS.Vertex_1 ? oc.TopoDS.Vertex_1(vertShapes[1].shape) : vertShapes[1].shape;
            const pos1 = brep.BRep_Tool.Pnt(vs1);
            const pos2 = brep.BRep_Tool.Pnt(vs2);
            // p0 = D0(t0): compare each vertex with the curve's first-parameter endpoint.
            const d1 = Math.hypot(pos1.X() - p0.X(), pos1.Y() - p0.Y(), pos1.Z() - p0.Z());
            const d2 = Math.hypot(pos2.X() - p0.X(), pos2.Y() - p0.Y(), pos2.Z() - p0.Z());
            pos1.delete(); pos2.delete();
            vStart = d1 <= d2 ? vertShapes[0].idx : vertShapes[1].idx;
            vEnd   = d1 <= d2 ? vertShapes[1].idx : vertShapes[0].idx;
            assigned = true;
          } catch { /* fall through */ }
        }
        if (!assigned) {
          // Fallback to walk order (often correct for well-formed BRep, but not guaranteed).
          vStart = vertShapes[0].idx;
          vEnd = vertShapes.length >= 2 ? vertShapes[1].idx : vStart;
        }
      }
      // Delete vertex shapes now that position lookup is done.
      for (const vd of vertShapes) { try { vd.shape.delete(); } catch { /* already freed */ } }

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
 * Returns all body-edge IDs that share a vertex with any seed edge but are
 * NOT themselves in the seed set.
 *
 * Used by the fillet corner-aware fallback (OCC-13.3): when OCC fails to
 * compute a corner blend in a combined pass, auto-including the non-filleted
 * edges adjacent to each seed-edge vertex at the same radius lets OCC close
 * the corner in a single build call.
 */
export function collectVertexNeighborEdges(
  oc: OcctRaw,
  body: BRepBody,
  seedEdgeIds: number[],
): number[] {
  if (seedEdgeIds.length === 0) return [];
  const occ = oc as OccAdjacencyApi;

  // rawShape is a VIEW from occDeref — do NOT delete.
  const rawShape = occDeref(oc, body.shape, oc.TopoDS_Shape);
  const edgeMap = new occ.TopTools_IndexedMapOfShape_1();
  const vertMap = new occ.TopTools_IndexedMapOfShape_1();
  try {
    occ.TopExp.MapShapes_1(rawShape, oc.TopAbs_ShapeEnum.TopAbs_EDGE, edgeMap);
    occ.TopExp.MapShapes_1(rawShape, oc.TopAbs_ShapeEnum.TopAbs_VERTEX, vertMap);
  } catch {
    edgeMap.delete();
    vertMap.delete();
    return [];
  }

  // Map body-edge IDs ↔ canonical edge indices.
  const bodyIdToCanonical = new Map<number, number>();
  const canonicalToBodyId = new Map<number, number>();
  for (const [bodyEdgeId, edgeHandle] of body.edgeIds) {
    // raw is a VIEW from occDeref — do NOT delete.
    const raw = occDeref(oc, edgeHandle, oc.TopoDS_Shape) as OccShapeRef;
    const idx = findShapeIndex(edgeMap, raw);
    if (idx > 0) {
      bodyIdToCanonical.set(bodyEdgeId, idx);
      canonicalToBodyId.set(idx, bodyEdgeId);
    }
  }

  const seedCanonical = new Set<number>();
  for (const bodyId of seedEdgeIds) {
    const cIdx = bodyIdToCanonical.get(bodyId);
    if (cIdx !== undefined) seedCanonical.add(cIdx);
  }

  // Build vertex → incident canonical-edge-index list.
  // FindKey_1 and TopoDS.Edge_1 return VIEWs — do NOT delete them.
  const vertexToCanonical = new Map<number, number[]>();
  for (const cIdx of canonicalToBodyId.keys()) {
    const edgeShapeView = findShapeByKey(edgeMap, cIdx);
    if (!edgeShapeView) continue;
    let rawEdge: unknown;
    try { rawEdge = oc.TopoDS.Edge_1(edgeShapeView); }
    catch { continue; }
    const vexp = new occ.TopExp_Explorer_2(rawEdge, oc.TopAbs_ShapeEnum.TopAbs_VERTEX, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
    try {
      while (vexp.More()) {
        const v = vexp.Current(); // OWNED — must delete
        const vIdx = findShapeIndex(vertMap, v);
        v.delete();
        if (vIdx > 0) {
          const list = vertexToCanonical.get(vIdx);
          if (list) list.push(cIdx);
          else vertexToCanonical.set(vIdx, [cIdx]);
        }
        vexp.Next();
      }
    } finally {
      vexp.delete();
    }
  }

  // Collect vertex neighbors of every seed edge (excluding seeds themselves).
  const neighborCanonical = new Set<number>();
  for (const cIdx of seedCanonical) {
    const edgeShapeView = findShapeByKey(edgeMap, cIdx);
    if (!edgeShapeView) continue;
    let rawEdge: unknown;
    try { rawEdge = oc.TopoDS.Edge_1(edgeShapeView); }
    catch { continue; }
    const vexp = new occ.TopExp_Explorer_2(rawEdge, oc.TopAbs_ShapeEnum.TopAbs_VERTEX, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
    try {
      while (vexp.More()) {
        const v = vexp.Current(); // OWNED — must delete
        const vIdx = findShapeIndex(vertMap, v);
        v.delete();
        if (vIdx > 0) {
          for (const nb of (vertexToCanonical.get(vIdx) ?? [])) {
            if (!seedCanonical.has(nb)) neighborCanonical.add(nb);
          }
        }
        vexp.Next();
      }
    } finally {
      vexp.delete();
    }
  }

  edgeMap.delete();
  vertMap.delete();

  const result: number[] = [];
  for (const cIdx of neighborCanonical) {
    const bodyId = canonicalToBodyId.get(cIdx);
    if (bodyId !== undefined) result.push(bodyId);
  }
  return result;
}

// ── OCC-16: vertex-edge topology helpers for fillet ordering ─────────────────

/**
 * Maps each vertex (keyed by "x,y,z" rounded to 3 dp) to the set of body-edge
 * IDs incident on it.  Uses body.edgeIds keys — same CRITICAL constraint as
 * selectableEdges.ts (never a fresh TopExp index that would disagree with
 * the stored body edge IDs).
 *
 * Disposal: all TopTools maps/explorers we create are OWNED → .delete().
 * occDeref VIEWs (rawShape, edge raws, vertex raws from TopoDS.cast) are NOT deleted.
 */
export type VertexEdgeMap = Map<string, Set<number>>;

export function buildVertexEdgeMap(
  oc: OcctRaw,
  body: BRepBody,
): VertexEdgeMap {
  const occ = oc as OccAdjacencyApi;
  const result: VertexEdgeMap = new Map();

  // rawShape is a VIEW from occDeref — do NOT delete.
  const rawShape = occDeref(oc, body.shape, oc.TopoDS_Shape);
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

  // Map body edge IDs to canonical indices.
  const bodyIdToCanonical = new Map<number, number>();
  for (const [bodyEdgeId, edgeHandle] of body.edgeIds) {
    // raw is a VIEW from occDeref — do NOT delete.
    const raw = occDeref(oc, edgeHandle, oc.TopoDS_Shape) as { ptr: number; delete(): void };
    const idx = findShapeIndex(edgeMap, raw);
    if (idx > 0) bodyIdToCanonical.set(bodyEdgeId, idx);
  }

  // For each body edge, walk its vertices and build the map.
  for (const bodyEdgeId of body.edgeIds.keys()) {
    const canonicalIdx = bodyIdToCanonical.get(bodyEdgeId);
    if (canonicalIdx === undefined) continue;

    const edgeShapeView = findShapeByKey(edgeMap, canonicalIdx);
    if (!edgeShapeView) continue;

    let rawEdge: unknown;
    try { rawEdge = oc.TopoDS.Edge_1(edgeShapeView); }
    catch { continue; }

    const vexp = new occ.TopExp_Explorer_2(rawEdge, oc.TopAbs_ShapeEnum.TopAbs_VERTEX, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
    try {
      while (vexp.More()) {
        const v = vexp.Current(); // OWNED — must delete
        const vIdx = findShapeIndex(vertMap, v);
        // Get stable coordinate key for this vertex (3 dp rounding).
        let key: string | null = null;
        if (vIdx > 0) {
          const vertShapeView = findShapeByKey(vertMap, vIdx);
          if (vertShapeView) {
            try {
              // BRep_Tool.Pnt is the only reliable way to get the vertex coordinate.
              // If it is unavailable, leave key=null: we skip the vertex rather than
              // inserting a `v${vIdx}` fallback key that can never match a coordinate
              // key from another call, producing spurious "no shared vertex" results.
              const brep = oc as OcctRaw & { BRep_Tool?: { Pnt(v: unknown): { X(): number; Y(): number; Z(): number; delete(): void } } };
              if (typeof brep.BRep_Tool?.Pnt === 'function') {
                const rawVertex = oc.TopoDS.Vertex_1
                  ? oc.TopoDS.Vertex_1(vertShapeView)
                  : vertShapeView;
                const p = brep.BRep_Tool.Pnt(rawVertex);
                key = `${p.X().toFixed(3)},${p.Y().toFixed(3)},${p.Z().toFixed(3)}`;
                p.delete();
              }
            } catch { /* skip vertex if position lookup fails */ }
          }
        }
        v.delete();
        if (key) {
          const set = result.get(key);
          if (set) set.add(bodyEdgeId);
          else result.set(key, new Set([bodyEdgeId]));
        }
        vexp.Next();
      }
    } finally {
      vexp.delete();
    }
  }

  edgeMap.delete();
  vertMap.delete();
  return result;
}

/**
 * Returns true when edge `idA` and edge `idB` share at least one vertex.
 * Pure map lookup — no OCC calls.
 */
export function edgesShareVertex(vertexMap: VertexEdgeMap, idA: number, idB: number): boolean {
  for (const set of vertexMap.values()) {
    if (set.has(idA) && set.has(idB)) return true;
  }
  return false;
}

export interface EdgePartition {
  /** Edge IDs classified as circle or arc. */
  round: number[];
  /** Edge IDs classified as line or unknown. */
  linear: number[];
  /** Round edge IDs that share a vertex with at least one linear edge in the set. */
  roundAdjacentToLinear: number[];
  /** Linear edge IDs that share a vertex with at least one round edge in the set. */
  linearAdjacentToRound: number[];
}

/**
 * Partitions `edgeIds` by geometry type (using pre-classified kinds) and vertex adjacency.
 * Drives the ordering strategy in `topologicalFilletOrder` (filletOrder.ts).
 *
 * `edgeKinds` maps edgeId → 'circle' | 'arc' | other.  Pass the output of
 * `getSelectableEdges` mapped to its `kind` field.  Kept here (rather than
 * in filletOrder.ts) so callers who already have a `SelectableEdgeMeta` map
 * can avoid a second OCC walk.
 */
export function partitionEdgesByTopology(
  edgeIds: number[],
  edgeKinds: ReadonlyMap<number, string>,
  vertexMap: VertexEdgeMap,
): EdgePartition {
  const isRound = (id: number) => {
    const kind = edgeKinds.get(id);
    return kind === 'circle' || kind === 'arc';
  };

  const round = edgeIds.filter(isRound);
  const linear = edgeIds.filter((id) => !isRound(id));

  const roundAdjacentToLinear = round.filter((r) =>
    linear.some((l) => edgesShareVertex(vertexMap, r, l)),
  );
  const linearAdjacentToRound = linear.filter((l) =>
    round.some((r) => edgesShareVertex(vertexMap, l, r)),
  );

  return { round, linear, roundAdjacentToLinear, linearAdjacentToRound };
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
