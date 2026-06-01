/**
 * sketchInference.ts — A10: compute horizontal/vertical inference guides.
 *
 * Given the raw cursor position, the drawing start point, and the active sketch's
 * existing entities, returns an InferenceResult describing:
 *   - Whether the cursor is near H or V from the current drawing start (driving the
 *     guide line and auto-apply of H/V constraint on commit)
 *   - Whether the cursor aligns H or V with an existing entity endpoint (alignment
 *     guide only, no constraint auto-apply)
 *
 * Pure TypeScript — no React, no store imports.
 */
import * as THREE from 'three';
import type { Sketch } from '../../../../types/cad';

/** Degrees within H or V that triggers inference snapping. */
const HV_ANGLE_TOL_DEG = 5;

export type InferenceConstraintType = 'horizontal' | 'vertical';

export interface InferenceResult {
  /** 'horizontal' or 'vertical' when the cursor is near H/V from the draw start
   *  and a constraint should be auto-applied on commit. null for alignment-only guides. */
  constraintType: InferenceConstraintType | null;
  /** The cursor position snapped to the inferred line. */
  snappedPos: THREE.Vector3;
  /** Guide line endpoints (extended through the relevant axis). */
  guideFrom: THREE.Vector3;
  guideTo: THREE.Vector3;
}

/**
 * Compute the active inference guide for the current cursor position.
 *
 * Returns null when:
 *   - A snap target is already active (snap takes precedence)
 *   - No H/V proximity or alignment is detected
 *
 * @param rawPos      Raw world-space cursor position (pre-snap)
 * @param drawStart   First drawing point (null before the first click)
 * @param sketch      Active sketch (used for entity endpoint alignment)
 * @param t1          Sketch plane U axis (from getSketchAxes)
 * @param t2          Sketch plane V axis
 * @param snapActive  Whether a geometric snap is already engaged
 * @param wuPerPx     World units per screen pixel at cursor depth (for screen-space thresholds)
 */
export function computeSketchInference(
  rawPos: THREE.Vector3,
  drawStart: THREE.Vector3 | null,
  sketch: Sketch,
  t1: THREE.Vector3,
  t2: THREE.Vector3,
  snapActive: boolean,
  wuPerPx: number,
): InferenceResult | null {
  if (snapActive) return null;

  const ANGLE_TOL = (HV_ANGLE_TOL_DEG * Math.PI) / 180;
  // Minimum distance from start before H/V inference kicks in (avoids jitter near origin).
  const MIN_DIST = wuPerPx * 8;

  // ── Priority 1: H/V inference from the current drawing start ──────────────
  if (drawStart) {
    const delta = rawPos.clone().sub(drawStart);
    const u = delta.dot(t1);
    const v = delta.dot(t2);
    const len = Math.sqrt(u * u + v * v);

    if (len > MIN_DIST) {
      const angle = Math.atan2(Math.abs(v), Math.abs(u));

      if (angle < ANGLE_TOL) {
        // Near-horizontal — snap cursor to the horizontal line through drawStart.
        const snapped = drawStart.clone().addScaledVector(t1, u);
        const ext = Math.abs(u) * 1.4 + wuPerPx * 40;
        return {
          constraintType: 'horizontal',
          snappedPos: snapped,
          guideFrom: drawStart.clone().addScaledVector(t1, -ext),
          guideTo: drawStart.clone().addScaledVector(t1, ext),
        };
      }

      if (angle > Math.PI / 2 - ANGLE_TOL) {
        // Near-vertical — snap cursor to the vertical line through drawStart.
        const snapped = drawStart.clone().addScaledVector(t2, v);
        const ext = Math.abs(v) * 1.4 + wuPerPx * 40;
        return {
          constraintType: 'vertical',
          snappedPos: snapped,
          guideFrom: drawStart.clone().addScaledVector(t2, -ext),
          guideTo: drawStart.clone().addScaledVector(t2, ext),
        };
      }
    }
  }

  // ── Priority 2: H/V alignment from existing entity endpoints ──────────────
  // The cursor aligns horizontally or vertically with an existing endpoint.
  // Draws a short guide from that endpoint to the cursor. No constraint auto-apply.
  const ALIGN_PX = 10; // screen-space alignment zone in pixels
  const alignTol = wuPerPx * ALIGN_PX;

  for (const e of sketch.entities) {
    // Skip construction/centerline — alignment to those is rarely useful
    if (e.type === 'construction-line' || e.type === 'centerline') continue;
    for (const pt of e.points) {
      const ep = new THREE.Vector3(pt.x, pt.y, pt.z);
      const delta = rawPos.clone().sub(ep);
      const u = delta.dot(t1);
      const v = delta.dot(t2);
      const absU = Math.abs(u);
      const absV = Math.abs(v);

      // Don't trigger when the cursor is too close to the endpoint itself
      if (absU < alignTol && absV < alignTol) continue;
      // Need meaningful displacement in at least one axis
      if (absU < 0.1 && absV < 0.1) continue;

      if (absV < alignTol && absU > alignTol) {
        // Horizontally aligned with this endpoint
        const snapped = ep.clone().addScaledVector(t1, u);
        return {
          constraintType: null,
          snappedPos: snapped,
          guideFrom: ep.clone(),
          guideTo: snapped.clone(),
        };
      }

      if (absU < alignTol && absV > alignTol) {
        // Vertically aligned with this endpoint
        const snapped = ep.clone().addScaledVector(t2, v);
        return {
          constraintType: null,
          snappedPos: snapped,
          guideFrom: ep.clone(),
          guideTo: snapped.clone(),
        };
      }
    }
  }

  return null;
}
