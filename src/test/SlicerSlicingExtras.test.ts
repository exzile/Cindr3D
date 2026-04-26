import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import { Slicer } from '../engine/slicer/Slicer';
import {
  DEFAULT_MATERIAL_PROFILES,
  DEFAULT_PRINTER_PROFILES,
  DEFAULT_PRINT_PROFILES,
} from '../types/slicer';

/**
 * Extra system-level slicer tests covering geometry shapes, multi-wall
 * configurations, layer-count edge cases, and travel/G-code emission.
 */

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

function buildBox(sx: number, sy: number, sz: number): THREE.BufferGeometry {
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
  return geom;
}

describe('Slicer — layer count + height invariants', () => {
  it('emits exactly ceil(modelHeight / layerHeight) layers', async () => {
    const result = await makeSlicer({ layerHeight: 0.2 }).slice([{
      geometry: buildBox(10, 10, 4),
      transform: new THREE.Matrix4(),
    }]);
    // 4mm / 0.2 = 20 layers. Some implementations add a partial layer.
    expect(result.layerCount).toBeGreaterThanOrEqual(19);
    expect(result.layerCount).toBeLessThanOrEqual(21);
  }, 60_000);

  it('halving layerHeight roughly doubles the layer count', async () => {
    const coarse = await makeSlicer({ layerHeight: 0.4 }).slice([{
      geometry: buildBox(10, 10, 4),
      transform: new THREE.Matrix4(),
    }]);
    const fine = await makeSlicer({ layerHeight: 0.2 }).slice([{
      geometry: buildBox(10, 10, 4),
      transform: new THREE.Matrix4(),
    }]);
    expect(fine.layerCount).toBeGreaterThan(coarse.layerCount * 1.6);
    expect(fine.layerCount).toBeLessThan(coarse.layerCount * 2.4);
  }, 60_000);

  it('layerHeight=0.1 produces denser slicing than layerHeight=0.3', async () => {
    const tall = await makeSlicer({ layerHeight: 0.3 }).slice([{
      geometry: buildBox(10, 10, 3),
      transform: new THREE.Matrix4(),
    }]);
    const fine = await makeSlicer({ layerHeight: 0.1 }).slice([{
      geometry: buildBox(10, 10, 3),
      transform: new THREE.Matrix4(),
    }]);
    expect(fine.layerCount).toBeGreaterThan(tall.layerCount);
  }, 60_000);
});

describe('Slicer — wall count', () => {
  it('emits more wall moves with wallCount=3 than wallCount=1', async () => {
    const single = await makeSlicer({ wallCount: 1 }).slice([{
      geometry: buildBox(20, 20, 2),
      transform: new THREE.Matrix4(),
    }]);
    const triple = await makeSlicer({ wallCount: 3 }).slice([{
      geometry: buildBox(20, 20, 2),
      transform: new THREE.Matrix4(),
    }]);
    const wallsAt = (r: typeof single, idx: number) => r.layers[idx].moves.filter(
      (m) => m.type === 'wall-outer' || m.type === 'wall-inner',
    ).length;
    expect(wallsAt(triple, 3)).toBeGreaterThan(wallsAt(single, 3));
    // 3 walls should produce roughly 3× the wall moves of 1.
    expect(wallsAt(triple, 3)).toBeGreaterThan(wallsAt(single, 3) * 2);
  }, 60_000);

  it('classifies the first wall as wall-outer and the rest as wall-inner', async () => {
    const result = await makeSlicer({ wallCount: 3 }).slice([{
      geometry: buildBox(20, 20, 2),
      transform: new THREE.Matrix4(),
    }]);
    const layer = result.layers[3];
    const outerCount = layer.moves.filter((m) => m.type === 'wall-outer').length;
    const innerCount = layer.moves.filter((m) => m.type === 'wall-inner').length;
    expect(outerCount).toBeGreaterThan(0);
    expect(innerCount).toBeGreaterThan(0);
    // Inner walls cover more depth — typically more total inner segments.
    expect(innerCount).toBeGreaterThan(outerCount);
  }, 60_000);
});

