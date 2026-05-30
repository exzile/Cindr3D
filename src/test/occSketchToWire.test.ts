import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  normalizeClosedLoop2D,
  orientLoop2D,
  signedArea2D,
} from '../engine/occ/ops/sketchToWire';

describe('OCC sketch-to-wire loop helpers', () => {
  it('computes positive signed area for counter-clockwise loops', () => {
    const loop = [
      new THREE.Vector2(0, 0),
      new THREE.Vector2(10, 0),
      new THREE.Vector2(10, 5),
      new THREE.Vector2(0, 5),
    ];

    expect(signedArea2D(loop)).toBe(50);
    expect(signedArea2D([...loop].reverse())).toBe(-50);
  });

  it('normalizes explicit closing vertices and consecutive duplicate points', () => {
    const normalized = normalizeClosedLoop2D([
      new THREE.Vector2(0, 0),
      new THREE.Vector2(10, 0),
      new THREE.Vector2(10, 0),
      new THREE.Vector2(10, 5),
      new THREE.Vector2(0, 5),
      new THREE.Vector2(0, 0),
    ]);

    expect(normalized?.map((point) => point.toArray())).toEqual([
      [0, 0],
      [10, 0],
      [10, 5],
      [0, 5],
    ]);
  });

  it('rejects loops that cannot form a face region', () => {
    expect(normalizeClosedLoop2D([
      new THREE.Vector2(0, 0),
      new THREE.Vector2(10, 0),
    ])).toBeNull();

    expect(normalizeClosedLoop2D([
      new THREE.Vector2(0, 0),
      new THREE.Vector2(5, 0),
      new THREE.Vector2(10, 0),
    ])).toBeNull();
  });

  it('orients hole loops opposite the outer loop', () => {
    const outer = normalizeClosedLoop2D([
      new THREE.Vector2(0, 0),
      new THREE.Vector2(10, 0),
      new THREE.Vector2(10, 10),
      new THREE.Vector2(0, 10),
    ]);
    const hole = normalizeClosedLoop2D([
      new THREE.Vector2(2, 2),
      new THREE.Vector2(4, 2),
      new THREE.Vector2(4, 4),
      new THREE.Vector2(2, 4),
    ]);

    expect(outer).not.toBeNull();
    expect(hole).not.toBeNull();

    const outerClockwise = signedArea2D(outer!) < 0;
    const orientedHole = orientLoop2D(hole!, !outerClockwise);

    expect(Math.sign(signedArea2D(orientedHole))).toBe(-Math.sign(signedArea2D(outer!)));
  });
});
