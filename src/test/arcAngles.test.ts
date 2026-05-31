import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ccwArcToCursor, ccwArcThrough, ccwArcTangent, sampleCcwArc } from '../components/viewport/interaction/sketchInteraction/arcAngles';

const TAU = Math.PI * 2;
const t1 = new THREE.Vector3(1, 0, 0);
const t2 = new THREE.Vector3(0, 1, 0);

/** Reproduce the renderer's CCW normalisation: the sweep that is actually drawn. */
function sweep(sa: number, ea: number): number {
  let e = ea;
  if (e <= sa) e += TAU;
  return e - sa;
}

describe('arcAngles — CCW-canonical arc helpers', () => {
  describe('ccwArcToCursor (center-point arc)', () => {
    it('keeps a counter-clockwise sweep as-is (minor arc)', () => {
      // start at 0°, cursor at 90° CCW → 90° CCW arc
      const { startAngle, endAngle } = ccwArcToCursor(0, Math.PI / 2);
      expect(startAngle).toBeCloseTo(0, 6);
      expect(sweep(startAngle, endAngle)).toBeCloseTo(Math.PI / 2, 6);
    });

    it('represents a clockwise sweep as the same near-side minor arc', () => {
      // start at 0°, cursor at -90° (CW). Stored CCW from -90° to 0° = same 90° minor arc.
      const { startAngle, endAngle } = ccwArcToCursor(0, -Math.PI / 2);
      expect(sweep(startAngle, endAngle)).toBeCloseTo(Math.PI / 2, 6);
      // the drawn arc must include the cursor angle (-90°) and the start (0°)
      expect(startAngle).toBeCloseTo(-Math.PI / 2, 6);
      expect(endAngle).toBeCloseTo(0, 6);
    });

    it('never produces a sweep greater than 180°', () => {
      for (let deg = -179; deg <= 179; deg += 7) {
        const { startAngle, endAngle } = ccwArcToCursor(0, (deg * Math.PI) / 180);
        expect(sweep(startAngle, endAngle)).toBeLessThanOrEqual(Math.PI + 1e-6);
      }
    });
  });

  describe('ccwArcThrough (3-point arc)', () => {
    it('keeps order when the through-point is on the CCW side', () => {
      // start 0°, through 45° (CCW), end 90°
      const { startAngle, endAngle } = ccwArcThrough(0, Math.PI / 4, Math.PI / 2);
      expect(startAngle).toBeCloseTo(0, 6);
      expect(endAngle).toBeCloseTo(Math.PI / 2, 6);
    });

    it('swaps ends so the CCW arc passes through a CW through-point', () => {
      // start 0°, end 90°, but through-point at -45° (the long way / CW side)
      const { startAngle, endAngle } = ccwArcThrough(0, -Math.PI / 4, Math.PI / 2);
      // After swap the CCW arc must contain -45° (=315°)
      const s = sweep(startAngle, endAngle);
      const throughFromStart = ((-Math.PI / 4 - startAngle) % TAU + TAU) % TAU;
      expect(throughFromStart).toBeLessThanOrEqual(s + 1e-6);
    });
  });

  describe('ccwArcTangent (tangent arc)', () => {
    it('leaves the start in the tangent direction (no swap needed)', () => {
      // start at angle 0 (point on +t1 axis). CCW tangent there is +t2.
      const tangentDir = new THREE.Vector3(0, 1, 0); // +t2
      const { startAngle, endAngle } = ccwArcTangent(0, Math.PI / 2, t1, t2, tangentDir);
      expect(startAngle).toBeCloseTo(0, 6);
      expect(endAngle).toBeCloseTo(Math.PI / 2, 6);
    });

    it('swaps when the CCW start tangent opposes the desired direction', () => {
      // CCW tangent at angle 0 is +t2; ask for -t2 → must swap
      const tangentDir = new THREE.Vector3(0, -1, 0); // -t2
      const { startAngle, endAngle } = ccwArcTangent(0, Math.PI / 2, t1, t2, tangentDir);
      expect(startAngle).toBeCloseTo(Math.PI / 2, 6);
      expect(endAngle).toBeCloseTo(0, 6);
    });
  });

  describe('sampleCcwArc', () => {
    it('matches the renderer convention: forces endAngle > startAngle', () => {
      const center = new THREE.Vector3(0, 0, 0);
      // start 0°, end -90° → renderer adds 2π → 270° CCW sweep
      const pts = sampleCcwArc(center, 1, 0, -Math.PI / 2, t1, t2, 4);
      expect(pts).toHaveLength(5);
      // first point at angle 0 → (1,0,0)
      expect(pts[0].x).toBeCloseTo(1, 6);
      expect(pts[0].y).toBeCloseTo(0, 6);
      // last point at -90° (=270°) → (0,-1,0)
      expect(pts[4].x).toBeCloseTo(0, 6);
      expect(pts[4].y).toBeCloseTo(-1, 6);
    });
  });
});
