import { describe, it, expect } from 'vitest';
import { SketchAnalyzer } from '../engine/SketchAnalyzer';
import type { SketchEntity, SketchConstraint } from '../types/cad';

// Helper to make a line entity with x/y/z
function makeLine(
  id: string,
  x1: number, y1: number,
  x2: number, y2: number,
): SketchEntity {
  return {
    id,
    type: 'line',
    points: [
      { id: `${id}-p0`, x: x1, y: y1, z: 0 },
      { id: `${id}-p1`, x: x2, y: y2, z: 0 },
    ],
  };
}

function makeCircle(id: string, cx: number, cy: number, r: number): SketchEntity {
  return {
    id,
    type: 'circle',
    points: [{ id: `${id}-c`, x: cx, y: cy, z: 0 }],
    radius: r,
  };
}

describe('SketchAnalyzer.computeLoopArea', () => {
  it('computes positive area for a CCW triangle loop', () => {
    const line1 = makeLine('l1', 0, 0, 1, 0);
    const line2 = makeLine('l2', 1, 0, 0, 1);
    const line3 = makeLine('l3', 0, 1, 0, 0);
    const loop = { entityIds: ['l1', 'l2', 'l3'], closed: true };
    const entities = [line1, line2, line3];
    const area = SketchAnalyzer.computeLoopArea(loop, entities);
    // Triangle with vertices (0,0),(1,0),(0,1) has area = 0.5
    expect(Math.abs(area)).toBeCloseTo(0.5, 5);
  });

  it('returns zero for a degenerate loop with fewer than 3 points', () => {
    const line1 = makeLine('l1', 0, 0, 1, 0);
    const loop = { entityIds: ['l1'], closed: false };
    const area = SketchAnalyzer.computeLoopArea(loop, [line1]);
    expect(area).toBe(0);
  });

  it('computes area for a circle loop (single entity)', () => {
    const circle = makeCircle('c1', 0, 0, 1);
    const loop = { entityIds: ['c1'], closed: true };
    const area = SketchAnalyzer.computeLoopArea(loop, [circle]);
    // Circle area = pi*r^2 = pi, shoelace approximation with 8 samples should be close
    expect(Math.abs(area)).toBeGreaterThan(2.8);
    expect(Math.abs(area)).toBeLessThan(3.2);
  });
});

describe('SketchAnalyzer.estimateDOF', () => {
  it('returns correct DOF for unconstrained lines', () => {
    const entities: SketchEntity[] = [
      makeLine('l1', 0, 0, 1, 0),
      makeLine('l2', 1, 0, 2, 0),
    ];
    // Each line has 4 DOF, total = 8
    const dof = SketchAnalyzer.estimateDOF(entities, []);
    expect(dof).toBe(8);
  });

  it('reduces DOF with horizontal constraints', () => {
    const entities: SketchEntity[] = [makeLine('l1', 0, 0, 1, 0)];
    const constraints: SketchConstraint[] = [
      { id: 'c1', type: 'horizontal', entityIds: ['l1'] },
    ];
    // 4 DOF - 1 constraint = 3
    const dof = SketchAnalyzer.estimateDOF(entities, constraints);
    expect(dof).toBe(3);
  });

  it('returns 0 DOF for over-constrained or fully constrained sketch (clamps at 0)', () => {
    const entities: SketchEntity[] = [makeLine('l1', 0, 0, 1, 0)];
    const constraints: SketchConstraint[] = [
      { id: 'c1', type: 'fix', entityIds: ['l1'] },
      { id: 'c2', type: 'fix', entityIds: ['l1'] },
      { id: 'c3', type: 'fix', entityIds: ['l1'] },
    ];
    // Over-constrained: clamps at 0
    const dof = SketchAnalyzer.estimateDOF(entities, constraints);
    expect(dof).toBe(0);
  });

  it('counts circle DOF correctly (3 DOF each)', () => {
    const entities: SketchEntity[] = [makeCircle('c1', 0, 0, 1)];
    const dof = SketchAnalyzer.estimateDOF(entities, []);
    expect(dof).toBe(3);
  });
});

describe('SketchAnalyzer.findRedundantEntities', () => {
  it('detects a zero-length line as redundant', () => {
    const entities: SketchEntity[] = [makeLine('l1', 0, 0, 0, 0)];
    const redundant = SketchAnalyzer.findRedundantEntities(entities, 0.01);
    expect(redundant).toContain('l1');
  });

  it('detects duplicate lines as redundant', () => {
    const entities: SketchEntity[] = [
      makeLine('l1', 0, 0, 1, 0),
      makeLine('l2', 0, 0, 1, 0), // exact duplicate
    ];
    const redundant = SketchAnalyzer.findRedundantEntities(entities, 0.01);
    expect(redundant).toContain('l2');
    expect(redundant).not.toContain('l1');
  });

  it('does not flag distinct non-overlapping lines', () => {
    const entities: SketchEntity[] = [
      makeLine('l1', 0, 0, 1, 0),
      makeLine('l2', 0, 1, 1, 1),
    ];
    const redundant = SketchAnalyzer.findRedundantEntities(entities, 0.01);
    expect(redundant).toHaveLength(0);
  });
});
