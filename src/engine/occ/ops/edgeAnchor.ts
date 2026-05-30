/**
 * Geometric edge re-identification across topology rebuilds.
 *
 * `makeBRepBodyFromOccShape` assigns edge IDs positionally (fresh allocator, walk
 * order), so an edge's numeric ID is NOT stable once the body is rebuilt — e.g.
 * after each pass of a sequential fillet. To carry a selection across rebuilds we
 * anchor each edge by its intrinsic curve geometry, which survives the trimming
 * that a fillet applies near shared corners:
 *
 *   - line  → infinite line (a point + direction). A filleted neighbour only
 *             shortens the segment; the underlying line is unchanged, so we match
 *             by "candidate lies on the same infinite line, same direction".
 *   - circle/arc → centre + axis + radius (all trim-invariant).
 *   - other (spline/…) → fall back to curve-midpoint proximity (less robust; such
 *             edges adjacent to a fillet may fail to re-match and are then skipped).
 *
 * All gp_* accessor results are OWNED embind wrappers and are deleted here; the
 * edge VIEW from occDeref / TopoDS.Edge_1 is NOT deleted (occDeref VIEW rule).
 */
import type { OcctRaw } from '../types';
import { occDeref, type BRepBody } from '../brepBody';

const LINE_PERP_TOL = 1e-4;     // mm — distance of candidate midpoint to anchor line
const LINE_ANGLE_TOL = 1e-3;    // |cross| of unit directions (parallel or anti-parallel)
const CIRCLE_POS_TOL = 1e-3;    // mm — centre / radius match
const MID_FALLBACK_TOL = 1e-2;  // mm — 'other' kinds match by midpoint proximity

export type EdgeAnchor =
  | { kind: 'line'; p: [number, number, number]; d: [number, number, number]; mid: [number, number, number] }
  | { kind: 'circle'; c: [number, number, number]; ax: [number, number, number]; r: number; mid: [number, number, number] }
  | { kind: 'other'; mid: [number, number, number] };

interface OccAnchorApi extends OcctRaw {
  BRepAdaptor_Curve_2: new (edge: unknown) => {
    GetType(): unknown;
    FirstParameter(): number;
    LastParameter(): number;
    D0(u: number, p: unknown): void;
    Line(): { Location(): GpPnt; Direction(): GpDir; delete?(): void };
    Circle(): { Location(): GpPnt; Axis(): { Direction(): GpDir; delete?(): void }; Radius(): number; delete?(): void };
    delete(): void;
  };
  gp_Pnt_1: new () => GpPnt;
  GeomAbs_CurveType: { GeomAbs_Line?: unknown; GeomAbs_Circle?: unknown };
}

interface GpPnt { X(): number; Y(): number; Z(): number; delete?(): void }
interface GpDir { X(): number; Y(): number; Z(): number; delete?(): void }

/** Embind enums compare by identity in some builds, by `.value` in others. */
function enumEq(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  const av = (a as { value?: unknown })?.value;
  const bv = (b as { value?: unknown })?.value;
  return av !== undefined && (av === bv || av === b);
}

function norm(v: [number, number, number]): [number, number, number] {
  const len = Math.hypot(v[0], v[1], v[2]);
  return len > 1e-12 ? [v[0] / len, v[1] / len, v[2] / len] : [0, 0, 0];
}

