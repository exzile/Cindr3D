/**
 * topologyCache.ts — per-geometry world-space cache of the body's explicit
 * model-edge topology, for the pointermove hot path.
 *
 * Model edges are NOT reconstructed from the (non-manifold) render soup. They
 * are extracted once, at geometry-build time, by `extractEdgeTopology` /
 * `extrudeProfileTopology` and attached to `geometry.userData.topology` (see
 * engine/.../solid/edgeTopology.ts + profileTopology.ts). This hook just
 * consumes that explicit, already-correct edge set.
 *
 * pointermove fires constantly; without this cache every move re-ran
 * `applyMatrix4` over every point of every edge (the two hole-rim loops alone
 * are ~270 segments). Cached arrays are flat Float64 xyz with a 6-float AABB,
 * rebuilt only when the geometry, its topology object, or the mesh's
 * matrixWorld changes — so the values are byte-identical to a per-move
 * transform, just computed once. Keyed by geometry (WeakMap → GC-safe).
 */
import * as THREE from 'three';

export interface BodyTopologyLike {
  edges: { id: string; polyline: THREE.Vector3[]; kind: string }[];
}

export interface CachedEdge {
  pts: Float64Array;
  aabb: Float64Array;
  ref: BodyTopologyLike['edges'][number];
}

interface TopoCache {
  topo: BodyTopologyLike;
  matrixKey: string;
  edges: CachedEdge[];
}

const _topoCache = new WeakMap<THREE.BufferGeometry, TopoCache>();
const _t = new THREE.Vector3();

export function getCachedEdges(
  geom: THREE.BufferGeometry,
  topo: BodyTopologyLike,
  m: THREE.Matrix4,
): CachedEdge[] {
  const me = m.elements;
  const matrixKey =
    `${me[0]},${me[1]},${me[2]},${me[4]},${me[5]},${me[6]},${me[8]},${me[9]},${me[10]},${me[12]},${me[13]},${me[14]}`;
  const hit = _topoCache.get(geom);
  if (hit && hit.topo === topo && hit.matrixKey === matrixKey) return hit.edges;

  const edges: CachedEdge[] = topo.edges.map((edge) => {
    const pl = edge.polyline;
    const pts = new Float64Array(pl.length * 3);
    let mnx = Infinity, mny = Infinity, mnz = Infinity;
    let mxx = -Infinity, mxy = -Infinity, mxz = -Infinity;
    for (let i = 0; i < pl.length; i++) {
      _t.copy(pl[i]).applyMatrix4(m);
      const o = i * 3;
      pts[o] = _t.x; pts[o + 1] = _t.y; pts[o + 2] = _t.z;
      if (_t.x < mnx) mnx = _t.x; if (_t.y < mny) mny = _t.y; if (_t.z < mnz) mnz = _t.z;
      if (_t.x > mxx) mxx = _t.x; if (_t.y > mxy) mxy = _t.y; if (_t.z > mxz) mxz = _t.z;
    }
    return { pts, aabb: new Float64Array([mnx, mny, mnz, mxx, mxy, mxz]), ref: edge };
  });
  _topoCache.set(geom, { topo, matrixKey, edges });
  return edges;
}

/** Squared distance from a point to an AABB (0 inside) — broad-phase reject. */
export function pointAabbDistSq(px: number, py: number, pz: number, a: Float64Array): number {
  const dx = px < a[0] ? a[0] - px : px > a[3] ? px - a[3] : 0;
  const dy = py < a[1] ? a[1] - py : py > a[4] ? py - a[4] : 0;
  const dz = pz < a[2] ? a[2] - pz : pz > a[5] ? pz - a[5] : 0;
  return dx * dx + dy * dy + dz * dz;
}
