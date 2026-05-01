import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { MultiPolygon as PCMultiPolygon, Ring as PCRing } from 'polygon-clipping';

import { buildLayerTopology } from './layerTopology';
import type { Contour } from '../../../../types/slicer-pipeline.types';

function ring(minX: number, minY: number, maxX: number, maxY: number): PCRing {
  return [
    [minX, minY],
    [maxX, minY],
    [maxX, maxY],
    [minX, maxY],
    [minX, minY],
  ];
}

function mp(minX: number, minY: number, maxX: number, maxY: number): PCMultiPolygon {
  return [[ring(minX, minY, maxX, maxY)]];
}

function contour(minX: number, minY: number, maxX: number, maxY: number): Contour {
  const points = [
    new THREE.Vector2(minX, minY),
    new THREE.Vector2(maxX, minY),
    new THREE.Vector2(maxX, maxY),
    new THREE.Vector2(minX, maxY),
  ];
  return { points, area: (maxX - minX) * (maxY - minY), isOuter: true };
}

function pointInRing(x: number, y: number, testRing: PCRing): boolean {
  let inside = false;
  for (let i = 0, j = testRing.length - 1; i < testRing.length; j = i++) {
    const xi = testRing[i][0];
    const yi = testRing[i][1];
    const xj = testRing[j][0];
    const yj = testRing[j][1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function multiPolygonBounds(material: PCMultiPolygon): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const polygon of material) {
    for (const testRing of polygon) {
      for (const [x, y] of testRing) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }
  return { minX, minY, maxX, maxY };
}

describe('buildLayerTopology top skin regions', () => {
  it('clips next-layer material from the current layer', () => {
    const layer = contour(0, 0, 10, 10);
    const topology = buildLayerTopology({
      contours: [layer],
      optimizeWallOrder: false,
      currentX: 0,
      currentY: 0,
      previousLayerMaterial: [],
      nextLayerMaterial: mp(0, 0, 8, 10),
      isFirstLayer: true,
      pointInContour: (point, points) => pointInRing(point.x, point.y, points.map((p) => [p.x, p.y] as [number, number])),
      pointInRing,
    });

    expect(topology.topSkinRegion.length).toBeGreaterThan(0);
    expect(topology.topSkinRegion).toHaveLength(1);
    expect(multiPolygonBounds(topology.topSkinRegion)).toEqual({ minX: 8, minY: 0, maxX: 10, maxY: 10 });
  });
});
