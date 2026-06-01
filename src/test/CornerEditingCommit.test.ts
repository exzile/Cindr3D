import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { handleCornerEditingCommit } from '../components/viewport/interaction/sketchInteraction/commitHandlers/editing/cornerEditingHandlers';
import type { SketchCommitCtx } from '../types/sketch-commit.types';
import type { Sketch, SketchEntity } from '../types/cad';

function pt(x: number, y: number, z: number) {
  return { id: crypto.randomUUID(), x, y, z };
}
function line(id: string, a: [number, number, number], b: [number, number, number]): SketchEntity {
  return { id, type: 'line', points: [pt(...a), pt(...b)] };
}

// YZ-plane square, corner at (0,119,201). 'bottom' and 'right' meet there,
// welded by a coincident constraint (as the rectangle tool emits).
function yzSquareSketch(): Sketch {
  return {
    id: 's', name: 'S', plane: 'YZ',
    entities: [
      line('top', [0, 119, 229], [0, 91, 229]),
      line('left', [0, 91, 229], [0, 91, 201]),
      line('bottom', [0, 91, 201], [0, 119, 201]),
      line('right', [0, 119, 201], [0, 119, 229]),
    ],
    constraints: [
      { id: 'weld', type: 'coincident', entityIds: ['bottom', 'right'], pointIndices: [1, 0] },
      { id: 'other', type: 'coincident', entityIds: ['right', 'top'], pointIndices: [1, 0] },
    ],
    dimensions: [],
  } as unknown as Sketch;
}

function makeCtx(
  sketch: Sketch,
  clickAt: [number, number, number],
  capture: { out?: SketchEntity[]; constraints?: import('../types/cad').SketchConstraint[]; msg?: string },
): SketchCommitCtx {
  return {
    activeTool: 'sketch-fillet',
    activeSketch: sketch,
    sketchPoint: pt(...clickAt),
    drawingPoints: [],
    setDrawingPoints: () => {},
    t1: new THREE.Vector3(0, 1, 0),
    t2: new THREE.Vector3(0, 0, 1),
    projectToPlane: () => ({ u: 0, v: 0 }),
    addSketchEntity: () => {},
    addSketchConstraint: () => {},
    replaceSketchEntities: (entities) => { capture.out = entities; },
    replaceActiveSketchGeometry: (entities, constraints) => { capture.out = entities; capture.constraints = constraints; },
    cycleEntityLinetype: () => {},
    setStatusMessage: (m) => { capture.msg = m; },
    polygonSides: 4,
    filletRadius: 2,
    chamferDist1: 1, chamferDist2: 1, chamferAngle: 45,
    tangentCircleRadius: 5, conicRho: 0.5, blendCurveMode: 'g1',
  };
}

describe('handleCornerEditingCommit — sketch-fillet', () => {
  it('trims both lines back to the tangent points and adds one arc', () => {
    const sketch = yzSquareSketch();
    const capture: { out?: SketchEntity[]; msg?: string } = {};
    const handled = handleCornerEditingCommit(makeCtx(sketch, [0, 119, 201], capture));

    expect(handled).toBe(true);
    expect(capture.out).toBeDefined();
    const out = capture.out!;

    // 4 lines + 1 new arc = 5 entities.
    expect(out.length).toBe(5);
    const arcs = out.filter((e) => e.type === 'arc');
    expect(arcs.length).toBe(1);
    expect(arcs[0].radius).toBeCloseTo(2, 5);

    // The two lines that met at (119,201) must NO LONGER reach that corner —
    // they should be trimmed to the tangent points (117,201) and (119,203).
    const bottom = out.find((e) => e.id === 'bottom')!;
    const right = out.find((e) => e.id === 'right')!;
    const reaches = (e: SketchEntity, y: number, z: number) =>
      e.points.some((p) => Math.abs(p.y - y) < 1e-6 && Math.abs(p.z - z) < 1e-6);

    expect(reaches(bottom, 119, 201)).toBe(false); // sharp corner gone
    expect(reaches(right, 119, 201)).toBe(false);
    expect(reaches(bottom, 117, 201)).toBe(true);  // trimmed to tangent
    expect(reaches(right, 119, 203)).toBe(true);
  });

  it('keeps original line IDs so constraints survive', () => {
    const sketch = yzSquareSketch();
    const capture: { out?: SketchEntity[] } = {};
    handleCornerEditingCommit(makeCtx(sketch, [0, 119, 201], capture));
    const ids = capture.out!.filter((e) => e.type === 'line').map((e) => e.id).sort();
    expect(ids).toEqual(['bottom', 'left', 'right', 'top']);
  });

  it('drops the corner weld so the solver cannot collapse the fillet', () => {
    const sketch = yzSquareSketch();
    const capture: { out?: SketchEntity[]; constraints?: import('../types/cad').SketchConstraint[] } = {};
    handleCornerEditingCommit(makeCtx(sketch, [0, 119, 201], capture));
    expect(capture.constraints).toBeDefined();
    // The bottom↔right weld must be gone; unrelated constraints must remain.
    expect(capture.constraints!.some((c) => c.id === 'weld')).toBe(false);
    expect(capture.constraints!.some((c) => c.id === 'other')).toBe(true);
  });
});
