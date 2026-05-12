import * as THREE from 'three';
import type { Feature } from '../../../../types/cad';
import { GeometryEngine } from '../../../../engine/GeometryEngine';
import type { CADSliceContext } from '../../sliceContext';
import type { CADState } from '../../state';
import { recomputeBooleanDependents, runBoolean } from './featureBooleanUtils';
import { errorMessage } from '../../../../utils/errorHandling';

function getBooleanParentIds(feature: Feature): string[] {
  const fromArray = feature.params.booleanParentIds;
  if (Array.isArray(fromArray)) return fromArray.filter((id): id is string => typeof id === 'string');
  return [feature.params.targetId, feature.params.toolId].filter((id): id is string => typeof id === 'string');
}

function keepsParentsHidden(feature: Feature): boolean {
  return feature.type === 'combine' && feature.params.keepTools === false;
}

function parentIsHiddenByAnotherCombine(features: Feature[], parentId: string, excludeCombineId: string): boolean {
  return features.some((feature) =>
    feature.id !== excludeCombineId &&
    keepsParentsHidden(feature) &&
    getBooleanParentIds(feature).includes(parentId),
  );
}

function syncActiveConfigurationSuppression(
  state: CADState,
  entries: Record<string, boolean>,
): CADState['designConfigurations'] {
  const updatedAt = Date.now();
  return state.designConfigurations.map((configuration) =>
    configuration.id === state.activeDesignConfigurationId
      ? {
          ...configuration,
          featureSuppression: {
            ...configuration.featureSuppression,
            ...entries,
          },
          updatedAt,
        }
      : configuration,
  );
}

