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
import { circleSegments } from '../../engine/geometryEngine/core/sketch/sketchProfiles';
import {
  type PickedEdge,
  type ResolvedEdge,
  type EdgeLoopCircle,
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

  // No segment-length guard here: setback is measured perpendicular to the
  // edge, not along it, so it is independent of how finely the edge is
  // tessellated. A circle rim with 30 short segments (segment ≈ 1 unit,
  // setback = 2) is perfectly valid — each arc-segment cutter tiles correctly
  // around the loop. The CSG driver already has try/catch; any truly
  // degenerate case (e.g. setback >> face extent) will be skipped there.

  const bis = u1.clone().add(u2).normalize(); // interior bisector

  // ── Corner prism: spans [0,setback] along u1, [0,setback] along u2, and
  //    [-eps, length+eps] along the edge. Built as a unit box then placed
  //    with a basis matrix (columns u1, edgeDir, u2) anchored at edge start.
  //
  // (u1, edgeDir, u2) is right-handed for some edges and left-handed for
  // others (depends on the edge's world orientation + adjacent-triangle
  // order). A left-handed basis makes `makeBasis` a MIRROR (negative
  // determinant): the prism−cylinder cutter is turned inside-out and
  // CSG-subtracting it leaves a back-facing (invisible) fillet surface — the
  // same "edge looks un-filleted" defect the chamfer cutter guards against.
  // The prism cross-section is a symmetric setback×setback square and the
  // cylinder is placed off the symmetric bisector, so swapping the u1/u2
  // basis columns yields a geometrically identical world cutter (same world
  // shape/volume — buffer/triangle ordering may differ) with a right-handed
  // (non-mirroring) basis. det>0 edges are unchanged (branch not taken).
  const leftHanded =
    new THREE.Matrix4().makeBasis(u1, edgeDir, u2).determinant() < 0;
  const axisX = leftHanded ? u2 : u1;
  const axisZ = leftHanded ? u1 : u2;
  const prism = new THREE.BoxGeometry(setback, length + 2 * eps, setback);
  // Box is centered at local origin; shift so the (u1=0, u2=0) corner sits on
  // the edge line and the edge axis spans [-eps, length+eps].
  prism.translate(setback / 2, length / 2, setback / 2);
  const basis = new THREE.Matrix4().makeBasis(axisX, edgeDir, axisZ);
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
// Circular-rim loop cutter — ONE analytic torus instead of N box slivers
// ---------------------------------------------------------------------------

/**
 * Builds a single cutting tool for a complete circular-rim fillet (hole edge,
 * boss edge). The per-segment `buildFilletCutter` tiles ~120 straight prisms
 * around the circle whose seams collapse into unrenderable triangle soup; this
 * instead removes an analytic "corner ring minus torus", giving the exact
 * smooth quarter-torus a BREP kernel (Fusion) would.
 *
 *   cutter = annular corner block  −  fillet torus
 *
 * - annular block: radius ∈ [holeR, holeR+setback], axial ∈ [cap, cap+setback
 *   into the body] — exactly the sharp corner material.
 * - torus: tube radius = fillet radius, swept at (holeR + radial bisector
 *   offset) around the hole axis — the rolling-ball surface.
 *
 * Subtracting the torus from the block leaves the curved sliver; subtracting
 * THAT from the solid replaces the sharp rim with the round.
 *
 * Returns null for degenerate dihedrals so the caller falls back to the
 * per-segment path.
 */
function buildFilletLoopCutter(
  circle: EdgeLoopCircle,
  re: ResolvedEdge,
  radius: number,
  radialSeg: number,
): THREE.BufferGeometry | null {
  const cosPhi = THREE.MathUtils.clamp(re.u1.dot(re.u2), -1, 1);
  const phi = Math.acos(cosPhi);
  if (phi < 0.05 || phi > Math.PI - 0.05) return null;
  const half = phi / 2;
  const sinH = Math.sin(half);
  const tanH = Math.tan(half);
  if (sinH < 1e-4 || tanH < 1e-4) return null;

  const setback = radius / tanH; // tangent-line distance along each face
  const axisDist = radius / sinH; // edge → fillet-cylinder-axis distance

  const A = circle.axis.clone().normalize();
  const O = circle.center;
  const R = circle.radius;
  if (!(R > 1e-6)) return null;

  // Of the two in-face perpendiculars, the one most aligned with the circle
  // axis runs along the wall (into the body); the other is the radial (cap)
  // direction. bodyAxial points from the cap plane into the solid.
  const u1A = Math.abs(re.u1.dot(A));
  const u2A = Math.abs(re.u2.dot(A));
  const uAxial = u1A >= u2A ? re.u1 : re.u2;
  const axialSign = Math.sign(uAxial.dot(A)) || 1;
  const bodyAxial = A.clone().multiplyScalar(axialSign);

  // Outward radial at the representative rim point (perp to the axis).
  const w = re.a.clone().sub(O);
  const rOut = w.sub(A.clone().multiplyScalar(w.dot(A)));
  if (rOut.lengthSq() < 1e-12) return null;
  rOut.normalize();

  const bis = re.u1.clone().add(re.u2).normalize();
  const bisAxial = Math.abs(bis.dot(A));
  const bisRadial = Math.abs(bis.dot(rOut));

  const majorR = R + bisRadial * axisDist; // fillet-tube centre-circle radius
  const minorR = radius;
  const torusAxialOffset = bisAxial * axisDist; // cap → tube-centre, into body
  if (!(majorR > minorR + 1e-6)) return null; // would self-intersect (spindle)

  const pad = Math.max(setback * 1e-3, 1e-4);
  const ringOuterR = R + setback;
  // Inner radius a hair inside the hole so the ring's inner wall never sits
  // coincident with the model's hole wall (coplanar booleans z-fight).
  const innerR = Math.max(R - pad, 1e-4);
  const ringLen = setback + 2 * pad; // +pad past the cap face for a clean exit

  const tubSeg = Math.max(48, Math.min(256, circleSegments(Math.max(majorR, ringOuterR))));
  const radSeg = Math.max(24, Math.min(96, Math.round(radialSeg)));

  const yAxis = new THREE.Vector3(0, 1, 0);
  const zAxis = new THREE.Vector3(0, 0, 1);
  const qCyl = new THREE.Quaternion().setFromUnitVectors(yAxis, bodyAxial);
  const qTor = new THREE.Quaternion().setFromUnitVectors(zAxis, A);

  // Ring spans axial s ∈ [-pad, setback] from O along bodyAxial → its centre
  // is at O + bodyAxial*((setback - pad)/2 ... use ringLen midpoint).
  const ringCenter = O.clone().add(bodyAxial.clone().multiplyScalar(ringLen / 2 - pad));
  const torusCenter = O.clone().add(bodyAxial.clone().multiplyScalar(torusAxialOffset));

  const outerCyl = new THREE.CylinderGeometry(ringOuterR, ringOuterR, ringLen, tubSeg);
  outerCyl.applyQuaternion(qCyl);
  outerCyl.translate(ringCenter.x, ringCenter.y, ringCenter.z);

  const innerCyl = new THREE.CylinderGeometry(innerR, innerR, ringLen + 4 * pad, tubSeg);
  innerCyl.applyQuaternion(qCyl);
  innerCyl.translate(ringCenter.x, ringCenter.y, ringCenter.z);

  let ring: THREE.BufferGeometry;
  try {
    ring = GeometryEngine.csgSubtract(outerCyl, innerCyl);
  } catch {
    outerCyl.dispose();
    innerCyl.dispose();
    return null;
  }
  outerCyl.dispose();
  innerCyl.dispose();

  const torus = new THREE.TorusGeometry(majorR, minorR, radSeg, tubSeg);
  torus.applyQuaternion(qTor);
  torus.translate(torusCenter.x, torusCenter.y, torusCenter.z);

  let cutter: THREE.BufferGeometry;
  try {
    cutter = GeometryEngine.csgSubtract(ring, torus);
  } catch {
    ring.dispose();
    torus.dispose();
    return null;
  }
  ring.dispose();
  torus.dispose();
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
  fast?: boolean,
): THREE.BufferGeometry | null {
  if (!(radius > 0)) return null;
  // `segments` is the arc-resolution hint (~4). Scale up to a full-circle
  // radial count so the visible fillet arc gets ~3× that many facets.
  // In fast (preview) mode use fewer segments — half the cylinder complexity,
  // still visually smooth enough for a live preview.
  const radialSeg = fast
    ? Math.max(12, Math.round(segments) * 6)
    : Math.max(24, Math.round(segments) * 12);
  return computeEdgeCutGeometry(
    srcGeo,
    edges,
    (re, eps) => buildFilletCutter(re, radius, radialSeg, eps),
    'fillet',
    fast,
    (circle, re) => buildFilletLoopCutter(circle, re, radius, radialSeg),
  );
}
