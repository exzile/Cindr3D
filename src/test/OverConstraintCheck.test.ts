import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { wouldOverConstrain } from '../engine/overConstraintCheck';
import type { Sketch, SketchDimension, SketchEntity } from '../types/cad';

// Minimal XY-plane sketch. On the XY plane getSketchAxes() gives
// t1 = (1,0,0), t2 = (0,0,-1), so geometry that varies only in world-x
// projects to a non-degenerate 2D segment along the solver's x' axis —
// exactly what buildSketchSolveInputs feeds the solver in the real solve.
const mkSketch = (entities: SketchEntity[], dimensions: SketchDimension[] = []): Sketch => ({
  id: 'over-constraint-sketch',
  name: 'Over-constraint sketch',
  plane: 'XY',
  planeNormal: new THREE.Vector3(0, 1, 0),
  planeOrigin: new THREE.Vector3(0, 0, 0),
  entities,
  constraints: [],
  dimensions,
  fullyConstrained: false,
});

const line = (id: string, x0: number, x1: number): SketchEntity => ({
  id,
  type: 'line',
  points: [
    { id: `${id}-p0`, x: x0, y: 0, z: 0 },
    { id: `${id}-p1`, x: x1, y: 0, z: 0 },
  ],
});

const circle = (id: string, radius: number): SketchEntity => ({
  id,
  type: 'circle',
  points: [{ id: `${id}-c`, x: 0, y: 0, z: 0 }],
  radius,
});

// Arc fixture mirrors how the dimension hook models an arc for arc-length:
// points[0] = center, radius + startAngle/endAngle carry the sweep. Those
// are NOT solver parameters, so (exactly like radial/diameter) the arc-length
// residual is geometry−target; it can be driven to zero only when the
// dimension's value matches the arc's intrinsic length.
const arc = (
  id: string,
  radius: number,
  startAngle: number,
  endAngle: number,
): SketchEntity => ({
  id,
  type: 'arc',
  points: [{ id: `${id}-c`, x: 0, y: 0, z: 0 }],
  radius,
  startAngle,
  endAngle,
});

const arcLengthDim = (
  id: string,
  entityId: string,
  value: number,
  driven = false,
): SketchDimension => ({
  id,
  type: 'arc-length',
  entityIds: [entityId],
  value,
  position: { x: 4, y: 4 },
  driven,
});

const radialDim = (
  id: string,
  entityId: string,
  value: number,
  type: 'radial' | 'diameter' = 'radial',
  driven = false,
): SketchDimension => ({
  id,
  type,
  entityIds: [entityId],
  value,
  position: { x: 4, y: 4 },
  driven,
});

const lengthDim = (
  id: string,
  entityId: string,
  value: number,
  driven = false,
): SketchDimension => ({
  id,
  type: 'aligned',
  entityIds: [entityId],
  value,
  position: { x: 0, y: 4 },
  driven,
});