export function createFeatureMeshActions({ set, get }: CADSliceContext): Partial<CADState> {
  return {
  // D119 Tessellate
  tessellateFeature: (featureId) => {
    const { features } = get();
    const feature = features.find((f) => f.id === featureId);
    if (!feature?.mesh) {
      get().setStatusMessage('No mesh found on selected feature');
      return;
    }
    const geom = GeometryEngine.extractMeshGeometry(feature.mesh as THREE.Mesh | THREE.Group);
    if (!geom) {
      get().setStatusMessage('No mesh found on selected feature');
      return;
    }
    const mat = new THREE.MeshPhysicalMaterial({ color: 0x8899aa, metalness: 0.3, roughness: 0.4, side: THREE.DoubleSide });
    const newMesh = new THREE.Mesh(geom, mat);
    newMesh.castShadow = true;
    newMesh.receiveShadow = true;
    const n = features.filter((f) => f.params.kind === 'tessellate').length + 1;
    const newFeature: Feature = {
      id: crypto.randomUUID(),
      name: `Tessellate ${n}`,
      type: 'primitive',
      params: { kind: 'tessellate' },
      visible: true,
      suppressed: false,
      timestamp: Date.now(),
      mesh: newMesh,
      bodyKind: 'mesh',
    };
    set((state) => ({
      features: [...state.features, newFeature],
      statusMessage: 'Feature tessellated as mesh body',
    }));
  },
  // D125 Mesh Reduce
  reduceMesh: (featureId, reductionPercent) => {
    const { features } = get();
    const feature = features.find((f) => f.id === featureId);
    if (!feature?.mesh) {
      get().setStatusMessage('Mesh Reduce: selected feature has no mesh');
      return;
    }
    // Build a new simplified mesh rather than mutating the existing one in-place.
    // Mutating geometry on a Zustand-owned object bypasses set() and leaves
    // React unaware of the change. Instead we clone, simplify, then replace
    // the feature in state via set().
    const applyToMesh = async (m: THREE.Mesh): Promise<THREE.Mesh> => {
      const newGeom = await GeometryEngine.simplifyGeometry(m.geometry, reductionPercent);
      const clone = new THREE.Mesh(newGeom, m.material);
      clone.castShadow = m.castShadow;
      clone.receiveShadow = m.receiveShadow;
      Object.assign(clone.userData, m.userData);
      return clone;
    };
    const featureMesh = feature.mesh as THREE.Object3D;
    // Re-validate the feature/mesh AFTER the await Ã¢â‚¬â€ by the time the simplify
    // promise resolves, the user could have deleted the feature, replaced its
    // mesh, or kicked off another reduce. Without this guard the post-await
    // set() would write the new mesh into whatever feature row currently has
    // the matching id, and dispose a mesh that's already been replaced.
    const stillValid = (currentMesh: THREE.Object3D | null | undefined): boolean => {
      const live = get().features.find((f) => f.id === featureId);
      return !!live && live.mesh === currentMesh;
    };
    const onErr = (err: unknown) => {
      get().setStatusMessage(`Mesh Reduce failed: ${errorMessage(err, 'unknown error')}`);
    };
    if (featureMesh instanceof THREE.Mesh) {
      applyToMesh(featureMesh).then((newMesh) => {
        if (!stillValid(featureMesh)) {
          // Stale Ã¢â‚¬â€ drop the freshly built mesh so we don't leak it
          newMesh.geometry.dispose();
          return;
        }
        const oldMesh = feature.mesh;
        set((state) => ({
          features: state.features.map((f) =>
            f.id === featureId ? { ...f, mesh: newMesh } : f,
          ),
        }));
        // Dispose old geometry AFTER removing from state
        if (oldMesh instanceof THREE.Mesh) oldMesh.geometry.dispose();
        get().setStatusMessage(`Mesh reduced by ${reductionPercent}%`);
      }).catch(onErr);
    } else if (featureMesh instanceof THREE.Group) {
      const meshes: THREE.Mesh[] = [];
      featureMesh.traverse((child) => {
        if (child instanceof THREE.Mesh) meshes.push(child);
      });
      Promise.all(meshes.map(applyToMesh)).then((newMeshes) => {
        if (!stillValid(featureMesh)) {
          // Stale Ã¢â‚¬â€ drop all freshly built meshes' geometries
          for (const m of newMeshes) m.geometry.dispose();
          return;
        }
        const oldGroup = feature.mesh;
        const newGroup = new THREE.Group();
        newMeshes.forEach((m) => newGroup.add(m));
        set((state) => ({
          features: state.features.map((f) =>
            f.id === featureId ? { ...f, mesh: newGroup as unknown as THREE.Mesh } : f,
          ),
        }));
        // Dispose old geometries AFTER removal
        if (oldGroup instanceof THREE.Group) {
          oldGroup.traverse((child) => {
            if (child instanceof THREE.Mesh) child.geometry.dispose();
          });
        }
        get().setStatusMessage(`Mesh reduced by ${reductionPercent}%`);
      }).catch(onErr);
    } else {
      get().setStatusMessage('Mesh Reduce: feature is not simplifiable');
    }
  },
  // D115 Reverse Normals
  reverseNormals: (featureId) => {
    const { features } = get();
    const feature = features.find((f) => f.id === featureId);
    if (!feature?.mesh) {
      get().setStatusMessage('Reverse Normal: selected feature has no mesh');
      return;
    }
    const featureMesh = feature.mesh as THREE.Object3D;
    if (featureMesh instanceof THREE.Mesh) {
      GeometryEngine.reverseNormals(featureMesh.geometry);
    } else if (featureMesh instanceof THREE.Group) {
      featureMesh.traverse((child) => {
        if (child instanceof THREE.Mesh) GeometryEngine.reverseNormals(child.geometry);
      });
    }
    // Mutating mesh.geometry in place doesn't notify Zustand subscribers Ã¢â‚¬â€ replace
    // the features array reference so the timeline / re-renderers see the change.
    set((state) => ({
      features: state.features.map((f) => f.id === featureId ? { ...f } : f),
    }));
    get().setStatusMessage('Normals reversed');
  },
  // UTL1 Ã¢â‚¬â€ Show All / Hide
  showAllFeatures: () => set((state) => ({
    features: state.features.map((f) => ({ ...f, visible: true })),
    statusMessage: 'All features shown',
  })),
  hideFeature: (id) => set((state) => ({
    features: state.features.map((f) => f.id === id ? { ...f, visible: false } : f),
    statusMessage: 'Feature hidden',
  })),

  // MSH8 Ã¢â‚¬â€ commitReverseNormal: clone geometry with flipped normals
  commitReverseNormal: (featureId) => {
    const { features } = get();
    const feature = features.find((f) => f.id === featureId);
    if (!feature?.mesh) {
      get().setStatusMessage('Reverse Normal: no mesh on selected feature');
      return;
    }
    const srcMesh = feature.mesh as THREE.Mesh;
    if (!(srcMesh instanceof THREE.Mesh)) {
      get().setStatusMessage('Reverse Normal: feature is not a mesh');
      return;
    }
    const newMesh = GeometryEngine.reverseMeshNormals(srcMesh);
    newMesh.castShadow = true;
    newMesh.receiveShadow = true;
    // Dispose the previous geometry Ã¢â‚¬â€ reverseMeshNormals returns a fresh
    // mesh with cloned geometry, so the source's BufferGeometry is now orphan.
    const oldMesh = feature.mesh;
    set((state) => ({
      features: state.features.map((f) => f.id === featureId ? { ...f, mesh: newMesh } : f),
      statusMessage: 'Mesh normals reversed',
    }));
    if (oldMesh instanceof THREE.Mesh) oldMesh.geometry.dispose();
  },

  // MSH7 Ã¢â‚¬â€ commitMeshCombine: merge all listed feature meshes into one
  commitMeshCombine: (featureIds) => {
    const { features } = get();
    const meshes: THREE.Mesh[] = [];
    for (const fid of featureIds) {
      const f = features.find((x) => x.id === fid);
      if (f?.mesh instanceof THREE.Mesh) meshes.push(f.mesh as THREE.Mesh);
    }
    if (meshes.length < 2) {
      get().setStatusMessage('Mesh Combine: need at least 2 mesh features');
      return;
    }
    const combined = GeometryEngine.combineMeshes(meshes);
    combined.castShadow = true;
    combined.receiveShadow = true;
    const n = features.filter((f) => f.name.startsWith('Mesh Combine')).length + 1;
    const newFeature: Feature = {
      id: crypto.randomUUID(),
      name: `Mesh Combine ${n}`,
      type: 'import',
      params: { featureKind: 'mesh-combine', sourceIds: featureIds.join(',') },
      visible: true,
      suppressed: false,
      timestamp: Date.now(),
      mesh: combined,
      bodyKind: 'mesh',
    };
    set((state) => ({
      features: [...state.features, newFeature],
      statusMessage: 'Meshes combined',
    }));
  },

  // MSH11 Ã¢â‚¬â€ commitMeshTransform: apply translate/rotate/scale to a mesh
  commitMeshTransform: (featureId, params) => {
    const { features } = get();
    const feature = features.find((f) => f.id === featureId);
    if (!feature?.mesh) {
      get().setStatusMessage('Mesh Transform: no mesh on selected feature');
      return;
    }
    const srcMesh = feature.mesh as THREE.Mesh;
    if (!(srcMesh instanceof THREE.Mesh)) {
      get().setStatusMessage('Mesh Transform: feature is not a mesh');
      return;
    }
    // Validate inputs before mutating Ã¢â‚¬â€ scale=0 collapses the mesh permanently
    // and there's no rollback path. NaN/Infinity rotations propagate into
    // the geometry and corrupt every downstream raycast.
    const finite = (v: number) => Number.isFinite(v);
    if (!finite(params.tx) || !finite(params.ty) || !finite(params.tz) ||
        !finite(params.rx) || !finite(params.ry) || !finite(params.rz) ||
        !finite(params.scale) || params.scale === 0) {
      get().setStatusMessage('Mesh Transform: invalid params (translate/rotate must be finite, scale != 0)');
      return;
    }
    get().pushUndo();
    const newMesh = GeometryEngine.transformMesh(srcMesh, params);
    newMesh.castShadow = true;
    newMesh.receiveShadow = true;
    const oldMesh = feature.mesh;
    set((state) => ({
      features: state.features.map((f) => f.id === featureId ? { ...f, mesh: newMesh } : f),
      statusMessage: 'Mesh transformed',
    }));
    // Defer disposal so undo can still reference the old geometry.
    // setTimeout(0) ensures the set() completes and state is stable first.
    if (oldMesh instanceof THREE.Mesh) {
      const geo = oldMesh.geometry;
      setTimeout(() => geo.dispose(), 0);
    }
  },

  // SLD13 Ã¢â‚¬â€ commitScale: scale a feature mesh by sx/sy/sz
  commitScale: (featureId, sx, sy, sz) => {
    const { features } = get();
    const feature = features.find((f) => f.id === featureId);
    if (!feature?.mesh) {
      get().setStatusMessage('Scale: no mesh on selected feature');
      return;
    }
    const srcMesh = feature.mesh as THREE.Mesh;
    if (!(srcMesh instanceof THREE.Mesh)) {
      get().setStatusMessage('Scale: feature is not a mesh');
      return;
    }
    // Validate before mutating Ã¢â‚¬â€ any zero axis flattens the mesh permanently.
    if (!Number.isFinite(sx) || !Number.isFinite(sy) || !Number.isFinite(sz) ||
        sx === 0 || sy === 0 || sz === 0) {
      get().setStatusMessage('Scale: factors must be finite and non-zero');
      return;
    }
    get().pushUndo();
    const newMesh = GeometryEngine.scaleMesh(srcMesh, sx, sy, sz);
    newMesh.castShadow = true;
    newMesh.receiveShadow = true;
    const oldGeom = srcMesh.geometry;
    set((state) => {
      const features = state.features.map((f) => f.id === featureId ? { ...f, mesh: newMesh } : f);
      return {
        features: recomputeBooleanDependents(features, [featureId]),
        statusMessage: `Scaled ${sx}×${sy}×${sz}`,
      };
    });
    // Defer so the undo snapshot can still reference the old geometry if needed.
    setTimeout(() => oldGeom.dispose(), 0);
  },

  // SLD12 Ã¢â‚¬â€ commitCombine: boolean op on two feature meshes
  commitCombine: (targetFeatureId, toolFeatureId, operation, keepTool) => {
    const { features } = get();
    const targetFeature = features.find((f) => f.id === targetFeatureId);
    const toolFeature = features.find((f) => f.id === toolFeatureId);
    if (!targetFeature?.mesh || !(targetFeature.mesh instanceof THREE.Mesh)) {
      get().setStatusMessage('Combine: target has no mesh');
      return;
    }
    if (!toolFeature?.mesh || !(toolFeature.mesh instanceof THREE.Mesh)) {
      get().setStatusMessage('Combine: tool has no mesh');
      return;
    }
    const tgtMesh = targetFeature.mesh as THREE.Mesh;
    const toolMesh = toolFeature.mesh as THREE.Mesh;
    let resultGeom: THREE.BufferGeometry;
    // CSG can throw on degenerate / non-manifold inputs. Catch + report so
    // the user gets a status message instead of a silent broken state, and
    // the partially-built result (if any) doesn't end up in the scene.
    // pushUndo is called AFTER the try/catch so a failed CSG doesn't leave
    // an orphaned snapshot on the undo stack.
    try {
      resultGeom = runBoolean(tgtMesh, toolMesh, operation);
    } catch (err) {
      get().setStatusMessage(`Combine (${operation}) failed: ${errorMessage(err, 'unknown CSG error')}`);
      return;
    }
    get().pushUndo();
    const newMesh = new THREE.Mesh(resultGeom, tgtMesh.material);
    newMesh.castShadow = true;
    newMesh.receiveShadow = true;
    const n = features.filter((f) => f.type === 'combine').length + 1;
    const combineFeature: Feature = {
      id: crypto.randomUUID(),
      name: `Combine ${n} (${operation})`,
      type: 'combine',
      params: {
        operation,
        keepTools: keepTool,
        targetId: targetFeatureId,
        toolId: toolFeatureId,
        booleanParentIds: [targetFeatureId, toolFeatureId],
        recomputeOnParentChange: true,
      },
      mesh: newMesh,
      visible: true,
      suppressed: false,
      timestamp: Date.now(),
      bodyKind: targetFeature.bodyKind,
    };
    set((state) => {
      const updated = state.features.map((f) =>
        !keepTool && (f.id === targetFeatureId || f.id === toolFeatureId)
          ? { ...f, suppressed: true }
          : f
      );
      const suppressionEntries: Record<string, boolean> = {
        [combineFeature.id]: false,
        [targetFeatureId]: !keepTool,
        [toolFeatureId]: !keepTool,
      };
      return {
        features: [...updated, combineFeature],
        designConfigurations: syncActiveConfigurationSuppression(state, suppressionEntries),
        statusMessage: `Combine (${operation}) created with editable parents`,
      };
    });
  },

  // SLD17 Ã¢â‚¬â€ commitMirrorFeature: mirror a feature's mesh across a plane
  commitMirrorFeature: (featureId, plane) => {
    const { features } = get();
    const feature = features.find((f) => f.id === featureId);
    if (!feature?.mesh) {
      get().setStatusMessage('Mirror Feature: no mesh on selected feature');
      return;
    }
    const srcMesh = feature.mesh as THREE.Mesh;
    if (!(srcMesh instanceof THREE.Mesh)) {
      get().setStatusMessage('Mirror Feature: feature is not a mesh');
      return;
    }
    get().pushUndo();
    const mirrored = GeometryEngine.mirrorMesh(srcMesh, plane);
    mirrored.castShadow = true;
    mirrored.receiveShadow = true;
    const n = features.filter((f) => f.name.startsWith('Mirror Feature')).length + 1;
    const newFeature: Feature = {
      id: crypto.randomUUID(),
      name: `Mirror Feature ${n}`,
      type: 'mirror',
      params: { featureKind: 'mirror-feature', sourceId: featureId, plane },
      visible: true,
      suppressed: false,
      timestamp: Date.now(),
      mesh: mirrored,
      bodyKind: feature.bodyKind,
    };
    set((state) => ({
      features: [...state.features, newFeature],
      statusMessage: `Feature mirrored on ${plane} plane`,
    }));
  },

  // SLD12-edit — re-run CSG on an existing combine feature with new params.
  // Atomically updates params + mesh in one pushUndo so the edit is a single
  // undo step (avoids double-snapshot from separate updateFeatureParams + CSG).
  recommitCombine: (featureId, params) => {
    const { features } = get();
    const feature = features.find((f) => f.id === featureId);
    if (!feature || feature.type !== 'combine') {
      get().setStatusMessage('Combine (edit): feature not found');
      return;
    }
    const { operation, keepTools, targetId, toolId } = params;
    const targetFeature = features.find((f) => f.id === targetId);
    const toolFeature = features.find((f) => f.id === toolId);
    if (!targetFeature?.mesh || !(targetFeature.mesh instanceof THREE.Mesh)) {
      get().setStatusMessage('Combine (edit): target has no mesh');
      return;
    }
    if (!toolFeature?.mesh || !(toolFeature.mesh instanceof THREE.Mesh)) {
      get().setStatusMessage('Combine (edit): tool has no mesh');
      return;
    }
    const tgtMesh = targetFeature.mesh as THREE.Mesh;
    const toolMesh = toolFeature.mesh as THREE.Mesh;
    let resultGeom: THREE.BufferGeometry;
    try {
      resultGeom = runBoolean(tgtMesh, toolMesh, operation);
    } catch (err) {
      get().setStatusMessage(`Combine (edit) failed: ${errorMessage(err, 'unknown CSG error')}`);
      return;
    }
    get().pushUndo();
    const newMesh = new THREE.Mesh(resultGeom, tgtMesh.material);
    newMesh.castShadow = true;
    newMesh.receiveShadow = true;
    const oldMesh = feature.mesh;
    set((state) => {
      const oldParentIds = getBooleanParentIds(feature);
      const nextParentIds = [targetId, toolId];
      const affectedParentIds = Array.from(new Set([...oldParentIds, ...nextParentIds]));
      const features = state.features.map((f) => {
        if (f.id === featureId) {
          return { ...f, mesh: newMesh, params: { ...f.params, operation, keepTools, targetId, toolId, booleanParentIds: [targetId, toolId], recomputeOnParentChange: true } };
        }
        if (affectedParentIds.includes(f.id)) {
          const isNextParent = nextParentIds.includes(f.id);
          const shouldSuppress = isNextParent
            ? !keepTools
            : parentIsHiddenByAnotherCombine(state.features, f.id, featureId);
          return { ...f, suppressed: shouldSuppress };
        }
        return f;
      });
      const suppressionEntries: Record<string, boolean> = { [featureId]: false };
      for (const id of affectedParentIds) {
        suppressionEntries[id] = !!features.find((candidate) => candidate.id === id)?.suppressed;
      }
      return {
        features,
        designConfigurations: syncActiveConfigurationSuppression(state, suppressionEntries),
        statusMessage: `Combine (${operation}) updated`,
      };
    });
    if (oldMesh instanceof THREE.Mesh) {
      const geo = oldMesh.geometry;
      setTimeout(() => geo.dispose(), 0);
    }
  },

  toggleFeatureVisibility: (id) => set((state) => ({
    features: state.features.map((f) =>
      f.id === id ? { ...f, visible: !f.visible } : f
    ),
  })),
  toggleFeatureSuppressed: (id) => set((state) => {
    const features = state.features.map((f) =>
      f.id === id ? { ...f, suppressed: !f.suppressed } : f
    );
    const target = features.find((feature) => feature.id === id);
    return {
      features,
      designConfigurations: state.designConfigurations.map((configuration) =>
        configuration.id === state.activeDesignConfigurationId && target
          ? {
              ...configuration,
              featureSuppression: {
                ...configuration.featureSuppression,
                [id]: !!target.suppressed,
              },
              updatedAt: Date.now(),
            }
          : configuration,
      ),
    };
  }),
  };
}
