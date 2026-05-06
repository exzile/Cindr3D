import * as THREE from 'three';
import type { Feature } from '../../../../types/cad';
import { GeometryEngine } from '../../../../engine/GeometryEngine';

export type CombineOperation = 'join' | 'cut' | 'intersect';

export function runBoolean(targetMesh: THREE.Mesh, toolMesh: THREE.Mesh, operation: CombineOperation): THREE.BufferGeometry {
  if (operation === 'join') return GeometryEngine.csgUnion(targetMesh.geometry, toolMesh.geometry);
  if (operation === 'cut') return GeometryEngine.csgSubtract(targetMesh.geometry, toolMesh.geometry);
  return GeometryEngine.csgIntersect(targetMesh.geometry, toolMesh.geometry);
}

export const MAX_RECOMPUTE_ITERATIONS = 32;

export function recomputeBooleanDependents(features: Feature[], changedFeatureIds: string[]): Feature[] {
  const changed = new Set(changedFeatureIds);
  let next = features;
  let iterations = 0;

  for (let didUpdate = true; didUpdate && iterations < MAX_RECOMPUTE_ITERATIONS; iterations++) {
    didUpdate = false;
    const prev = next;
    const byId = new Map(prev.map((f) => [f.id, f]));
    next = prev.map((feature) => {
      if (feature.type !== 'combine' || feature.params.recomputeOnParentChange !== true) return feature;
      const parentIds = Array.isArray(feature.params.booleanParentIds) ? feature.params.booleanParentIds.map(String) : [];
      if (!parentIds.some((id) => changed.has(id))) return feature;
      const target = byId.get(String(feature.params.targetId ?? parentIds[0] ?? ''));
      const tool = byId.get(String(feature.params.toolId ?? parentIds[1] ?? ''));
      const operation = (feature.params.operation as CombineOperation) ?? 'join';
      if (!target?.mesh || !tool?.mesh || !(target.mesh instanceof THREE.Mesh) || !(tool.mesh instanceof THREE.Mesh)) return feature;
      try {
        const mesh = new THREE.Mesh(runBoolean(target.mesh, tool.mesh, operation), target.mesh.material);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        changed.add(feature.id);
        didUpdate = true;
        if (feature.mesh instanceof THREE.Mesh) {
          const oldGeom = feature.mesh.geometry;
          setTimeout(() => oldGeom.dispose(), 0);
        }
        return { ...feature, mesh };
      } catch {
        return feature;
      }
    });
  }

  return next;
}