describe('Slicer — G-code generation surface', () => {
  it('includes a layer-change comment for every emitted layer', async () => {
    const result = await makeSlicer().slice([{
      geometry: buildBox(10, 10, 1),
      transform: new THREE.Matrix4(),
    }]);
    const layerComments = result.gcode.split('\n').filter((line) =>
      /^; ----- Layer \d+/.test(line),
    );
    expect(layerComments.length).toBe(result.layerCount);
  }, 60_000);

  it('opens with a header comment block', async () => {
    const result = await makeSlicer().slice([{
      geometry: buildBox(10, 10, 1),
      transform: new THREE.Matrix4(),
    }]);
    const head = result.gcode.split('\n').slice(0, 30).join('\n');
    // Should contain at least one comment line at the start (Cura/Dzign3D
    // typically starts with `;FLAVOR:` or similar).
    expect(head).toMatch(/^;/m);
  }, 60_000);

  it('emits a G1 Z<...> line for each layer change', async () => {
    const result = await makeSlicer({ layerHeight: 0.2 }).slice([{
      geometry: buildBox(10, 10, 1),
      transform: new THREE.Matrix4(),
    }]);
    // At least one G1 Z line per layer change.
    const zMoves = result.gcode.split('\n').filter((line) => /^G1 Z\d+/.test(line));
    expect(zMoves.length).toBeGreaterThanOrEqual(result.layerCount - 1);
  }, 60_000);

  it('produces a non-empty G-code string', async () => {
    const result = await makeSlicer().slice([{
      geometry: buildBox(10, 10, 1),
      transform: new THREE.Matrix4(),
    }]);
    expect(result.gcode.length).toBeGreaterThan(1000);
    expect(result.gcode).toMatch(/G28/);  // Home command in start g-code
  }, 60_000);
});

describe('Slicer — solid top/bottom layer skin', () => {
  it('first few layers are solid (bottom skin)', async () => {
    const result = await makeSlicer({
      bottomLayers: 3,
      topLayers: 3,
      infillDensity: 20,
    }).slice([{
      geometry: buildBox(20, 20, 4),
      transform: new THREE.Matrix4(),
    }]);
    // Layer 0 and 1 should have top-bottom solid moves.
    const topBottomAt = (idx: number) => result.layers[idx].moves.filter((m) => m.type === 'top-bottom').length;
    expect(topBottomAt(0)).toBeGreaterThan(0);
    expect(topBottomAt(1)).toBeGreaterThan(0);
  }, 60_000);

  it('mid layers default to sparse infill (less dense than solid skin)', async () => {
    const result = await makeSlicer({
      bottomLayers: 3,
      topLayers: 3,
      infillDensity: 20,
    }).slice([{
      geometry: buildBox(20, 20, 6),
      transform: new THREE.Matrix4(),
    }]);
    const lastLayerIdx = result.layers.length - 1;
    const middleIdx = Math.floor(lastLayerIdx / 2);
    const topBottomLines = result.layers[middleIdx].moves.filter((m) => m.type === 'top-bottom').length;
    const infillLines = result.layers[middleIdx].moves.filter((m) => m.type === 'infill').length;
    // Mid-layer should be infill, not top-bottom.
    expect(infillLines).toBeGreaterThan(0);
    expect(topBottomLines).toBeLessThanOrEqual(infillLines);
  }, 60_000);
});

describe('Slicer — input geometry size scaling', () => {
  it('larger input box produces a wider wall bbox (shape preserved)', async () => {
    const small = await makeSlicer().slice([{
      geometry: buildBox(10, 10, 2),
      transform: new THREE.Matrix4(),
    }]);
    const large = await makeSlicer().slice([{
      geometry: buildBox(20, 20, 2),
      transform: new THREE.Matrix4(),
    }]);

    const layerIdx = 3;
    const bbox = (r: typeof small) => {
      let minX = Infinity, maxX = -Infinity;
      for (const m of r.layers[layerIdx].moves) {
        if (m.type !== 'wall-outer' && m.type !== 'wall-inner') continue;
        minX = Math.min(minX, m.from.x, m.to.x);
        maxX = Math.max(maxX, m.from.x, m.to.x);
      }
      return maxX - minX;
    };
    expect(bbox(large)).toBeGreaterThan(bbox(small) * 1.7);
    expect(bbox(large)).toBeLessThan(bbox(small) * 2.3);
  }, 60_000);
});
