import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { useCADStore } from '../../../store/cadStore';
import { useComponentStore } from '../../../store/componentStore';
import { liveBodyMeshes, bodyGeometryCache, bodyIdGeometryCache } from '../../../store/meshRegistry';
import { GeometryEngine } from '../../../engine/GeometryEngine';
import { globalBRepBodyRegistry } from '../../../engine/occ/globalRegistry';
import { parseOccEdgeSelection, storedEdgeIds } from '../../../utils/occEdgeUtils';

import type { Feature } from '../../../types/cad';
import { BODY_MATERIAL, SURFACE_MATERIAL, DIM_MATERIAL, componentColorMaterial } from './bodyMaterial';


type PersistHydrationApi = {
  persist?: {
    hasHydrated: () => boolean;
    onFinishHydration: (cb: () => void) => (() => void) | void;
  };
};

function storeHasHydrated(store: PersistHydrationApi): boolean {
  return store.persist?.hasHydrated() ?? true;
}

function useSceneStoresHydrated(): boolean {
  const [hydrated, setHydrated] = useState(
    () => storeHasHydrated(useCADStore as unknown as PersistHydrationApi) &&
      storeHasHydrated(useComponentStore as unknown as PersistHydrationApi),
  );

  useEffect(() => {
    if (hydrated) return undefined;

    const cadStore = useCADStore as unknown as PersistHydrationApi;
    const componentStore = useComponentStore as unknown as PersistHydrationApi;
    const check = () => {
      if (storeHasHydrated(cadStore) && storeHasHydrated(componentStore)) {
        setHydrated(true);
      }
    };
    const disposers: Array<() => void> = [];

    if (!storeHasHydrated(cadStore)) {
      const unsub = cadStore.persist?.onFinishHydration(check);
      if (typeof unsub === 'function') disposers.push(unsub);
    }
    if (!storeHasHydrated(componentStore)) {
      const unsub = componentStore.persist?.onFinishHydration(check);
      if (typeof unsub === 'function') disposers.push(unsub);
    }

    check();
    return () => {
      for (const dispose of disposers) dispose();
    };
  }, [hydrated]);

  return hydrated;
}

function featureNeedsBody(feature: Feature, bodiesById: ReturnType<typeof useComponentStore.getState>['bodies']): boolean {
  if (feature.type !== 'extrude' || feature.suppressed) return false;
  const operation =
    (feature.params?.operation as string | undefined) ??
    (feature.params?.extrudeOperation as string | undefined) ??
    'new-body';
  if (operation !== 'new-body') return false;
  if (feature.bodyId && bodiesById[feature.bodyId]) return false;
  return !Object.values(bodiesById).some((body) => body.featureIds.includes(feature.id));
}

function cloneWorldGeometry(mesh: THREE.Mesh): THREE.BufferGeometry {
  mesh.updateMatrixWorld(true);
  return GeometryEngine.bakeMeshWorldGeometry(mesh);
}

/**
 * Renders committed feature meshes. Strict OCC commits store registered display
 * meshes, so this component no longer rebuilds extrudes/revolves from sketches.
 */

