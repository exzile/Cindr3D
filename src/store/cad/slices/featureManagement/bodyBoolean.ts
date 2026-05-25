/**
 * Shared "boolean a freshly-built tool body against an existing body" helpers.
 *
 * Revolve, Boundary Fill, Pipe, Snap Fit and Lip & Groove all need the same
 * thing for operation = join/cut/intersect: find the body to combine with,
 * run the CSG, and consume (suppress + hide) that target the way commitCombine
 * does. This was copy-pasted as `pickRevolveTarget`/`pickBoundaryFillTarget` +
 * inline bake/csg; it now lives here once.
 *
 * Note: extrude bodies live only in the R3F scene (no `feature.mesh`) so they
 * are never eligible single-shot targets here — same limitation the per-tool
 * copies had.
 */
import * as THREE from 'three';
import type { Feature } from '../../../../types/cad';
import type { CADState } from '../../state';
import { errorMessage } from '../../../../utils/errorHandling';
import { getOcc, getOccSync } from '../../../../engine/occ/loader';
import { globalBRepBodyRegistry } from '../../../../engine/occ/globalRegistry';
import { performOccBooleanWithInstance, type OccBooleanOperation } from '../../../../engine/occ/ops/booleanCore';
import { tessellate, tessellateWithInstance, tessellationToGeometry } from '../../../../engine/occ/tessellate';
import { attachTessellationToMesh } from '../../../../engine/occ/picking';

export type BodyBooleanOp = 'new-body' | 'join' | 'cut' | 'intersect';

interface PickOpts {
  /** Feature ids to skip (e.g. the boundary-fill tool bodies). */
  excludeIds?: Set<string>;
  /** Skip features of this `type` (e.g. 'revolve'). */
  excludeType?: Feature['type'];
  /** Skip features whose `params.featureKind` equals this. */
  excludeFeatureKind?: string;
}

/**
 * The most recent active, visible, non-surface feature that carries a real
 * THREE.Mesh — the body a tool booleans against.
 */
export function pickMostRecentSolidTarget(
  features: Feature[],
  opts: PickOpts = {},
): Feature | undefined {
  let best: Feature | undefined;
  for (const f of features) {
    if (opts.excludeIds?.has(f.id)) continue;
    if (opts.excludeType && f.type === opts.excludeType) continue;
    if (opts.excludeFeatureKind && f.params?.featureKind === opts.excludeFeatureKind) continue;
    if (!f.visible || f.suppressed) continue;
    if (f.bodyKind === 'surface') continue;
    if (!(f.mesh instanceof THREE.Mesh)) continue;
    if (!best || f.timestamp >= best.timestamp) best = f;
  }
  return best;
}

/**
 * Mirror of commitCombine's designConfigurations sync: write feature
 * suppression flags into the active configuration so they survive a config
 * switch.
 */
export function syncConfigurationSuppression(
  state: CADState,
  entries: Record<string, boolean>,
): CADState['designConfigurations'] {
  const updatedAt = Date.now();
  return state.designConfigurations.map((configuration) =>
    configuration.id === state.activeDesignConfigurationId
      ? {
          ...configuration,
          featureSuppression: { ...configuration.featureSuppression, ...entries },
          updatedAt,
        }
      : configuration,
  );
}



/**
 * Async boolean (join/cut/intersect) via the OCC BRep pipeline.
 * Both meshes must carry a `brepBodyId` referencing a live BRepBody in the
 * global registry; returns null (standalone body) if either is missing.
 */
