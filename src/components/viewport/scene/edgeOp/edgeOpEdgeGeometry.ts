import * as THREE from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import {
  attachTessellationToMesh,
  getMeshTessellation,
} from "../../../../engine/occ/picking";
import { globalBRepBodyRegistry } from "../../../../engine/occ/globalRegistry";
import type { BRepTessellation } from "../../../../engine/occ/brepBody";
import type { BodyTopology } from "../../../../engine/geometryEngine/core/solid/edgeTypes";
import { getOccSync } from "../../../../engine/occ/loader";
import { tessellate } from "../../../../engine/occ/tessellate";

export type GuideGeometryResult = {
  geometry: THREE.BufferGeometry;
  edgeIdsBySegment: number[];
  edgePolylines: Map<number, THREE.Vector3[]>;
};

type StraightEdgeInfo = {
  edgeId: number | string;
  center: THREE.Vector3;
  length: number;
  direction: THREE.Vector3;
};

export function polylineIsCurved(polyline: Float32Array | THREE.Vector3[]): boolean {
  const count = Array.isArray(polyline) ? polyline.length : polyline.length / 3;
  if (count <= 2) return false;
  const first = Array.isArray(polyline)
    ? polyline[0]
    : new THREE.Vector3(polyline[0], polyline[1], polyline[2]);
  const last = Array.isArray(polyline)
    ? polyline[count - 1]
    : new THREE.Vector3(polyline[(count - 1) * 3], polyline[(count - 1) * 3 + 1], polyline[(count - 1) * 3 + 2]);
  const axis = last.clone().sub(first);
  const axisLen = axis.length();
  if (axisLen < 1e-8) return true;
  axis.divideScalar(axisLen);
  const tolerance = Math.max(axisLen * 1e-3, 1e-5);
  for (let index = 1; index < count - 1; index += 1) {
    const point = Array.isArray(polyline)
      ? polyline[index]
      : new THREE.Vector3(polyline[index * 3], polyline[index * 3 + 1], polyline[index * 3 + 2]);
    const offset = point.clone().sub(first);
    const projected = first.clone().addScaledVector(axis, offset.dot(axis));
    if (point.distanceTo(projected) > tolerance) return true;
  }
  return false;
}

export function resolveMeshOccTessellation(mesh: THREE.Mesh) {
  let tess = getMeshTessellation(mesh);
  // brepBodyId is set by attachTessellationToMesh; bodyId (no-prefix) is set by
  // ExtrudedBodies.tsx for stored-mesh features that never went through
  // attachTessellationToMesh. Accept either key so stored extrude/boolean meshes work.
  let bodyId = (mesh.userData.brepBodyId ?? mesh.userData.bodyId) as string | undefined;
  // A cached tess with no edge polylines is a stale tessellation built before
  // the edge-polyline cast fix (TopoDS.Edge_1) — force rebuild from the body.
  const cachedHasEdges = tess && tess.edgePolylines.size > 0;
  if (cachedHasEdges && bodyId) return { tess: tess!, bodyId };

  const featureId = mesh.userData.featureId as string | undefined;
  const body =
    (bodyId ? globalBRepBodyRegistry.get(bodyId) : undefined) ??
    (featureId ? globalBRepBodyRegistry.getByFeature(featureId).find((candidate) => candidate._tessellation ?? candidate.shape) : undefined);

  if (!body) return null;

  // Tessellate on-demand if the body exists but _tessellation hasn't been cached yet,
  // OR if the cached tessellation has no edge polylines (stale pre-fix data).
  if (!body._tessellation || body._tessellation.edgePolylines.size === 0) {
    const occ = getOccSync();
    if (!occ) return null;
    try {
      body._tessellation = tessellate(occ.oc, body, { useCache: false });
    } catch (e) {
      console.warn('[resolveMeshOcc] on-demand tessellate failed:', e);
      return null;
    }
  }

  tess = body._tessellation;
  bodyId = body.id;
  attachTessellationToMesh(mesh, tess, body.id);
  return { tess, bodyId };
}

