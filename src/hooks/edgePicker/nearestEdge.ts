/**
 * nearestEdge.ts — pick the nearest MODEL edge from the explicit body
 * topology (no soup reconstruction).
 *
 * The topology was extracted once, correctly, at geometry-build time and
 * lives on `geometry.userData.topology`. We find the edge whose polyline is
 * closest to the CURSOR in SCREEN SPACE — not closest in 3D to the face hit
 * point. 3D-nearest is fundamentally wrong for perspective/isometric views:
 * the cursor visually points at one edge while the hit point on the surface
 * is closer in 3D to a different edge (e.g. the front-top edge of a box is
 * what the user sees, but the left-top edge can be closer in 3D when the
 * raycast lands on the top face). Screen-space distance matches the user's
 * intent. Occlusion is still verified by `edgeIsPickable`.
 *
 * The whole edge is returned as `chain` so highlight + selection + cut act
 * on the entire edge; `edgeVertexA/B` carry the screen-nearest segment for
 * the proximity gate.
 *
 * LAZY TOPOLOGY FALLBACK: committed edge-cut meshes (fillet/chamfer) that were
 * produced before the pre-toCreasedNormals extraction was added arrive here
 * with no topology. We recover by re-welding the non-indexed creased geometry
 * back to indexed (mergeVertices, position-only) and extracting from there.
 * This runs at most once per geometry — the result is stored on
 * `geometry.userData.topology` so subsequent hovers hit the normal fast path.
 */
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { extractEdgeTopology } from '../../engine/geometryEngine/core/solid/edgeTopology';
import type { EdgePickResult } from '../../types/edge-picker.types';
import { segDistSqPx } from './segmentMath';
import {
  getCachedEdges,
  getCachedChain,
  type BodyTopologyLike,
  type CachedEdge,
} from './topologyCache';

// Module-level scratch — no per-event allocation.
const _projA = new THREE.Vector3();
const _projB = new THREE.Vector3();

// Bump this whenever the lazy-fallback extraction logic changes so that
// geometries cached with an older run are automatically re-extracted.
// edgeCutCore.ts stamps the same version on topologies it extracts before
// toCreasedNormals so those are never overridden by the lazy path.
const LAZY_TOPO_VERSION = 3;

export function pickNearestEdge(
  mesh: THREE.Mesh,
  faceIndex: number,
  _hitPoint: THREE.Vector3,
  camera: THREE.Camera,
  cursorPx: number,
  cursorPy: number,
  rectW: number,
  rectH: number,
): EdgePickResult | null {
  const geom = mesh.geometry;
  let topo = geom.userData?.topology as BodyTopologyLike | undefined;
  if (!topo || !topo.edges || topo.edges.length === 0 || geom.userData._topoV !== LAZY_TOPO_VERSION) {
    // Lazy fallback: committed edge-cut meshes lack topology when they were
    // produced before the pre-toCreasedNormals extraction was in place.
    // Re-weld the non-indexed creased geometry back to indexed and extract.
    // Runs once; result cached on userData.topology for all subsequent hovers.
    try {
      // Use a tolerance that matches extractEdgeTopology's own quantization
      // (diag * 1e-4) so vertices that were merged by weldAndCleanSolid
      // (which uses diag * 1e-5) are reliably re-merged here.
      geom.computeBoundingBox();
      const bb = geom.boundingBox;
      const diag = bb ? bb.min.distanceTo(bb.max) : 1;
      const tol = Math.max(diag * 1e-4, 1e-5);
      const indexed = mergeVertices(geom, tol);
      const extracted = extractEdgeTopology(indexed);
      indexed.dispose();
      geom.userData.topology = extracted;
      geom.userData._topoV = LAZY_TOPO_VERSION;
      topo = extracted as BodyTopologyLike;
    } catch {
      geom.userData.topology = { edges: [] };
      geom.userData._topoV = LAZY_TOPO_VERSION;
    }
    if (!topo || !topo.edges || topo.edges.length === 0) return null;
  }

  mesh.updateWorldMatrix(true, false);
  const cached = getCachedEdges(geom, topo, mesh.matrixWorld);
  // GHOST TOPOLOGY: edges from prior edge-cut operations that this body has
  // consumed (fillet replaces the original sharp box-top-left edge with a
  // rounded arc — without ghost edges, the picker can't find that original
  // edge anymore). Stamped by edgeCutCore.ts on the cut result. We search
  // ghost edges in the same screen-space loop; whichever is closer wins.
  const ghostTopo = geom.userData.ghostTopology as BodyTopologyLike | undefined;
  const ghostCached = ghostTopo && ghostTopo.edges && ghostTopo.edges.length > 0
    ? getCachedEdges(geom, ghostTopo, mesh.matrixWorld)
    : null;

  // Find the segment whose 2D screen-space projection is closest to the cursor.
  // Projects each endpoint, converts to canvas pixels, measures point-to-segment
  // distance². Closest wins. Behind-camera points (NDC z > 1) are dropped
  // per-segment; the edge's other segments may still qualify.
  let bestPxSq = Infinity;
  let bestEdge: CachedEdge | null = null;
  let bestI = 0;
  const halfW = rectW * 0.5;
  const halfH = rectH * 0.5;

  const scan = (edges: CachedEdge[]) => {
    for (const ce of edges) {
      const pts = ce.pts;
      const segCount = (pts.length / 3) - 1;
      for (let i = 0; i < segCount; i++) {
        const o = i * 3;
        _projA.set(pts[o], pts[o + 1], pts[o + 2]).project(camera);
        _projB.set(pts[o + 3], pts[o + 4], pts[o + 5]).project(camera);
        if (_projA.z > 1 || _projB.z > 1) continue;
        const ax = (_projA.x + 1) * halfW;
        const ay = (1 - _projA.y) * halfH;
        const bx = (_projB.x + 1) * halfW;
        const by = (1 - _projB.y) * halfH;
        const dSq = segDistSqPx(cursorPx, cursorPy, ax, ay, bx, by);
        if (dSq < bestPxSq) {
          bestPxSq = dSq;
          bestEdge = ce;
          bestI = i;
        }
      }
    }
  };
  scan(cached);
  if (ghostCached) scan(ghostCached);

  if (!bestEdge) return null;

  const bp = bestEdge.pts;
  const bo = bestI * 3;
  const ea = new THREE.Vector3(bp[bo], bp[bo + 1], bp[bo + 2]);
  const eb = new THREE.Vector3(bp[bo + 3], bp[bo + 4], bp[bo + 5]);
  // Full edge polyline (world) for highlight + stable id + cut. Cached on the
  // CachedEdge so continuous-hover pointermove doesn't allocate ~N Vector3
  // instances per event (N up to ~30 for circle rims). Treated as read-only
  // by consumers — handleClick clones it before storing in selection state.
  const chain = getCachedChain(bestEdge);
  const midpoint = new THREE.Vector3().addVectors(ea, eb).multiplyScalar(0.5);
  const direction = new THREE.Vector3().subVectors(eb, ea).normalize();

  return {
    mesh,
    faceIndex,
    edgeVertexA: ea,            // nearest segment — drives the proximity gate
    edgeVertexB: eb,
    edgeVertexIndexA: 0,
    edgeVertexIndexB: 0,
    midpoint,
    direction,
    chain,                      // the WHOLE model edge — drives highlight/id/cut
  };
}
