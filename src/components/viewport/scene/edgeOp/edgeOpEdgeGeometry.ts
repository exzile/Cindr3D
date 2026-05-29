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
import {
  getSelectableEdges,
  type SelectableEdgeMeta,
} from "../../../../engine/occ/ops/selectableEdges";

export type GuideGeometryResult = {
  geometry: THREE.BufferGeometry;
  edgeIdsBySegment: number[];
  edgePolylines: Map<number, THREE.Vector3[]>;
  /** OCC-12.B1 — edgeId → tangent chainId (only when built from selectable-edge meta). */
  chainIdByEdgeId?: Map<number, number>;
};

/**
 * Resolve authoritative selectable-edge metadata for an OCC body.
 * Returns null when the body is gone or OCC is still loading.
 */
export function getSelectableEdgesForBody(
  bodyId: string | undefined,
): Map<number, SelectableEdgeMeta> | null {
  if (!bodyId) return null;
  const body = globalBRepBodyRegistry.get(bodyId);
  if (!body) return null;
  const occ = getOccSync();
  if (!occ) return null;
  try {
    return getSelectableEdges(occ.oc, body);
  } catch (e) {
    console.warn("[selectableEdges] metadata build failed; using legacy heuristics:", e);
    return null;
  }
}

/**
 * OCC-12.B2/B3 — expand a clicked/hovered edge to its tangent chain using the
 * authoritative chainId map (the SAME grouping fillet `propagate` uses), instead
 * of the per-frame polylineTangentChain geometric BFS.
 */
export function expandChainEdges(
  chainMap: Map<number, number> | undefined,
  edgePolylines: Map<number, THREE.Vector3[]>,
  seedEdgeId: number,
): Set<number> {
  const result = new Set<number>([seedEdgeId]);
  if (!chainMap) return result;
  const chainId = chainMap.get(seedEdgeId);
  if (chainId === undefined) return result;
  for (const [edgeId, cid] of chainMap) {
    if (cid === chainId && edgePolylines.has(edgeId)) result.add(edgeId);
  }
  return result;
}

