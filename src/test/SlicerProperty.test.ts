import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import { Slicer } from '../engine/slicer/Slicer';
import {
  DEFAULT_MATERIAL_PROFILES,
  DEFAULT_PRINTER_PROFILES,
  DEFAULT_PRINT_PROFILES,
} from '../types/slicer';

/**
 * Property-based slicer tests: invariants that should hold across a
 * randomized fuzz space of inputs. We use a deterministic seed so
 * failures are reproducible.
 */

class RNG {
  private state: number;
  constructor(seed: number) { this.state = seed >>> 0; }
  next(): number {
    // xorshift32
    let x = this.state;
    x ^= x << 13; x >>>= 0;
    x ^= x >> 17;
    x ^= x << 5; x >>>= 0;
    this.state = x;
    return (x & 0x7fffffff) / 0x7fffffff;
  }
  float(min: number, max: number): number { return min + this.next() * (max - min); }
  int(min: number, max: number): number { return Math.floor(this.float(min, max + 1)); }
}

interface RandomBox { geom: THREE.BufferGeometry; sx: number; sy: number; sz: number }

function buildRandomBox(rng: RNG): RandomBox {
  const sx = rng.float(5, 30);
  const sy = rng.float(5, 30);
  const sz = rng.float(1, 4);
  const hx = sx / 2, hy = sy / 2;
  const positions: number[] = [];
  const v = (x: number, y: number, z: number) => [x, y, z];
  const push = (a: number[], b: number[], c: number[]) => positions.push(...a, ...b, ...c);
  const p000 = v(-hx, -hy, 0), p100 = v(hx, -hy, 0), p110 = v(hx, hy, 0), p010 = v(-hx, hy, 0);
  const p001 = v(-hx, -hy, sz), p101 = v(hx, -hy, sz), p111 = v(hx, hy, sz), p011 = v(-hx, hy, sz);
  push(p000, p110, p100); push(p000, p010, p110);
  push(p001, p101, p111); push(p001, p111, p011);
  push(p000, p100, p101); push(p000, p101, p001);
  push(p010, p011, p111); push(p010, p111, p110);
  push(p000, p001, p011); push(p000, p011, p010);
  push(p100, p110, p111); push(p100, p111, p101);
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.computeVertexNormals();
  return { geom, sx, sy, sz };
}

function makeSlicer(overrides: Record<string, unknown> = {}) {
  const printer = {
    ...DEFAULT_PRINTER_PROFILES.find((p) => p.id === 'marlin-generic')!,
    buildVolume: { x: 200, y: 200, z: 200 },
  };
  const material = DEFAULT_MATERIAL_PROFILES[0];
  const print = {
    ...DEFAULT_PRINT_PROFILES[0],
    adhesionType: 'none' as const,
    parallelLayerPreparation: false,
    wallGenerator: 'classic' as const,
    wallCount: 1,
    wallLineWidth: 0.4,
    layerHeight: 0.2,
    horizontalExpansion: 0,
    initialLayerHorizontalExpansion: 0,
    elephantFootCompensation: 0,
    ...overrides,
  };
  return new Slicer(printer, material, print);
}

