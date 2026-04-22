import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Slicer } from '../engine/Slicer';
import {
  DEFAULT_MATERIAL_PROFILES,
  DEFAULT_PRINTER_PROFILES,
  DEFAULT_PRINT_PROFILES,
} from '../types/slicer';

function signedArea(points: THREE.Vector2[]): number {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    area += points[i].x * points[j].y;
    area -= points[j].x * points[i].y;
  }
  return area / 2;
}

describe('Slicer.classifyContours', () => {
  it('classifies by containment depth and normalizes winding', () => {
    const printer = DEFAULT_PRINTER_PROFILES[0];
    const material = DEFAULT_MATERIAL_PROFILES[0];
    const print = DEFAULT_PRINT_PROFILES[0];
    const slicer = new Slicer(printer, material, print) as unknown as {
      classifyContours: (rawContours: THREE.Vector2[][]) => Array<{
        points: THREE.Vector2[];
        isOuter: boolean;
        area: number;
      }>;
    };

    // Outer loop intentionally wound CW (wrong for an outer), inner loop
    // intentionally wound CCW (wrong for a hole). The regression is that
    // winding-only classification treats these backwards and can drop layers.
    const outerCW = [
      new THREE.Vector2(0, 0),
      new THREE.Vector2(0, 10),
      new THREE.Vector2(10, 10),
      new THREE.Vector2(10, 0),
    ];
    const holeCCW = [
      new THREE.Vector2(3, 3),
      new THREE.Vector2(7, 3),
      new THREE.Vector2(7, 7),
      new THREE.Vector2(3, 7),
    ];

    const contours = slicer.classifyContours([outerCW, holeCCW]);
    expect(contours).toHaveLength(2);

    const outer = contours.find((c) => c.isOuter);
    const hole = contours.find((c) => !c.isOuter);

    expect(outer).toBeTruthy();
    expect(hole).toBeTruthy();
    expect(signedArea(outer!.points)).toBeGreaterThan(0);
    expect(signedArea(hole!.points)).toBeLessThan(0);
  });
});
