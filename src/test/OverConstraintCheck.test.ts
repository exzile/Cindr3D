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
});
