import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { analyzeMeshGeometry, autoRepairMeshGeometry, weldMeshVertices } from '../meshRepair';

describe('mesh repair', () => {
  it('reports duplicate vertices and boundary edges', () => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
      0, 0, 0,
      1, 0, 0,
      0, 1, 0,
      0, 0, 0,
      0, 1, 0,
      1, 0, 0,
    ], 3));

    const report = analyzeMeshGeometry(geometry);

    expect(report.duplicateVertices).toBeGreaterThan(0);
    expect(report.boundaryEdges).toBeGreaterThan(0);
  });

  it('welds duplicate positions and recomputes normals', () => {
    const geometry = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
    const welded = weldMeshVertices(geometry);
    const repaired = autoRepairMeshGeometry(geometry);

    expect(welded.getAttribute('position').count).toBeLessThan(geometry.getAttribute('position').count);
    expect(repaired.getAttribute('normal')).toBeTruthy();
  });
});
