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
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Feature } from '../../../../types/cad';
import type { CADState } from '../../state';
import { GeometryEngine } from '../../../../engine/GeometryEngine';
import { errorMessage } from '../../../../utils/errorHandling';
import { csgAsync } from '../../../../workers/csgWorkerPool';
import { extractEdgeTopology } from '../../../../engine/geometryEngine/core/solid/edgeTopology';
import { getOccSync } from '../../../../engine/occ/loader';
import { globalBRepBodyRegistry } from '../../../../engine/occ/globalRegistry';
import { performOccBooleanWithInstance } from '../../../../engine/occ/ops/booleanCore';
import type { OccBooleanOperation } from '../../../../engine/occ/ops/booleanCore';
import { tessellateWithInstance, tessellationToGeometry } from '../../../../engine/occ/tessellate';
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
 * Async version of applyBodyBoolean — runs CSG in a worker pool so the main
 * thread stays responsive. Returns null on failure (caller falls back to
 * standalone body). Attaches edge topology to the result geometry for
 * fillet/chamfer edge picking.
 */
export async function applyBodyBooleanAsync(
  targetMesh: THREE.Mesh,
  toolMesh: THREE.Mesh,
  operation: 'join' | 'cut' | 'intersect',
): Promise<THREE.Mesh | null> {
  try {
    const targetGeom = GeometryEngine.bakeMeshWorldGeometry(targetMesh);
    const toolGeom = GeometryEngine.bakeMeshWorldGeometry(toolMesh);
    const opKey = operation === 'join' ? 'union' : operation === 'cut' ? 'subtract' : 'intersect';
    const resultGeom = await csgAsync(targetGeom, toolGeom, opKey);
    targetGeom.dispose();
    toolGeom.dispose();
    if (!resultGeom) return null;
    try {
      const forTopo = mergeVertices(resultGeom, 1e-6);
      resultGeom.userData.topology = extractEdgeTopology(forTopo);
      forTopo.dispose();
    } catch { /* non-fatal */ }
    const mesh = new THREE.Mesh(resultGeom, targetMesh.material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  } catch (err) {
    void errorMessage(err, 'unknown CSG error');
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
