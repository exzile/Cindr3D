import { useRef, useCallback, useEffect, useMemo } from "react";
import * as THREE from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { useFrame, useThree } from "@react-three/fiber";
import { buildPolylineGeometry } from "../pickerGeometry";
import { applyLinePulse } from "../pickPulse";
import { useOccEdgePicker, type OccEdgePickResult } from "../OccEdgePicker";
import { globalBRepBodyRegistry } from "../../../../engine/occ/globalRegistry";
import { migrateLegacyExtrudeFeatures } from "../../../../engine/occ/legacyMigration";
import { getOcc } from "../../../../engine/occ/loader";
import {
  attachTessellationToMesh,
  getMeshTessellation,
} from "../../../../engine/occ/picking";
import type { BRepTessellation } from "../../../../engine/occ/brepBody";
import type { BodyTopology } from "../../../../engine/geometryEngine/core/solid/edgeTypes";
import { useCADStore } from "../../../../store/cadStore";

interface EdgeOpEdgeHighlightProps {
  enabled: boolean;
  edgeIds: string[];
  addEdge: (id: string) => void;
  removeEdge: (id: string) => void;
  selectedColor: number;
  allowCurvedEdges?: boolean;
}

const EDGE_GUIDE_RENDER_ORDER = 1398;
const EDGE_HOVER_RENDER_ORDER = 1402;
const EDGE_SELECTED_RENDER_ORDER = 1403;

function occEdgeId(result: OccEdgePickResult): string {
  return `occ:${result.bodyId}:${result.edgeId}`;
}

function getOccEdgePolyline(result: OccEdgePickResult): THREE.Vector3[] | null {
  const body = globalBRepBodyRegistry.get(result.bodyId);
  const pts = body?._tessellation?.edgePolylines.get(result.edgeId);
  if (!pts || pts.length < 6) return null;
  const out: THREE.Vector3[] = [];
  for (let i = 0; i + 2 < pts.length; i += 3) {
    out.push(new THREE.Vector3(pts[i], pts[i + 1], pts[i + 2]).applyMatrix4(result.mesh.matrixWorld));
  }
  return out.length >= 2 ? out : null;
}

