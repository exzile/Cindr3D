import * as THREE from 'three';
import type { Feature } from '../../../../types/cad';
import type { BRepBody } from '../../../../engine/occ/brepBody';
import { getOccSync } from '../../../../engine/occ/loader';
import { performOccBooleanWithInstance, type OccBooleanOperation } from '../../../../engine/occ/ops/booleanCore';
import { globalBRepBodyRegistry } from '../../../../engine/occ/globalRegistry';
import { disposeMeshDeferred } from '../../../../engine/occ/picking';
import { createRegisteredOccMesh } from '../../../../engine/occ/registeredMesh';

export type CombineOperation = 'join' | 'cut' | 'intersect';

function brepBodyFromMesh(mesh: THREE.Mesh): BRepBody | null {
  const bodyId = mesh.userData['brepBodyId'] as string | undefined;
  return bodyId ? globalBRepBodyRegistry.get(bodyId) ?? null : null;
}

export function runBoolean(targetBody: BRepBody, toolBody: BRepBody, operation: CombineOperation): BRepBody {
  const occ = getOccSync();
  if (!occ) throw new Error(`runBoolean: OCC is not loaded (operation: ${operation})`);

  const boolOp: OccBooleanOperation =
    operation === 'join' ? 'union' : operation === 'cut' ? 'subtract' : 'intersect';
  const resultBody = performOccBooleanWithInstance(occ.oc, boolOp, targetBody, toolBody);
  if (!resultBody) throw new Error(`runBoolean: OCC boolean returned no body (operation: ${operation})`);
  return resultBody;
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
      const occ = getOccSync();

      if (!occ || !target?.mesh || !(target.mesh instanceof THREE.Mesh)) return feature;
      if (tools.length === 0 || tools.some((tool) => !(tool.mesh instanceof THREE.Mesh))) return feature;

      const targetBody = brepBodyFromMesh(target.mesh);
      const toolBodies = tools
        .map((tool) => brepBodyFromMesh(tool.mesh as THREE.Mesh))
        .filter((body): body is BRepBody => !!body);
      if (!targetBody || toolBodies.length !== tools.length) return feature;

      let currentBody: BRepBody = targetBody;
      let ownsCurrentBody = false;

      try {
        for (const toolBody of toolBodies) {
          const resultBody = runBoolean(currentBody, toolBody, operation);
          if (ownsCurrentBody) currentBody.dispose();
          currentBody = resultBody;
          ownsCurrentBody = true;
        }

        let mesh: THREE.Mesh;
        try {
          mesh = createRegisteredOccMesh(occ.oc, currentBody, target.mesh.material, feature.id);
          ownsCurrentBody = false;
        } catch (error) {
          ownsCurrentBody = false;
          throw error;
        }

        changed.add(feature.id);
        didUpdate = true;
        if (feature.mesh instanceof THREE.Mesh) {
          disposeMeshDeferred(feature.mesh);
        }
        return { ...feature, mesh };
      } catch {
        if (ownsCurrentBody) currentBody.dispose();
        return feature;
      }
    });
  }

  return next;
}
