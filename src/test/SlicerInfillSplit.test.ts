import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Slicer } from '../engine/Slicer';
import {
  DEFAULT_MATERIAL_PROFILES,
  DEFAULT_PRINTER_PROFILES,
  DEFAULT_PRINT_PROFILES,
} from '../types/slicer';

describe('Slicer split infill regions', () => {
  it('maps each polygon to its own contour and holes', () => {
    const printer = DEFAULT_PRINTER_PROFILES[0];
    const material = DEFAULT_MATERIAL_PROFILES[0];
    const print = DEFAULT_PRINT_PROFILES[0];
    const slicer = new Slicer(printer, material, print) as unknown as {
      contourToClosedPCRing: (contour: THREE.Vector2[]) => [number, number][];
      multiPolygonToRegions: (mp: Array<Array<Array<[number, number]>>>) => Array<{
        contour: THREE.Vector2[];
        holes: THREE.Vector2[][];
      }>;
    };

    const left = [
      new THREE.Vector2(0, 0),
      new THREE.Vector2(4, 0),
      new THREE.Vector2(4, 10),
      new THREE.Vector2(0, 10),
    ];
    const right = [
      new THREE.Vector2(4, 0),
      new THREE.Vector2(10, 0),
      new THREE.Vector2(10, 10),
      new THREE.Vector2(4, 10),
    ];
    const rightHole = [
      new THREE.Vector2(6, 4),
      new THREE.Vector2(8, 4),
      new THREE.Vector2(8, 6),
      new THREE.Vector2(6, 6),
    ];

    const regions = slicer.multiPolygonToRegions([
      [slicer.contourToClosedPCRing(left)],
      [
        slicer.contourToClosedPCRing(right),
        slicer.contourToClosedPCRing(rightHole),
      ],
    ]);

    expect(regions).toHaveLength(2);
    expect(regions[0].holes).toHaveLength(0);
    expect(regions[1].holes).toHaveLength(1);
    expect(regions[1].holes[0][0].x).toBe(6);
    expect(regions[1].holes[0][0].y).toBe(4);
  });
});
