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
import { csgSubtract as csgSubtractRaw } from '../../engine/geometryEngine/core/solid/csg';
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

/**
 * Extended fillet parameters mirroring Fusion 360's fillet modes.
 * Only `mode` is used to select geometry path; radius-scale fields
 * (variable, chord-length) are applied in computeFilletGeometry when set.
 */
export interface FilletCommitParams {
  /** Geometry mode: how the radius parameter is interpreted. */
  mode?: 'constant' | 'variable' | 'chord-length' | 'full-round' | 'asymmetric';
  /** Variable-radius: radius at the start of each edge. */
  startRadius?: number;
  /** Variable-radius: radius at the end of each edge. */
  endRadius?: number;
  /** Chord-length mode: target chord length instead of arc radius. */
  chordLength?: number;
  /**
   * Asymmetric mode: offset along face 1 (setback on side 1).
   * When set with `offsetTwo`, the cylinder axis is shifted off the
   * interior bisector so each face gets its own tangent distance.
   */
  offsetOne?: number;
  /** Asymmetric mode: offset along face 2 (setback on side 2). */
  offsetTwo?: number;
  /** Flip face-1/face-2 assignment for asymmetric mode. */
  isFlipped?: boolean;
  /** Propagate selection along tangent-continuous edges. */
  propagate?: boolean;
  /** G2-curvature-continuous blend (cubic Bézier approximation). */
  isG2?: boolean;
  /**
   * Tangency weight 0.1–2.0 (Fusion FilletEdgeSet.tangencyWeight).
   * Scales the effective cutter radius so the blend extends further (> 1.0)
   * or less far (< 1.0) along adjacent faces. 1.0 = standard circular arc.
   * Only applied when isG2 is true.
   */
  tangencyWeight?: number;
  /** Rolling-ball corner blend at edge intersections. */
  isRollingBallCorner?: boolean;
}

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
interface FilletCutterOpts {
  chordLength?: number;
  startRadius?: number;
  endRadius?: number;
  offsetOne?: number;
  offsetTwo?: number;
  isAsymmetric?: boolean;
}

