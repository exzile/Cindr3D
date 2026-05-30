import * as THREE from 'three';
import type { Feature } from '../../../../types/cad';
import { applyBodyBooleanAsync } from '../featureManagement/bodyBoolean';

export async function replayToolBooleanAsync(
  features: Feature[],
  feature: Feature,
  toolMesh: THREE.Mesh,
  operation: 'new-body' | 'join' | 'cut' | 'intersect',
): Promise<{ mesh: THREE.Mesh; note: string } | null> {
  if (operation === 'new-body') return { mesh: toolMesh, note: '' };
  const parentId = feature.parentFeatureId;
  if (!parentId) return null;
  const parent = features.find((f) => f.id === parentId);
  if (!(parent?.mesh instanceof THREE.Mesh)) {
    return null;
  }
  const result = await applyBodyBooleanAsync(parent.mesh, toolMesh, operation);
  if (!result) return null;
  result.userData.pickable = true;
  result.userData.featureId = feature.id;
  toolMesh.geometry.dispose();
  return { mesh: result, note: ` (${operation} with ${parent.name})` };
}
