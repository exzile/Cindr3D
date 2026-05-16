/**
 * Chamfer geometry — the chamfer-specific cutter on top of the shared
 * edge-cut core (`edgeCutCore.ts`).
 *
 * Same machinery as the fillet (edge-ID parse → edge→face resolve → CSG
 * subtract → live preview), but the per-edge cutter is a triangular wedge
 * prism instead of prism−cylinder: subtracting it replaces the sharp edge
 * with a flat bevel face between the two setback lines.
 *
 * Used by both commitChamfer (permanent commit) and ChamferPreview (live
 * preview) so the preview matches the committed result exactly.
 */
import * as THREE from 'three';
import {
  type PickedEdge,
  type ResolvedEdge,
  parseEdgeIds,
  computeEdgeCutGeometry,
} from './edgeCutCore';

// The chamfer module's public API names (commit + preview import these).
export const parseChamferEdgeIds = parseEdgeIds;

// ---------------------------------------------------------------------------
// Chamfer-specific triangular-wedge cutting tool
// ---------------------------------------------------------------------------

/**
 * Builds the cutting tool for one edge: a triangular prism whose cross-section
 * is the corner triangle (sharp corner on the edge, setback `d1` along face 1,
 * setback `d2` along face 2), extruded along the edge. Subtracting it from the
 * solid removes the sharp corner and leaves a flat chamfer face spanning the
 * two setback lines.
 *
 * Built from THREE.ExtrudeGeometry (guaranteed-consistent, watertight winding
 * — same trust level the fillet cutter relies on for its Box/Cylinder) then
 * placed with an affine basis whose columns are u1, u2, edgeDir. The local
 * triangle (0,0)-(d1,0)-(0,d2) maps exactly onto the world corner triangle,
 * so the shear from the non-orthogonal (u1,u2) is intentional and correct.
 *
 * Returns null for degenerate dihedral angles (nearly flat or nearly folded).
 */
function buildChamferCutter(
  re: ResolvedEdge,
  d1: number,
  d2: number,
  eps: number,
): THREE.BufferGeometry | null {
  const { a, edgeDir, length, u1, u2 } = re;

  // Skip near-coplanar (no real edge) or fully-folded degenerate cases —
  // same guard the fillet cutter uses.
  const cosPhi = THREE.MathUtils.clamp(u1.dot(u2), -1, 1);
  const phi = Math.acos(cosPhi);
  if (phi < 0.05 || phi > Math.PI - 0.05) return null;
  if (!(d1 > 0) || !(d2 > 0)) return null;

  // Local corner triangle in the XY plane; extruded along +Z (the edge).
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);      // sharp corner, on the edge line
  shape.lineTo(d1, 0);     // face-1 setback
  shape.lineTo(0, d2);     // face-2 setback
  shape.lineTo(0, 0);

  const prism = new THREE.ExtrudeGeometry(shape, {
    depth: length + 2 * eps,
    bevelEnabled: false,
    steps: 1,
  });
  // ExtrudeGeometry spans local z ∈ [0, depth]; shift so the edge axis spans
  // [-eps, length+eps] and place via basis (cols u1, u2, edgeDir) at corner a.
  prism.translate(0, 0, -eps);
  const basis = new THREE.Matrix4().makeBasis(u1, u2, edgeDir);
  basis.setPosition(a.x, a.y, a.z);
  prism.applyMatrix4(basis);

  return prism;
}

// ---------------------------------------------------------------------------
// Public: compute the chamfered geometry
// ---------------------------------------------------------------------------

/**
 * Bevels the given edges on a NON-INDEXED, world-space solid BufferGeometry
 * using CSG. Returns a new BufferGeometry, or null if no eligible edges were
 * resolved (degenerate geometry, edge not shared by two faces, etc.).
 *
 * - `srcGeo` must be non-indexed (call `.toNonIndexed()` before passing).
 * - The caller is responsible for disposing `srcGeo`.
 * - `distance` is the setback along face 1; `distance2` along face 2
 *   (caller resolves it from the dialog mode — equal / two-dist / angle).
 *   When omitted, an equal-distance chamfer (distance2 = distance) is used.
 */
export function computeChamferGeometry(
  srcGeo: THREE.BufferGeometry,
  edges: PickedEdge[],
  distance: number,
  distance2?: number,
): THREE.BufferGeometry | null {
  if (!(distance > 0)) return null;
  const d1 = distance;
  const d2 = distance2 && distance2 > 0 ? distance2 : distance;
  return computeEdgeCutGeometry(
    srcGeo,
    edges,
    (re, eps) => buildChamferCutter(re, d1, d2, eps),
    'chamfer',
  );
}
