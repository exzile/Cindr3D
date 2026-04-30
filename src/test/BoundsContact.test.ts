import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { boxesHaveJoinableContact, boxesShareFaceContact } from '../utils/geometry/boundsContact';

const box = (min: [number, number, number], max: [number, number, number]) =>
  new THREE.Box3(new THREE.Vector3(...min), new THREE.Vector3(...max));

describe('boxesHaveJoinableContact', () => {
  it('accepts volume overlap', () => {
    expect(boxesHaveJoinableContact(
      box([0, 0, 0], [10, 10, 10]),
      box([5, 0, 0], [15, 10, 10]),
    )).toBe(true);
  });

  it('accepts face contact with positive shared area', () => {
    const a = box([0, 0, 0], [10, 10, 10]);
    const b = box([10, 2, 2], [20, 8, 8]);

    expect(boxesHaveJoinableContact(a, b)).toBe(true);
    expect(boxesShareFaceContact(a, b)).toBe(true);
  });

  it('rejects edge-only contact', () => {
    expect(boxesHaveJoinableContact(
      box([0, 0, 0], [10, 10, 10]),
      box([10, 10, 2], [20, 20, 8]),
    )).toBe(false);
  });

  it('rejects separated boxes', () => {
    expect(boxesHaveJoinableContact(
      box([0, 0, 0], [10, 10, 10]),
      box([11, 0, 0], [20, 10, 10]),
    )).toBe(false);
  });
});
