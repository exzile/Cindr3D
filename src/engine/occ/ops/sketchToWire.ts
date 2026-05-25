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
      polygonMaker = new (oc as any).BRepBuilderAPI_MakePolygon_3(
        retainedPoints[0],
        retainedPoints[1],
        retainedPoints[2],
        true,
      );
    } else if (retainedPoints.length === 4) {
      polygonMaker = new (oc as any).BRepBuilderAPI_MakePolygon_4(
        retainedPoints[0],
        retainedPoints[1],
        retainedPoints[2],
        retainedPoints[3],
        true,
      );
    } else {
      const wireMaker = new (oc as any).BRepBuilderAPI_MakeWire_1();
      retainedBuilders.push(wireMaker);
      for (let i = 0; i < retainedPoints.length; i++) {
        const next = (i + 1) % retainedPoints.length;
        const edgeMaker = new (oc as any).BRepBuilderAPI_MakeEdge_3(
          retainedPoints[i],
          retainedPoints[next],
        );
        retainedBuilders.push(edgeMaker);
        if (!edgeMaker.IsDone()) return null;
        const edge = edgeMaker.Edge();
        try {
          wireMaker.Add_1(edge);
        } finally {
          safeDeleteOcc(edge);
        }
      }
      if (!wireMaker.IsDone()) return null;
      const wire = wireMaker.Wire();
      keepPolygonMakerAlive = true;
      (wire as { [OCC_OWNED_RESOURCES]?: OccOwnedResource[] })[OCC_OWNED_RESOURCES] = [
        ...retainedBuilders,
        ...retainedPoints,
      ];
      return wire;
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
      for (const point of retainedPoints) safeDeleteOcc(point);
    }
  }
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
export function wireToFace(
  oc: OcctRaw,
  outerWire: any,
  holeWires: any[],
  frame?: SketchPlaneFrame,
): any | null {
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
    faceMaker.Add(holeWire);
  }
  if (!faceMaker.IsDone()) {
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
