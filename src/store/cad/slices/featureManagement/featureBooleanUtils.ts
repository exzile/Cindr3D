import * as THREE from 'three';
import type { Feature } from '../../../../types/cad';
import { GeometryEngine } from '../../../../engine/GeometryEngine';
import { csgAsync } from '../../../../workers/csgWorkerPool';

export type CombineOperation = 'join' | 'cut' | 'intersect';

export function runBoolean(targetMesh: THREE.Mesh, toolMesh: THREE.Mesh, operation: CombineOperation): THREE.BufferGeometry {
  if (operation === 'join') return GeometryEngine.csgUnion(targetMesh.geometry, toolMesh.geometry);
  if (operation === 'cut') return GeometryEngine.csgSubtract(targetMesh.geometry, toolMesh.geometry);
  return GeometryEngine.csgIntersect(targetMesh.geometry, toolMesh.geometry);
}

export async function runBooleanAsync(targetMesh: THREE.Mesh, toolMesh: THREE.Mesh, operation: CombineOperation): Promise<THREE.BufferGeometry | null> {
  const opKey = operation === 'join' ? 'union' : operation === 'cut' ? 'subtract' : 'intersect';
  return csgAsync(targetMesh.geometry as THREE.BufferGeometry, toolMesh.geometry as THREE.BufferGeometry, opKey);
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
      const toolIds = Array.isArray(feature.params.toolIds)
        ? feature.params.toolIds.map(String)
        : [String(feature.params.toolId ?? parentIds[1] ?? '')].filter(Boolean);
      const tools = toolIds.map((id) => byId.get(id)).filter((f): f is Feature => !!f);
      const operation = (feature.params.operation as CombineOperation) ?? 'join';
      if (!target?.mesh || !(target.mesh instanceof THREE.Mesh)) return feature;
      if (tools.length === 0 || tools.some((tool) => !(tool.mesh instanceof THREE.Mesh))) return feature;
      try {
        const resultGeometry = tools.reduce(
          (acc, tool) =>
            runBoolean(new THREE.Mesh(acc, target.mesh!.material), tool.mesh as THREE.Mesh, operation),
          target.mesh.geometry as THREE.BufferGeometry,
        );
        const mesh = new THREE.Mesh(resultGeometry, target.mesh.material);
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
