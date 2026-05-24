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

const DEFAULT_LOOP_TOLERANCE = 1e-5;
const DEFAULT_LOOP_TOLERANCE_SQ = DEFAULT_LOOP_TOLERANCE * DEFAULT_LOOP_TOLERANCE;
const MIN_LOOP_AREA = 1e-10;

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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wireMaker: any = new oc.BRepBuilderAPI_MakeWire_1();
  const loop = points.slice();
  if (loop.length > 1 && loop[0].distanceToSquared(loop.at(-1)!) <= DEFAULT_LOOP_TOLERANCE_SQ) {
    loop.pop();
  }

  let edgeCount = 0;
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i];
    const b = loop[(i + 1) % loop.length];
    if (a.distanceToSquared(b) < 1e-12) continue;

    const pa = makeGpPnt(oc, a);
    const pb = makeGpPnt(oc, b);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const edgeMaker = new (oc as any).BRepBuilderAPI_MakeEdge_3(pa, pb);
    pa.delete();
    pb.delete();

    if (!edgeMaker.IsDone()) {
      edgeMaker.delete();
      continue;
    }

    wireMaker.Add_1(edgeMaker.Edge());
    edgeMaker.delete();
    edgeCount += 1;
  }

  if (edgeCount < 3 || !wireMaker.IsDone()) {
    wireMaker.delete();
    return null;
  }

  const wire = wireMaker.Wire();
  wireMaker.delete();
  return wire;
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  outerWire: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  holeWires: any[];
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
      return pointLoopToWire(oc, orientLoop2D(normalizedHole, !outerClockwise).map(toWorld));
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((w): w is any => w !== null);

  return { outerWire, holeWires };
}

/**
 * Build a TopoDS_Face from outer wire + optional hole wires.
 * Caller owns cleanup of the returned face.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function wireToFace(oc: OcctRaw, outerWire: any, holeWires: any[]): any | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const faceMaker = new (oc as any).BRepBuilderAPI_MakeFace_15(outerWire, false);
  for (const holeWire of holeWires) {
    faceMaker.Add(holeWire);
  }
  if (!faceMaker.IsDone()) {
    faceMaker.delete();
    return null;
  }
  const face = faceMaker.Face();
  faceMaker.delete();
  return face;
}
