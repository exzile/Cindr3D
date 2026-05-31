import * as THREE from 'three';

/**
 * Shared arc-angle math for every arc tool (center-point, 3-point, tangent).
 *
 * LOAD-BEARING INVARIANT: the sketch renderer (`createArc`) and every engine
 * consumer (sketchProfiles, sketchAnalyzer, profileGeometry, DimensionEngine,
 * DXF export) trace an arc as the COUNTERCLOCKWISE sweep from `startAngle` to
 * `endAngle`, normalising `endAngle += 2π` while `endAngle <= startAngle`.
 *
 * Therefore every arc tool must store angles such that the CCW arc from
 * startAngle→endAngle is exactly the arc the user drew. These helpers return
 * that CCW-canonical pair, and `sampleCcwArc` reproduces the renderer's path
 * EXACTLY so live previews match the committed geometry. Mirrors Fusion 360's
 * SketchArcs factory, whose sweep "is always counterclockwise from start to end
 * using the right-hand rule around the [plane] normal."
 */

/** Normalize an angle delta into (-π, π]. */
function normalizePiToPi(d: number): number {
  let r = d;
  while (r > Math.PI) r -= 2 * Math.PI;
  while (r <= -Math.PI) r += 2 * Math.PI;
  return r;
}

/** Normalize an angle delta into [0, 2π). */
function normalize0To2Pi(d: number): number {
  let r = d % (2 * Math.PI);
  if (r < 0) r += 2 * Math.PI;
  return r;
}

/**
 * Center-point arc (Fusion `addByCenterStartSweep`): pick the minor arc (≤180°)
 * from the start-click toward the cursor, returned CCW-canonical (endAngle >
 * startAngle) so the CCW renderer traces exactly the previewed near-side arc.
 * Avoids the "flip to the complementary arc on commit" bug that happens when a
 * clockwise sweep is stored as raw atan2 angles.
 */
export function ccwArcToCursor(
  startClickAngle: number,
  cursorAngle: number,
): { startAngle: number; endAngle: number } {
  const delta = normalizePiToPi(cursorAngle - startClickAngle);
  if (delta >= 0) return { startAngle: startClickAngle, endAngle: startClickAngle + delta };
  // Cursor is on the clockwise side: store the same minor arc as a CCW sweep
  // from the cursor to the start click (geometry identical, ends swapped).
  return { startAngle: cursorAngle, endAngle: cursorAngle - delta };
}

/**
 * 3-point arc (Fusion `addByThreePoints`): return CCW-canonical (sa, ea) such
 * that the CCW sweep passes through the through-point. Swaps the ends when the
 * through-point lies on the clockwise side of the naive start→end sweep.
 */
export function ccwArcThrough(
  startAngle: number,
  throughAngle: number,
  endAngle: number,
): { startAngle: number; endAngle: number } {
  const midFromStart = normalize0To2Pi(throughAngle - startAngle);
  const endFromStart = normalize0To2Pi(endAngle - startAngle);
  if (midFromStart > endFromStart) return { startAngle: endAngle, endAngle: startAngle };
  return { startAngle, endAngle };
}

/**
 * Tangent arc: return CCW-canonical (sa, ea) so the CCW arc's start tangent
 * aligns with `tangentDir` (smooth G1 join, no cusp). The CCW arc's tangent at
 * angle θ is (-sinθ·t1 + cosθ·t2); when it opposes tangentDir we select the
 * complementary arc (swap) which is the one that actually leaves the junction
 * in the tangent direction.
 */
export function ccwArcTangent(
  startAngle: number,
  endAngle: number,
  t1: THREE.Vector3,
  t2: THREE.Vector3,
  tangentDir: THREE.Vector3,
): { startAngle: number; endAngle: number } {
  const startTangent = t1.clone().multiplyScalar(-Math.sin(startAngle))
    .add(t2.clone().multiplyScalar(Math.cos(startAngle)));
  if (startTangent.dot(tangentDir) < 0) return { startAngle: endAngle, endAngle: startAngle };
  return { startAngle, endAngle };
}

/**
 * Sample a CCW arc IDENTICALLY to the renderer's `createArc`, so a live preview
 * built with these points matches the committed geometry pixel-for-pixel.
 */
export function sampleCcwArc(
  center: THREE.Vector3,
  radius: number,
  startAngle: number,
  endAngle: number,
  t1: THREE.Vector3,
  t2: THREE.Vector3,
  segments = 32,
): THREE.Vector3[] {
  let ea = endAngle;
  if (ea <= startAngle) ea += 2 * Math.PI;
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= segments; i++) {
    const a = startAngle + (i / segments) * (ea - startAngle);
    pts.push(
      center.clone()
        .addScaledVector(t1, Math.cos(a) * radius)
        .addScaledVector(t2, Math.sin(a) * radius),
    );
  }
  return pts;
}
