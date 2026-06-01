import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { findFilletCorner, computeFilletGeometry } from '../components/viewport/interaction/sketchInteraction/cornerFilletGeometry';
import type { Sketch, SketchEntity } from '../types/cad';

function pt(x: number, y: number, z: number) {
  return { id: crypto.randomUUID(), x, y, z };
}

function line(a: [number, number, number], b: [number, number, number]): SketchEntity {
  return { id: crypto.randomUUID(), type: 'line', points: [pt(...a), pt(...b)] };
}

function mkSketch(entities: SketchEntity[]): Sketch {
  return {
    id: 's', name: 'S', plane: 'XY',
    entities, constraints: [], dimensions: [],
  } as unknown as Sketch;
}

// YZ-plane square (x=0), y∈[91,119], z∈[201,229] — matches the user's real sketch.
function yzSquare() {
  const square = [
    line([0, 119, 229], [0, 91, 229]),
    line([0, 91, 229], [0, 91, 201]),
    line([0, 91, 201], [0, 119, 201]),
    line([0, 119, 201], [0, 119, 229]),
  ];
  return { ...mkSketch(square), plane: 'YZ' } as unknown as Sketch;
}

describe('cornerFilletGeometry', () => {
  it('insets the fillet centre by r on each edge (NOT r/2)', () => {
    const sketch = yzSquare();
    const corner = findFilletCorner(sketch, new THREE.Vector3(0, 119, 201), 4)!;
    expect(corner).not.toBeNull();
    const geo = computeFilletGeometry(sketch, corner, 2)!;
    // Inset 2 from (119,201) toward interior → (117,203). Stale data had (118,202).
    expect(geo.center.y).toBeCloseTo(117, 5);
    expect(geo.center.z).toBeCloseTo(203, 5);
    // Tangent points land 2 units down each edge.
    expect(geo.tangent0.y).toBeCloseTo(117, 5);
    expect(geo.tangent0.z).toBeCloseTo(201, 5);
    expect(geo.tangent1.y).toBeCloseTo(119, 5);
    expect(geo.tangent1.z).toBeCloseTo(203, 5);
  });

  it('produces a 90° (≤180°) arc span, not the reflex arc', () => {
    const sketch = yzSquare();
    const corner = findFilletCorner(sketch, new THREE.Vector3(0, 119, 201), 4)!;
    const geo = computeFilletGeometry(sketch, corner, 2)!;
    let span = ((geo.arcEnd - geo.arcStart) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
    if (span > Math.PI) span = 2 * Math.PI - span;
    expect(span).toBeCloseTo(Math.PI / 2, 4);
  });

  it('returns null near a corner that is not a real two-line junction', () => {
    const sketch = mkSketch([line([0, 0, 0], [0, 10, 0])]); // single line, no corner
    expect(findFilletCorner(sketch, new THREE.Vector3(0, 0, 0), 4)).toBeNull();
  });
});