export async function applyBodyBooleanAsync(
  targetMesh: THREE.Mesh,
  toolMesh: THREE.Mesh,
  operation: 'join' | 'cut' | 'intersect',
): Promise<THREE.Mesh | null> {
  const targetBodyId = targetMesh.userData['brepBodyId'] as string | undefined;
  const toolBodyId = toolMesh.userData['brepBodyId'] as string | undefined;
  if (!targetBodyId || !toolBodyId) return null;

  try {
    const { oc } = await getOcc();
    const targetBody = globalBRepBodyRegistry.get(targetBodyId);
    const toolBody = globalBRepBodyRegistry.get(toolBodyId);
    if (!targetBody || !toolBody) return null;

    const boolOp: OccBooleanOperation =
      operation === 'join' ? 'union' : operation === 'cut' ? 'subtract' : 'intersect';
    const resultBody = performOccBooleanWithInstance(oc, boolOp, targetBody, toolBody);
    if (!resultBody) return null;

    try {
      const tess = tessellate(oc, resultBody);
      const geo = tessellationToGeometry(tess);
      globalBRepBodyRegistry.add(resultBody);
      // The tool body is consumed by the boolean and will no longer be referenced
      // by any feature in the returned state — evict it to free the WASM heap entry.
      // Target body is intentionally kept: the suppressed target feature still holds
      // a mesh.userData reference to it and may be needed for undo re-evaluation.
      globalBRepBodyRegistry.delete(toolBodyId);
      const mesh = new THREE.Mesh(geo, targetMesh.material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData['brepBodyId'] = resultBody.id;
      return mesh;
    } catch (err) {
      resultBody.dispose();
      throw err;
    }
  } catch (err) {
    void errorMessage(err, 'OCC boolean error');
    return null;
  }
}

/**
 * Async version of placeToolFeature — CSG runs in a worker pool rather than
 * blocking the main thread. State snapshot is captured at call time; the
 * caller calls set() with the resolved result.
 */
export async function placeToolFeatureAsync(
  state: CADState,
  feature: Feature,
  operation: BodyBooleanOp,
  pickOpts: PickOpts = {},
): Promise<{ features: Feature[]; designConfigurations: CADState['designConfigurations']; note: string }> {
  const append = (note: string) => ({
    features: [...state.features, feature],
    designConfigurations: state.designConfigurations,
    note,
  });

  if (operation === 'new-body') return append('');

  const target = pickMostRecentSolidTarget(state.features, pickOpts);
  if (!target || !(target.mesh instanceof THREE.Mesh) || !(feature.mesh instanceof THREE.Mesh)) {
    return append(` (${operation}: no target body — standalone)`);
  }

  // OCC boolean path: when both tool and target have OCC bodies, use exact BRep boolean.
  const toolMesh = feature.mesh as THREE.Mesh;
  const targetMesh = target.mesh as THREE.Mesh;
  const toolOccBodyId = toolMesh.userData['brepBodyId'] as string | undefined;
  const targetOccBodyId = targetMesh.userData['brepBodyId'] as string | undefined;
  if (toolOccBodyId && targetOccBodyId) {
    const occ = getOccSync();
    const toolOccBody = occ ? globalBRepBodyRegistry.get(toolOccBodyId) : undefined;
    const targetOccBody = occ ? globalBRepBodyRegistry.get(targetOccBodyId) : undefined;
    if (occ && toolOccBody && targetOccBody) {
      try {
        const occOp: OccBooleanOperation = operation === 'join' ? 'union' : operation === 'cut' ? 'subtract' : 'intersect';
        const boolResult = performOccBooleanWithInstance(occ.oc, occOp, targetOccBody, toolOccBody, {
          id: feature.id,
          sourceFeatureId: feature.id,
        });
        if (boolResult) {
          boolResult.id = feature.id;
          boolResult.sourceFeatureId = feature.id;
          globalBRepBodyRegistry.add(boolResult);
          const tess = tessellateWithInstance(occ.oc, boolResult);
          const geo = tessellationToGeometry(tess);
          const occMesh = new THREE.Mesh(geo, targetMesh.material);
          attachTessellationToMesh(occMesh, tess, boolResult.id);
          occMesh.userData['pickable'] = true;
          occMesh.userData['featureId'] = feature.id;
          occMesh.castShadow = true;
          occMesh.receiveShadow = true;
          const combined: Feature = { ...feature, mesh: occMesh, parentFeatureId: target.id };
          const features = state.features.map((f) =>
            f.id === target.id ? { ...f, suppressed: true, visible: false } : f,
          );
          features.push(combined);
          return {
            features,
            designConfigurations: syncConfigurationSuppression(state, {
              [feature.id]: false,
              [target.id]: true,
            }),
            note: ` (${operation} with ${target.name})`,
          };
        }
      } catch (err) {
        void errorMessage(err, 'OCC boolean error');
      }
    }
  }

  const result = await applyBodyBooleanAsync(target.mesh, feature.mesh, operation);
  if (!result) return append(` (${operation} failed — standalone body)`);

  result.userData.pickable = true;
  result.userData.featureId = feature.id;
  const combined: Feature = { ...feature, mesh: result, parentFeatureId: target.id };

  const features = state.features.map((f) =>
    f.id === target.id ? { ...f, suppressed: true, visible: false } : f,
  );
  features.push(combined);

  return {
    features,
    designConfigurations: syncConfigurationSuppression(state, {
      [feature.id]: false,
      [target.id]: true,
    }),
    note: ` (${operation} with ${target.name})`,
  };
}