export function buildBatchedEdgeLineGeometry(
  tess: BRepTessellation,
  allowCurvedEdges: boolean,
): { geometry: THREE.BufferGeometry; edgeIdsBySegment: number[] } | null {
  const positions: number[] = [];
  const edgeIdsBySegment: number[] = [];
  // Filter out synthetic generator edges (polygonal cylinder facet lines, etc.):
  // OCC tessellation often includes ~N parallel straight edges for cylindrical /
  // toroidal faces. detectSyntheticGeneratorEdges flags groups of 9+ parallel
  // same-length edges that aren't on the model's exterior bounds.
  const synthetic = detectSyntheticGeneratorEdges(tess);

  for (const [edgeId, polyline] of tess.edgePolylines) {
    if (synthetic.has(edgeId)) continue;
    if (!allowCurvedEdges && polylineIsCurved(polyline)) continue;
    const pointCount = polyline.length / 3;
    if (pointCount < 2) continue;
    for (let index = 0; index < pointCount - 1; index += 1) {
      const a = index * 3;
      const b = (index + 1) * 3;
      positions.push(
        polyline[a],
        polyline[a + 1],
        polyline[a + 2],
        polyline[b],
        polyline[b + 1],
        polyline[b + 2],
      );
      edgeIdsBySegment.push(edgeId);
    }
  }

  if (positions.length === 0) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
  return { geometry, edgeIdsBySegment };
}

function canonicalDirection(direction: THREE.Vector3): THREE.Vector3 {
  const out = direction.clone().normalize();
  if (
    out.x < -1e-6 ||
    (Math.abs(out.x) <= 1e-6 && out.y < -1e-6) ||
    (Math.abs(out.x) <= 1e-6 && Math.abs(out.y) <= 1e-6 && out.z < -1e-6)
  ) {
    out.multiplyScalar(-1);
  }
  return out;
}

function straightEdgeInfo(edgeId: number | string, polyline: Float32Array): StraightEdgeInfo | null {
  const pointCount = polyline.length / 3;
  if (pointCount < 2) return null;
  const first = new THREE.Vector3(polyline[0], polyline[1], polyline[2]);
  const last = new THREE.Vector3(
    polyline[(pointCount - 1) * 3],
    polyline[(pointCount - 1) * 3 + 1],
    polyline[(pointCount - 1) * 3 + 2],
  );
  const delta = last.clone().sub(first);
  const length = delta.length();
  if (length < 1e-5) return null;
  const direction = delta.clone().normalize();
  const maxDeviation = Math.max(length * 0.0075, 1e-4);
  for (let index = 1; index < pointCount - 1; index += 1) {
    const point = new THREE.Vector3(polyline[index * 3], polyline[index * 3 + 1], polyline[index * 3 + 2]);
    const offset = point.clone().sub(first);
    const projected = first.clone().addScaledVector(direction, offset.dot(direction));
    if (point.distanceTo(projected) > maxDeviation) return null;
  }
  return {
    edgeId,
    center: first.add(last).multiplyScalar(0.5),
    length,
    direction: canonicalDirection(direction),
  };
}

function straightEdgeGroupKey(info: StraightEdgeInfo): string {
  const dir = info.direction;
  const quantizedLength = Math.round(info.length * 1000);
  return [
    Math.round(dir.x * 100),
    Math.round(dir.y * 100),
    Math.round(dir.z * 100),
    quantizedLength,
  ].join(":");
}

function detectSyntheticEdgeInfos(
  infos: StraightEdgeInfo[],
  bounds?: { min: THREE.Vector3; max: THREE.Vector3 },
): Set<number | string> {
  const groups = new Map<string, StraightEdgeInfo[]>();
  for (const info of infos) {
    const key = straightEdgeGroupKey(info);
    const group = groups.get(key) ?? [];
    group.push(info);
    groups.set(key, group);
  }

  const hidden = new Set<number | string>();
  const boundsSize = bounds ? bounds.max.clone().sub(bounds.min) : null;
  const boundsTolerance = boundsSize ? Math.max(boundsSize.length() * 1e-4, 1e-4) : 0;
  const isOnExteriorBounds = (info: StraightEdgeInfo) =>
    !!bounds &&
    (Math.abs(info.center.x - bounds.min.x) <= boundsTolerance ||
      Math.abs(info.center.x - bounds.max.x) <= boundsTolerance ||
      Math.abs(info.center.y - bounds.min.y) <= boundsTolerance ||
      Math.abs(info.center.y - bounds.max.y) <= boundsTolerance ||
      Math.abs(info.center.z - bounds.min.z) <= boundsTolerance ||
      Math.abs(info.center.z - bounds.max.z) <= boundsTolerance);

  for (const group of groups.values()) {
    if (group.length < 9) continue;
    for (const info of group) {
      if (isOnExteriorBounds(info)) continue;
      hidden.add(info.edgeId);
    }
  }
  return hidden;
}

