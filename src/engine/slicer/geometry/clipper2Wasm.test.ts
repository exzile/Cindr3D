import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import { booleanPathsClipper2, loadClipper2Module, offsetPathsClipper2 } from './clipper2Wasm';
import { booleanMultiPolygonClipper2Sync } from './clipper2Boolean';
import { SlicePipelineGeometry } from '../pipeline/execution/base/SlicePipelineGeometry';

const v = (x: number, y: number) => new THREE.Vector2(x, y);

class OffsetHarness extends SlicePipelineGeometry {
  public legacy(contour: THREE.Vector2[], offset: number): THREE.Vector2[] {
    return this.offsetContour(contour, offset);
  }

  public fast(contour: THREE.Vector2[], offset: number): THREE.Vector2[] {
    return this.offsetContourFast(contour, offset);
  }
}

function bbox(points: THREE.Vector2[]) {
  return {
    minX: Math.min(...points.map((p) => p.x)),
    maxX: Math.max(...points.map((p) => p.x)),
    minY: Math.min(...points.map((p) => p.y)),
    maxY: Math.max(...points.map((p) => p.y)),
  };
}

describe('Clipper2 WASM adapter', () => {
  it('inflates a square through the WASM module', async () => {
    const result = await offsetPathsClipper2([
      [v(0, 0), v(10, 0), v(10, 10), v(0, 10)],
    ], 1, { joinType: 'miter' });

    expect(result.length).toBeGreaterThan(0);
    const xs = result.flat().map((point) => point.x);
    const ys = result.flat().map((point) => point.y);
    expect(Math.min(...xs)).toBeLessThanOrEqual(-0.99);
    expect(Math.max(...xs)).toBeGreaterThanOrEqual(10.99);
    expect(Math.min(...ys)).toBeLessThanOrEqual(-0.99);
    expect(Math.max(...ys)).toBeGreaterThanOrEqual(10.99);
  });

  it('unions two overlapping squares into one polygon', async () => {
    const a = [v(0, 0), v(10, 0), v(10, 10), v(0, 10)];
    const b = [v(5, 5), v(15, 5), v(15, 15), v(5, 15)];
    const result = await booleanPathsClipper2([a], [b], 'union');
    expect(result.length).toBe(1);
    // L-shaped union has 8 vertices (Clipper drops collinear points).
    expect(result[0].length).toBeGreaterThanOrEqual(6);
  });

  it('subtracts a hole via difference', async () => {
    const outer = [v(0, 0), v(10, 0), v(10, 10), v(0, 10)];
    const hole = [v(3, 3), v(7, 3), v(7, 7), v(3, 7)];
    const result = await booleanPathsClipper2([outer], [hole], 'difference');
    // Difference of solid - inner hole = annulus (1 outer ring + 1 hole ring).
    expect(result.length).toBe(2);
  });

  it('groups boolean path output into multipolygons with holes', async () => {
    await loadClipper2Module();
    const outer = [[
      [0, 0], [10, 0], [10, 10], [0, 10], [0, 0],
    ]] as [[number, number][]];
    const hole = [[
      [3, 3], [7, 3], [7, 7], [3, 7], [3, 3],
    ]] as [[number, number][]];

    const result = booleanMultiPolygonClipper2Sync([outer], [hole], 'difference');
    expect(result).not.toBeNull();
    expect(result?.length).toBe(1);
    expect(result?.[0].length).toBe(2);
  });

  it('xors two overlapping squares into the symmetric difference', async () => {
    const a = [v(0, 0), v(10, 0), v(10, 10), v(0, 10)];
    const b = [v(5, 5), v(15, 5), v(15, 15), v(5, 15)];
    const result = await booleanPathsClipper2([a], [b], 'xor');
    // Symmetric difference of two overlapping squares is two L-shapes —
    // Clipper2 typically returns them as one polygon with a hole or two
    // separate rings depending on topology. Either way, the area should
    // equal sum(areas) - 2 × intersection = 100 + 100 - 2 × 25 = 150.
    expect(result.length).toBeGreaterThanOrEqual(1);
    let totalSignedArea = 0;
    for (const ring of result) {
      let area = 0;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        area += ring[j].x * ring[i].y - ring[i].x * ring[j].y;
      }
      totalSignedArea += Math.abs(area) / 2;
    }
    expect(totalSignedArea).toBeCloseTo(150, 1);
  });

  it('intersects to a 5x5 overlap', async () => {
    const a = [v(0, 0), v(10, 0), v(10, 10), v(0, 10)];
    const b = [v(5, 5), v(15, 5), v(15, 15), v(5, 15)];
    const result = await booleanPathsClipper2([a], [b], 'intersection');
    expect(result.length).toBe(1);
    const xs = result[0].map((p) => p.x);
    const ys = result[0].map((p) => p.y);
    expect(Math.min(...xs)).toBeCloseTo(5, 3);
    expect(Math.max(...xs)).toBeCloseTo(10, 3);
    expect(Math.min(...ys)).toBeCloseTo(5, 3);
    expect(Math.max(...ys)).toBeCloseTo(10, 3);
  });

  it('matches legacy offset direction for pipeline contour offsets', async () => {
    const harness = new OffsetHarness();
    const square = [v(0, 0), v(10, 0), v(10, 10), v(0, 10)];
    await harness.prepareClipper2Offsets();

    for (const offset of [1, -1]) {
      const legacyBox = bbox(harness.legacy(square, offset));
      const fastBox = bbox(harness.fast(square, offset));
      expect(fastBox.minX).toBeCloseTo(legacyBox.minX, 3);
      expect(fastBox.maxX).toBeCloseTo(legacyBox.maxX, 3);
      expect(fastBox.minY).toBeCloseTo(legacyBox.minY, 3);
      expect(fastBox.maxY).toBeCloseTo(legacyBox.maxY, 3);
    }
  });
});
