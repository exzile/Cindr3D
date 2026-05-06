import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { PlateObject } from '../../types/slicer';
import { unzipSync } from 'fflate';
import { createPlateSnapshot, exportPlateThreeMf, readPlateSnapshotFromThreeMf } from './plateThreeMf';

function plateObject(id: string, x: number): PlateObject {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    0, 0, 0,
    10, 0, 0,
    0, 10, 0,
  ], 3));
  geometry.setIndex([0, 1, 2]);
  geometry.computeBoundingBox();

  return {
    id,
    name: `Part ${id}`,
    geometry,
    position: { x, y: 2, z: 0 },
    rotation: { x: 0, y: 0, z: 15 },
    scale: { x: 1, y: 1, z: 1 },
    boundingBox: { min: { x: 0, y: 0, z: 0 }, max: { x: 10, y: 10, z: 0 } },
  };
}

describe('plate 3MF round-trip', () => {
  it('preserves multiple plate objects and transforms in the manifest', async () => {
    const snapshot = createPlateSnapshot({
      activePrinterProfileId: 'printer',
      activeMaterialProfileId: 'material',
      activePrintProfileId: 'print',
      plateObjects: [plateObject('a', 0), plateObject('b', 25)],
    });

    const blob = exportPlateThreeMf(snapshot);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(Array.from(bytes.slice(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
    const entries = unzipSync(bytes);
    expect(Object.keys(entries)).toContain('Metadata/cindr3d-plate.json');
    const restored = readPlateSnapshotFromThreeMf(bytes);

    expect(restored?.plate).toHaveLength(2);
    expect(restored?.plate[0].name).toBe('Part a');
    expect(restored?.plate[1].position.x).toBe(25);
    expect(restored?.plate[1].geometry?.positions).toHaveLength(9);
  });
});
