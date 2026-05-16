/**
 * resolveBodySource — obtain a non-indexed, world-space source geometry +
 * material for an edge-modification commit (fillet, chamfer, …).
 *
 * Shared by commitFillet and commitChamfer so the three source paths stay in
 * one place:
 *  1. Mesh-backed features (sweep, thin extrude, …): use the stored mesh.
 *  2. Primitive features (box/cyl/sphere/torus): rebuild geometry from params
 *     and apply the world transform so edge coords (world-space from the
 *     picker) match the vertices.
 *  3. Extrude (CSG-pipeline) features: geometry lives only in the R3F scene —
 *     look up the live rendered mesh from the BodyMesh registry
 *     (`liveBodyMeshes`, keyed by THREE.js mesh UUID, embedded in the edge ID).
 */
import * as THREE from 'three';
import type { Feature } from '../../../../types/cad';
import { liveBodyMeshes } from '../../../../store/meshRegistry';

export interface BodySource {
  /** Non-indexed, world-space. Caller owns it — dispose after use. */
  srcGeo: THREE.BufferGeometry;
  srcMaterial: THREE.Material | THREE.Material[];
  /** feature.mesh was a real THREE.Mesh (vs primitive/extrude). */
  hasMesh: boolean;
  /** The replaced mesh's geometry — dispose AFTER the state set() completes. */
  oldGeomToDispose: THREE.BufferGeometry | null;
}

export function resolveBodySource(
  feature: Feature,
  meshUuid: string,
): BodySource | { error: string } {
  const hasMesh = feature.mesh instanceof THREE.Mesh;

  if (hasMesh) {
    const srcMesh = feature.mesh as THREE.Mesh;
    return {
      srcGeo: srcMesh.geometry.clone().toNonIndexed(),
      srcMaterial: srcMesh.material,
      hasMesh: true,
      oldGeomToDispose: srcMesh.geometry,
    };
  }

  if (feature.type === 'primitive') {
    const p = feature.params;
    const kind = p.kind as string;
    let baseGeo: THREE.BufferGeometry | null = null;
    if (kind === 'box') {
      baseGeo = new THREE.BoxGeometry(Number(p.width) || 20, Number(p.height) || 20, Number(p.depth) || 20);
    } else if (kind === 'cylinder') {
      baseGeo = new THREE.CylinderGeometry(
        Number(p.radius) || 10, Number(p.radiusTop ?? p.radius) || 10, Number(p.height) || 20, 48,
      );
    } else if (kind === 'sphere') {
      baseGeo = new THREE.SphereGeometry(Number(p.radius) || 10, 48, 32);
    } else if (kind === 'torus') {
      baseGeo = new THREE.TorusGeometry(Number(p.radius) || 15, Number(p.tubeRadius) || 3, 24, 48);
    }
    if (!baseGeo) return { error: 'unsupported primitive type' };
    // Apply world transform so edge coords (world-space) match vertices.
    const pos = new THREE.Vector3(Number(p.x) || 0, Number(p.y) || 0, Number(p.z) || 0);
    const quat = new THREE.Quaternion().setFromEuler(new THREE.Euler(
      THREE.MathUtils.degToRad(Number(p.rx) || 0),
      THREE.MathUtils.degToRad(Number(p.ry) || 0),
      THREE.MathUtils.degToRad(Number(p.rz) || 0),
    ));
    baseGeo.applyMatrix4(new THREE.Matrix4().compose(pos, quat, new THREE.Vector3(1, 1, 1)));
    const srcGeo = baseGeo.toNonIndexed();
    baseGeo.dispose();
    return {
      srcGeo,
      // Placeholder — ExtrudedBodies overrides on next render via its
      // material useEffect.
      srcMaterial: new THREE.MeshStandardMaterial({ color: 0x5b9bd5, roughness: 0.4, metalness: 0.1 }),
      hasMesh: false,
      oldGeomToDispose: null,
    };
  }

  // Extrude (CSG-pipeline) feature: geometry lives only in the R3F scene.
  const liveMesh = liveBodyMeshes.get(meshUuid);
  if (!liveMesh) {
    return { error: 'body not yet rendered — select the edge and try again' };
  }
  return {
    srcGeo: liveMesh.geometry.clone().toNonIndexed(),
    srcMaterial: liveMesh.material,
    hasMesh: false,
    oldGeomToDispose: null,
  };
}
