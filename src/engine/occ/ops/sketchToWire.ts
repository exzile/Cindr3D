/**
 * OCC-3.3 helper — Convert a closed 2-D point loop (world-space Vector3 array)
 * into a TopoDS_Wire via BRepBuilderAPI_MakeEdge + BRepBuilderAPI_MakeWire.
 *
 * The caller is responsible for transforming sketch-plane UV coordinates to
 * world space before calling this (use planePointToWorld from plane.ts).
 */
import * as THREE from 'three';
import type { OcctRaw } from '../types';

export interface SketchProfile {
  outer: THREE.Vector2[];
  holes: THREE.Vector2[][];
}

export interface SketchPlaneFrame {
  origin: THREE.Vector3;
  normal: THREE.Vector3;
  uDir: THREE.Vector3;
  vDir: THREE.Vector3;
}

export const OCC_OWNED_RESOURCES = Symbol.for('cindr3d.occOwnedResources');

type OccOwnedResource = { delete?: () => void };

const DEFAULT_LOOP_TOLERANCE = 1e-5;
const DEFAULT_LOOP_TOLERANCE_SQ = DEFAULT_LOOP_TOLERANCE * DEFAULT_LOOP_TOLERANCE;
const MIN_LOOP_AREA = 1e-10;

function safeDeleteOcc(value: { delete?: () => void } | null | undefined): void {
  try {
    value?.delete?.();
  } catch {
    // Some OCC builder result proxies are invalidated by their owning builder.
  }
}

export function takeOccOwnedResources(value: unknown): OccOwnedResource[] {
  const carrier = value as { [OCC_OWNED_RESOURCES]?: OccOwnedResource[] } | null | undefined;
  const resources = carrier?.[OCC_OWNED_RESOURCES] ?? [];
  if (carrier) carrier[OCC_OWNED_RESOURCES] = undefined;
  return resources;
}

export function signedArea2D(points: readonly THREE.Vector2[]): number {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    area += a.x * b.y - b.x * a.y;
  }
  return area / 2;
}

export function normalizeClosedLoop2D(
  points: readonly THREE.Vector2[],
  tolerance = DEFAULT_LOOP_TOLERANCE,
): THREE.Vector2[] | null {
  if (points.length < 3) return null;

  const toleranceSq = tolerance * tolerance;
  const normalized: THREE.Vector2[] = [];
  for (const point of points) {
    const previous = normalized.at(-1);
    if (previous && previous.distanceToSquared(point) <= toleranceSq) continue;
    normalized.push(point.clone());
  }

  if (normalized.length > 1 && normalized[0].distanceToSquared(normalized.at(-1)!) <= toleranceSq) {
    normalized.pop();
  }

  if (normalized.length < 3 || Math.abs(signedArea2D(normalized)) <= MIN_LOOP_AREA) {
    return null;
  }

  return normalized;
}