export function disposeGuideGeometryResult(result: GuideGeometryResult | null | undefined): void {
  result?.geometry.dispose();
  result?.edgePolylines.clear();
}

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
  if (tess && bodyId) return { tess, bodyId };

  const featureId = mesh.userData.featureId as string | undefined;
  const body =
    (bodyId ? globalBRepBodyRegistry.get(bodyId) : undefined) ??
    (featureId ? globalBRepBodyRegistry.getByFeature(featureId).find((candidate) => candidate._tessellation ?? candidate.shape) : undefined);

  if (!body) return null;

  // Tessellate on-demand if the body exists but _tessellation hasn't been cached yet.
  if (!body._tessellation) {
    const occ = getOccSync();
    if (!occ) return null;
    try {
      body._tessellation = tessellate(occ.oc, body);
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

/**
 * Polygon-arc chain threshold: chains with more members than this are
 * polygon approximations of a curved edge (circle/arc tessellated as many
 * straight segments). The visible guide merges them into one arc polyline
 * (allowCurvedEdges=true) or filters them entirely (allowCurvedEdges=false),
 * matching the behaviour for real analytical OCC circle/arc edges.
 */
const POLYGON_ARC_CHAIN_THRESHOLD = 8;

/** Build a Map<chainId, memberCount> from the meta entries. */
function buildChainSizes(
  edgeIds: Iterable<number>,
  meta: Map<number, SelectableEdgeMeta>,
): Map<number, number> {
  const sizes = new Map<number, number>();
  for (const edgeId of edgeIds) {
    const chainId = meta.get(edgeId)?.chainId;
    if (chainId !== undefined && chainId >= 0) {
      sizes.set(chainId, (sizes.get(chainId) ?? 0) + 1);
    }
  }
  return sizes;
}

/**
 * Sort 2-point polygon-arc segments (each a Float32Array[6]) into a
 * continuous chain by greedy nearest-endpoint matching. Reverses segments
 * as needed so each start connects to the previous end.
 */
function sortSegmentsIntoChain(segments: Float32Array[]): Float32Array[] {
  if (segments.length <= 1) return segments;
  const remaining = [...segments];
  const result: Float32Array[] = [remaining.splice(0, 1)[0]];
  while (remaining.length > 0) {
    const last = result[result.length - 1];
    const lx = last[last.length - 3], ly = last[last.length - 2], lz = last[last.length - 1];
    let bestI = 0, bestDist = Infinity, bestRev = false;
    for (let i = 0; i < remaining.length; i++) {
      const pts = remaining[i];
      const d0 = (pts[0] - lx) ** 2 + (pts[1] - ly) ** 2 + (pts[2] - lz) ** 2;
      const n = pts.length;
      const dR = (pts[n - 3] - lx) ** 2 + (pts[n - 2] - ly) ** 2 + (pts[n - 1] - lz) ** 2;
      if (d0 < bestDist) { bestDist = d0; bestI = i; bestRev = false; }
      if (dR < bestDist) { bestDist = dR; bestI = i; bestRev = true; }
    }
    const next = remaining.splice(bestI, 1)[0];
    if (bestRev) {
      const n = next.length / 3;
      const rev = new Float32Array(next.length);
      for (let i = 0; i < n; i++) {
        rev[i * 3] = next[(n - 1 - i) * 3];
        rev[i * 3 + 1] = next[(n - 1 - i) * 3 + 1];
        rev[i * 3 + 2] = next[(n - 1 - i) * 3 + 2];
      }
      result.push(rev);
    } else {
      result.push(next);
    }
  }
  return result;
}

export function buildBatchedEdgeLineGeometry(
  tess: BRepTessellation,
  allowCurvedEdges: boolean,
  meta?: Map<number, SelectableEdgeMeta> | null,
): { geometry: THREE.BufferGeometry; edgeIdsBySegment: number[] } | null {
  const positions: number[] = [];
  const edgeIdsBySegment: number[] = [];
  const useMeta = !!meta;
  // Polygon-arc filter: chains with many members are tessellated approximations
  // of a curved edge. Pre-compute sizes so we can filter them in the loop.
  const chainSizes = useMeta && !allowCurvedEdges
    ? buildChainSizes(tess.edgePolylines.keys(), meta!)
    : null;

  for (const [edgeId, polyline] of tess.edgePolylines) {
    if (useMeta) {
      const m = meta!.get(edgeId);
      if (m?.filletable === false) continue;
      if (m && !m.sharpEdge) continue; // smooth surface edge — hide like Fusion 360
      // Treat polygon-arc chains the same as real curved edges.
      if (!allowCurvedEdges && chainSizes) {
        const chainId = m?.chainId;
        if (chainId !== undefined && (chainSizes.get(chainId) ?? 1) > POLYGON_ARC_CHAIN_THRESHOLD) continue;
      }
    }
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

/**
 * Build line geometry for TANGENT (smooth) edges — the fillet / round / chamfer
 * surface boundaries where two faces meet at a shallow (G1-continuous) dihedral.
 * These are the reference lines Fusion 360 draws around fillets. They are
 * deliberately returned WITHOUT an edgeIdsBySegment map and rendered on a plain
 * LineSegments with no pick userData, so the edge picker never selects them — they
 * are purely a visual reference.
 *
 * Selection: `filletable === true` (excludes seams / open boundaries) AND
 * `blendEdge === true` — the edge borders a curved fillet/round/chamfer-blend face
 * with a shallow (≤45°) dihedral. `blendEdge` is what separates a real tangent blend
 * boundary (including corner-blend arcs nudged past the 15° sharp threshold by
 * faceted neighbour walls) from both the facet seams inside a polygon-approximated
 * curved WALL (flat-flat, never a blend) and genuine ~90° corners like a bore rim.
 * Returns null when there are none.
 */
export function buildTangentEdgeLineGeometry(
  tess: BRepTessellation,
  meta: Map<number, SelectableEdgeMeta>,
): THREE.BufferGeometry | null {
  const positions: number[] = [];
  for (const [edgeId, polyline] of tess.edgePolylines) {
    const m = meta.get(edgeId);
    if (!m || m.filletable === false || !m.blendEdge) continue;
    const pointCount = polyline.length / 3;
    if (pointCount < 2) continue;
    for (let index = 0; index < pointCount - 1; index += 1) {
      const a = index * 3;
      const b = (index + 1) * 3;
      positions.push(
        polyline[a], polyline[a + 1], polyline[a + 2],
        polyline[b], polyline[b + 1], polyline[b + 2],
      );
    }
  }
  if (positions.length === 0) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
  return geometry;
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
  meta?: Map<number, SelectableEdgeMeta> | null,
): GuideGeometryResult | null {
  const positions: number[] = [];
  const edgeIdsBySegment: number[] = [];
  const edgePolylines = new Map<number, THREE.Vector3[]>();
  const chainIdByEdgeId = new Map<number, number>();
  const useMeta = !!meta;
  // Polygon-arc chain handling: chains with > THRESHOLD members are polygon
  // approximations of a curved edge. For the VISIBLE guide:
  //   allowCurvedEdges=true  → merge the whole chain into one arc polyline
  //   allowCurvedEdges=false → filter entirely (same as real curved edges)
  // The invisible pick line (buildBatchedEdgeLineGeometry) keeps individual
  // segments for accurate click detection.
  const chainSizes = useMeta
    ? buildChainSizes(tess.edgePolylines.keys(), meta!)
    : null;
  const largeChainProcessed = new Set<number>();

  if (useMeta && chainSizes) {
    // Group large-chain edge IDs
    const chainEdgeGroups = new Map<number, number[]>();
    for (const [edgeId] of tess.edgePolylines) {
      const m = meta!.get(edgeId);
      if (!m || m.filletable === false) continue;
      if (!m.sharpEdge) continue; // smooth surface edge — hide like Fusion 360
      const chainId = m.chainId;
      if (chainId === undefined || chainId < 0) continue;
      if ((chainSizes.get(chainId) ?? 1) <= POLYGON_ARC_CHAIN_THRESHOLD) continue;
      const group = chainEdgeGroups.get(chainId) ?? [];
      group.push(edgeId);
      chainEdgeGroups.set(chainId, group);
    }

    for (const [chainId, chainEdgeIds] of chainEdgeGroups) {
      // All members are handled here — skip them in the main loop below.
      for (const eid of chainEdgeIds) largeChainProcessed.add(eid);
      if (!allowCurvedEdges) continue; // filter entirely

      // Build a single continuous arc polyline from the polygon segments.
      const segments = chainEdgeIds
        .map((eid) => tess.edgePolylines.get(eid))
        .filter((p): p is Float32Array => !!p && p.length >= 6);
      if (segments.length === 0) continue;

      const ordered = sortSegmentsIntoChain(segments);
      const repEdgeId = chainEdgeIds[0];
      const worldPts: THREE.Vector3[] = [];
      for (let si = 0; si < ordered.length; si++) {
        const pts = ordered[si];
        const ptCount = pts.length / 3;
        const startI = si === 0 ? 0 : 1; // skip duplicate junction point
        for (let i = startI; i < ptCount; i++) {
          worldPts.push(
            new THREE.Vector3(pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2]).applyMatrix4(meshMatrix),
          );
        }
      }
      if (worldPts.length < 2) continue;

      edgePolylines.set(repEdgeId, worldPts);
      for (let i = 0; i + 1 < worldPts.length; i++) {
        const a = worldPts[i], b = worldPts[i + 1];
        positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
        edgeIdsBySegment.push(repEdgeId);
      }
      // Register ALL chain member IDs in chainIdByEdgeId so that clicking any
      // individual pick-line segment can expand to show the merged arc highlight.
      for (const eid of chainEdgeIds) chainIdByEdgeId.set(eid, chainId);
    }
  }

  for (const [edgeId, polyline] of tess.edgePolylines) {
    if (largeChainProcessed.has(edgeId)) continue; // handled above
    if (useMeta) {
      const m = meta!.get(edgeId);
      if (m?.filletable === false) continue;
      if (m && !m.sharpEdge) continue; // smooth surface edge — hide like Fusion 360
      if (m && m.chainId >= 0) chainIdByEdgeId.set(edgeId, m.chainId);
    }
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
  return {
    geometry,
    edgeIdsBySegment,
    edgePolylines,
    chainIdByEdgeId: useMeta ? chainIdByEdgeId : undefined,
  };
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
