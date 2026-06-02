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
  /**
   * True when adjacent faces meet at a dihedral angle ≥ SHARP_THRESHOLD (15°).
   * Smooth surface edges on polygon-approximated curves (e.g. iso-lines on a
   * cylinder body) have dihedral ~3–5° and are false — same as Fusion 360's
   * edge-visibility rule. Boundary/seam edges (< 2 adjacent faces) default to true.
   */
  sharpEdge: boolean;
  /**
   * Convexity of the edge — true = convex (material on the outside of the bend),
   * false = concave (material on the inside), null = indeterminate (boundary/seam
   * or degenerate centroid data). Matches Fusion 360 BRepBody.convexEdges() /
   * concaveEdges() and drives RuleFilletTopologyTypes (RoundsOnly / FilletsOnly).
   * Computed via centroid-difference test: dot(nA, centroidB − centroidA) < 0 → convex.
   */
  convex: boolean | null;
  /**
   * True when at least one adjacent face is curved (non-planar) — its averaged
   * vertex normal magnitude falls below the flat threshold. Distinguishes a real
   * fillet/round tangent boundary (one neighbour is the curved blend face) from a
   * facet seam inside a polygon-approximated wall (both neighbours flat facets).
   * Used to draw Fusion-style tangent reference lines without the facet clutter.
   * Defaults to false; only set when tessellation data is available.
   */
  adjacentCurvedFace: boolean;
  /**
   * True when this edge borders a curved (fillet/round/chamfer-blend) face AND the
   * dihedral there is shallow enough to be a tangent BLEND boundary rather than a
   * hard corner. Uses a looser threshold than `sharpEdge` (≈45° vs 15°) so blend
   * arcs whose dihedral is nudged past 15° by faceted neighbour walls still count,
   * while genuine ~90° edges (a bore rim, a sharp corner) are excluded. Drives the
   * Fusion-style tangent reference line overlay. Defaults to false.
   */
  blendEdge: boolean;
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
      sharpEdge: true,            // refined in A4 below using tessellation face normals
      convex: null,               // refined in A4 below using centroid-difference test
      adjacentCurvedFace: false,  // refined in A4 below using per-face normal spread
      blendEdge: false,           // refined in A4 below (tangent blend boundary)
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

  // A4 — sharpEdge + convex: compute dihedral angle and convexity between adjacent
  // faces using tessellation data in a single pass.
  //
  // Layout reminder (see tessellate.ts): faceIds is per-TRIANGLE; normals/positions
  // are per-VERTEX (3 verts × 3 components per triangle → 9 floats at tri*9).
  //
  // sharpEdge: |dot(nA_local, nB_local)| ≤ cos(15°) → faces differ by ≥ 15° → edge is sharp.
  //   Uses LOCAL normals — the nearest triangle to the edge midpoint — instead of the
  //   whole-face averaged normal. Averaged normals mislead for curved fillet faces: a
  //   quarter-cylinder fillet face averages to ~45° from both neighbours even though the
  //   boundary is G1-tangent (0° dihedral). The nearest-triangle normal at the boundary
  //   correctly reads ~0° because the fillet tessellation is G1 by construction.
  //   Uses Math.abs so either-pointing normals both give the right result.
  //
  // convex: centroid-difference test — dot(nA_avg_unit, centroidB − centroidA) < 0
  //   → convex (face B curves away from nA direction). Still uses averaged normals +
  //   centroids — approximate face orientation is fine for this coarse sign test.
  const SHARP_DOT_THRESHOLD = Math.cos(Math.PI * 15 / 180); // cos(15°) ≈ 0.9659
  const BLEND_DOT_THRESHOLD = Math.cos(Math.PI * 45 / 180); // cos(45°) ≈ 0.7071 — blend-edge cutoff
  const tess = body._tessellation;
  if (tess) {
    // Per-triangle data grouped by face, plus face-level sums for the convex test.
    type VertData = {
      x: number; y: number; z: number;     // vertex position
      nx: number; ny: number; nz: number;  // vertex normal
    };
    type FaceData = {
      verts: VertData[];
      snx: number; sny: number; snz: number;  // summed normals (for convex avg)
      cx: number; cy: number; cz: number;      // summed centroids (for convex avg)
      count: number;
    };
    const faceData = new Map<number, FaceData>();
    const numTriangles = tess.faceIds.length;
    for (let tri = 0; tri < numTriangles; tri++) {
      const fid = tess.faceIds[tri];
      let fd = faceData.get(fid);
      if (!fd) { fd = { verts: [], snx: 0, sny: 0, snz: 0, cx: 0, cy: 0, cz: 0, count: 0 }; faceData.set(fid, fd); }
      const base = tri * 9;
      // Store all three vertices (position + normal) so localNormal can sample the
      // true surface normal AT the edge boundary, where a fillet face is G1-tangent.
      for (let j = 0; j < 3; j++) {
        const o = base + j * 3;
        fd.verts.push({
          x: tess.positions[o], y: tess.positions[o + 1], z: tess.positions[o + 2],
          nx: tess.normals[o], ny: tess.normals[o + 1], nz: tess.normals[o + 2],
        });
      }
      const tnx = tess.normals[base];
      const tny = tess.normals[base + 1];
      const tnz = tess.normals[base + 2];
      const tcx = (tess.positions[base] + tess.positions[base + 3] + tess.positions[base + 6]) / 3;
      const tcy = (tess.positions[base + 1] + tess.positions[base + 4] + tess.positions[base + 7]) / 3;
      const tcz = (tess.positions[base + 2] + tess.positions[base + 5] + tess.positions[base + 8]) / 3;
      fd.snx += tnx; fd.sny += tny; fd.snz += tnz;
      fd.cx += tcx;  fd.cy += tcy;  fd.cz += tcz;
      fd.count++;
    }

    // Return the unit normal of the VERTEX nearest to (px,py,pz). Vertices lie on
    // the face boundary, so at a fillet's tangent edge this reads the true G1
    // boundary normal (≈ the flat neighbour's normal). The previous version used
    // the nearest triangle CENTROID, which on a coarse curved fillet sits partway
    // up the arc — its normal is already rotated several degrees off tangent, so
    // one boundary of a fillet could tip past the 15° sharp threshold while the
    // other stayed under it, dropping one tangent reference line.
    const localNormal = (fd: FaceData, px: number, py: number, pz: number): [number, number, number] | null => {
      if (fd.verts.length === 0) return null;
      let bestDist2 = Infinity;
      let best = fd.verts[0];
      for (const v of fd.verts) {
        const dx = v.x - px, dy = v.y - py, dz = v.z - pz;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < bestDist2) { bestDist2 = d2; best = v; }
      }
      const len = Math.sqrt(best.nx * best.nx + best.ny * best.ny + best.nz * best.nz);
      if (len < 1e-9) return null;
      return [best.nx / len, best.ny / len, best.nz / len];
    };

    for (const [edgeId, m] of meta.entries()) {
      if (m.adjacentFaceIds.length < 2) {
        // Boundary / seam — no dihedral available; keep defaults (sharpEdge=true, convex=null).
        continue;
      }
      const dA = faceData.get(m.adjacentFaceIds[0]);
      const dB = faceData.get(m.adjacentFaceIds[1]);
      if (!dA || !dB || dA.count === 0 || dB.count === 0) continue;

      // Edge midpoint: middle vertex of the polyline stored in the tessellation.
      // This is the query point for nearest-triangle lookup on each adjacent face.
      // eslint-disable-next-line no-useless-assignment
      let emx = 0, emy = 0, emz = 0;
      const poly = tess.edgePolylines?.get(edgeId);
      if (poly && poly.length >= 3) {
        // poly is a flat Float32Array of (x,y,z) triples; pick the middle triple.
        const midIdx = Math.floor(poly.length / 6) * 3;
        emx = poly[midIdx];
        emy = poly[midIdx + 1];
        emz = poly[midIdx + 2];
      } else {
        // No polyline data — fall back to face A's averaged centroid.
        emx = dA.cx / dA.count;
        emy = dA.cy / dA.count;
        emz = dA.cz / dA.count;
      }

      // sharpEdge: hybrid dihedral check.
      //
      // For flat-flat edges (both adjacent faces have uniform normals — |avg| ≈ 1):
      //   Use the averaged face normals. This is identical to the pre-OCC-12.D2 code
      //   and is always correct for planar-to-planar 90° extrude corners.
      //
      // For curved-to-anything edges (one or both faces have varying normals, e.g.
      //   a cylindrical fillet face): use the LOCAL normal from the nearest triangle
      //   to the edge midpoint. Averaged normals mislead here — a quarter-cylinder's
      //   average normal points ~45° from both flat neighbours even though the
      //   boundary is G1-tangent. The nearest-boundary-triangle normal reads ~0°.
      //
      // FLAT_THRESHOLD = cos(10°) ≈ 0.985. |avg unit normal| ≥ this → planar face.
      const FLAT_THRESHOLD = 0.985;
      const lenAvgA = Math.sqrt(dA.snx * dA.snx + dA.sny * dA.sny + dA.snz * dA.snz) / dA.count;
      const lenAvgB = Math.sqrt(dB.snx * dB.snx + dB.sny * dB.sny + dB.snz * dB.snz) / dB.count;

      // A neighbour with sub-threshold averaged-normal magnitude is a curved face.
      // Marks fillet/round boundaries apart from facet seams in a faceted wall.
      m.adjacentCurvedFace = lenAvgA < FLAT_THRESHOLD || lenAvgB < FLAT_THRESHOLD;

      if (lenAvgA >= FLAT_THRESHOLD && lenAvgB >= FLAT_THRESHOLD) {
        // Both faces flat → averaged normals give the correct dihedral.
        if (lenAvgA >= 1e-9 && lenAvgB >= 1e-9) {
          const dot =
            (dA.snx * dB.snx + dA.sny * dB.sny + dA.snz * dB.snz) /
            (dA.count * dB.count * lenAvgA * lenAvgB);
          m.sharpEdge = Math.abs(dot) <= SHARP_DOT_THRESHOLD;
        }
      } else {
        // At least one curved face → use local normals near the edge midpoint.
        const nA = localNormal(dA, emx, emy, emz);
        const nB = localNormal(dB, emx, emy, emz);
        if (nA && nB) {
          const dot = Math.abs(nA[0] * nB[0] + nA[1] * nB[1] + nA[2] * nB[2]);
          m.sharpEdge = dot <= SHARP_DOT_THRESHOLD;
          // blendEdge: a tangent fillet/round boundary. Looser than sharpEdge so a
          // blend arc nudged just past 15° by a faceted neighbour wall still counts,
          // while a genuine ~90° corner (bore rim) does not. BLEND_DOT = cos(45°).
          m.blendEdge = dot > BLEND_DOT_THRESHOLD;
        }
      }

      // convex: dot(nA_avg_unit, centroidB − centroidA).
      //   < 0 → face B is behind nA's outward direction → edge is convex (outside corner).
      //   > 0 → face B is ahead of nA's outward direction → edge is concave (inside corner).
      // lenAvgA/B already computed above for the sharpEdge hybrid check.
      if (lenAvgA >= 1e-9 && lenAvgB >= 1e-9) {
        const centDx = dB.cx / dB.count - dA.cx / dA.count;
        const centDy = dB.cy / dB.count - dA.cy / dA.count;
        const centDz = dB.cz / dB.count - dA.cz / dA.count;
        const nAux = dA.snx / (dA.count * lenAvgA);
        const nAuy = dA.sny / (dA.count * lenAvgA);
        const nAuz = dA.snz / (dA.count * lenAvgA);
        const signDot = nAux * centDx + nAuy * centDy + nAuz * centDz;
        if (Math.abs(signDot) > 1e-6) {
          m.convex = signDot < 0;
        }
        // else: leave convex=null — degenerate (co-planar adjacent faces).
      }
    }
  }

  return meta;
}
