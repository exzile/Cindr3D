import * as THREE from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { extractEdgeTopology } from "../../../../engine/geometryEngine/core/solid/edgeTopology";
import { isCurvedEdge } from "./edgeOpHighlightIds";

/** Version tag matching nearestEdge.ts — bump both when lazy-fallback logic changes. */
const LAZY_TOPO_VERSION = 10;

type OverlayEdge = { polyline: THREE.Vector3[] };

export function guideEdgesForOverlay(
  displayEdges: OverlayEdge[] | undefined,
  ghostEdges: OverlayEdge[] | undefined,
  topoEdges: OverlayEdge[],
  allowCurvedEdges: boolean,
): OverlayEdge[] {
  const edges = displayEdges?.length
    ? displayEdges
    : ghostEdges?.length
      ? ghostEdges
      : topoEdges;
  return allowCurvedEdges ? edges : edges.filter((edge) => !isCurvedEdge(edge));
}

function pointSegmentDistanceSq(
  p: THREE.Vector3,
  a: THREE.Vector3,
  b: THREE.Vector3,
): number {
  const ab = b.clone().sub(a);
  const lenSq = ab.lengthSq();
  if (lenSq < 1e-12) return p.distanceToSquared(a);
  const t = THREE.MathUtils.clamp(p.clone().sub(a).dot(ab) / lenSq, 0, 1);
  return p.distanceToSquared(a.clone().addScaledVector(ab, t));
}

function pointPolylineDistanceSq(
  p: THREE.Vector3,
  polyline: THREE.Vector3[],
): number {
  let best = Infinity;
  for (let i = 0; i + 1 < polyline.length; i++) {
    best = Math.min(
      best,
      pointSegmentDistanceSq(p, polyline[i], polyline[i + 1]),
    );
  }
  return best;
}

export function filterStaleDisplayEdges(
  displayEdges: OverlayEdge[] | undefined,
  ghostEdges: OverlayEdge[] | undefined,
  bounds: THREE.Box3 | null,
): OverlayEdge[] | undefined {
  if (!displayEdges?.length) return displayEdges;
  const diag = Math.max(bounds?.min.distanceTo(bounds.max) ?? 1, 1);
  const nearSq = Math.max((diag * 1.5e-2) ** 2, 1e-6);
  const curveEdges = displayEdges.filter(
    (edge) => (edge.polyline?.length ?? 0) > 2,
  );
  return displayEdges.filter((edge) => {
    const pl = edge.polyline;
    if (!pl || pl.length < 2) return false;
    if (ghostEdges?.length) {
      let nearGhost = 0;
      for (const p of pl) {
        if (
          ghostEdges.some(
            (ghost) => pointPolylineDistanceSq(p, ghost.polyline) <= nearSq,
          )
        )
          nearGhost++;
      }
      if (nearGhost / pl.length >= 0.5) return false;
    }
    if (pl.length === 2 && curveEdges.length > 0) {
      const aNearCurve = curveEdges.some(
        (curve) => pointPolylineDistanceSq(pl[0], curve.polyline) <= nearSq,
      );
      const bNearCurve = curveEdges.some(
        (curve) => pointPolylineDistanceSq(pl[1], curve.polyline) <= nearSq,
      );
      if (aNearCurve || bNearCurve) {
        const mid = pl[0].clone().add(pl[1]).multiplyScalar(0.5);
        const midNearCurve = curveEdges.some(
          (curve) => pointPolylineDistanceSq(mid, curve.polyline) <= nearSq * 4,
        );
        if (!midNearCurve) return false;
      }
    }
    return true;
  });
}

export function guideSegmentIsVisible(
  a: THREE.Vector3,
  b: THREE.Vector3,
  camera: THREE.Camera,
  raycaster: THREE.Raycaster,
  pickables: THREE.Mesh[],
): boolean {
  const mid = a.clone().add(b).multiplyScalar(0.5);
  const ndc = mid.clone().project(camera);
  if (ndc.z > 1) return false;
  raycaster.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), camera);
  const distToEdge = raycaster.ray.origin.distanceTo(mid);
  if (distToEdge < 1e-6) return true;
  raycaster.far = distToEdge * 1.5;
  const hits = raycaster.intersectObjects(pickables, false);
  if (hits.length === 0) return true;
  const eps = Math.max(distToEdge * 0.005, 1e-3);
  return hits[0].distance >= distToEdge - eps;
}

export function collectGuideOverlayPositions(
  scene: THREE.Scene,
  camera: THREE.Camera,
  allowCurvedEdges: boolean,
): number[] {
  const positions: number[] = [];
  const _t1 = new THREE.Vector3();
  const _t2 = new THREE.Vector3();
  const pickables: THREE.Mesh[] = [];
  scene.traverse((obj) => {
    const m = obj as THREE.Mesh;
    if (!m.isMesh || typeof m.userData?.featureId !== "string") return;
    pickables.push(m);
  });
  const guideRaycaster = new THREE.Raycaster();
  for (const m of pickables) {
    m.updateWorldMatrix(true, false);
    const mw = m.matrixWorld;
    const geom = m.geometry;
    geom.computeBoundingBox();
    const geomBounds = geom.boundingBox;
    const existingTopo = geom.userData.topology as
      | { edges?: unknown[] }
      | undefined;
    const topoV = geom.userData._topoV as number | undefined;
    const hasEdgeCutMetadata =
      !!geom.userData.displayTopology || !!geom.userData.ghostTopology;
    const staleTopology =
      topoV !== undefined ? topoV < LAZY_TOPO_VERSION : hasEdgeCutMetadata;
    if (!existingTopo?.edges?.length || staleTopology) {
      try {
        const diag = geomBounds ? geomBounds.min.distanceTo(geomBounds.max) : 1;
        const tol = Math.max(diag * 1e-4, 1e-5);
        const indexed = mergeVertices(geom, tol);
        const extracted = extractEdgeTopology(indexed);
        indexed.dispose();
        geom.userData.topology = extracted;
        geom.userData._topoV = LAZY_TOPO_VERSION;
      } catch {
        /* leave topology as-is — picker will retry on hover */
      }
    }
    const displayTopo = geom.userData.displayTopology as
      | { edges?: OverlayEdge[] }
      | undefined;
    const ghost = geom.userData.ghostTopology as
      | { edges?: OverlayEdge[] }
      | undefined;
    const topo = geom.userData.topology as
      | { edges?: OverlayEdge[] }
      | undefined;
    const topoEdges = topo?.edges ?? [];
    const displayEdges = staleTopology
      ? filterStaleDisplayEdges(displayTopo?.edges, ghost?.edges, geomBounds)
      : displayTopo?.edges;
    const edges = guideEdgesForOverlay(
      displayEdges,
      ghost?.edges,
      topoEdges,
      allowCurvedEdges,
    );
    for (const e of edges) {
      const pl = e.polyline;
      if (!pl || pl.length < 2) continue;
      for (let i = 0; i + 1 < pl.length; i++) {
        _t1.copy(pl[i]).applyMatrix4(mw);
        _t2.copy(pl[i + 1]).applyMatrix4(mw);
        if (!guideSegmentIsVisible(_t1, _t2, camera, guideRaycaster, pickables))
          continue;
        positions.push(_t1.x, _t1.y, _t1.z, _t2.x, _t2.y, _t2.z);
      }
    }
  }
  return positions;
}