export function orientLoop2D(points: readonly THREE.Vector2[], clockwise: boolean): THREE.Vector2[] {
  const area = signedArea2D(points);
  const isClockwise = area < 0;
  const oriented = points.map((point) => point.clone());
  return isClockwise === clockwise ? oriented : oriented.reverse();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeGpPnt(oc: OcctRaw, v: THREE.Vector3): any {
  return new oc.gp_Pnt_3(v.x, v.y, v.z);
}

/** Convert a list of world-space points (closed polygon) into a TopoDS_Wire. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function pointLoopToWire(oc: OcctRaw, points: THREE.Vector3[]): any | null {
  if (points.length < 3) return null;

  const loop = points.slice();
  if (loop.length > 1 && loop[0].distanceToSquared(loop.at(-1)!) <= DEFAULT_LOOP_TOLERANCE_SQ) {
    loop.pop();
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let polygonMaker: any | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const retainedPoints: any[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const retainedBuilders: any[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const retainedEdges: any[] = [];
  let keepPolygonMakerAlive = false;
  try {
    for (let i = 0; i < loop.length; i++) {
      const point = loop[i];
      if (i > 0 && point.distanceToSquared(loop[i - 1]) < 1e-12) continue;
      const gp = makeGpPnt(oc, point);
      retainedPoints.push(gp);
    }

    if (retainedPoints.length < 3) return null;
    if (retainedPoints.length === 3) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      polygonMaker = new (oc as any).BRepBuilderAPI_MakePolygon_3(
        retainedPoints[0],
        retainedPoints[1],
        retainedPoints[2],
        true,
      );
    } else if (retainedPoints.length === 4) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      polygonMaker = new (oc as any).BRepBuilderAPI_MakePolygon_4(
        retainedPoints[0],
        retainedPoints[1],
        retainedPoints[2],
        retainedPoints[3],
        true,
      );
    } else {
      // Use BRepBuilderAPI_MakePolygon incremental API — avoids the
      // BRepBuilderAPI_MakeEdge_3 WASM "memory access out of bounds" crash
      // that occurs with 5+ point polygons on some OCC WASM builds.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      polygonMaker = new (oc as any).BRepBuilderAPI_MakePolygon_1();
      for (const pt of retainedPoints) {
        polygonMaker.Add_1(pt);
      }
      polygonMaker.Close();
    }
    if (!polygonMaker?.IsDone()) return null;

    const wire = polygonMaker.Wire();
    keepPolygonMakerAlive = true;
    (wire as { [OCC_OWNED_RESOURCES]?: OccOwnedResource[] })[OCC_OWNED_RESOURCES] = [
      polygonMaker,
      ...retainedPoints,
    ];
    return wire;
  } finally {
    if (!keepPolygonMakerAlive) safeDeleteOcc(polygonMaker);
    if (!keepPolygonMakerAlive) {
      for (const builder of retainedBuilders) safeDeleteOcc(builder);
    }
    if (!keepPolygonMakerAlive) {
      for (const edge of retainedEdges) safeDeleteOcc(edge);
    }
    if (!keepPolygonMakerAlive) {
      for (const point of retainedPoints) safeDeleteOcc(point);
    }
  }
}

// ── Analytic wire from THREE.Shape curves (OCC-15) ────────────────────────────
//
// The SketchProfile path above samples arcs/circles into ~96-point polygons, which
// makes BRepPrimAPI_MakePrism sweep each segment into its own planar facet — a
// faceted "cylinder" with ~100 flat faces. THREE.Shape.curves still carry the
// analytic ArcCurve/EllipseCurve data, so we can build true gp_Circ / arc edges
// and get a single analytic cylindrical face per wall (matching Fusion).
//
// Supported curve types: LineCurve, circular ArcCurve/EllipseCurve (full + partial).
// Any other curve (ellipse with xRadius≠yRadius, spline, bezier) aborts the analytic
// build and returns null, so the caller falls back to the proven faceted path.

type ThreeCurve = {
  type: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [k: string]: any;
  getPoint(t: number, target?: THREE.Vector2): THREE.Vector2;
};

function uvToWorld3(frame: SketchPlaneFrame, p: THREE.Vector2): THREE.Vector3 {
  return frame.origin.clone().addScaledVector(frame.uDir, p.x).addScaledVector(frame.vDir, p.y);
}

/** Sampled signed area (UV) of a curve loop — sign gives winding (CCW > 0). */
function curveLoopSignedAreaUV(curves: ThreeCurve[]): number {
  const pts: THREE.Vector2[] = [];
  for (const c of curves) {
    const n = c.type === 'LineCurve' ? 1 : 8;
    for (let i = 0; i < n; i++) pts.push(c.getPoint(i / n));
  }
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    area += a.x * b.y - b.x * a.y;
  }
  return area / 2;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function lineEdgeWorld(oc: OcctRaw, a: THREE.Vector3, b: THREE.Vector3): any | null {
  if (a.distanceToSquared(b) < 1e-12) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const occ = oc as any;
  const gp1 = makeGpPnt(oc, a);
  const gp2 = makeGpPnt(oc, b);
  try {
    const mk = new occ.BRepBuilderAPI_MakeEdge_3(gp1, gp2);
    if (!mk.IsDone()) { mk.delete(); return null; }
    const edge = mk.Edge();
    mk.delete();
    return edge;
  } finally { gp1.delete(); gp2.delete(); }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function arcEdgeWorld(oc: OcctRaw, p0: THREE.Vector3, pm: THREE.Vector3, p1: THREE.Vector3): any | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const occ = oc as any;
  const gp0 = makeGpPnt(oc, p0), gpm = makeGpPnt(oc, pm), gp1 = makeGpPnt(oc, p1);
  try {
    const arcMk = new occ.GC_MakeArcOfCircle_4(gp0, gpm, gp1);
    if (!arcMk.IsDone()) { arcMk.delete(); return null; }
    const edgeMk = new occ.BRepBuilderAPI_MakeEdge_24(arcMk.Value());
    arcMk.delete();
    if (!edgeMk.IsDone()) { edgeMk.delete(); return null; }
    const edge = edgeMk.Edge();
    edgeMk.delete();
    return edge;
  } catch { return null; } finally { gp0.delete(); gpm.delete(); gp1.delete(); }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function circleEdgeWorld(oc: OcctRaw, centre: THREE.Vector3, normal: THREE.Vector3, radius: number): any | null {
  if (radius <= 0) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const occ = oc as any;
  const gc = makeGpPnt(oc, centre);
  const gn = new occ.gp_Dir_4(normal.x, normal.y, normal.z);
  const ax2 = new occ.gp_Ax2_3(gc, gn);
  gc.delete(); gn.delete();
  try {
    const circ = new occ.gp_Circ_2(ax2, radius);
    ax2.delete();
    const edgeMk = new occ.BRepBuilderAPI_MakeEdge_8(circ);
    circ.delete();
    if (!edgeMk.IsDone()) { edgeMk.delete(); return null; }
    const edge = edgeMk.Edge();
    edgeMk.delete();
    return edge;
  } catch { return null; }
}

/**
 * Build an OCC edge for one THREE curve (already in UV), or null if the curve type
 * is not analytically supported here (→ caller aborts to the faceted fallback).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function curveToAnalyticEdge(oc: OcctRaw, curve: ThreeCurve, frame: SketchPlaneFrame, reverse: boolean): any | null {
  if (curve.type === 'LineCurve') {
    const v1 = curve.v1 as THREE.Vector2, v2 = curve.v2 as THREE.Vector2;
    const a = uvToWorld3(frame, reverse ? v2 : v1);
    const b = uvToWorld3(frame, reverse ? v1 : v2);
    return lineEdgeWorld(oc, a, b);
  }
  if (curve.type === 'EllipseCurve' || curve.type === 'ArcCurve') {
    const xR = curve.xRadius as number, yR = curve.yRadius as number;
    if (Math.abs(xR - yR) > 1e-7) return null; // true ellipse — fall back
    const start = curve.getPoint(0);
    const end = curve.getPoint(1);
    const span = Math.abs((curve.aEndAngle as number) - (curve.aStartAngle as number));
    const full = start.distanceTo(end) < 1e-7 && span > Math.PI;
    if (full) {
      const centre = uvToWorld3(frame, new THREE.Vector2(curve.aX as number, curve.aY as number));
      const normal = reverse ? frame.normal.clone().negate() : frame.normal.clone();
      return circleEdgeWorld(oc, centre, normal, xR);
    }
    // Partial circular arc — exact via 3 points (start, mid, end).
    const mid = curve.getPoint(0.5);
    const wp0 = uvToWorld3(frame, reverse ? end : start);
    const wpm = uvToWorld3(frame, mid);
    const wp1 = uvToWorld3(frame, reverse ? start : end);
    return arcEdgeWorld(oc, wp0, wpm, wp1);
  }
  return null; // spline / bezier / unknown — fall back
}

/**
 * Build an analytic TopoDS_Wire from a THREE loop's curves, wound to `targetSign`
 * (positive = CCW). Returns null if any curve is unsupported or the wire fails to
 * close — the caller then uses the faceted point-loop path. The returned wire
 * carries its MakeWire builder in OCC_OWNED_RESOURCES for cleanup.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildAnalyticWire(oc: OcctRaw, curves: ThreeCurve[], frame: SketchPlaneFrame, targetSign: number): any | null {
  if (curves.length === 0) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const occ = oc as any;
  const area = curveLoopSignedAreaUV(curves);
  const reverse = area !== 0 && Math.sign(area) !== Math.sign(targetSign);
  const ordered = reverse ? [...curves].reverse() : curves;

  const wireMaker = new occ.BRepBuilderAPI_MakeWire_1();
  let added = 0;
  for (const curve of ordered) {
    const edge = curveToAnalyticEdge(oc, curve, frame, reverse);
    if (!edge) { wireMaker.delete(); return null; } // unsupported → fall back
    wireMaker.Add_1(edge);
    edge.delete();
    added++;
  }
  if (added === 0 || !wireMaker.IsDone()) { wireMaker.delete(); return null; }
  const wire = wireMaker.Wire();
  (wire as { [OCC_OWNED_RESOURCES]?: OccOwnedResource[] })[OCC_OWNED_RESOURCES] = [wireMaker];
  return wire;
}

/**
 * Analytic counterpart of sketchProfileToWires: builds (outerWire, holeWires) from
 * a THREE.Shape's curves so arcs/circles become true OCC arc/circle edges. Returns
 * null if any loop can't be built analytically — caller falls back to the faceted
 * SketchProfile path. Holes are wound to match the outer loop (wireToFace reverses
 * them to inner orientation), identical to the point-loop path's convention.
 */
export function sketchShapeToWires(
  oc: OcctRaw,
  shape: THREE.Shape,
  frame: SketchPlaneFrame,
): { outerWire: unknown; holeWires: unknown[] } | null {
  const outerCurves = (shape.curves ?? []) as unknown as ThreeCurve[];
  if (outerCurves.length === 0) return null;
  const outerSign = curveLoopSignedAreaUV(outerCurves) >= 0 ? 1 : -1;

  const outerWire = buildAnalyticWire(oc, outerCurves, frame, outerSign);
  if (!outerWire) return null;

  const holeWires: unknown[] = [];
  for (const hole of shape.holes ?? []) {
    const holeCurves = (hole.curves ?? []) as unknown as ThreeCurve[];
    // Wind holes to the SAME sign as the outer loop; wireToFace reverses them.
    const hw = buildAnalyticWire(oc, holeCurves, frame, outerSign);
    if (!hw) {
      // Abort: clean up everything built so far so the faceted fallback runs cleanly.
      for (const r of takeOccOwnedResources(outerWire)) safeDeleteOcc(r);
      for (const w of holeWires) for (const r of takeOccOwnedResources(w)) safeDeleteOcc(r);
      return null;
    }
    holeWires.push(hw);
  }
  return { outerWire, holeWires };
}

/**
 * Convert a SketchProfile (UV coords) + plane frame into (outerWire, holeWires[]).
 * Returns null if the outer wire can't be built.
 */
export function sketchProfileToWires(
  oc: OcctRaw,
  profile: SketchProfile,
  frame: SketchPlaneFrame,
): {
  outerWire: unknown;
  holeWires: unknown[];
} | null {
  const toWorld = (uv: THREE.Vector2): THREE.Vector3 =>
    frame.origin.clone()
      .addScaledVector(frame.uDir, uv.x)
      .addScaledVector(frame.vDir, uv.y);

  const outerLoop = normalizeClosedLoop2D(profile.outer);
  if (!outerLoop) return null;

  const outerClockwise = signedArea2D(outerLoop) < 0;
  const outerPts = outerLoop.map(toWorld);
  const outerWire = pointLoopToWire(oc, outerPts);
  if (!outerWire) return null;

  const holeWires = profile.holes
    .map((hole) => {
      const normalizedHole = normalizeClosedLoop2D(hole);
      if (!normalizedHole) return null;
      // Keep hole wire in the SAME winding order as the outer wire (CCW for standard
      // Three.js shapes). wireToFace calls holeWire.Reversed() before Add(), which
      // sets the topological orientation to REVERSED (= inner/hole in OCCT) and makes
      // the effective traversal CW — producing correct inward-facing hole-wall normals.
      // Reversing the geometry here AND applying REVERSED topologically would double-negate,
      // making inner walls face outward.
      return pointLoopToWire(oc, orientLoop2D(normalizedHole, outerClockwise).map(toWorld));
    })
    .filter((w): w is unknown => w !== null);

  return { outerWire, holeWires };
}

/**
 * Build a TopoDS_Face from outer wire + optional hole wires.
 * Caller owns cleanup of the returned face.
 */
export function wireToFace(
  oc: OcctRaw,
  outerWire: unknown,
  holeWires: unknown[],
  frame?: SketchPlaneFrame,
): unknown | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const occ = oc as any;
  const planePoint = frame ? new occ.gp_Pnt_3(frame.origin.x, frame.origin.y, frame.origin.z) : null;
  const planeDir = frame ? new occ.gp_Dir_4(frame.normal.x, frame.normal.y, frame.normal.z) : null;
  const plane = planePoint && planeDir ? new occ.gp_Pln_3(planePoint, planeDir) : null;
  const faceMaker = plane
    ? new occ.BRepBuilderAPI_MakeFace_16(plane, outerWire, true)
    : new occ.BRepBuilderAPI_MakeFace_15(outerWire, false);
  safeDeleteOcc(plane);
  safeDeleteOcc(planeDir);
  safeDeleteOcc(planePoint);
  for (const holeWire of holeWires) {
    // OCCT classifies wires in a face by topological orientation:
    //   FORWARD  = outer boundary
    //   REVERSED = inner boundary (hole)
    // BRepBuilderAPI_MakePolygon always produces FORWARD wires.
    // We must pass a REVERSED copy to Add() so OCCT treats it as a hole.
    //
    // TopoDS_Shape.Reversed() returns TopoDS_Shape (base class), but faceMaker.Add()
    // expects TopoDS_Wire — the Emscripten binding does a strict instanceof check and
    // throws if given a base-class instance. Cast to TopoDS_Wire via TopoDS.Wire_1()
    // (a VIEW — same ptr, no extra ownership). Delete the owned TopoDS_Shape copy after.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const reversedShape = (holeWire as any).Reversed();
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const reversedWire = (occ as any).TopoDS.Wire_1(reversedShape); // VIEW — same ptr
      faceMaker.Add(reversedWire);
      // reversedWire is a VIEW (do NOT delete it); reversedShape is the owned copy (deleted in finally)
    } finally {
      reversedShape.delete?.();
    }
  }
  if (!faceMaker.IsDone()) {
    console.warn('[wireToFace] BRepBuilderAPI_MakeFace not done after', holeWires.length, 'holes');
    faceMaker.delete();
    return null;
  }
  const face = faceMaker.Face();
  const ownedResources = [
    ...takeOccOwnedResources(outerWire),
    ...holeWires.flatMap((holeWire) => takeOccOwnedResources(holeWire)),
    faceMaker,
  ];
  (face as { [OCC_OWNED_RESOURCES]?: OccOwnedResource[] })[OCC_OWNED_RESOURCES] = ownedResources;
  return face;
}
