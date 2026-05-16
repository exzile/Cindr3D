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
import { GeometryEngine } from '../../../../engine/GeometryEngine';
import { errorMessage } from '../../../../utils/errorHandling';

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
 * Run join/cut/intersect between a target body mesh and a freshly-built tool
 * mesh, returning a new pickable solid mesh (target's material). Wrapped in
 * try/catch like commitCombine — CSG can throw on degenerate / non-manifold
 * input; on failure returns null so the caller falls back to new-body.
 */
export function applyBodyBoolean(
  targetMesh: THREE.Mesh,
  toolMesh: THREE.Mesh,
  operation: 'join' | 'cut' | 'intersect',
): THREE.Mesh | null {
  try {
    const targetGeom = GeometryEngine.bakeMeshWorldGeometry(targetMesh);
    const toolGeom = GeometryEngine.bakeMeshWorldGeometry(toolMesh);
    let resultGeom: THREE.BufferGeometry;
    if (operation === 'join') resultGeom = GeometryEngine.csgUnion(targetGeom, toolGeom);
    else if (operation === 'cut') resultGeom = GeometryEngine.csgSubtract(targetGeom, toolGeom);
    else resultGeom = GeometryEngine.csgIntersect(targetGeom, toolGeom);
    targetGeom.dispose();
    toolGeom.dispose();
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
 * Finalize a freshly-built standalone tool `feature` (already carries
 * `feature.mesh`) according to `operation`:
 *  - new-body / no eligible target / CSG failure → append it standalone.
 *  - join/cut/intersect → boolean it against the most-recent solid body,
 *    replace `feature.mesh` with the result, and consume (suppress + hide)
 *    that target like commitCombine, syncing the active design config.
 *
 * Returns the next features array + designConfigurations + a status note
 * suffix describing what happened.
 */
export function placeToolFeature(
  state: CADState,
  feature: Feature,
  operation: BodyBooleanOp,
  pickOpts: PickOpts = {},
): { features: Feature[]; designConfigurations: CADState['designConfigurations']; note: string } {
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

  const result = applyBodyBoolean(target.mesh, feature.mesh, operation);
  if (!result) return append(` (${operation} failed — standalone body)`);

  result.userData.pickable = true;
  result.userData.featureId = feature.id;
  const combined: Feature = { ...feature, mesh: result };

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
