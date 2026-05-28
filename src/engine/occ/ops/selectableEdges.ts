/**
 * OCC-12 — Authoritative edge metadata layer.
 *
 * Replaces the two fragile heuristics in the OCC selection path
 * (detectSyntheticGeneratorEdges + polylineTangentChain) with BRep topology
 * read straight from the kernel, so selection can never disagree with the
 * fillet/chamfer commit.
 *
 * CONTRACT (do not deviate):
 *   - The returned map is keyed by the REAL body.edgeIds key (the 0-based
 *     MapShapes(TopAbs_EDGE) order assigned once at body creation). We iterate
 *     body.edgeIds and reuse those keys — never a fresh TopExp_Explorer that
 *     would invent a different ordering and silently fillet the wrong edge.
 *   - This is a metadata layer, NOT a geometry pipeline. The display polylines
 *     already live in body._tessellation.edgePolylines in the correct space and
 *     id; we never re-emit them here.
 *
 * DISPOSAL DISCIPLINE (see memory/wasm_patterns.md):
 *   - occDeref(...) / TopoDS.Edge_1(...) return VIEWs → never .delete()
 *   - BRepAdaptor_Curve_2, gp_Circ, and any TopTools maps / explorers WE create
 *     are OWNED → must .delete()
 */
import type { OcctRaw } from '../types';
import { occDeref, type BRepBody, type BRepTopologyHandle } from '../brepBody';
import { collectTangentChainEdges, findShapeIndex } from './adjacency';

export type SelectableEdgeKind =
  | 'line'
  | 'circle'
  | 'arc'
  | 'spline'
  | 'seam'
  | 'boundary';

export interface SelectableEdgeMeta {
  /** Curve classification. Overridden to 'seam'/'boundary' when not filletable. */
  kind: SelectableEdgeKind;
  /** body.faceIds keys that share this edge. */
  adjacentFaceIds: number[];
  /** Tangent group id (from collectTangentChainEdges) — same group == same fillet propagate set. */
  chainId: number;
  /** adjacentFaceIds.length >= 2. Also governs chamfer; a seam is neither fillet- nor chamfer-able. */
  filletable: boolean;
  /** Circle / arc only (mm). */
  radius?: number;
}

type OccShapeRef = { ptr: number; delete(): void };

type OccSelectableApi = OcctRaw & {
  TopTools_IndexedMapOfShape_1: new () => {
    FindIndex_1?(shape: unknown): number;
    FindIndex?(shape: unknown): number;
    Extent(): number;
    delete(): void;
  };
  TopExp: { MapShapes_1(shape: unknown, type: unknown, map: unknown): void };
  TopExp_Explorer_2: new (shape: unknown, toFind: unknown, toAvoid: unknown) => {
    More(): boolean;
    Current(): OccShapeRef;
    Next(): void;
    delete(): void;
  };
  BRepAdaptor_Curve_2: new (edge: unknown) => {
    GetType(): unknown;
    FirstParameter(): number;
    LastParameter(): number;
    Circle(): { Radius(): number; delete?(): void };
    delete(): void;
  };
  GeomAbs_CurveType: Record<string, unknown>;
};

const TWO_PI = Math.PI * 2;

// Memoize on (body, body.revision). invalidateBRepTessellation bumps revision
// whenever a new OCC shape replaces the body, so a stale cache can never leak.
const cache = new WeakMap<BRepBody, { revision: number; meta: Map<number, SelectableEdgeMeta> }>();

export function getSelectableEdges(oc: OcctRaw, body: BRepBody): Map<number, SelectableEdgeMeta> {
  const cached = cache.get(body);
  if (cached && cached.revision === body.revision) return cached.meta;
  const meta = computeSelectableEdges(oc, body);
  cache.set(body, { revision: body.revision, meta });
  return meta;
}

/** Embind enum members compare by identity in some builds and by `.value` in others. */
function enumEq(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  const av = (a as { value?: unknown })?.value;
  const bv = (b as { value?: unknown })?.value;
  if (av !== undefined && av === bv) return true;
  if (av !== undefined && av === b) return true;
  if (bv !== undefined && bv === a) return true;
  return false;
}

function classifyEdge(
  oc: OcctRaw,
  occ: OccSelectableApi,
  edgeHandle: BRepTopologyHandle,
): { kind: SelectableEdgeKind; radius?: number } {
  let curve: InstanceType<OccSelectableApi['BRepAdaptor_Curve_2']> | null = null;
  let circ: { Radius(): number; delete?(): void } | null = null;
  try {
    const rawShape = occDeref(oc, edgeHandle, oc.TopoDS_Shape);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawEdge = (oc as any).TopoDS?.Edge_1 ? (oc as any).TopoDS.Edge_1(rawShape) : rawShape;
    curve = new occ.BRepAdaptor_Curve_2(rawEdge);
    const t = curve.GetType();
    const G = occ.GeomAbs_CurveType ?? {};

    if (enumEq(t, G.GeomAbs_Line)) return { kind: 'line' };
    if (enumEq(t, G.GeomAbs_Circle)) {
      let radius: number | undefined;
      try {
        const c = curve.Circle();
        circ = c;
        radius = c.Radius();
      } catch {
        /* radius unavailable — leave undefined */
      }
      const span = Math.abs(curve.LastParameter() - curve.FirstParameter());
      const kind: SelectableEdgeKind = span >= TWO_PI - 1e-3 ? 'circle' : 'arc';
      return { kind, radius };
    }
    // Ellipse / Bézier / B-spline / hyperbola / parabola / other — treat as freeform.
    return { kind: 'spline' };
  } catch {
    // Never drop an edge on a classification failure; default to a filletable line.
    return { kind: 'line' };
  } finally {
    circ?.delete?.();
    curve?.delete?.();
  }
}

