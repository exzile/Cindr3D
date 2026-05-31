import { describe, expect, it } from 'vitest';
import { dimensionsToSolverConstraints, solveConstraints } from '../engine/ConstraintSolver';
import type { SketchDimension, SketchEntity } from '../types/cad';

const line = (id: string, x0: number, y0: number, x1: number, y1: number): SketchEntity => ({
  id,
  type: 'line',
  points: [
    { id: `${id}-0`, x: x0, y: y0, z: 0 },
    { id: `${id}-1`, x: x1, y: y1, z: 0 },
  ],
});

const circle = (id: string, x: number, y: number, radius: number): SketchEntity => ({
  id,
  type: 'circle',
  points: [{ id: `${id}-0`, x, y, z: 0 }],
  radius,
});

describe('dimension constraints in ConstraintSolver', () => {
  it('solves a driving aligned line dimension after geometry is moved', () => {
    const entities = [line('line-a', 0, 0, 14, 0)];
    const dimensions: SketchDimension[] = [{
      id: 'dim-a',
      type: 'aligned',
      entityIds: ['line-a'],
      value: 10,
      position: { x: 5, y: 4 },
      driven: false,
    }];

    const result = solveConstraints(entities, dimensionsToSolverConstraints(dimensions));

    expect(result.solved).toBe(true);
    const p0 = result.updatedPoints.get('line-a-p0')!;
    const p1 = result.updatedPoints.get('line-a-p1')!;
    expect(Math.hypot(p1.x - p0.x, p1.y - p0.y)).toBeCloseTo(10, 4);
  });

  it('fails a mismatched driving dimension when fixed geometry cannot move', () => {
    const entities = [line('line-a', 0, 0, 14, 0)];
    const dimensions: SketchDimension[] = [{
      id: 'dim-a',
      type: 'aligned',
      entityIds: ['line-a'],
      value: 10,
      position: { x: 5, y: 4 },
      driven: false,
    }];

    const result = solveConstraints(entities, [
      { type: 'fix', entityIds: ['line-a'] },
      ...dimensionsToSolverConstraints(dimensions),
    ]);

    expect(result.solved).toBe(false);
    expect(result.residual).toBeGreaterThan(1);
  });

  it('ignores driven dimensions as reference-only measurements', () => {
    const dimensions: SketchDimension[] = [{
      id: 'dim-a',
      type: 'aligned',
      entityIds: ['line-a'],
      value: 10,
      position: { x: 5, y: 4 },
      driven: true,
    }];

    expect(dimensionsToSolverConstraints(dimensions)).toEqual([]);
  });

  it('solves line-to-circle tangent with pinned radius', () => {
    // B1: radius is now a solver DOF. Without a radial dimension, the solver is free to
    // change both center position and radius. Pin radius=3 so only the center moves.
    const result = solveConstraints([
      line('line-a', -10, 5, 10, 5),
      circle('circle-a', 0, 0, 3),
    ], [
      { type: 'fix', entityIds: ['line-a'] },
      { type: 'tangent', entityIds: ['line-a', 'circle-a'] },
      { type: 'dimension-radial', entityIds: ['circle-a'], value: 3 },
    ]);

    expect(result.solved).toBe(true);
    const center = result.updatedPoints.get('circle-a-p0')!;
    expect(Math.abs(center.y - 5)).toBeCloseTo(3, 3);
  });

  // ── B1.e: radius / angle DOFs ──────────────────────────────────────────────
  it('B1: radial dimension resizes a circle', () => {
    const result = solveConstraints([circle('c', 0, 0, 5)], [
      { type: 'dimension-radial', entityIds: ['c'], value: 10 },
    ]);
    expect(result.solved).toBe(true);
    expect(result.updatedScalars.get('c::radius')).toBeCloseTo(10, 3);
  });

  it('B1: diameter dimension resizes a circle', () => {
    const result = solveConstraints([circle('c', 0, 0, 5)], [
      { type: 'dimension-diameter', entityIds: ['c'], value: 20 },
    ]);
    expect(result.solved).toBe(true);
    expect(result.updatedScalars.get('c::radius')).toBeCloseTo(10, 3);
  });

  it('B1: equal constraint equalises two circle radii', () => {
    const entities: SketchEntity[] = [
      circle('c1', 0, 0, 5),
      circle('c2', 20, 0, 9),
    ];
    const result = solveConstraints(entities, [
      { type: 'equal', entityIds: ['c1', 'c2'] },
    ]);
    expect(result.solved).toBe(true);
    const r1 = result.updatedScalars.get('c1::radius')!;
    const r2 = result.updatedScalars.get('c2::radius')!;
    expect(Math.abs(r1 - r2)).toBeCloseTo(0, 3);
  });
});
