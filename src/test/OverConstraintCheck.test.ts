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
});
