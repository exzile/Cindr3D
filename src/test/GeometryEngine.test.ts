import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { GeometryEngine } from '../engine/GeometryEngine';

describe('GeometryEngine.getPlaneAxes', () => {
  it('returns orthogonal X and Z vectors for XY plane', () => {
    const { t1, t2 } = GeometryEngine.getPlaneAxes('XY');
    expect(t1.x).toBe(1);
    expect(t1.y).toBe(0);
    expect(t1.z).toBe(0);
    expect(t2.x).toBe(0);
    expect(t2.y).toBe(0);
    expect(t2.z).toBe(1);
  });

  it('returns orthogonal vectors for YZ plane', () => {
    const { t1, t2 } = GeometryEngine.getPlaneAxes('YZ');
    expect(t1.y).toBe(1);
    expect(t2.z).toBe(1);
  });

  it('returns orthogonal vectors for XZ plane', () => {
    const { t1, t2 } = GeometryEngine.getPlaneAxes('XZ');
    expect(t1.x).toBe(1);
    expect(t2.y).toBe(1);
  });
});

describe('GeometryEngine.computePlaneAxesFromNormal', () => {
  it('produces orthonormal t1, t2 for a Z-axis normal', () => {
    const n = new THREE.Vector3(0, 0, 1);
    const { t1, t2 } = GeometryEngine.computePlaneAxesFromNormal(n);
    // t1 and t2 should be unit vectors
    expect(t1.length()).toBeCloseTo(1, 5);
    expect(t2.length()).toBeCloseTo(1, 5);
    // t1 and t2 should be perpendicular to normal
    expect(t1.dot(n)).toBeCloseTo(0, 5);
    expect(t2.dot(n)).toBeCloseTo(0, 5);
    // t1 and t2 should be perpendicular to each other
    expect(t1.dot(t2)).toBeCloseTo(0, 5);
  });

  it('produces orthonormal vectors for an X-axis normal', () => {
    const n = new THREE.Vector3(1, 0, 0);
    const { t1, t2 } = GeometryEngine.computePlaneAxesFromNormal(n);
    expect(t1.length()).toBeCloseTo(1, 5);
    expect(t2.length()).toBeCloseTo(1, 5);
    expect(t1.dot(n)).toBeCloseTo(0, 5);
    expect(t2.dot(n)).toBeCloseTo(0, 5);
    expect(t1.dot(t2)).toBeCloseTo(0, 5);
  });

  it('handles diagonal normals without degeneracy', () => {
    const n = new THREE.Vector3(1, 1, 0).normalize();
    const { t1, t2 } = GeometryEngine.computePlaneAxesFromNormal(n);
    expect(t1.length()).toBeCloseTo(1, 5);
    expect(t2.length()).toBeCloseTo(1, 5);
    expect(t1.dot(n)).toBeCloseTo(0, 5);
    expect(t2.dot(n)).toBeCloseTo(0, 5);
  });

  it('handles near-degenerate Y-axis normal', () => {
    // When normal is close to Y, the code picks world X as temp up
    const n = new THREE.Vector3(0, 1, 0);
    const { t1, t2 } = GeometryEngine.computePlaneAxesFromNormal(n);
    expect(t1.length()).toBeCloseTo(1, 5);
    expect(t2.length()).toBeCloseTo(1, 5);
    expect(t1.dot(n)).toBeCloseTo(0, 5);
    expect(t2.dot(n)).toBeCloseTo(0, 5);
  });
});

describe('GeometryEngine.getPlaneRotation', () => {
  it('returns no rotation for XY plane', () => {
    const rot = GeometryEngine.getPlaneRotation('XY');
    expect(rot).toEqual([0, 0, 0]);
  });

  it('returns -90 degrees around X for XZ plane', () => {
    const rot = GeometryEngine.getPlaneRotation('XZ');
    expect(rot[0]).toBeCloseTo(-Math.PI / 2, 10);
    expect(rot[1]).toBe(0);
    expect(rot[2]).toBe(0);
  });

  it('returns 90 degrees around Y for YZ plane', () => {
    const rot = GeometryEngine.getPlaneRotation('YZ');
    expect(rot[0]).toBe(0);
    expect(rot[1]).toBeCloseTo(Math.PI / 2, 10);
    expect(rot[2]).toBe(0);
  });
});