describe('wouldOverConstrain', () => {
  it('(a) a line + one length dimension is solvable → false', () => {
    const sketch = mkSketch([line('line-a', 0, 14)]);
    const candidate = lengthDim('dim-1', 'line-a', 10);

    expect(wouldOverConstrain(sketch, candidate)).toBe(false);
  });

  it('(b) a line + two conflicting length dimensions over-constrains → true', () => {
    // The sketch already pins line-a to length 10; the candidate demands 25
    // on the SAME single line. The two driving dimensions cannot both be
    // satisfied (the line has one free length DOF) ⇒ solver fails.
    const sketch = mkSketch([line('line-a', 0, 14)], [lengthDim('dim-1', 'line-a', 10)]);
    const candidate = lengthDim('dim-2', 'line-a', 25);

    expect(wouldOverConstrain(sketch, candidate)).toBe(true);
  });

  it('(c) a driven candidate never over-constrains, even when geometrically redundant', () => {
    // Same conflicting setup as (b), but the candidate is driven (reference).
    // Driven dims are filtered out by dimensionsToSolverConstraints and never
    // reach the solver — so they can never over-constrain. Short-circuits to
    // false before any trial solve runs.
    const sketch = mkSketch([line('line-a', 0, 14)], [lengthDim('dim-1', 'line-a', 10)]);
    const candidate = lengthDim('dim-2', 'line-a', 25, /* driven */ true);

    expect(wouldOverConstrain(sketch, candidate)).toBe(false);
  });

  // Type-coverage proof for the universal guard: radial and diameter
  // dimensions go through the SAME wouldOverConstrain predicate (via
  // dimensionsToSolverConstraints → dimension-radial / dimension-diameter
  // residuals), so the shared interceptOverConstraint helper now wired into
  // the inferred circle→diameter / arc→radial / explicit arc-length add sites
  // gets real coverage — not just linear/aligned.
  it('(d) a redundant radial dimension on an already radius-constrained circle over-constrains → true', () => {
    // circle-a's radius (5) is already pinned by a driving radial dim; a
    // second NON-driven radial demanding 9 on the same circle cannot also be
    // satisfied (radius is not a solver DOF) ⇒ trial solve fails.
    const sketch = mkSketch([circle('circle-a', 5)], [radialDim('rad-1', 'circle-a', 5)]);
    const candidate = radialDim('rad-2', 'circle-a', 9);

    expect(wouldOverConstrain(sketch, candidate)).toBe(true);
  });

  it('(e) a conflicting diameter dimension on a radius-constrained circle over-constrains → true', () => {
    // Same circle, but the redundant candidate is a DIAMETER (18 ⇒ r=9),
    // conflicting with the existing radial (r=5). Proves the diameter branch
    // of dimensionsToSolverConstraints is exercised by the same predicate.
    const sketch = mkSketch([circle('circle-a', 5)], [radialDim('rad-1', 'circle-a', 5)]);
    const candidate = radialDim('dia-1', 'circle-a', 18, 'diameter');

    expect(wouldOverConstrain(sketch, candidate)).toBe(true);
  });

  it('(f) a driven conflicting radial candidate never over-constrains → false', () => {
    // Same conflicting circle setup as (d) but the candidate is driven
    // (reference) — short-circuits before the trial solve, exactly like (c)
    // for linear. This is what the "Create driven dimension" fallback yields.
    const sketch = mkSketch([circle('circle-a', 5)], [radialDim('rad-1', 'circle-a', 5)]);
    const candidate = radialDim('rad-2', 'circle-a', 9, 'radial', /* driven */ true);

    expect(wouldOverConstrain(sketch, candidate)).toBe(false);
  });

  // ── Arc-length: detection parity with radial/diameter (CAVEAT 1) ──────────
  // arc-length is now a real `dimension-arc-length` solver constraint whose
  // residual = currentArcLength − target, computed IDENTICALLY to
  // DimensionEngine.computeArcLengthDimension: arc r=5 swept 0→π/2 has an
  // intrinsic length of r·(end−start) = 5·(π/2) = 2.5π ≈ 7.853981633974483.
  // Radius/angles are not solver DOFs (same as radial/diameter), so the
  // residual is non-zero exactly when the dimension value disagrees with the
  // arc's fixed geometry — no longer a silent solver no-op.
  const ARC_LEN = 2.5 * Math.PI; // r=5, sweep 0→π/2

  it('(g) a conflicting arc-length on an arc whose geometry fixes its sweep+radius → true', () => {
    // The arc's sweep+radius are intrinsic geometry (not solver DOFs). An
    // existing driving arc-length already pins the true length; a second
    // non-driven arc-length demanding 20 cannot also be satisfied ⇒ residual
    // ≠ 0 ⇒ trial solve reports !solved ⇒ over-constrained. (Mirrors (d).)
    const sketch = mkSketch(
      [arc('arc-a', 5, 0, Math.PI / 2)],
      [arcLengthDim('al-1', 'arc-a', ARC_LEN)],
    );
    const candidate = arcLengthDim('al-2', 'arc-a', 20);

    expect(wouldOverConstrain(sketch, candidate)).toBe(true);
  });

  it('(h) a single arc-length matching an otherwise-free arc is solvable → false', () => {
    // One arc, no other dimensions, candidate value == the arc's true length.
    // residual ≈ 0 ⇒ solver converges ⇒ NOT over-constrained (solvable),
    // exactly like a single matching radial on a free circle.
    const sketch = mkSketch([arc('arc-a', 5, 0, Math.PI / 2)]);
    const candidate = arcLengthDim('al-1', 'arc-a', ARC_LEN);

    expect(wouldOverConstrain(sketch, candidate)).toBe(false);
  });

  it('(i) a driven conflicting arc-length candidate never over-constrains → false', () => {
    // Same conflicting setup as (g) but the candidate is driven (reference) —
    // driven dims are filtered by dimensionsToSolverConstraints and never
    // reach the solver, so wouldOverConstrain short-circuits before any trial
    // solve. This is the "Create driven dimension" fallback for arc-length.
    const sketch = mkSketch(
      [arc('arc-a', 5, 0, Math.PI / 2)],
      [arcLengthDim('al-1', 'arc-a', ARC_LEN)],
    );
    const candidate = arcLengthDim('al-2', 'arc-a', 20, /* driven */ true);

    expect(wouldOverConstrain(sketch, candidate)).toBe(false);
  });

  // ── False-positive bound on a near-singular-but-solvable sketch ──────────
  // The remaining caveat (visual/interactive feel + false-positive feel on
  // near-singular sketches in LIVE use) needs human click-through and is NOT
  // claimed closed here. This single deterministic test only bounds the
  // false-positive RISK objectively: a sketch whose Jacobian is near-singular
  // (an extremely short, near-zero-length line — tiny direction, ill-scaled
  // partials) but which IS satisfiable by a consistent dimension must NOT be
  // falsely flagged. The Tikhonov regularisation in solveNormalEquations is
  // what keeps this convergent; if that ever regressed this test would catch
  // a spurious over-constraint report.
  it('(j) a near-singular but consistent sketch is NOT falsely flagged → false', () => {
    // Line spanning [0, 1e-4] — direction magnitude ~1e-4 makes JᵀJ
    // near-singular. The candidate aligned length equals the actual span,
    // so the system is consistent and the solver (with regularisation) must
    // still report solved ⇒ no false positive.
    const tiny = 1e-4;
    const sketch = mkSketch([line('line-a', 0, tiny)]);
    const candidate = lengthDim('dim-1', 'line-a', tiny);

    expect(wouldOverConstrain(sketch, candidate)).toBe(false);
  });
});