/** Compute a trim-invariant geometric anchor for one edge of `body`. */
export function computeEdgeAnchor(oc: OcctRaw, body: BRepBody, edgeId: number): EdgeAnchor | null {
  const occ = oc as OccAnchorApi;
  const handle = body.edgeIds.get(edgeId);
  if (!handle) return null;

  let adaptor: InstanceType<OccAnchorApi['BRepAdaptor_Curve_2']> | null = null;
  let p0: GpPnt | null = null;
  let p1: GpPnt | null = null;
  let pm: GpPnt | null = null;
  try {
    const rawShape = occDeref(oc, handle, oc.TopoDS_Shape);
    // Edge_1 is a VIEW (same ptr) — do NOT delete.
    const rawEdge = (oc as unknown as { TopoDS: { Edge_1(s: unknown): unknown } }).TopoDS.Edge_1(rawShape);
    adaptor = new occ.BRepAdaptor_Curve_2(rawEdge);

    const t0 = adaptor.FirstParameter();
    const t1 = adaptor.LastParameter();
    p0 = new occ.gp_Pnt_1();
    p1 = new occ.gp_Pnt_1();
    pm = new occ.gp_Pnt_1();
    adaptor.D0(t0, p0);
    adaptor.D0(t1, p1);
    adaptor.D0((t0 + t1) / 2, pm);
    const mid: [number, number, number] = [pm.X(), pm.Y(), pm.Z()];

    const type = adaptor.GetType();
    const curveTypes = occ.GeomAbs_CurveType;

    if (enumEq(type, curveTypes.GeomAbs_Line)) {
      let lin: ReturnType<InstanceType<OccAnchorApi['BRepAdaptor_Curve_2']>['Line']> | null = null;
      let dir: GpDir | null = null;
      try {
        lin = adaptor.Line();
        dir = lin.Direction();
        // Use the edge's FIRST ENDPOINT (D0 at FirstParameter) as `p`, NOT the
        // underlying gp_Lin's Location(): Location() is the infinite line's
        // reference point (parameter 0 of the surface's line), which is generally
        // NOT an endpoint of this trimmed edge. Any point on the line is equally
        // valid for findEdgeByAnchor's on-line projection, but anchoring `p` to a
        // real endpoint makes |p - mid| exactly half the edge length — which
        // isAnchorEdgePresent relies on to size its midpoint-proximity window.
        const p: [number, number, number] = [p0!.X(), p0!.Y(), p0!.Z()];
        const d = norm([dir.X(), dir.Y(), dir.Z()]);
        return { kind: 'line', p, d, mid };
      } finally {
        dir?.delete?.();
        lin?.delete?.();
      }
    }

    if (enumEq(type, curveTypes.GeomAbs_Circle)) {
      let circ: ReturnType<InstanceType<OccAnchorApi['BRepAdaptor_Curve_2']>['Circle']> | null = null;
      let loc: GpPnt | null = null;
      let axis: { Direction(): GpDir; delete?(): void } | null = null;
      let dir: GpDir | null = null;
      try {
        circ = adaptor.Circle();
        loc = circ.Location();
        axis = circ.Axis();
        dir = axis.Direction();
        const c: [number, number, number] = [loc.X(), loc.Y(), loc.Z()];
        const ax = norm([dir.X(), dir.Y(), dir.Z()]);
        return { kind: 'circle', c, ax, r: circ.Radius(), mid };
      } finally {
        dir?.delete?.();
        axis?.delete?.();
        loc?.delete?.();
        circ?.delete?.();
      }
    }

    return { kind: 'other', mid };
  } catch {
    return null;
  } finally {
    pm?.delete?.();
    p1?.delete?.();
    p0?.delete?.();
    adaptor?.delete?.();
  }
}

/**
 * Find the edge ID in `body` that matches `anchor`, or null when no edge matches
 * within tolerance (e.g. the edge was consumed by a prior fillet pass). Matching
 * is trim-invariant for lines/circles so a shortened survivor still matches.
 */