export function detectSyntheticGeneratorEdges(tess: BRepTessellation): Set<number | string> {
  const infos: StraightEdgeInfo[] = [];
  const min = new THREE.Vector3(Infinity, Infinity, Infinity);
  const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  for (const [edgeId, polyline] of tess.edgePolylines) {
    for (let index = 0; index + 2 < polyline.length; index += 3) {
      min.min(new THREE.Vector3(polyline[index], polyline[index + 1], polyline[index + 2]));
      max.max(new THREE.Vector3(polyline[index], polyline[index + 1], polyline[index + 2]));
    }
    const info = straightEdgeInfo(edgeId, polyline);
    if (info) infos.push(info);
  }
  const bounds = Number.isFinite(min.x) ? { min, max } : undefined;
  return detectSyntheticEdgeInfos(infos, bounds);
}

export function mergedGuideGeometryResults(
  ...results: Array<GuideGeometryResult | null | undefined>
): GuideGeometryResult | null {
  const positions: number[] = [];
  const edgeIdsBySegment: number[] = [];
  const edgePolylines = new Map<number, THREE.Vector3[]>();
  const seenSegments = new Set<string>();
  let nextEdgeId = 0;

  const quantizedPoint = (point: THREE.Vector3) =>
    `${Math.round(point.x * 10000)},${Math.round(point.y * 10000)},${Math.round(point.z * 10000)}`;
  const segmentKey = (a: THREE.Vector3, b: THREE.Vector3) => {
    const qa = quantizedPoint(a);
    const qb = quantizedPoint(b);
    return qa < qb ? `${qa}|${qb}` : `${qb}|${qa}`;
  };

  for (const result of results) {
    if (!result) continue;
    for (const sourcePolyline of result.edgePolylines.values()) {
      if (sourcePolyline.length < 2) continue;
      const edgeId = nextEdgeId;
      let appended = false;
      for (let index = 0; index < sourcePolyline.length - 1; index += 1) {
        const a = sourcePolyline[index];
        const b = sourcePolyline[index + 1];
        if (a.distanceToSquared(b) < 1e-10) continue;
        const key = segmentKey(a, b);
        if (seenSegments.has(key)) continue;
        seenSegments.add(key);
        positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
        edgeIdsBySegment.push(edgeId);
        appended = true;
      }
      if (!appended) continue;
      edgePolylines.set(edgeId, sourcePolyline.map((point) => point.clone()));
      nextEdgeId += 1;
    }
  }

  if (positions.length === 0) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
  return { geometry, edgeIdsBySegment, edgePolylines };
}

export function buildTessellationGuideGeometry(
  tess: BRepTessellation,
  meshMatrix: THREE.Matrix4,
  allowCurvedEdges: boolean,
): GuideGeometryResult | null {
  const positions: number[] = [];
  const edgeIdsBySegment: number[] = [];
  const edgePolylines = new Map<number, THREE.Vector3[]>();
  // Skip synthetic generator edges (polygonal facet iso-lines on cylinders /
  // tori / sweeps) so the user sees only real CAD edges.
  const synthetic = detectSyntheticGeneratorEdges(tess);

  for (const [edgeId, polyline] of tess.edgePolylines) {
    if (synthetic.has(edgeId)) continue;
    if (!allowCurvedEdges && polylineIsCurved(polyline)) continue;
    const pointCount = polyline.length / 3;
    if (pointCount < 2) continue;
    const worldPts: THREE.Vector3[] = [];
    for (let i = 0; i < pointCount; i++) {
      worldPts.push(new THREE.Vector3(polyline[i * 3], polyline[i * 3 + 1], polyline[i * 3 + 2]).applyMatrix4(meshMatrix));
    }
    edgePolylines.set(edgeId, worldPts);
    for (let index = 0; index < pointCount - 1; index++) {
      const a = worldPts[index];
      const b = worldPts[index + 1];
      positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
      edgeIdsBySegment.push(edgeId);
    }
  }

  if (positions.length === 0) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
  return { geometry, edgeIdsBySegment, edgePolylines };
}

