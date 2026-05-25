import * as THREE from 'three';
import type { BRepBody } from './brepBody';
import { globalBRepBodyRegistry } from './globalRegistry';
import { attachTessellationToMesh } from './picking';
import { tessellateWithInstance, tessellationToGeometry } from './tessellate';
import type { OcctRaw } from './types';

export function createRegisteredOccMesh(
  oc: OcctRaw,
  body: BRepBody,
  material: THREE.Material | THREE.Material[],
  featureId: string,
): THREE.Mesh {
  let geometry: THREE.BufferGeometry | null = null;
  let mesh: THREE.Mesh | null = null;
  let registered = false;

  try {
    const tess = tessellateWithInstance(oc, body);
    geometry = tessellationToGeometry(tess);
    mesh = new THREE.Mesh(geometry, material);
    attachTessellationToMesh(mesh, tess, body.id);
    mesh.userData.pickable = true;
    mesh.userData.featureId = featureId;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    globalBRepBodyRegistry.add(body);
    registered = true;
    return mesh;
  } catch (error) {
    if (mesh) mesh.geometry.dispose();
    else geometry?.dispose();
    if (!registered) body.dispose();
    throw error;
  }
}
