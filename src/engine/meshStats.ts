import * as THREE from 'three';

export interface MeshStats {
  triangleCount: number;
  volumeMm3: number;
  surfaceAreaMm2: number;
}

/**
 * Compute volume + surface area of a triangle mesh using signed tetrahedral
 * volumes from the origin. Robust on closed meshes; on open meshes the
 * absolute value is still a useful rough estimate.
 */
export function computeMeshStats(geo: THREE.BufferGeometry): MeshStats {
  const pos = geo.getAttribute('position');
  const idx = geo.getIndex();
  if (!pos) return { triangleCount: 0, volumeMm3: 0, surfaceAreaMm2: 0 };

  const v0 = new THREE.Vector3();
  const v1 = new THREE.Vector3();
  const v2 = new THREE.Vector3();
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  const cross = new THREE.Vector3();
  const volumeCross = new THREE.Vector3();

  let volume = 0;
  let area = 0;
  const triCount = idx ? idx.count / 3 : pos.count / 3;

  for (let t = 0; t < triCount; t++) {
    const i0 = idx ? idx.getX(t * 3) : t * 3;
    const i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
    const i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
    v0.set(pos.getX(i0), pos.getY(i0), pos.getZ(i0));
    v1.set(pos.getX(i1), pos.getY(i1), pos.getZ(i1));
    v2.set(pos.getX(i2), pos.getY(i2), pos.getZ(i2));
    e1.subVectors(v1, v0);
    e2.subVectors(v2, v0);
    cross.crossVectors(e1, e2);
    area += cross.length() * 0.5;
    volume += v0.dot(volumeCross.crossVectors(v1, v2)) / 6;
  }

  return {
    triangleCount: triCount | 0,
    volumeMm3: Math.abs(volume),
    surfaceAreaMm2: area,
  };
}
