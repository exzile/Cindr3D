import * as THREE from 'three';

export function tagShared<T extends THREE.Material | THREE.BufferGeometry>(obj: T): T {
  (obj as { _sharedResource?: boolean })._sharedResource = true;
  if (obj instanceof THREE.Material) {
    obj.userData.shared = true;
  }
  return obj;
}

export const SKETCH_MATERIAL = tagShared(new THREE.LineBasicMaterial({ color: 0x00aaff, linewidth: 2 }));

export const CONSTRUCTION_MATERIAL = tagShared(new THREE.LineDashedMaterial({
  color: 0xff8800, linewidth: 1, dashSize: 0.3, gapSize: 0.18,
}));

export const CENTERLINE_MATERIAL = tagShared(new THREE.LineDashedMaterial({
  color: 0x00aa55, linewidth: 1, dashSize: 0.7, gapSize: 0.2,
}));

export const ISOPARAMETRIC_MATERIAL = tagShared(new THREE.LineDashedMaterial({
  color: 0xcc44ff, linewidth: 1, dashSize: 0.5, gapSize: 0.25,
}));

export const EXTRUDE_MATERIAL = tagShared(new THREE.MeshPhysicalMaterial({
  color: 0x8899aa,
  metalness: 0.3,
  roughness: 0.4,
  side: THREE.DoubleSide,
}));
