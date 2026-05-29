import * as THREE from "three";
import type { OccEdgePickResult } from "../OccEdgePicker";
import { globalBRepBodyRegistry } from "../../../../engine/occ/globalRegistry";
import type { BRepTessellation } from "../../../../engine/occ/brepBody";
import { getSelectableEdgesForBody, polylineIsCurved } from "./edgeOpEdgeGeometry";
import type { SelectableEdgeMeta } from "../../../../engine/occ/ops/selectableEdges";

export type ResolvedOccEdgeSelection = {
  bodyId: string;
  edgeId: number;
  polylineWorld: THREE.Vector3[];
};

export function occEdgeId(result: OccEdgePickResult): string {
  return `occ:${result.bodyId}:${result.edgeId}`;
}

export function getOccEdgePolyline(result: OccEdgePickResult): THREE.Vector3[] | null {
  const body = globalBRepBodyRegistry.get(result.bodyId);
  const pts = body?._tessellation?.edgePolylines.get(result.edgeId);
  if (!pts || pts.length < 6) return null;
  const out: THREE.Vector3[] = [];
  for (let i = 0; i + 2 < pts.length; i += 3) {
    out.push(new THREE.Vector3(pts[i], pts[i + 1], pts[i + 2]).applyMatrix4(result.mesh.matrixWorld));
  }
  return out.length >= 2 ? out : null;
}

export function findClosestOccEdge(
  tess: BRepTessellation,
  topologyPolylineWorld: THREE.Vector3[],
  meshMatrix: THREE.Matrix4,
  allowCurvedEdges: boolean,
  meta?: Map<number, SelectableEdgeMeta> | null,
): { edgeId: number; polylineWorld: THREE.Vector3[]; distance: number } | null {
  if (topologyPolylineWorld.length === 0) return null;
  const mid = topologyPolylineWorld[Math.floor(topologyPolylineWorld.length / 2)].clone();
  const first = topologyPolylineWorld[0];
  const last = topologyPolylineWorld[topologyPolylineWorld.length - 1];
  let bestId: number | null = null;
  let bestDist = Infinity;
  for (const [edgeId, pts] of tess.edgePolylines) {
    if (meta) {
      const m = meta.get(edgeId);
      if (m?.filletable === false) continue;
    }
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
    if (dist < bestDist) {
      bestDist = dist;
      bestId = edgeId;
    }
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

export function findClosestLiveOccEdge(
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
    const meta = getSelectableEdgesForBody(candidate.bodyId);
    const edge = findClosestOccEdge(body._tessellation, topologyPolylineWorld, candidate.matrix, allowCurvedEdges, meta);
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