export function buildMeshTopologyGuideGeometry(
  mesh: THREE.Mesh,
  allowCurvedEdges: boolean,
  curvedOnly = false,
): GuideGeometryResult | null {
  const topology = mesh.geometry.userData?.topology as BodyTopology | undefined;
  const positions: number[] = [];
  const edgeIdsBySegment: number[] = [];
  const edgePolylines = new Map<number, THREE.Vector3[]>();
  const world = mesh.matrixWorld;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();

  if (!topology?.edges?.length) return null;
  let edgeIndex = 0;
  for (const edge of topology.edges) {
    const curved = polylineIsCurved(edge.polyline);
    if (curvedOnly && !curved) continue;
    if (!allowCurvedEdges && curved) continue;
    if (edge.polyline.length < 2) continue;
    const worldPts = edge.polyline.map((pt) => pt.clone().applyMatrix4(world));
    edgePolylines.set(edgeIndex, worldPts);
    for (let index = 0; index < edge.polyline.length - 1; index += 1) {
      a.copy(edge.polyline[index]).applyMatrix4(world);
      b.copy(edge.polyline[index + 1]).applyMatrix4(world);
      positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
      edgeIdsBySegment.push(edgeIndex);
    }
    edgeIndex += 1;
  }

  if (positions.length === 0) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
  return { geometry, edgeIdsBySegment, edgePolylines };
}