describe('Slicer — property invariants over random box geometries', () => {
  it('layer count is approximately ceil(modelHeight / layerHeight) for any size', async () => {
    const rng = new RNG(0xc0ffee);
    for (let trial = 0; trial < 5; trial++) {
      const { geom, sz } = buildRandomBox(rng);
      const lh = 0.2;
      const result = await makeSlicer({ layerHeight: lh }).slice([{
        geometry: geom,
        transform: new THREE.Matrix4(),
      }]);
      const expected = Math.ceil(sz / lh);
      expect(result.layerCount).toBeGreaterThanOrEqual(expected - 2);
      expect(result.layerCount).toBeLessThanOrEqual(expected + 2);
    }
  }, 120_000);

  it('every layer has at least one wall move (no empty layers in solid box)', async () => {
    const rng = new RNG(0x12345);
    for (let trial = 0; trial < 5; trial++) {
      const { geom } = buildRandomBox(rng);
      const result = await makeSlicer().slice([{
        geometry: geom,
        transform: new THREE.Matrix4(),
      }]);
      for (const layer of result.layers) {
        const walls = layer.moves.filter((m) =>
          m.type === 'wall-outer' || m.type === 'wall-inner',
        );
        expect(walls.length).toBeGreaterThan(0);
      }
    }
  }, 120_000);

  it('all move endpoints have finite coordinates', async () => {
    const rng = new RNG(0xdeadbeef);
    for (let trial = 0; trial < 5; trial++) {
      const { geom } = buildRandomBox(rng);
      const result = await makeSlicer().slice([{
        geometry: geom,
        transform: new THREE.Matrix4(),
      }]);
      for (const layer of result.layers) {
        for (const move of layer.moves) {
          expect(Number.isFinite(move.from.x)).toBe(true);
          expect(Number.isFinite(move.from.y)).toBe(true);
          expect(Number.isFinite(move.to.x)).toBe(true);
          expect(Number.isFinite(move.to.y)).toBe(true);
          expect(Number.isFinite(move.speed)).toBe(true);
          expect(Number.isFinite(move.lineWidth)).toBe(true);
        }
      }
    }
  }, 120_000);

  it('printTime estimate is positive and grows with model height', async () => {
    let prevTime = 0;
    for (const sz of [1, 2, 4]) {
      const result = await makeSlicer().slice([{
        geometry: (() => {
          const g = new THREE.BufferGeometry();
          const positions: number[] = [];
          const hx = 5, hy = 5;
          const v = (x: number, y: number, z: number) => [x, y, z];
          const push = (a: number[], b: number[], c: number[]) => positions.push(...a, ...b, ...c);
          const p000 = v(-hx, -hy, 0), p100 = v(hx, -hy, 0), p110 = v(hx, hy, 0), p010 = v(-hx, hy, 0);
          const p001 = v(-hx, -hy, sz), p101 = v(hx, -hy, sz), p111 = v(hx, hy, sz), p011 = v(-hx, hy, sz);
          push(p000, p110, p100); push(p000, p010, p110);
          push(p001, p101, p111); push(p001, p111, p011);
          push(p000, p100, p101); push(p000, p101, p001);
          push(p010, p011, p111); push(p010, p111, p110);
          push(p000, p001, p011); push(p000, p011, p010);
          push(p100, p110, p111); push(p100, p111, p101);
          g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
          g.computeVertexNormals();
          return g;
        })(),
        transform: new THREE.Matrix4(),
      }]);
      const time = result.printTime;
      expect(time).toBeGreaterThan(0);
      expect(time).toBeGreaterThan(prevTime);
      prevTime = time;
    }
  }, 180_000);

  it('all layer Z values are within [0, modelHeight + layerHeight]', async () => {
    const rng = new RNG(0xabc);
    for (let trial = 0; trial < 3; trial++) {
      const { geom, sz } = buildRandomBox(rng);
      const result = await makeSlicer().slice([{
        geometry: geom,
        transform: new THREE.Matrix4(),
      }]);
      for (const layer of result.layers) {
        expect(layer.z).toBeGreaterThan(0);
        expect(layer.z).toBeLessThanOrEqual(sz + 0.5);
      }
    }
  }, 120_000);

  it('extrusion accounting is consistent: totalExtruded > 0 and all per-move extrusions ≥ 0', async () => {
    const rng = new RNG(0xfeed);
    for (let trial = 0; trial < 3; trial++) {
      const { geom } = buildRandomBox(rng);
      const result = await makeSlicer().slice([{
        geometry: geom,
        transform: new THREE.Matrix4(),
      }]);
      let total = 0;
      for (const layer of result.layers) {
        for (const move of layer.moves) {
          if (move.type === 'travel') continue;
          expect(move.extrusion).toBeGreaterThanOrEqual(0);
          total += move.extrusion;
        }
      }
      expect(total).toBeGreaterThan(0);
    }
  }, 120_000);

  it('determinism: same seed → same slice output', async () => {
    const buildBox = (sx: number, sy: number, sz: number) => {
      const hx = sx / 2, hy = sy / 2;
      const positions: number[] = [];
      const v = (x: number, y: number, z: number) => [x, y, z];
      const push = (a: number[], b: number[], c: number[]) => positions.push(...a, ...b, ...c);
      const p000 = v(-hx, -hy, 0), p100 = v(hx, -hy, 0), p110 = v(hx, hy, 0), p010 = v(-hx, hy, 0);
      const p001 = v(-hx, -hy, sz), p101 = v(hx, -hy, sz), p111 = v(hx, hy, sz), p011 = v(-hx, hy, sz);
      push(p000, p110, p100); push(p000, p010, p110);
      push(p001, p101, p111); push(p001, p111, p011);
      push(p000, p100, p101); push(p000, p101, p001);
      push(p010, p011, p111); push(p010, p111, p110);
      push(p000, p001, p011); push(p000, p011, p010);
      push(p100, p110, p111); push(p100, p111, p101);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      g.computeVertexNormals();
      return g;
    };
    const r1 = await makeSlicer().slice([{ geometry: buildBox(12, 12, 2), transform: new THREE.Matrix4() }]);
    const r2 = await makeSlicer().slice([{ geometry: buildBox(12, 12, 2), transform: new THREE.Matrix4() }]);
    expect(r1.gcode).toBe(r2.gcode);
    expect(r1.layerCount).toBe(r2.layerCount);
    expect(r1.printTime).toBeCloseTo(r2.printTime, 4);
  }, 120_000);
});