export function findEdgeByAnchor(oc: OcctRaw, body: BRepBody, anchor: EdgeAnchor): number | null {
  let best = -1;
  let bestScore = Infinity;

  for (const edgeId of body.edgeIds.keys()) {
    const cand = computeEdgeAnchor(oc, body, edgeId);
    if (!cand) continue;

    if (anchor.kind === 'line') {
      if (cand.kind !== 'line') continue;
      // Directions parallel or anti-parallel.
      const cx = anchor.d[1] * cand.d[2] - anchor.d[2] * cand.d[1];
      const cy = anchor.d[2] * cand.d[0] - anchor.d[0] * cand.d[2];
      const cz = anchor.d[0] * cand.d[1] - anchor.d[1] * cand.d[0];
      if (Math.hypot(cx, cy, cz) > LINE_ANGLE_TOL) continue;
      // Candidate midpoint must lie on the anchor's infinite line.
      const wx = cand.mid[0] - anchor.p[0], wy = cand.mid[1] - anchor.p[1], wz = cand.mid[2] - anchor.p[2];
      const proj = wx * anchor.d[0] + wy * anchor.d[1] + wz * anchor.d[2];
      const perp = Math.hypot(wx - proj * anchor.d[0], wy - proj * anchor.d[1], wz - proj * anchor.d[2]);
      if (perp > LINE_PERP_TOL) continue;
      // Tie-break by midpoint proximity (closest collinear segment).
      const score = Math.hypot(
        cand.mid[0] - anchor.mid[0], cand.mid[1] - anchor.mid[1], cand.mid[2] - anchor.mid[2],
      );
      if (score < bestScore) { bestScore = score; best = edgeId; }
    } else if (anchor.kind === 'circle') {
      if (cand.kind !== 'circle') continue;
      if (Math.abs(cand.r - anchor.r) > CIRCLE_POS_TOL) continue;
      const dc = Math.hypot(cand.c[0] - anchor.c[0], cand.c[1] - anchor.c[1], cand.c[2] - anchor.c[2]);
      if (dc > CIRCLE_POS_TOL) continue;
      // Axis parallel or anti-parallel.
      const ax = anchor.ax[1] * cand.ax[2] - anchor.ax[2] * cand.ax[1];
      const ay = anchor.ax[2] * cand.ax[0] - anchor.ax[0] * cand.ax[2];
      const az = anchor.ax[0] * cand.ax[1] - anchor.ax[1] * cand.ax[0];
      if (Math.hypot(ax, ay, az) > LINE_ANGLE_TOL) continue;
      const score = dc + Math.hypot(
        cand.mid[0] - anchor.mid[0], cand.mid[1] - anchor.mid[1], cand.mid[2] - anchor.mid[2],
      );
      if (score < bestScore) { bestScore = score; best = edgeId; }
    } else {
      // 'other' — midpoint proximity only.
      const score = Math.hypot(
        cand.mid[0] - anchor.mid[0], cand.mid[1] - anchor.mid[1], cand.mid[2] - anchor.mid[2],
      );
      if (score < bestScore && score <= MID_FALLBACK_TOL) { bestScore = score; best = edgeId; }
    }
  }

  return best >= 0 ? best : null;
}

/**
 * "Is the *same physical edge* that `anchor` describes still present in `body`?"
 *
 * This is stricter than findEdgeByAnchor and exists for the fillet/chamfer
 * result-correctness guard. findEdgeByAnchor matches a LINE by its INFINITE line
 * (point + direction) and returns the nearest collinear segment with NO distance
 * cap — exactly right for trim-invariant remapping, where a survivor may have been
 * shortened. But it produces FALSE POSITIVES when asking "did this edge survive?":
 * a *different* edge that merely shares the seed's infinite line (e.g. a rim split
 * into two collinear segments by a notch, or the seed's own collinear neighbour)
 * matches, so a consumed edge looks like it survived.
 *
 * Here a line anchor counts as present only when the match lies near the anchor's
 * ORIGINAL midpoint — within the seed's own half-length (so a shortened survivor
 * whose midpoint drifted toward its un-trimmed end still counts) plus `extraMargin`
 * (pass the fillet radius so a blend that trims one end is tolerated). A far
 * collinear segment falls outside that span and is correctly treated as "gone".
 *
 * Circle/other anchors are spatially unique, so any match counts as present.
 */
export function isAnchorEdgePresent(
  oc: OcctRaw,
  body: BRepBody,
  anchor: EdgeAnchor,
  extraMargin = 0,
): boolean {
  const matchId = findEdgeByAnchor(oc, body, anchor);
  if (matchId === null) return false;
  if (anchor.kind !== 'line') return true;
  const matchAnchor = computeEdgeAnchor(oc, body, matchId);
  if (!matchAnchor) return false;
  const seedHalfLen = Math.hypot(
    anchor.p[0] - anchor.mid[0], anchor.p[1] - anchor.mid[1], anchor.p[2] - anchor.mid[2],
  );
  const midDist = Math.hypot(
    matchAnchor.mid[0] - anchor.mid[0], matchAnchor.mid[1] - anchor.mid[1], matchAnchor.mid[2] - anchor.mid[2],
  );
  return midDist <= seedHalfLen + extraMargin;
}