function polylineIsCurved(polyline: Float32Array | THREE.Vector3[]): boolean {
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

function resolveMeshOccTessellation(mesh: THREE.Mesh) {
  let tess = getMeshTessellation(mesh);
  let bodyId = mesh.userData.brepBodyId as string | undefined;
  if (tess && bodyId) return { tess, bodyId };

  const featureId = mesh.userData.featureId as string | undefined;
  const body =
    (bodyId ? globalBRepBodyRegistry.get(bodyId) : undefined) ??
    (featureId ? globalBRepBodyRegistry.getByFeature(featureId).find((candidate) => candidate._tessellation) : undefined);
  if (!body) return null;

  tess = body._tessellation ?? null;
  if (!tess) return null;
  bodyId = body.id;
  attachTessellationToMesh(mesh, tess, body.id);
  return { tess, bodyId };
}

function buildBatchedEdgeLineGeometry(
  tess: BRepTessellation,
  allowCurvedEdges: boolean,
): { geometry: THREE.BufferGeometry; edgeIdsBySegment: number[] } | null {
  const positions: number[] = [];
  const edgeIdsBySegment: number[] = [];

  for (const [edgeId, polyline] of tess.edgePolylines) {
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

type StraightEdgeInfo = {
  edgeId: number | string;
  center: THREE.Vector3;
  length: number;
  direction: THREE.Vector3;
};

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

    // Many same-length, same-direction straight OCC edges are usually ruled
    // surface generator strips from cylindrical/lofted faces. They are not
    // fillet/chamfer targets; the selectable edges are the boundary loops.
    // Preserve true exterior box/plate edges that happen to share the same
    // direction/length as those generators.
    for (const info of group) {
      if (isOnExteriorBounds(info)) continue;
      hidden.add(info.edgeId);
    }
  }
  return hidden;
}

function detectSyntheticGeneratorEdges(tess: BRepTessellation): Set<number | string> {
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

type GuideGeometryResult = {
  geometry: THREE.BufferGeometry;
  edgeIdsBySegment: number[];
  edgePolylines: Map<number, THREE.Vector3[]>;
};

function mergedGuideGeometryResults(
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

// Used as the visible guide for OCC bodies whose mesh has no BodyTopology userData
// (i.e. bodies rendered directly from tessellation, not via CSG).
// Stores world-space polylines keyed by the real OCC edge ID so handleOccClick
// can use the edgeId directly without proximity remapping.
function buildTessellationGuideGeometry(
  tess: BRepTessellation,
  meshMatrix: THREE.Matrix4,
  allowCurvedEdges: boolean,
): GuideGeometryResult | null {
  const positions: number[] = [];
  const edgeIdsBySegment: number[] = [];
  const edgePolylines = new Map<number, THREE.Vector3[]>();

  for (const [edgeId, polyline] of tess.edgePolylines) {
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
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  return { geometry, edgeIdsBySegment, edgePolylines };
}

function buildMeshTopologyGuideGeometry(
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

function buildMergedMeshCreaseGuideGeometry(
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

  // Mesh-only fallback geometry is faceted, so a low threshold turns every
  // cylinder segment into a fake selectable-looking edge. Keep this high and
  // only draw true rim/box creases; OCC-backed bodies still use exact curved
  // edge polylines above.
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

/**
 * When a topology-based guideLine is clicked on an OCC body, the edgeId is a
 * sequential topology index, not an OCC edge number. This resolves it by finding
 * the tessellation edge whose midpoint (in world space) is closest to the topology
 * edge's midpoint so fillet/chamfer commit always receives a valid OCC edge ID.
 */
function findClosestOccEdge(
  tess: BRepTessellation,
  topologyPolylineWorld: THREE.Vector3[],
  meshMatrix: THREE.Matrix4,
  allowCurvedEdges: boolean,
): { edgeId: number; polylineWorld: THREE.Vector3[]; distance: number } | null {
  if (topologyPolylineWorld.length === 0) return null;
  const mid = topologyPolylineWorld[Math.floor(topologyPolylineWorld.length / 2)].clone();
  const first = topologyPolylineWorld[0];
  const last = topologyPolylineWorld[topologyPolylineWorld.length - 1];
  const syntheticEdgeIds = detectSyntheticGeneratorEdges(tess);
  let bestId: number | null = null;
  let bestDist = Infinity;
  for (const [edgeId, pts] of tess.edgePolylines) {
    if (syntheticEdgeIds.has(edgeId)) continue;
    if (!allowCurvedEdges && polylineIsCurved(pts)) continue;
    const count = pts.length / 3;
    const ci = Math.floor(count / 2);
    const tessFirst = new THREE.Vector3(pts[0], pts[1], pts[2]).applyMatrix4(meshMatrix);
    const tessMid = new THREE.Vector3(pts[ci * 3], pts[ci * 3 + 1], pts[ci * 3 + 2]).applyMatrix4(meshMatrix);
    const tessLast = new THREE.Vector3(
      pts[(count - 1) * 3],
      pts[(count - 1) * 3 + 1],
      pts[(count - 1) * 3 + 2],
    ).applyMatrix4(meshMatrix);
    const sameDirection = first.distanceTo(tessFirst) + last.distanceTo(tessLast);
    const reversed = first.distanceTo(tessLast) + last.distanceTo(tessFirst);
    const endpointDist = Math.min(sameDirection, reversed);
    const dist = mid.distanceTo(tessMid) + endpointDist * 0.5;
    if (dist < bestDist) { bestDist = dist; bestId = edgeId; }
  }
  if (bestId === null) return null;
  const pts = tess.edgePolylines.get(bestId)!;
  const count = pts.length / 3;
  const polylineWorld: THREE.Vector3[] = [];
  for (let i = 0; i < count; i++) {
    polylineWorld.push(new THREE.Vector3(pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2]).applyMatrix4(meshMatrix));
  }
  return { edgeId: bestId, polylineWorld, distance: bestDist };
}

type ResolvedOccEdgeSelection = {
  bodyId: string;
  edgeId: number;
  polylineWorld: THREE.Vector3[];
};

function findClosestLiveOccEdge(
  topologyPolylineWorld: THREE.Vector3[],
  allowCurvedEdges: boolean,
  preferredBodyId?: string,
  preferredFeatureId?: string,
  meshMatrix = new THREE.Matrix4(),
): ResolvedOccEdgeSelection | null {
  const candidates: Array<{ bodyId: string; matrix: THREE.Matrix4 }> = [];
  const seen = new Set<string>();
  const addCandidate = (bodyId: string | undefined, matrix: THREE.Matrix4) => {
    if (!bodyId || seen.has(bodyId)) return;
    const body = globalBRepBodyRegistry.get(bodyId);
    if (!body?._tessellation) return;
    seen.add(bodyId);
    candidates.push({ bodyId, matrix });
  };

  addCandidate(preferredBodyId, meshMatrix);
  if (preferredFeatureId) {
    for (const body of globalBRepBodyRegistry.getByFeature(preferredFeatureId)) {
      addCandidate(body.id, meshMatrix);
    }
  }
  if (candidates.length === 0) {
    for (const bodyId of globalBRepBodyRegistry.snapshot().bodyIds) {
      addCandidate(bodyId, new THREE.Matrix4());
    }
  }

  let best: ResolvedOccEdgeSelection | null = null;
  let bestDistance = Infinity;
  for (const candidate of candidates) {
    const body = globalBRepBodyRegistry.get(candidate.bodyId);
    if (!body?._tessellation) continue;
    const edge = findClosestOccEdge(body._tessellation, topologyPolylineWorld, candidate.matrix, allowCurvedEdges);
    if (!edge || edge.distance >= bestDistance) continue;
    bestDistance = edge.distance;
    best = {
      bodyId: candidate.bodyId,
      edgeId: edge.edgeId,
      polylineWorld: edge.polylineWorld,
    };
  }
  return best;
}

export default function EdgeOpEdgeHighlight({
  enabled,
  edgeIds,
  addEdge,
  removeEdge,
  selectedColor,
  allowCurvedEdges = false,
}: EdgeOpEdgeHighlightProps) {
  const hoverMat = useMemo(
    () =>
      new THREE.LineBasicMaterial({
        color: 0x2196f3,
        linewidth: 2,
        transparent: true,
        depthTest: false,
        depthWrite: false,
      }),
    [],
  );
  const selectedMat = useMemo(
    () =>
      new THREE.LineBasicMaterial({
        color: selectedColor,
        linewidth: 3,
        transparent: true,
        depthTest: false,
        depthWrite: false,
      }),
    [selectedColor],
  );
  const allEdgesMat = useMemo(
    () =>
      new THREE.LineBasicMaterial({
        color: 0xff6a00,
        transparent: true,
        opacity: 1,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      }),
    [],
  );
  const pickEdgesMat = useMemo(
    () =>
      new THREE.LineBasicMaterial({
        color: 0xff6a00,
        transparent: true,
        opacity: 0,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      }),
    [],
  );

  useEffect(() => () => hoverMat.dispose(), [hoverMat]);
  useEffect(() => () => selectedMat.dispose(), [selectedMat]);
  useEffect(() => () => allEdgesMat.dispose(), [allEdgesMat]);
  useEffect(() => () => pickEdgesMat.dispose(), [pickEdgesMat]);

  const allEdgeLinesRef = useRef<THREE.LineSegments[]>([]);
  const hoverLineRef = useRef<THREE.Line | null>(null);
  const occHoverRef = useRef<OccEdgePickResult | null>(null);
  const renderedHoverIdRef = useRef<string | null>(null);
  const selectedLinesRef = useRef<Map<string, THREE.Line>>(new Map());
  const selectedEdgesDataRef = useRef<Map<string, THREE.Vector3[]>>(new Map());
  const lastMigrationKeyRef = useRef<string | null>(null);
  // Feature IDs that have already been attempted in migration (success or crash).
  // Prevents the infinite retry loop when OCC WASM crashes on a legacy feature.
  const attemptedMigrationIdsRef = useRef<Set<string>>(new Set());
  const cursorOnRef = useRef(false);
  const { scene: _scene, gl, invalidate: invalidateCanvas } = useThree();
  const features = useCADStore((state) => state.features);
  const sketches = useCADStore((state) => state.sketches);

  const edgeSourceSignature = useMemo(
    () =>
      features
        .filter((feature) => feature.visible && !feature.suppressed)
        .map((feature) => `${feature.id}:${feature.timestamp}:${feature.mesh instanceof THREE.Mesh ? feature.mesh.uuid : ''}`)
        .join("|"),
    [features],
  );

  // Compute a stable string key so that visibleBodyFeatureIds is only a new
  // Set reference when the actual IDs change — not on every features re-render.
  const visibleBodyFeatureIdsKey = useMemo(
    () =>
      features
        .filter((feature) => feature.visible && !feature.suppressed && feature.type !== "sketch")
        .map((feature) => feature.id)
        .sort()
        .join(","),
    [features],
  );
  const visibleBodyFeatureIds = useMemo(
    () => new Set(visibleBodyFeatureIdsKey ? visibleBodyFeatureIdsKey.split(",") : []),
    [visibleBodyFeatureIdsKey],
  );

  const edgeIdSet = useMemo(() => new Set(edgeIds), [edgeIds]);

  useEffect(() => {
    const sceneRef = _scene;
    const canvas = gl.domElement;
    const selectedLines = selectedLinesRef.current;
    const selectedEdges = selectedEdgesDataRef.current;
    return () => {
      if (hoverLineRef.current) {
        sceneRef.remove(hoverLineRef.current);
        hoverLineRef.current.geometry.dispose();
        hoverLineRef.current = null;
      }
      for (const line of allEdgeLinesRef.current) {
        sceneRef.remove(line);
        line.geometry.dispose();
      }
      allEdgeLinesRef.current = [];
      selectedLines.forEach((line) => {
        sceneRef.remove(line);
        line.geometry.dispose();
      });
      selectedLines.clear();
      selectedEdges.clear();
      if (cursorOnRef.current) {
        canvas.style.cursor = "";
        cursorOnRef.current = false;
      }
    };
  }, [_scene, gl]);

  const handleOccHover = useCallback((result: OccEdgePickResult | null) => {
    if (result && !result.bodyId) {
      const stored = result.mesh.userData['edgePolylines'] as Map<number, THREE.Vector3[]> | undefined;
      const pts = stored?.get(result.edgeId);
      const featureId = result.mesh.userData['sourceFeatureId'] as string | undefined;
      const meshMatrix = (result.mesh.userData['meshMatrix'] as THREE.Matrix4 | undefined) ?? new THREE.Matrix4();
      if (!pts || !findClosestLiveOccEdge(pts, allowCurvedEdges, undefined, featureId, meshMatrix)) {
        occHoverRef.current = null;
        invalidateCanvas();
        return;
      }
    }
    if (result && !allowCurvedEdges) {
      // guideLine (topology) has edgePolylines; pickLine (OCC tessellation) does not.
      const isTopologyHit = result.mesh.userData['edgePolylines'] !== undefined;
      if (isTopologyHit) {
        const stored = result.mesh.userData['edgePolylines'] as Map<number, THREE.Vector3[]> | undefined;
        const pts = stored?.get(result.edgeId);
        if (pts && polylineIsCurved(pts)) {
          occHoverRef.current = null;
          invalidateCanvas();
          return;
        }
      } else {
        const body = globalBRepBodyRegistry.get(result.bodyId);
        const occPolyline = body?._tessellation?.edgePolylines.get(result.edgeId);
        if (occPolyline && polylineIsCurved(occPolyline)) {
          occHoverRef.current = null;
          invalidateCanvas();
          return;
        }
      }
    }
    occHoverRef.current = result;
    invalidateCanvas();
  }, [allowCurvedEdges, invalidateCanvas]);

  const handleOccClick = useCallback((result: OccEdgePickResult) => {

    // guideLine (topology) has edgePolylines; pickLine (OCC tessellation) does not.
    const isTopologyHit = result.mesh.userData['edgePolylines'] !== undefined;
    let polyline: THREE.Vector3[] | null = null;
    let displayPolyline: THREE.Vector3[] | null = null;
    let resolvedBodyId = result.bodyId;
    let resolvedEdgeId = result.edgeId;
    let sourceBody = globalBRepBodyRegistry.get(result.bodyId);
    let visualSourceFeatureId: string | undefined;

    if (!isTopologyHit) {
      // pickLine hit: OCC edge ID is already correct — use tessellation directly.
      polyline = getOccEdgePolyline(result);
      displayPolyline = polyline;
    }

    if (!polyline) {
      // topology guideLine hit (or OCC lookup failed): get stored world-space polyline.
      const stored = result.mesh.userData['edgePolylines'] as Map<number, THREE.Vector3[]> | undefined;
      polyline = stored?.get(result.edgeId) ?? null;
      displayPolyline = polyline;

      // For OCC bodies, resolve the topology index → nearest OCC tessellation edge ID
      // so that fillet/chamfer commit always receives a valid numeric OCC edge number.
      if (polyline) {
        const meshMatrix = (result.mesh.userData['meshMatrix'] as THREE.Matrix4 | undefined) ?? new THREE.Matrix4();
        const featureId = result.mesh.userData['sourceFeatureId'] as string | undefined;
        const occ = sourceBody?._tessellation
          ? findClosestOccEdge(sourceBody._tessellation, polyline, meshMatrix, allowCurvedEdges)
          : findClosestLiveOccEdge(polyline, allowCurvedEdges, resolvedBodyId, featureId, meshMatrix);
        if (occ) {
          polyline = occ.polylineWorld;
          resolvedEdgeId = occ.edgeId;
          if ('bodyId' in occ) {
            if (!resolvedBodyId && featureId) visualSourceFeatureId = featureId;
            resolvedBodyId = occ.bodyId;
            sourceBody = globalBRepBodyRegistry.get(resolvedBodyId);
          }
        }
      }
    }
    if (!polyline || !sourceBody || !resolvedBodyId) return;
    if (!allowCurvedEdges && polylineIsCurved(polyline)) return;
    const id = visualSourceFeatureId
      ? `occ:${resolvedBodyId}:${resolvedEdgeId}:feature:${visualSourceFeatureId}`
      : `occ:${resolvedBodyId}:${resolvedEdgeId}`;
    if (edgeIdSet.has(id)) {
      removeEdge(id);
      return;
    }
    selectedEdgesDataRef.current.set(id, displayPolyline ?? polyline);
    addEdge(id);
  }, [addEdge, removeEdge, edgeIdSet, allowCurvedEdges]);

  useOccEdgePicker({
    enabled,
    onHover: handleOccHover,
    onClick: handleOccClick,
  });

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;

    const migrate = (occ: Awaited<ReturnType<typeof getOcc>>) => {
      // Key off only feature IDs so mesh-UUID churn from CSG fallback doesn't
      // cause retries. Once every current extrude ID has been attempted, stop.
      const pendingIds = features
        .filter((f) => f.type === "extrude" && !attemptedMigrationIdsRef.current.has(f.id))
        .map((f) => f.id);
      if (pendingIds.length === 0) return;

      const legacyKey = features
        .filter((feature) => feature.type === "extrude")
        .map((feature) => feature.id)
        .join("|");
      if (!legacyKey || legacyKey === lastMigrationKeyRef.current) return;

      const migrated = migrateLegacyExtrudeFeatures(features, sketches, occ);

      const changed = migrated.some((feature, index) => feature !== features[index]);
      if (changed) {
        useCADStore.setState({ features: migrated });
        return;
      }
      // Only mark a no-change pass as attempted. If migration changed any
      // upstream feature, downstream booleans may become migratable on the
      // next render and must not be blocked by this crash guard.
      for (const id of pendingIds) {
        attemptedMigrationIdsRef.current.add(id);
      }
      lastMigrationKeyRef.current = legacyKey;
    };

    getOcc()
      .then((occ) => {
        if (!cancelled) migrate(occ);
      })
      .catch((error) => {
        console.warn("[EdgeOpEdgeHighlight] OCC load failed before legacy migration", error);
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, features, sketches]);

  useEffect(() => {
    let cancelled = false;
    let initialBuildHandle: number | null = null;
    let retryHandle: number | null = null;
    let attempts = 0;
    const maxAttempts = 24;
    for (const line of allEdgeLinesRef.current) {
      _scene.remove(line);
      line.geometry.dispose();
    }
    allEdgeLinesRef.current = [];
    if (!enabled) return undefined;

    const buildLines = () => {
      for (const line of allEdgeLinesRef.current) {
        _scene.remove(line);
        line.geometry.dispose();
      }
      const lines: THREE.LineSegments[] = [];
      _scene.traverse((obj) => {
        if (!(obj instanceof THREE.Mesh) && !(obj as THREE.Mesh).isMesh) return;
        const mesh = obj as THREE.Mesh;
        if (!mesh.visible) return;
        const featureId = mesh.userData.featureId as string | undefined;
        const bodyId = mesh.userData.brepBodyId as string | undefined;
        if (featureId && !visibleBodyFeatureIds.has(featureId)) return;
        if (!featureId && !bodyId) return;
        const resolved = resolveMeshOccTessellation(mesh);
        if (bodyId && !resolved) return;
        const batched = resolved
          ? buildBatchedEdgeLineGeometry(resolved.tess, allowCurvedEdges)
          : null;

        // Visible orange guide — always built from topology/crease so every boundary
        // edge of the mesh is shown regardless of OCC tessellation filtering.
        // edgeIdsBySegment is always set so the picker detects it for hover/cursor.
        // meshMatrix lets handleOccClick map a topology-index hit back to the nearest
        // OCC tessellation edge ID when an OCC body is present.
        const topologyGuideResult = buildMeshTopologyGuideGeometry(mesh, allowCurvedEdges);
        const renderedGuideResult = buildMergedMeshCreaseGuideGeometry(mesh, allowCurvedEdges);
        const tessellationGuideResult = resolved
          ? buildTessellationGuideGeometry(resolved.tess, mesh.matrixWorld, allowCurvedEdges)
          : null;
        const fallbackGuideResult = allowCurvedEdges
          ? mergedGuideGeometryResults(topologyGuideResult, tessellationGuideResult, renderedGuideResult)
          : topologyGuideResult ?? renderedGuideResult ?? tessellationGuideResult;
        if (!batched && !fallbackGuideResult) return;
        if (fallbackGuideResult) {
          const guideLine = new THREE.LineSegments(fallbackGuideResult.geometry, allEdgesMat);
          guideLine.userData.edgeIdsBySegment = fallbackGuideResult.edgeIdsBySegment;
          guideLine.userData.edgePolylines = fallbackGuideResult.edgePolylines;
          guideLine.userData.brepBodyId = resolved?.bodyId ?? "";
          guideLine.userData.sourceFeatureId = featureId ?? "";
          guideLine.userData.meshMatrix = mesh.matrixWorld.clone();
          if (resolved?.bodyId) {
            guideLine.userData.brepBodyId = resolved.bodyId;
          }
          guideLine.frustumCulled = false;
          guideLine.matrixAutoUpdate = true;
          guideLine.renderOrder = EDGE_GUIDE_RENDER_ORDER;
          _scene.add(guideLine);
          lines.push(guideLine);
        }
        // Invisible OCC tessellation pick target — carries exact OCC edge IDs needed
        // when no visible guide could be built. If both exist, the visible guide wins
        // so selected feedback matches the line the user actually clicked.
        if (batched && !fallbackGuideResult) {
          const pickLine = new THREE.LineSegments(batched.geometry, pickEdgesMat);
          pickLine.userData.edgeIdsBySegment = batched.edgeIdsBySegment;
          pickLine.userData.brepBodyId = resolved!.bodyId;
          pickLine.frustumCulled = false;
          pickLine.matrixAutoUpdate = true;
          pickLine.renderOrder = EDGE_GUIDE_RENDER_ORDER;
          _scene.add(pickLine);
          lines.push(pickLine);
        }
      });
      allEdgeLinesRef.current = lines;
      invalidateCanvas();
      return lines.length;
    };

    const scheduleBuild = (delayMs: number) => {
      retryHandle = window.setTimeout(() => {
        retryHandle = null;
        if (cancelled) return;
        attempts += 1;
        const lineCount = buildLines();
        if (lineCount > 0 || attempts >= maxAttempts) return;
        scheduleBuild(125);
      }, delayMs);
    };

    initialBuildHandle = window.setTimeout(() => {
      initialBuildHandle = null;
      if (cancelled) return;
      const lineCount = buildLines();
      if (lineCount > 0) return;
      scheduleBuild(125);
    }, 250);

    return () => {
      cancelled = true;
      if (initialBuildHandle !== null) window.clearTimeout(initialBuildHandle);
      if (retryHandle !== null) window.clearTimeout(retryHandle);
      for (const line of allEdgeLinesRef.current) {
        _scene.remove(line);
        line.geometry.dispose();
      }
      allEdgeLinesRef.current = [];
    };
  }, [enabled, _scene, allEdgesMat, pickEdgesMat, allowCurvedEdges, edgeSourceSignature, visibleBodyFeatureIds, invalidateCanvas]);

  useFrame(({ scene, invalidate }) => {
    if (!enabled) {
      /* eslint-disable-next-line react-hooks/immutability */
      allEdgesMat.opacity = 1;
      if (hoverLineRef.current) {
        scene.remove(hoverLineRef.current);
        hoverLineRef.current.geometry.dispose();
        hoverLineRef.current = null;
        renderedHoverIdRef.current = null;
      }
      if (selectedLinesRef.current.size > 0) {
        selectedLinesRef.current.forEach((line) => {
          scene.remove(line);
          line.geometry.dispose();
        });
        selectedLinesRef.current.clear();
        selectedEdgesDataRef.current.clear();
      }
      if (cursorOnRef.current) {
        /* eslint-disable-next-line react-hooks/immutability */
        gl.domElement.style.cursor = "";
        cursorOnRef.current = false;
      }
      return;
    }

    if (allEdgeLinesRef.current.length > 0 || occHoverRef.current || selectedLinesRef.current.size > 0 || edgeIds.length > 0) {
      invalidate();
    }

    const wantCursor = !!occHoverRef.current;
    if (wantCursor !== cursorOnRef.current) {
      gl.domElement.style.cursor = wantCursor ? "crosshair" : "";
      cursorOnRef.current = wantCursor;
    }

    const occHover = occHoverRef.current;
    if (occHover) {
      const id = occEdgeId(occHover);
      if (id !== renderedHoverIdRef.current || !hoverLineRef.current) {
        renderedHoverIdRef.current = id;
        // OCC body: get polyline from tessellation; topology guideLine: fall back to stored polyline.
        const hPts = getOccEdgePolyline(occHover)
          ?? (occHover.mesh.userData['edgePolylines'] as Map<number, THREE.Vector3[]> | undefined)?.get(occHover.edgeId)
          ?? null;
        if (hPts) {
          if (!hoverLineRef.current) {
            const line = new THREE.Line(buildPolylineGeometry(hPts), hoverMat);
            line.renderOrder = EDGE_HOVER_RENDER_ORDER;
            scene.add(line);
            hoverLineRef.current = line;
          } else {
            hoverLineRef.current.geometry.dispose();
            hoverLineRef.current.geometry = buildPolylineGeometry(hPts);
          }
        }
      }
    } else if (hoverLineRef.current) {
      scene.remove(hoverLineRef.current);
      hoverLineRef.current.geometry.dispose();
      hoverLineRef.current = null;
      renderedHoverIdRef.current = null;
    }

    selectedLinesRef.current.forEach((line, id) => {
      if (!edgeIdSet.has(id)) {
        scene.remove(line);
        line.geometry.dispose();
        selectedLinesRef.current.delete(id);
        selectedEdgesDataRef.current.delete(id);
      }
    });
    for (const id of edgeIds) {
      if (!selectedLinesRef.current.has(id)) {
        const edgeData = selectedEdgesDataRef.current.get(id);
        if (edgeData && edgeData.length >= 2) {
          const line = new THREE.Line(buildPolylineGeometry(edgeData), selectedMat);
          line.renderOrder = EDGE_SELECTED_RENDER_ORDER;
          scene.add(line);
          selectedLinesRef.current.set(id, line);
        }
      }
    }

    const now = performance.now();
    if (allEdgeLinesRef.current.length > 0) {
      allEdgesMat.opacity = 0.82 + 0.18 * (0.5 + 0.5 * Math.sin(now * 0.006));
    }
    if (hoverLineRef.current) applyLinePulse(hoverLineRef.current, 1, now);
    selectedLinesRef.current.forEach((line) => {
      const material = line.material as THREE.Material;
      material.opacity = 0.65 + 0.35 * (0.5 + 0.5 * Math.sin(now * 0.006));
      material.transparent = true;
    });
  });

  return null;
}