/**
 * Build canonicalEdgeIndex → set of body.faceIds keys that contain that edge.
 * Walks each face once via the body's stored face handle (authoritative ids).
 */
function buildEdgeFaceAdjacency(
  oc: OcctRaw,
  occ: OccSelectableApi,
  body: BRepBody,
  rawShape: unknown,
): { canonicalToFaces: Map<number, Set<number>>; edgeIdxOf: Map<number, number> } {
  const canonicalToFaces = new Map<number, Set<number>>();
  const edgeIdxOf = new Map<number, number>();

  const edgeMap = new occ.TopTools_IndexedMapOfShape_1();
  try {
    occ.TopExp.MapShapes_1(rawShape, oc.TopAbs_ShapeEnum.TopAbs_EDGE, edgeMap);
  } catch {
    edgeMap.delete();
    return { canonicalToFaces, edgeIdxOf };
  }

  // body edgeId → canonical index.
  for (const [edgeId, handle] of body.edgeIds) {
    const raw = occDeref(oc, handle, oc.TopoDS_Shape) as OccShapeRef;
    const idx = findShapeIndex(edgeMap, raw);
    if (idx > 0) edgeIdxOf.set(edgeId, idx);
  }

  // For each face, mark which canonical edge indices it contains.
  for (const [faceId, handle] of body.faceIds) {
    const faceRaw = occDeref(oc, handle, oc.TopoDS_Shape) as OccShapeRef;
    const exp = new occ.TopExp_Explorer_2(
      faceRaw,
      oc.TopAbs_ShapeEnum.TopAbs_EDGE,
      oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
    );
    try {
      while (exp.More()) {
        const e = exp.Current();
        const idx = findShapeIndex(edgeMap, e);
        e.delete();
        if (idx > 0) {
          let faces = canonicalToFaces.get(idx);
          if (!faces) {
            faces = new Set<number>();
            canonicalToFaces.set(idx, faces);
          }
          faces.add(faceId);
        }
        exp.Next();
      }
    } finally {
      exp.delete();
    }
  }

  edgeMap.delete();
  return { canonicalToFaces, edgeIdxOf };
}

function computeSelectableEdges(oc: OcctRaw, body: BRepBody): Map<number, SelectableEdgeMeta> {
  const occ = oc as OccSelectableApi;
  const meta = new Map<number, SelectableEdgeMeta>();

  // rawShape is a VIEW from occDeref — do NOT delete.
  const rawShape = occDeref(oc, body.shape, oc.TopoDS_Shape);

  // A2 — adjacency (authoritative replacement for detectSyntheticGeneratorEdges).
  const { canonicalToFaces, edgeIdxOf } = buildEdgeFaceAdjacency(oc, occ, body, rawShape);

  // A1 — kind/radius classification + A2 filletable.
  for (const [edgeId, edgeHandle] of body.edgeIds) {
    const { kind, radius } = classifyEdge(oc, occ, edgeHandle);
    const canonicalIdx = edgeIdxOf.get(edgeId);
    const adjacentFaceIds =
      canonicalIdx !== undefined ? [...(canonicalToFaces.get(canonicalIdx) ?? [])] : [];
    const filletable = adjacentFaceIds.length >= 2;
    // A seam (1 face) or boundary (0 faces) is neither fillet- nor chamfer-able;
    // override the geometric kind so the UI can label it honestly.
    const finalKind: SelectableEdgeKind = filletable
      ? kind
      : adjacentFaceIds.length === 1
        ? 'seam'
        : 'boundary';
    meta.set(edgeId, {
      kind: finalKind,
      adjacentFaceIds,
      chainId: -1, // filled in by A3 below
      filletable,
      ...(radius !== undefined ? { radius } : {}),
    });
  }

  // A3 — chainId via collectTangentChainEdges (the SAME fn fillet `propagate`
  // uses, so highlight chains and propagation sets agree by construction).
  let nextChainId = 0;
  const grouped = new Set<number>();
  for (const edgeId of body.edgeIds.keys()) {
    if (grouped.has(edgeId)) continue;
    const chainId = nextChainId++;
    let chain: number[];
    try {
      chain = collectTangentChainEdges(oc, body, [edgeId]);
    } catch {
      chain = [edgeId];
    }
    if (chain.length === 0) chain = [edgeId];
    for (const member of chain) {
      const m = meta.get(member);
      if (m && !grouped.has(member)) {
        m.chainId = chainId;
        grouped.add(member);
      }
    }
    // Guarantee the seed itself is grouped even if the chain walk skipped it.
    if (!grouped.has(edgeId)) {
      const m = meta.get(edgeId);
      if (m) {
        m.chainId = chainId;
        grouped.add(edgeId);
      }
    }
  }

  return meta;
}
