// dimensionPlacement.ts — Pure-math helper that infers the orientation and
// signed offset of a single-line linear/aligned dimension from the cursor
// position, mirroring Fusion 360's rubber-band placement behaviour.
//
// No THREE.js dependency. All coordinates are 2D sketch space (model units).
// Kept separate from DimensionEngine so it can be unit-tested in isolation.

export type Vec2 = { x: number; y: number };

export type LinearPlacement =
  | { kind: 'linear'; axis: 'horizontal' | 'vertical'; offset: number }
  | { kind: 'aligned'; offset: number };

/**
 * Given a picked line (start→end) and the cursor position, decide how a
 * single-entity dimension should be drawn:
 *
 * - Cursor pulled above/below a horizontal line ⇒ horizontal measurement (ΔX),
 *   offset perpendicular (vertically).
 * - Cursor pulled to the side of a vertical line ⇒ vertical measurement (ΔY),
 *   offset perpendicular (horizontally).
 * - For a diagonal line: pulling perpendicular to the line ⇒ aligned
 *   (true-length); pulling along the dominant axis ⇒ horizontal/vertical.
 *
 * `panelOrientation` (the SketchDimensionPanel override) wins over cursor
 * inference whenever it is not 'auto'.
 *
 * Offsets are signed — the sign encodes which side of the geometry the
 * dimension line sits on, so the ghost/commit follows the cursor.
 */
export function inferLinearPlacement(
  lineStart: Vec2,
  lineEnd: Vec2,
  cursor: Vec2,
  panelOrientation: 'horizontal' | 'vertical' | 'auto',
): LinearPlacement {
  const mid = { x: (lineStart.x + lineEnd.x) / 2, y: (lineStart.y + lineEnd.y) / 2 };
  const rawDir = { x: lineEnd.x - lineStart.x, y: lineEnd.y - lineStart.y };
  const dirLen = Math.hypot(rawDir.x, rawDir.y) || 1;
  const dir = { x: rawDir.x / dirLen, y: rawDir.y / dirLen };
  // 90° CCW perpendicular — matches DimensionEngine.computeAlignedDimension's
  // normal convention so the signed offset feeds straight through.
  const nrm = { x: -dir.y, y: dir.x };
  const rel = { x: cursor.x - mid.x, y: cursor.y - mid.y };
  const along = rel.x * dir.x + rel.y * dir.y;
  const perp = rel.x * nrm.x + rel.y * nrm.y;

  if (panelOrientation !== 'auto') {
    // For an explicit axis, computeLinearDimension offsets from the midpoint
    // baseline (y-base for horizontal, x-base for vertical). The signed
    // distance on that axis is simply how far the cursor is from the line's
    // midpoint along that world axis.
    const offset = panelOrientation === 'horizontal' ? rel.y : rel.x;
    return { kind: 'linear', axis: panelOrientation, offset };
  }

  // Axis-aligned line: measure the span and push the dim line perpendicular.
  if (Math.abs(dir.x) > 0.97) {
    // Horizontal line → measure ΔX, dim line offset vertically.
    return { kind: 'linear', axis: 'horizontal', offset: perp };
  }
  if (Math.abs(dir.y) > 0.97) {
    // Vertical line → measure ΔY, dim line offset horizontally.
    return { kind: 'linear', axis: 'vertical', offset: perp };
  }

  // Diagonal line: pulling perpendicular ⇒ true-length aligned dimension.
  if (Math.abs(perp) >= Math.abs(along)) {
    return { kind: 'aligned', offset: perp };
  }
  // Pulled along the line — fall back to an axis-aligned linear dimension
  // chosen by the dominant cursor delta, signed by that delta's direction.
  const relLen = Math.hypot(rel.x, rel.y);
  if (Math.abs(rel.x) >= Math.abs(rel.y)) {
    return { kind: 'linear', axis: 'vertical', offset: Math.sign(rel.x || 1) * relLen };
  }
  return { kind: 'linear', axis: 'horizontal', offset: Math.sign(rel.y || 1) * relLen };
}