export function buildMergedMeshCreaseGuideGeometry(
  mesh: THREE.Mesh,
  allowCurvedEdges: boolean,
): GuideGeometryResult | null {
  const source = mesh.geometry;
  const merged = mergeVertices(source, 1e-4);
  const position = merged.getAttribute("position") as THREE.BufferAttribute | undefined;
  if (!position || position.count < 3) {
    merged.dispose();
    return null;
  }

  const index = merged.index;
  const edgeMap = new Map<string, { a: THREE.Vector3; b: THREE.Vector3; normals: THREE.Vector3[] }>();
  const p0 = new THREE.Vector3();
  const p1 = new THREE.Vector3();
  const p2 = new THREE.Vector3();
  const n = new THREE.Vector3();
  const q = (v: THREE.Vector3) => `${Math.round(v.x * 10000)},${Math.round(v.y * 10000)},${Math.round(v.z * 10000)}`;
  type BoundaryEdge = { a: THREE.Vector3; b: THREE.Vector3; keyA: string; keyB: string };

  const addEdge = (a: THREE.Vector3, b: THREE.Vector3, normal: THREE.Vector3) => {
    const qa = q(a);
    const qb = q(b);
    const key = qa < qb ? `${qa}|${qb}` : `${qb}|${qa}`;
    const existing = edgeMap.get(key);
    if (existing) {
      existing.normals.push(normal.clone());
      return;
    }
    edgeMap.set(key, { a: a.clone(), b: b.clone(), normals: [normal.clone()] });
  };

  const triCount = index ? index.count / 3 : position.count / 3;
  for (let tri = 0; tri < triCount; tri += 1) {
    const ia = index ? index.getX(tri * 3) : tri * 3;
    const ib = index ? index.getX(tri * 3 + 1) : tri * 3 + 1;
    const ic = index ? index.getX(tri * 3 + 2) : tri * 3 + 2;
    p0.fromBufferAttribute(position, ia);
    p1.fromBufferAttribute(position, ib);
    p2.fromBufferAttribute(position, ic);
    n.subVectors(p1, p0).cross(new THREE.Vector3().subVectors(p2, p0));
    if (n.lengthSq() < 1e-16) continue;
    n.normalize();
    addEdge(p0, p1, n);
    addEdge(p1, p2, n);
    addEdge(p2, p0, n);
  }

  const creaseThreshold = THREE.MathUtils.degToRad(20);
  const positions: number[] = [];
  const edgeIdsBySegment: number[] = [];
  const edgePolylines = new Map<number, THREE.Vector3[]>();
  const world = mesh.matrixWorld;
  const boundaryEdges: BoundaryEdge[] = [];
  const appendedBoundaryEdges = new Set<number>();
  let segmentId = 0;
  const appendSegment = (edge: { a: THREE.Vector3; b: THREE.Vector3 }) => {
    const wa = edge.a.clone().applyMatrix4(world);
    const wb = edge.b.clone().applyMatrix4(world);
    positions.push(wa.x, wa.y, wa.z, wb.x, wb.y, wb.z);
    edgeIdsBySegment.push(segmentId);
    edgePolylines.set(segmentId, [wa, wb]);
    segmentId += 1;
  };
  const appendBoundaryTopologyEdges = () => {
    if (boundaryEdges.length === 0) return;
    const incident = new Map<string, number[]>();
    boundaryEdges.forEach((edge, index) => {
      const aList = incident.get(edge.keyA) ?? [];
      aList.push(index);
      incident.set(edge.keyA, aList);
      const bList = incident.get(edge.keyB) ?? [];
      bList.push(index);
      incident.set(edge.keyB, bList);
    });

    const visited = new Set<number>();
    for (let start = 0; start < boundaryEdges.length; start += 1) {
      if (visited.has(start)) continue;
      const component: number[] = [];
      const stack = [start];
      visited.add(start);
      while (stack.length > 0) {
        const index = stack.pop()!;
        component.push(index);
        const edge = boundaryEdges[index];
        for (const key of [edge.keyA, edge.keyB]) {
          for (const next of incident.get(key) ?? []) {
            if (visited.has(next)) continue;
            visited.add(next);
            stack.push(next);
          }
        }
      }
      const componentKeys = new Set<string>();
      for (const index of component) {
        componentKeys.add(boundaryEdges[index].keyA);
        componentKeys.add(boundaryEdges[index].keyB);
      }
      const degrees = [...componentKeys].map((key) => incident.get(key)?.length ?? 0);
      const maxDegree = Math.max(...degrees);
      if (maxDegree > 2) continue;
      const closedCount = degrees.filter((degree) => degree === 2).length;
      const endpointCount = degrees.filter((degree) => degree === 1).length;
      const mostlyClosed = closedCount >= componentKeys.size * 0.85;
      const openChain = endpointCount === 2 && closedCount === componentKeys.size - 2;
      if (!openChain && (!allowCurvedEdges || component.length < 8 || !mostlyClosed)) continue;
      for (const index of component) {
        if (appendedBoundaryEdges.has(index)) continue;
        const edge = boundaryEdges[index];
        if (mostlyClosed) {
          const degreeA = incident.get(edge.keyA)?.length ?? 0;
          const degreeB = incident.get(edge.keyB)?.length ?? 0;
          if (degreeA !== 2 || degreeB !== 2) continue;
        }
        appendedBoundaryEdges.add(index);
        appendSegment(edge);
      }
    }
  };

  for (const edge of edgeMap.values()) {
    let include = false;
    if (edge.normals.length === 1) {
      boundaryEdges.push({ a: edge.a, b: edge.b, keyA: q(edge.a), keyB: q(edge.b) });
      continue;
    }
    if (!include) {
      for (let i = 0; !include && i < edge.normals.length; i += 1) {
        for (let j = i + 1; j < edge.normals.length; j += 1) {
          if (edge.normals[i].angleTo(edge.normals[j]) >= creaseThreshold) {
            include = true;
            break;
          }
        }
      }
    }
    if (!include) continue;
    appendSegment(edge);
  }
  appendBoundaryTopologyEdges();
  merged.dispose();

  if (positions.length === 0) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
  return { geometry, edgeIdsBySegment, edgePolylines };
}
