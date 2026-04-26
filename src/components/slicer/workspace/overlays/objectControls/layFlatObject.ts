import * as THREE from 'three';
import type { PlateObject } from '../../../../../types/slicer';
import type { ObjectUpdate } from './types';

export function layFlatObject({
  obj,
  locked,
  rotation,
  scale,
  position,
  onUpdate,
}: {
  obj: PlateObject;
  locked: boolean;
  rotation: { x: number; y: number; z: number };
  scale: { x: number; y: number; z: number };
  position: { x: number; y: number; z: number };
  onUpdate: ObjectUpdate;
}) {
  if (locked) return;
  const geom: THREE.BufferGeometry | null = obj.geometry ?? null;

  if (!geom?.attributes?.position) {
    onUpdate({ rotation: { x: 0, y: 0, z: 0 } });
    return;
  }

  const posAttr = geom.attributes.position;
  const indexAttr = geom.index;
  const triCount = indexAttr ? indexAttr.count / 3 : posAttr.count / 3;

  const currentQuat = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(rotation.x, rotation.y, rotation.z, 'XYZ'),
  );

  const va = new THREE.Vector3();
  const vb = new THREE.Vector3();
  const vc = new THREE.Vector3();
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  const cross = new THREE.Vector3();
  const down = new THREE.Vector3(0, 0, -1);

  const buckets = new Map<string, { worldNormal: THREE.Vector3; area: number }>();

  for (let i = 0; i < triCount; i++) {
    const i0 = indexAttr ? indexAttr.getX(i * 3) : i * 3;
    const i1 = indexAttr ? indexAttr.getX(i * 3 + 1) : i * 3 + 1;
    const i2 = indexAttr ? indexAttr.getX(i * 3 + 2) : i * 3 + 2;

    va.fromBufferAttribute(posAttr, i0);
    vb.fromBufferAttribute(posAttr, i1);
    vc.fromBufferAttribute(posAttr, i2);

    e1.subVectors(vb, va);
    e2.subVectors(vc, va);
    cross.crossVectors(e1, e2);

    const area = cross.length() / 2;
    if (area < 1e-6) continue;

    const worldNorm = cross.clone().normalize().applyQuaternion(currentQuat);
    const key = `${worldNorm.x.toFixed(2)},${worldNorm.y.toFixed(2)},${worldNorm.z.toFixed(2)}`;
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.area += area;
    } else {
      buckets.set(key, { worldNormal: worldNorm, area });
    }
  }

  let bestWorldNormal = new THREE.Vector3(0, 0, -1);
  let bestScore = -Infinity;
  for (const { worldNormal, area } of buckets.values()) {
    const dotDown = worldNormal.dot(down);
    const score = dotDown * area;
    if (score > bestScore) {
      bestScore = score;
      bestWorldNormal = worldNormal.clone();
    }
  }

  const correctionQuat = new THREE.Quaternion().setFromUnitVectors(bestWorldNormal, down);
  const finalQuat = new THREE.Quaternion().multiplyQuaternions(correctionQuat, currentQuat);
  const finalEuler = new THREE.Euler().setFromQuaternion(finalQuat, 'XYZ');

  const tmpBox = new THREE.Box3().setFromBufferAttribute(posAttr as THREE.BufferAttribute);
  const rotMat = new THREE.Matrix4().makeRotationFromQuaternion(finalQuat);
  const cornerOffsets: [number, number, number][] = [
    [tmpBox.min.x, tmpBox.min.y, tmpBox.min.z], [tmpBox.max.x, tmpBox.min.y, tmpBox.min.z],
    [tmpBox.min.x, tmpBox.max.y, tmpBox.min.z], [tmpBox.max.x, tmpBox.max.y, tmpBox.min.z],
    [tmpBox.min.x, tmpBox.min.y, tmpBox.max.z], [tmpBox.max.x, tmpBox.min.y, tmpBox.max.z],
    [tmpBox.min.x, tmpBox.max.y, tmpBox.max.z], [tmpBox.max.x, tmpBox.max.y, tmpBox.max.z],
  ];
  let newMinZ = Infinity;
  for (const [cx, cy, cz] of cornerOffsets) {
    const scaled = new THREE.Vector3(cx * scale.x, cy * scale.y, cz * scale.z);
    scaled.applyMatrix4(rotMat);
    if (scaled.z < newMinZ) newMinZ = scaled.z;
  }

  onUpdate({
    rotation: { x: finalEuler.x, y: finalEuler.y, z: finalEuler.z },
    position: { ...position, z: isFinite(newMinZ) ? -newMinZ : position.z },
  });
}
