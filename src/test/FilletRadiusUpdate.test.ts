import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  findFilletCorner,
  computeFilletGeometry,
  computeFilletRadiusUpdate,
} from '../components/viewport/interaction/sketchInteraction/cornerFilletGeometry';
import type { Sketch, SketchEntity } from '../types/cad';

function pt(x: number, y: number, z: number) {
  return { id: crypto.randomUUID(), x, y, z };
}
function line(id: string, a: [number, number, number], b: [number, number, number]): SketchEntity {
  return { id, type: 'line', points: [pt(...a), pt(...b)] };
}

// Build a YZ-plane square and apply a fillet (r=6) at corner (0,119,201),
// returning the post-fillet sketch (lines trimmed + arc), mirroring the commit.
function filletedSketch(): Sketch {
  const lines: SketchEntity[] = [
    line('top', [0, 119, 229], [0, 91, 229]),
    line('left', [0, 91, 229], [0, 91, 201]),
    line('bottom', [0, 91, 201], [0, 119, 201]),
    line('right', [0, 119, 201], [0, 119, 229]),
  ];
  const base = { id: 's', name: 'S', plane: 'YZ', entities: lines, constraints: [], dimensions: [] } as unknown as Sketch;

  const corner = findFilletCorner(base, new THREE.Vector3(0, 119, 201), 4)!;
  const geo = computeFilletGeometry(base, corner, 6)!;
  // Trim bottom (corner endpoint is points[1]) and right (corner endpoint is points[0]).
  const entities = base.entities.map((e) => {
    if (e.id === 'bottom') return { ...e, points: [e.points[0], { ...e.points[1], x: geo.tangent0.x, y: geo.tangent0.y, z: geo.tangent0.z }] };
    if (e.id === 'right') return { ...e, points: [{ ...e.points[0], x: geo.tangent1.x, y: geo.tangent1.y, z: geo.tangent1.z }, e.points[1]] };
    return e;
  });
  entities.push({ id: 'arc', type: 'arc', points: [pt(geo.center.x, geo.center.y, geo.center.z)], radius: 6, startAngle: geo.arcStart, endAngle: geo.arcEnd });
  return { ...base, entities } as unknown as Sketch;
}

describe('computeFilletRadiusUpdate', () => {
  it('moves both line tangent points and the arc when the radius shrinks', () => {
    const sketch = filletedSketch();
    const arc = sketch.entities.find((e) => e.type === 'arc')!;

    const upd = computeFilletRadiusUpdate(sketch, arc, 3);
    expect(upd).not.toBeNull();
    expect(upd!.radius).toBe(3);

    // For a 90° corner at (119,201) the new centre insets by 3 → (116,204).
    expect(upd!.center.y).toBeCloseTo(116, 4);
    expect(upd!.center.z).toBeCloseTo(204, 4);

    // Both adjoining lines must be identified and their tangent points moved
    // inward to 3 units from the corner.
    const ids = [upd!.line0Id, upd!.line1Id].sort();
    expect(ids).toEqual(['bottom', 'right']);

    // Tangent points are 3 units from the corner along each edge.
    const distFromCorner = (v: THREE.Vector3) => Math.hypot(v.y - 119, v.z - 201);
    expect(distFromCorner(upd!.tangent0)).toBeCloseTo(3, 4);
    expect(distFromCorner(upd!.tangent1)).toBeCloseTo(3, 4);
  });

  it('keeps the arc tangent: line tangent points lie on the new arc (radius from centre)', () => {
    const sketch = filletedSketch();
    const arc = sketch.entities.find((e) => e.type === 'arc')!;
    const upd = computeFilletRadiusUpdate(sketch, arc, 2.5)!;
    const distToCentre = (v: THREE.Vector3) => Math.hypot(v.y - upd.center.y, v.z - upd.center.z);
    expect(distToCentre(upd.tangent0)).toBeCloseTo(2.5, 4);
    expect(distToCentre(upd.tangent1)).toBeCloseTo(2.5, 4);
  });
});