export default function ExtrudedBodies() {
  const sceneStoresHydrated = useSceneStoresHydrated();
  const features = useCADStore((s) => s.features) as Feature[];
  const rollbackIndex = useCADStore((s) => s.rollbackIndex);
  const activeComponentId = useComponentStore((s) => s.activeComponentId);
  const rootComponentId = useComponentStore((s) => s.rootComponentId);
  const components = useComponentStore((s) => s.components);
  const showComponentColors = useCADStore((s) => s.showComponentColors);

  const bodiesById = useComponentStore((s) => s.bodies);
  useEffect(() => {
    if (!sceneStoresHydrated) return;
    const componentStore = useComponentStore.getState();
    const parentId = componentStore.activeComponentId ?? componentStore.rootComponentId;
    const missing = features.filter((feature) => featureNeedsBody(feature, componentStore.bodies));
    for (const feature of missing) {
      const label = `${feature.bodyKind === 'surface' ? 'Surface' : 'Body'} ${Object.keys(componentStore.bodies).length + 1}`;
      const bodyId = componentStore.addBody(parentId, label);
      if (bodyId) componentStore.addFeatureToBody(bodyId, feature.id);
    }
  }, [sceneStoresHydrated, features, bodiesById]);

  // When a non-root component is active, dim features that belong to other components.
  const editingInPlace = !!activeComponentId && activeComponentId !== rootComponentId;

  // Per-body cloned MeshStandardMaterial cache. Cloned materials are disposed
  // when the appearance changes or the component unmounts. Singletons
  // (BODY_MATERIAL / SURFACE_MATERIAL / DIM_MATERIAL) are NEVER disposed.
  const materialCache = useRef<Map<string, { mat: THREE.MeshStandardMaterial; key: string }>>(new Map());
  useEffect(() => {
    const cache = materialCache.current;
    return () => {
      cache.forEach(({ mat }) => mat.dispose());
      cache.clear();
    };
  }, []);
  // Evict cache entries for bodies that have been removed from the store —
  // otherwise their cloned MeshStandardMaterial would leak for the lifetime of
  // ExtrudedBodies. Runs whenever the bodies map changes.
  useEffect(() => {
    const cache = materialCache.current;
    for (const bodyId of Array.from(cache.keys())) {
      if (!bodiesById[bodyId]) {
        cache.get(bodyId)!.mat.dispose();
        cache.delete(bodyId);
      }
    }
  }, [bodiesById]);

  const getMaterial = useCallback(
    (featureComponentId: string | undefined, bodyId: string | undefined, isSurface = false): THREE.Material => {
      const effectiveComponentId = featureComponentId ?? (bodyId ? bodiesById[bodyId]?.componentId : undefined);
      const shouldDim = editingInPlace && effectiveComponentId !== activeComponentId;
      const componentColor = effectiveComponentId ? components[effectiveComponentId]?.color : undefined;
      const componentMaterial = showComponentColors && componentColor && !isSurface
        ? componentColorMaterial(componentColor)
        : null;
      const fallback: THREE.Material = componentMaterial ?? (isSurface ? SURFACE_MATERIAL : BODY_MATERIAL);
      if (componentMaterial) return shouldDim ? DIM_MATERIAL : componentMaterial;
      if (!bodyId) return shouldDim ? DIM_MATERIAL : fallback;
      const body = bodiesById[bodyId];
      if (!body || !body.material) return shouldDim ? DIM_MATERIAL : fallback;
      const m = body.material;
      // CTX-7: per-body display opacity (independent of material.opacity)
      const displayOpacity = body.opacity ?? 1;
      // Skip override when body uses default aluminum + no display opacity override.
      // Color compared case-insensitively so picker output (#b0b8c0) matches the
      // canonical default (#B0B8C0) — otherwise we'd needlessly clone a fresh
      // MeshStandardMaterial for every default-aluminum body just on a case mismatch.
      if (!shouldDim && m.id === 'aluminum' && m.color.toLowerCase() === '#b0b8c0' && m.opacity === 1 && displayOpacity === 1) return fallback;
      const finalOpacity = m.opacity * displayOpacity * (shouldDim ? DIM_MATERIAL.opacity : 1);
      const key = `${m.color}|${m.metalness}|${m.roughness}|${m.opacity}|${displayOpacity}|${shouldDim ? 'dim' : 'normal'}`;
      const cached = materialCache.current.get(bodyId);
      if (cached && cached.key === key) return cached.mat;
      if (cached) cached.mat.dispose();
      const mat = new THREE.MeshStandardMaterial({
        color: m.color,
        metalness: m.metalness,
        roughness: m.roughness,
        opacity: finalOpacity,
        transparent: finalOpacity < 1,
        side: THREE.DoubleSide,
      });
      materialCache.current.set(bodyId, { mat, key });
      return mat;
    },
    [editingInPlace, activeComponentId, bodiesById, components, showComponentColors],
  );

  const resolveBodyId = useCallback(
    (featureId: string | undefined, bodyId: string | undefined): string | undefined => {
      if (bodyId && bodiesById[bodyId]) return bodyId;
      if (!featureId) return undefined;
      const bodies = Object.values(bodiesById);
      return bodies.find((body) => body.featureIds.includes(featureId))?.id
        ?? (bodies.length === 1 ? bodies[0].id : undefined);
    },
    [bodiesById],
  );

  // D187 + D190: a feature is skipped when it is suppressed, hidden, or
  // rolled back past the marker.
  const isActive = (f: Feature) => {
    if (!f.visible || f.suppressed) return false;
    if (rollbackIndex >= 0) {
      const idx = features.indexOf(f);
      if (idx > rollbackIndex) return false;
    }
    return true;
  };

  // Non-destructive OCC edge modification: when a fillet/chamfer feature has been committed
  // with a mesh (Phase 0 — it stores the result on its own node), the parent
  // feature must be hidden so the two bodies don't overlap. A downstream
  // edge modification is "active" only when it has a computed mesh; while it's pending
  // (just added, OCC not yet run) the parent stays visible for replay.
  const edgeModificationSourceFeatureId = (feature: Feature): string | undefined => {
    const explicit =
      feature.parentFeatureId ??
      (feature.params.parentFeatureId as string | undefined) ??
      (feature.params.sourceFeatureId as string | undefined);
    if (explicit) return explicit;

    const selection = parseOccEdgeSelection(storedEdgeIds(feature.params.edgeIds));
    if (!selection) return undefined;
    return globalBRepBodyRegistry.get(selection.bodyId)?.sourceFeatureId;
  };

  const hasActiveDownstreamEdgeModification = (featureId: string): boolean =>
    features.some((f) => {
      if (f.type !== 'fillet' && f.type !== 'chamfer') return false;
      if (!f.visible || f.suppressed || f.mesh == null) return false;
      return edgeModificationSourceFeatureId(f) === featureId;
    });

  // Keep the persistent geometry caches in sync from committed OCC meshes so
  // Prepare/export can resolve body geometry from committed OCC/stored meshes.
  useEffect(() => {
    if (!sceneStoresHydrated) return;

    const liveFeatureIds = new Set<string>();
    const liveBodyIds = new Set<string>();
    const byBodyId = new Map<string, THREE.BufferGeometry[]>();

    for (const feature of features) {
      if (!isActive(feature) || !feature.mesh || hasActiveDownstreamEdgeModification(feature.id)) continue;
      if (!(feature.mesh instanceof THREE.Mesh)) continue;

      const bodyId = resolveBodyId(feature.id, feature.bodyId);
      const worldGeometry = cloneWorldGeometry(feature.mesh);
      liveFeatureIds.add(feature.id);
      bodyGeometryCache.get(feature.id)?.dispose();
      bodyGeometryCache.set(feature.id, worldGeometry);

      if (bodyId) {
        liveBodyIds.add(bodyId);
        const bucket = byBodyId.get(bodyId);
        if (bucket) bucket.push(worldGeometry);
        else byBodyId.set(bodyId, [worldGeometry]);
      }
    }

    for (const [featureId, geometry] of bodyGeometryCache) {
      if (!liveFeatureIds.has(featureId)) {
        geometry.dispose();
        bodyGeometryCache.delete(featureId);
      }
    }

    for (const [bodyId, geometry] of bodyIdGeometryCache) {
      if (!liveBodyIds.has(bodyId)) {
        geometry.dispose();
        bodyIdGeometryCache.delete(bodyId);
      }
    }

    for (const [bodyId, geometries] of byBodyId) {
      bodyIdGeometryCache.get(bodyId)?.dispose();
      const merged = geometries.length === 1
        ? geometries[0].clone()
        : (mergeGeometries(geometries, false) ?? geometries[0].clone());
      bodyIdGeometryCache.set(bodyId, merged);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneStoresHydrated, features, rollbackIndex, resolveBodyId]);

  // Register stored-mesh features (fillet/chamfer/sweep/etc.) in liveBodyMeshes
  // so downstream tools and export/slicer caches can locate their geometry.
  useEffect(() => {
    if (!sceneStoresHydrated) return undefined;
    const stored: Array<{ uuid: string }> = [];
    for (const f of features) {
      if (!isActive(f) || !f.mesh || hasActiveDownstreamEdgeModification(f.id)) continue;
      if (!(f.mesh instanceof THREE.Mesh)) continue;
      const m = f.mesh;
      // Stamp userData eagerly so collectPickable / EdgeOpEdgeHighlight's
      // featureId filter can find this mesh before R3F's <primitive> onUpdate
      // fires on the next animation frame. Without this the mesh is in the scene
      // but invisible to the edge picker until the first R3F reconcile after mount.
      m.userData.pickable = true;
      m.userData.featureId = f.id;
      m.userData.bodyId = resolveBodyId(f.id, f.bodyId);
      liveBodyMeshes.set(m.uuid, m);
      stored.push({ uuid: m.uuid });
    }
    return () => { stored.forEach(({ uuid }) => liveBodyMeshes.delete(uuid)); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneStoresHydrated, features, rollbackIndex]);

  // Apply dim / appearance materials on pre-built stored meshes in an effect,
  // never in render, so cleanup is guaranteed when Edit In Place exits.
  useEffect(() => {
    if (!sceneStoresHydrated) return;
    const storedMeshFeatures = features.filter((f) => isActive(f) && f.mesh && !hasActiveDownstreamEdgeModification(f.id));
    storedMeshFeatures.forEach((feature) => {
      if (!(feature.mesh instanceof THREE.Mesh)) return;
      const mesh = feature.mesh;
      const isSurface = feature.bodyKind === 'surface';
      const bodyId = resolveBodyId(feature.id, feature.bodyId);
      mesh.userData._origMaterial = undefined;
      mesh.userData.bodyId = bodyId;
      mesh.material = getMaterial(feature.componentId, bodyId, isSurface);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneStoresHydrated, features, editingInPlace, activeComponentId, rollbackIndex, bodiesById, getMaterial, resolveBodyId]);

  // Memoised filtered lists — avoid re-allocating on every render when only unrelated
  // state changes (e.g. visibility toggles, status messages that bump features ref).
  // isActive / hasActiveDownstreamEdgeModification close over features + rollbackIndex,
  // so those two are the only deps needed.
  const storedMeshFeaturesFiltered = useMemo(
    () => features.filter((f) => isActive(f) && f.mesh && !hasActiveDownstreamEdgeModification(f.id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [features, rollbackIndex],
  );

  if (!sceneStoresHydrated) return null;

  return (
    <>
      {/* Render committed OCC/stored meshes. Material assignment is done in a
          useEffect above, never in render. */}
      {storedMeshFeaturesFiltered.map((feature) => (
        <primitive
          key={feature.id}
          object={feature.mesh!}
          onUpdate={(m: THREE.Object3D) => {
            m.userData.pickable = true;
            const bodyId = resolveBodyId(feature.id, feature.bodyId);
            m.userData.featureId = feature.id;
            m.userData.bodyId = bodyId;
          }}
        />
      ))}
    </>
  );
}
