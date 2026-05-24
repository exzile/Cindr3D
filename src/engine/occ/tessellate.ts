import * as THREE from 'three';
import { occDeref, type BRepBody, type BRepTessellation } from './brepBody';
import { getOcc } from './loader';
import type { OcctRaw } from './types';

export interface BRepTessellateOptions {
  linearDeflection?: number;
  angularDeflection?: number;
  relative?: boolean;
  parallel?: boolean;
  useCache?: boolean;
}

export async function tessellateAsync(
  body: BRepBody,
  options: BRepTessellateOptions = {},
): Promise<BRepTessellation> {
  const { oc } = await getOcc();
  return tessellate(oc, body, options);
}

export function tessellate(
  oc: OcctRaw,
  body: BRepBody,
  options: BRepTessellateOptions = {},
): BRepTessellation {
  const hasExplicitQuality =
    options.linearDeflection !== undefined ||
    options.angularDeflection !== undefined ||
    options.relative !== undefined ||
    options.parallel !== undefined;
  if (options.useCache !== false && !hasExplicitQuality && body._tessellation) {
    return body._tessellation;
  }

  const shape = occDeref(oc, body.shape, oc.TopoDS_Shape);
  const mesher = new oc.BRepMesh_IncrementalMesh_2(
    shape,
    options.linearDeflection ?? 0.1,
    options.relative ?? false,
    options.angularDeflection ?? 0.5,
    options.parallel ?? false,
  );
  mesher.Perform();
  mesher.delete();

  const positions: number[] = [];
  const normals: number[] = [];
  const faceIds: number[] = [];

  const faceLookup = new Map<number, number>();
  for (const [faceId, handle] of body.faceIds) {
    faceLookup.set(handle.ptr, faceId);
  }

  const explorer = new oc.TopExp_Explorer_2(shape, oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
  let fallbackFaceId = 0;
  while (explorer.More()) {
    const current = explorer.Current();
    const face = oc.TopoDS.Face_1(current);
    const faceId = faceLookup.get(face.ptr) ?? fallbackFaceId;
    fallbackFaceId += 1;
    const location = new oc.TopLoc_Location_1();
    const triangulation = oc.BRep_Tool.Triangulation(face, location);

    if (!triangulation.IsNull()) {
      appendFaceTriangles(oc, triangulation, location, face, faceId, positions, normals, faceIds);
    }

    triangulation.delete();
    location.delete();
    face.delete();
    current.delete();
    explorer.Next();
  }
  explorer.delete();

  const tessellation: BRepTessellation = {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    faceIds: new Uint32Array(faceIds),
    edgePolylines: buildEdgePolylines(oc, body),
  };
  body._tessellation = tessellation;
  return tessellation;
}

export const tessellateWithInstance = tessellate;

export function tessellationToGeometry(tessellation: BRepTessellation): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(tessellation.positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(tessellation.normals, 3));
  return geometry;
}

export function computeAdaptiveLinearDeflection(cameraDistance: number, bboxDiagonal: number): number {
  const safeDistance = Math.max(1, cameraDistance);
  const safeDiagonal = Math.max(1, bboxDiagonal);
  const zoomRatio = safeDistance / safeDiagonal;
  return THREE.MathUtils.clamp(safeDiagonal * zoomRatio * 0.0025, 0.01, safeDiagonal * 0.01);
}

function appendFaceTriangles(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  oc: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  triangulation: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  location: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  face: any,
  faceId: number,
  positions: number[],
  normals: number[],
  faceIds: number[],
): void {
  const transform = location.IsIdentity() ? null : location.Transformation();
  const poly = triangulation.get();
  const triCount = poly.NbTriangles();
  const reversed = face.Orientation_1() === oc.TopAbs_Orientation.TopAbs_REVERSED;

  for (let index = 1; index <= triCount; index += 1) {
    const tri = poly.Triangle(index);
    const indices = reversed
      ? [tri.Value(1), tri.Value(3), tri.Value(2)]
      : [tri.Value(1), tri.Value(2), tri.Value(3)];
    const points = indices.map((nodeIndex) => {
      const node = poly.Node(nodeIndex);
      const point = transform ? node.Transformed(transform) : node;
      return new THREE.Vector3(point.X(), point.Y(), point.Z());
    });
    const normal = new THREE.Vector3()
      .subVectors(points[1], points[0])
      .cross(new THREE.Vector3().subVectors(points[2], points[0]))
      .normalize();

    for (const point of points) {
      positions.push(point.x, point.y, point.z);
      normals.push(normal.x, normal.y, normal.z);
    }
    faceIds.push(faceId);
    tri.delete();
  }

  poly.delete();
  transform?.delete();
}

function buildEdgePolylines(oc: OcctRaw, body: BRepBody): Map<number, Float32Array> {
  const edgePolylines = new Map<number, Float32Array>();
  for (const [edgeId, edgeHandle] of body.edgeIds) {
    const rawEdge = occDeref(oc, edgeHandle, oc.TopoDS_Edge);
    try {
      const polyline = sampleEdgePolyline(oc, rawEdge);
      if (polyline.length >= 6) edgePolylines.set(edgeId, polyline);
    } catch {
      // Keep tessellation usable even if a rare OCC curve adapter is unavailable.
    }
  }
  return edgePolylines;
}

function sampleEdgePolyline(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  oc: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rawEdge: any,
): Float32Array {
  const curve =
    typeof oc.BRepAdaptor_Curve_2 === 'function'
      ? new oc.BRepAdaptor_Curve_2(rawEdge)
      : new oc.BRepAdaptor_Curve_1(rawEdge);
  const point = new oc.gp_Pnt_1();
  try {
    const first = curve.FirstParameter();
    const last = curve.LastParameter();
    if (!Number.isFinite(first) || !Number.isFinite(last) || first === last) {
      return new Float32Array();
    }
    const divisions = 96;
    const out: number[] = [];
    for (let i = 0; i <= divisions; i += 1) {
      const u = first + ((last - first) * i) / divisions;
      curve.D0(u, point);
      out.push(point.X(), point.Y(), point.Z());
    }
    return new Float32Array(out);
  } finally {
    point.delete?.();
    curve.delete?.();
  }
}
