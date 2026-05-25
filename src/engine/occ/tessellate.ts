import * as THREE from 'three';
import { occDeref, type BRepBody, type BRepTessellation } from './brepBody';
import { getOcc } from './loader';
import type { OcctRaw } from './types';
import { OCC_PROFILE_POINT_COUNT } from '../../utils/occConstants';

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
  try {
    const mesher = new oc.BRepMesh_IncrementalMesh_2(
      shape,
      options.linearDeflection ?? 0.1,
      options.relative ?? false,
      options.angularDeflection ?? 0.5,
      options.parallel ?? false,
    );
    try {
      performMesh(oc, mesher);
    } finally {
      mesher.delete();
    }

    const positions: number[] = [];
    const normals: number[] = [];
    const faceIds: number[] = [];

    const faceLookup = new Map<number, number>();
    for (const [faceId, handle] of body.faceIds) {
      faceLookup.set(handle.ptr, faceId);
    }

    const explorer = new oc.TopExp_Explorer_2(shape, oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
    let fallbackFaceId = 0;
    try {
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
    } finally {
      explorer.delete();
    }

    const tessellation: BRepTessellation = {
      positions: new Float32Array(positions),
      normals: new Float32Array(normals),
      faceIds: new Uint32Array(faceIds),
      edgePolylines: buildEdgePolylines(oc, body),
    };
    body._tessellation = tessellation;
    return tessellation;
  } finally {
    shape.delete?.();
  }
}

export const tessellateWithInstance = tessellate;

function performMesh(
  oc: OcctRaw,
  mesher: { Perform: (...args: unknown[]) => void },
): void {
  if (typeof oc.Message_ProgressRange_1 !== 'function') {
    mesher.Perform();
    return;
  }

  const progress = new oc.Message_ProgressRange_1();
  try {
    mesher.Perform(progress);
  } catch (error) {
    const message = String((error as { message?: unknown })?.message ?? error);
    if (!message.includes('expected 0 args')) {
      throw error;
    }
    mesher.Perform();
  } finally {
    progress.delete?.();
  }
}

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

  // Reusable scalar buffers — avoids THREE.Vector3 allocations per triangle.
  const px = [0, 0, 0];
  const py = [0, 0, 0];
  const pz = [0, 0, 0];

  for (let index = 1; index <= triCount; index += 1) {
    const tri = poly.Triangle(index);
    const v0 = tri.Value(1);
    const v1 = reversed ? tri.Value(3) : tri.Value(2);
    const v2 = reversed ? tri.Value(2) : tri.Value(3);
    tri.delete();

    const nodeIndices = [v0, v1, v2];
    for (let k = 0; k < 3; k++) {
      const node = poly.Node(nodeIndices[k]);
      if (transform) {
        const pt = node.Transformed(transform);
        node.delete();
        px[k] = pt.X(); py[k] = pt.Y(); pz[k] = pt.Z();
        pt.delete();
      } else {
        px[k] = node.X(); py[k] = node.Y(); pz[k] = node.Z();
        node.delete();
      }
    }

    // Compute face normal inline — no THREE.Vector3 allocations.
    const ax = px[1] - px[0], ay = py[1] - py[0], az = pz[1] - pz[0];
    const bx = px[2] - px[0], by = py[2] - py[0], bz = pz[2] - pz[0];
    let nx = ay * bz - az * by;
    let ny = az * bx - ax * bz;
    let nz = ax * by - ay * bx;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (len > 1e-10) { nx /= len; ny /= len; nz /= len; }

    for (let k = 0; k < 3; k++) {
      positions.push(px[k], py[k], pz[k]);
      normals.push(nx, ny, nz);
    }
    faceIds.push(faceId);
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
    } finally {
      rawEdge.delete?.();
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
    const divisions = OCC_PROFILE_POINT_COUNT;
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
