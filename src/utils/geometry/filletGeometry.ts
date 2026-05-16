/**
 * Fillet geometry — the fillet-specific cutter on top of the shared
 * edge-cut core (`edgeCutCore.ts`).
 *
 * Used by both commitFillet (permanent commit) and FilletPreview (live
 * preview while the dialog is open). Keeping the algorithm in the shared
 * core guarantees the preview matches the committed result exactly, and that
 * fillet and chamfer never drift apart.
 *
 * ── Why CSG and not vertex-dragging ────────────────────────────────────────
 * Extrude bodies are coarsely triangulated — each flat side face is just two
 * big triangles. The old "rolling-ball" approach moved the shared edge
 * vertices of the two adjacent triangles, which dragged the *entire* face and
 * sliced a giant diagonal wedge off the body instead of rounding the edge.
 *
 * The correct, Fusion-like result is produced with CSG: for each picked edge
 * we build a "corner sliver" cutting tool — a prism that exactly covers the
 * sharp corner material, minus a cylinder of radius r tangent to both faces —
 * and subtract it from the solid. Only a thin band along the edge is
 * affected; the rest of every face stays perfectly flat.
 */
import * as THREE from 'three';
import { GeometryEngine } from '../../engine/GeometryEngine';
import {
  type PickedEdge,
  type ResolvedEdge,
  parseEdgeIds,
  computeEdgeCutGeometry,
} from './edgeCutCore';

// The fillet module's public API names (commit + preview import these).
export const parseFilletEdgeIds = parseEdgeIds;

// ---------------------------------------------------------------------------
// Fillet-specific corner-sliver cutting tool
// ---------------------------------------------------------------------------

/**
 * Builds the cutting tool for one edge: a prism that exactly covers the sharp
 * corner material (set back to the fillet tangent lines on both faces) minus
 * a cylinder of radius r tangent to both faces. Subtracting this from the
 * solid replaces the sharp edge with a smooth radius arc.
 *
 * Returns null for degenerate dihedral angles (nearly flat or nearly folded).
 */
function buildFilletCutter(
  re: ResolvedEdge,
  radius: number,
  radialSeg: number,
  eps: number,
): THREE.BufferGeometry | null {
  const { a, edgeDir, length, u1, u2 } = re;

  // Angle between the two in-face perpendiculars.
  const cosPhi = THREE.MathUtils.clamp(u1.dot(u2), -1, 1);
  const phi = Math.acos(cosPhi);
  // Skip near-coplanar (no real edge) or fully-folded degenerate cases.
  if (phi < 0.05 || phi > Math.PI - 0.05) return null;

  const half = phi / 2;
  const sinHalf = Math.sin(half);
  const tanHalf = Math.tan(half);
  if (sinHalf < 1e-4 || tanHalf < 1e-4) return null;

  // Setback distance along each face to the fillet tangent line, and the
  // distance from the edge to the cylinder axis along the interior bisector.
  const setback = radius / tanHalf;          // tangent point distance along u1/u2
  const axisDist = radius / sinHalf;          // edge → cylinder axis distance
  const bis = u1.clone().add(u2).normalize(); // interior bisector

  // ── Corner prism: spans [0,setback] along u1, [0,setback] along u2, and
  //    [-eps, length+eps] along the edge. Built as a unit box then placed
  //    with a basis matrix (columns u1, edgeDir, u2) anchored at edge start.
  const prism = new THREE.BoxGeometry(setback, length + 2 * eps, setback);
  // Box is centered at local origin; shift so the (u1=0, u2=0) corner sits on
  // the edge line and the edge axis spans [-eps, length+eps].
  prism.translate(setback / 2, length / 2, setback / 2);
  const basis = new THREE.Matrix4().makeBasis(u1, edgeDir, u2);
  basis.setPosition(a.x, a.y, a.z);
  prism.applyMatrix4(basis);

  // ── Fillet cylinder: radius r, axis along the edge, through the point
  //    `a + bis*axisDist`, length = edge length + 2*eps.
  //    radialSeg is the FULL-circle segment count; the visible fillet is only
  //    a ~(180°-φ) arc of it, so we need a generous count for a smooth round.
  const cyl = new THREE.CylinderGeometry(radius, radius, length + 2 * eps, Math.max(24, Math.min(96, radialSeg)));
  // Default cylinder axis is +Y → rotate +Y to edgeDir, then position at the
  // axis midpoint.
  const yAxis = new THREE.Vector3(0, 1, 0);
  const quat = new THREE.Quaternion().setFromUnitVectors(yAxis, edgeDir);
  const axisMid = a.clone()
    .add(bis.clone().multiplyScalar(axisDist))
    .add(edgeDir.clone().multiplyScalar(length / 2));
  const cylMat = new THREE.Matrix4().compose(axisMid, quat, new THREE.Vector3(1, 1, 1));
  cyl.applyMatrix4(cylMat);

  // Cutter = prism − cylinder (the sharp sliver between the corner and the arc).
  const cutter = GeometryEngine.csgSubtract(prism, cyl);
  prism.dispose();
  cyl.dispose();
  return cutter;
}

// ---------------------------------------------------------------------------
// Public: compute the filleted geometry
// ---------------------------------------------------------------------------

/**
 * Rounds the given edges on a NON-INDEXED, world-space solid BufferGeometry
 * using CSG. Returns a new BufferGeometry, or null if no eligible edges were
 * resolved (degenerate geometry, edge not shared by two faces, etc.).
 *
 * - `srcGeo` must be non-indexed (call `.toNonIndexed()` before passing).
 * - The caller is responsible for disposing `srcGeo`.
 * - `segments` controls the cylinder's radial smoothness (arc-resolution hint).
 */
export function computeFilletGeometry(
  srcGeo: THREE.BufferGeometry,
  edges: PickedEdge[],
  radius: number,
  segments: number,
): THREE.BufferGeometry | null {
  if (!(radius > 0)) return null;
  // `segments` is the arc-resolution hint (~4). Scale up to a full-circle
  // radial count so the visible fillet arc gets ~3× that many facets.
  const radialSeg = Math.max(24, Math.round(segments) * 12);
  return computeEdgeCutGeometry(
    srcGeo,
    edges,
    (re, eps) => buildFilletCutter(re, radius, radialSeg, eps),
    'fillet',
  );
}