function buildFilletCutter(
  re: ResolvedEdge,
  radius: number,
  radialSeg: number,
  eps: number,
  opts?: FilletCutterOpts,
): THREE.BufferGeometry | null {
  const { a, edgeDir, length, u1, u2 } = re;
  const { chordLength, startRadius, endRadius, offsetOne, offsetTwo, isAsymmetric } = opts ?? {};

  // Angle between the two in-face perpendiculars.
  const cosPhi = THREE.MathUtils.clamp(u1.dot(u2), -1, 1);
  const phi = Math.acos(cosPhi);

  // chord-length mode: back-compute actual radius from the chord spanning the
  // fillet arc. Arc angle = π − phi; chord = 2r·sin(arcAngle/2) = 2r·cos(phi/2).
  // So r = chordLength / (2·cos(phi/2)), using the real per-edge dihedral.
  if (chordLength && chordLength > 0) {
    const cosHalfPhi = Math.cos(phi / 2);
    if (cosHalfPhi > 1e-4) radius = chordLength / (2 * cosHalfPhi);
  }
  // Skip near-coplanar (no real edge) or fully-folded degenerate cases.
  if (phi < 0.05 || phi > Math.PI - 0.05) return null;

  const half = phi / 2;
  const sinHalf = Math.sin(half);
  const tanHalf = Math.tan(half);
  if (sinHalf < 1e-4 || tanHalf < 1e-4) return null;

  const det = new THREE.Matrix4().makeBasis(u1, edgeDir, u2).determinant();
  if (Math.abs(det) < 1e-9) return null; // degenerate basis — u1/u2 nearly parallel
  const leftHanded = det < 0;
  const axisX = leftHanded ? u2 : u1;
  const axisZ = leftHanded ? u1 : u2;
  const d1 = leftHanded ? (offsetTwo ?? 0) : (offsetOne ?? 0);
  const d2 = leftHanded ? (offsetOne ?? 0) : (offsetTwo ?? 0);

  // ── Asymmetric fillet (offsetOne ≠ offsetTwo) ────────────────────────────
  if (isAsymmetric && d1 > 0 && d2 > 0) {
    // Incircle of the corner triangle {origin, d1*axisX, d2*axisZ}.
    // Side lengths: a = d1, b = d2, c = sqrt(d1²+d2²-2·d1·d2·cos(phi)).
    // Area = d1·d2·sin(phi)/2.
    // Incircle radius r = 2·Area / (a+b+c).
    const sinPhi = Math.sin(phi);
    const c = Math.sqrt(d1 * d1 + d2 * d2 - 2 * d1 * d2 * cosPhi);
    if (c < 1e-9) return null;
    const area2 = d1 * d2 * sinPhi;
    const rAsym = area2 / (d1 + d2 + c);
    if (rAsym < 1e-6) return null;

    // Incircle center (in axisX/axisZ face plane, world space):
    // Barycentric: touches all three sides → use tangent lengths.
    // In the triangle with vertices O, P1=d1*axisX, P2=d2*axisZ:
    // tangent lengths from O = (d1 + d2 - c) / 2 = s - c where s=semi-perimeter.
    const s = (d1 + d2 + c) / 2;
    const tO = s - c; // tangent length from origin vertex
    const incenterX = tO; // in axisX direction
    const incenterZ = tO; // in axisZ direction (symmetric along both rays)

    // Build the prism (d1 × d2 asymmetric box).
    const prismAsym = new THREE.BoxGeometry(d1, length + 2 * eps, d2);
    prismAsym.translate(d1 / 2, length / 2, d2 / 2);
    const basisA = new THREE.Matrix4().makeBasis(axisX, edgeDir, axisZ);
    basisA.setPosition(a.x, a.y, a.z);
    prismAsym.applyMatrix4(basisA);

    const radialSegClamped = Math.max(8, Math.min(96, radialSeg));
    const yAxis = new THREE.Vector3(0, 1, 0);
    const quat = new THREE.Quaternion().setFromUnitVectors(yAxis, edgeDir);
    const axisMidAsym = a.clone()
      .add(axisX.clone().multiplyScalar(incenterX))
      .add(axisZ.clone().multiplyScalar(incenterZ))
      .add(edgeDir.clone().multiplyScalar(length / 2));
    const cylAsym = new THREE.CylinderGeometry(rAsym, rAsym, length + 2 * eps, radialSegClamped);
    cylAsym.applyMatrix4(new THREE.Matrix4().compose(axisMidAsym, quat, new THREE.Vector3(1, 1, 1)));
    const cutterAsym = csgSubtractRaw(prismAsym, cylAsym);
    prismAsym.dispose();
    cylAsym.dispose();
    return cutterAsym;
  }

  // ── Variable-radius mode ─────────────────────────────────────────────────
  const isVariable = startRadius != null && endRadius != null && Math.abs(startRadius - endRadius) > 1e-4;
  const rStart = isVariable ? startRadius! : radius;
  const rEnd = isVariable ? endRadius! : radius;
  const rMax = Math.max(rStart, rEnd);

  const setback = rMax / tanHalf;
  const axisDistStart = rStart / sinHalf;
  const axisDistEnd = rEnd / sinHalf;

  const bis = u1.clone().add(u2).normalize(); // interior bisector

  const prism = new THREE.BoxGeometry(setback, length + 2 * eps, setback);
  prism.translate(setback / 2, length / 2, setback / 2);
  const basis = new THREE.Matrix4().makeBasis(axisX, edgeDir, axisZ);
  basis.setPosition(a.x, a.y, a.z);
  prism.applyMatrix4(basis);

  const radialSegClamped = Math.max(8, Math.min(96, radialSeg));
  const yAxis = new THREE.Vector3(0, 1, 0);
  const quat = new THREE.Quaternion().setFromUnitVectors(yAxis, edgeDir);
  const axisStart = a.clone().add(bis.clone().multiplyScalar(axisDistStart));
  const axisEnd = a.clone()
    .add(edgeDir.clone().multiplyScalar(length))
    .add(bis.clone().multiplyScalar(axisDistEnd));
  const axisMid = axisStart.clone().add(axisEnd).multiplyScalar(0.5);

  let cyl: THREE.BufferGeometry;
  if (isVariable) {
    cyl = new THREE.CylinderGeometry(rEnd, rStart, length + 2 * eps, radialSegClamped);
  } else {
    cyl = new THREE.CylinderGeometry(radius, radius, length + 2 * eps, radialSegClamped);
  }
  const cylMat = new THREE.Matrix4().compose(axisMid, quat, new THREE.Vector3(1, 1, 1));
  cyl.applyMatrix4(cylMat);

  const cutter = csgSubtractRaw(prism, cyl);
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
  fast?: boolean,
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

  // In fast (preview) mode use fewer tube segments — the cutter only needs to
  // look plausible while dragging. Commit mode uses full adaptive density.
  // Fast (preview) mode uses a fixed 24-segment ring instead of adaptive
  // circleSegments (which floors at 32). Fewer torus triangles → faster
  // main-body CSG while still looking smooth enough for a live drag preview.
  const tubSeg = fast
    ? 24
    : Math.max(48, Math.min(256, circleSegments(Math.max(majorR, ringOuterR))));
  // radSeg: 16 for preview (visible arc is ~90° → 4 visible facets, smooth
  // enough without excess triangles), full adaptive range for commit.
  const radSeg = fast
    ? 16
    : Math.max(24, Math.min(96, Math.round(radialSeg)));

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
    // Raw CSG — ring is an intermediate operand, not rendered or picked.
    ring = csgSubtractRaw(outerCyl, innerCyl);
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
    // Raw CSG — cutter is operand B in the solid subtract, never rendered.
    cutter = csgSubtractRaw(ring, torus);
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
// G2 curvature-continuous fillet cutter
// ---------------------------------------------------------------------------

/**
 * Builds a G2-continuous (curvature-continuous) cutter for one edge using a
 * cubic Bézier cross-section instead of a circular arc.
 *
 * Cross-section profile (in the axisX / axisZ face plane):
 *   P0 = (sb, 0)  — tangent point on face 1
 *   P1 = (sb, sb) — both control points at the corner
 *   P2 = (sb, sb)   (P1 = P2 gives κ = 0 at both tangent points)
 *   P3 = (0,  sb) — tangent point on face 2
 * Close via origin to form the cutter solid.
 *
 * With α = 1 (control points at the corner), the curvature of the cubic
 * Bézier is exactly 0 at P0 and P3, which matches the infinite-radius
 * (flat) faces → G2 continuity. The profile bulges slightly closer to the
 * corner than a G1 circular arc, giving the characteristic "tighter"
 * look of curvature-continuous blends.
 *
 * Uses THREE.ExtrudeGeometry for a clean single-step construction (no
 * intermediate CSG). Returns null for degenerate dihedral angles.
 */
function buildG2FilletCutter(
  re: ResolvedEdge,
  radius: number,
  eps: number,
): THREE.BufferGeometry | null {
  const { a, edgeDir, length, u1, u2 } = re;
  const cosPhi = THREE.MathUtils.clamp(u1.dot(u2), -1, 1);
  const phi = Math.acos(cosPhi);
  if (phi < 0.05 || phi > Math.PI - 0.05) return null;
  const half = phi / 2;
  const tanHalf = Math.tan(half);
  if (tanHalf < 1e-4) return null;

  const sb = radius / tanHalf;

  const det = new THREE.Matrix4().makeBasis(u1, edgeDir, u2).determinant();
  if (Math.abs(det) < 1e-9) return null; // degenerate basis — u1/u2 nearly parallel
  const leftHanded = det < 0;
  const axisX = leftHanded ? u2 : u1;
  const axisZ = leftHanded ? u1 : u2;

  // G2 Bézier cross-section: P0=(sb,0) → P3=(0,sb) with P1=P2=(sb,sb).
  // Closing lines: (0,sb) → (0,0) → (sb,0).
  const shape = new THREE.Shape();
  shape.moveTo(sb, 0);
  shape.bezierCurveTo(sb, sb, sb, sb, 0, sb);
  shape.lineTo(0, 0);
  // Shape auto-closes back to (sb, 0).

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: length + 2 * eps,
    bevelEnabled: false,
    curveSegments: 16,
  });

  // Apply edge frame: shape-X → axisX, shape-Y → axisZ, extrude-Z → edgeDir.
  // Shift start back by eps so the cutter fully overlaps both edge endpoints.
  const origin = a.clone().addScaledVector(edgeDir, -eps);
  const basis = new THREE.Matrix4().makeBasis(axisX, axisZ, edgeDir);
  basis.setPosition(origin.x, origin.y, origin.z);
  geo.applyMatrix4(basis);

  return geo;
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
  params?: FilletCommitParams,
): THREE.BufferGeometry | null {
  if (!(radius > 0) && !(params?.mode === 'chord-length' && params.chordLength && params.chordLength > 0)) return null;

  const chordLength = params?.mode === 'chord-length' ? (params.chordLength ?? 0) : 0;
  // In chord-length mode `radius` is a fallback — actual per-edge radius is
  // computed from the real dihedral inside buildFilletCutter.
  const baseRadius = chordLength > 0 ? (radius || chordLength / Math.SQRT2) : radius;
  // Tangency weight scales the blend extent (Fusion FilletEdgeSet.tangencyWeight).
  // Values > 1.0 extend the cutter radius (bigger blend); < 1.0 shrink it.
  // Only applied when isG2 is explicitly true — leaves standard G1 unaffected.
  const tw = (params?.isG2 && params.tangencyWeight && params.tangencyWeight !== 1.0)
    ? Math.max(0.1, Math.min(2.0, params.tangencyWeight))
    : 1.0;
  const effectiveRadius = baseRadius * tw;

  // Adaptive segment count: when segments <= 0, derive from arc length so
  // small radii use fewer triangles and large radii stay smooth.
  //   arcLen ≈ r * π/2  (90° edge approximation)
  //   targetSegLen ≈ 0.5mm (commit) / 2mm (preview)
  //   radialSeg = clamp(round(arcLen / targetSegLen), 16, 128)
  // Explicit segments > 0 override for callers that want a fixed resolution.
  let radialSeg: number;
  if (segments > 0) {
    radialSeg = fast
      ? Math.max(16, Math.round(segments) * 6)
      : Math.max(24, Math.round(segments) * 12);
  } else {
    const arcLen = effectiveRadius * (Math.PI / 2);
    const targetLen = fast ? 2.0 : 0.5;
    radialSeg = Math.max(16, Math.min(128, Math.round(arcLen / targetLen)));
  }
  const cutterOpts: FilletCutterOpts = {
    chordLength: chordLength || undefined,
  };
  if (params?.mode === 'variable') {
    cutterOpts.startRadius = params.startRadius ?? effectiveRadius;
    cutterOpts.endRadius = params.endRadius ?? effectiveRadius;
  }
  if (params?.mode === 'asymmetric') {
    const o1 = params.isFlipped ? (params.offsetTwo ?? effectiveRadius) : (params.offsetOne ?? effectiveRadius);
    const o2 = params.isFlipped ? (params.offsetOne ?? effectiveRadius) : (params.offsetTwo ?? effectiveRadius);
    cutterOpts.offsetOne = o1;
    cutterOpts.offsetTwo = o2;
    cutterOpts.isAsymmetric = true;
  }

  // G2 mode is only compatible with constant-radius (no variable, chord-length,
  // or asymmetric modes — those use the G1 cutter regardless of isG2).
  const useG2 = params?.isG2 === true &&
    (!params.mode || params.mode === 'constant') &&
    !cutterOpts.chordLength && !cutterOpts.startRadius && !cutterOpts.isAsymmetric;

  return computeEdgeCutGeometry(
    srcGeo,
    edges,
    useG2
      ? (re, eps) => buildG2FilletCutter(re, effectiveRadius, eps)
      : (re, eps) => buildFilletCutter(re, effectiveRadius, radialSeg, eps, cutterOpts),
    'fillet',
    fast,
    (circle, re) => buildFilletLoopCutter(circle, re, effectiveRadius, radialSeg, fast),
    {
      propagate: params?.propagate,
      cornerRadius: params?.isRollingBallCorner ? effectiveRadius : undefined,
    },
  );
}
