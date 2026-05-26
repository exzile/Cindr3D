import * as THREE from 'three';
import { useComponentStore } from '../../../../componentStore';
import type { CADSliceContext } from '../../../sliceContext';
import type { CADState } from '../../../state';
import { bodyGeometryCache, bodyIdGeometryCache } from '../../../../../store/meshRegistry';
import { globalBRepBodyRegistry } from '../../../../../engine/occ/globalRegistry';
import { invalidateFeature } from '../../../../../engine/occ/featureEvaluator';
import { detachTessellationFromMesh } from '../../../../../engine/occ/picking';

export function createFeatureLifecycleRemovalActions({ set, get }: CADSliceContext): Partial<CADState> {
  return {
    removeFeature: (id) => {
      get().pushUndo();
      const target = get().features.find((f) => f.id === id);
      const removedSketchId = target?.type === 'sketch' ? target.sketchId : null;
      bodyGeometryCache.get(id)?.dispose();
      bodyGeometryCache.delete(id);
      for (const occBody of globalBRepBodyRegistry.getByFeature(id)) {
        globalBRepBodyRegistry.delete(occBody.id);
      }
      invalidateFeature(id);

      if (target?.bodyId) {
        const componentStore = useComponentStore.getState();
        const body = componentStore.bodies[target.bodyId];
        if (body) {
          const remaining = body.featureIds.filter((fid) => fid !== id);
          if (remaining.length === 0) {
            bodyIdGeometryCache.get(target.bodyId)?.dispose();
            bodyIdGeometryCache.delete(target.bodyId);
            componentStore.removeBody(target.bodyId);
          } else {
            componentStore.removeFeatureFromBody(target.bodyId, id);
          }
        }
      }

      set((state) => ({
        features: state.features.filter((f) => f.id !== id),
        ...(removedSketchId
          ? {
              sketches: state.sketches.filter((sketch) => sketch.id !== removedSketchId),
              activeSketch: state.activeSketch?.id === removedSketchId ? null : state.activeSketch,
              extrudeSelectedSketchId:
                state.extrudeSelectedSketchId?.split('::')[0] === removedSketchId ? null : state.extrudeSelectedSketchId,
              extrudeSelectedSketchIds: state.extrudeSelectedSketchIds.filter(
                (selectionId) => selectionId.split('::')[0] !== removedSketchId,
              ),
              revolveSelectedSketchId:
                state.revolveSelectedSketchId?.split('::')[0] === removedSketchId ? null : state.revolveSelectedSketchId,
            }
          : {}),
      }));

      const disposeMat = (mat: THREE.Material | THREE.Material[] | null | undefined) => {
        if (!mat) return;
        const arr = Array.isArray(mat) ? mat : [mat];
        for (const m of arr) {
          if (m?.userData?.shared) continue;
          m?.dispose?.();
        }
      };
      if (target?.mesh) {
        const m = target.mesh as THREE.Object3D;
        if (m instanceof THREE.Mesh) {
          m.geometry?.dispose();
          detachTessellationFromMesh(m);
          disposeMat(m.material);
        } else if (m instanceof THREE.Group) {
          m.traverse((child) => {
            if (child instanceof THREE.Mesh) {
              child.geometry?.dispose();
              detachTessellationFromMesh(child);
              disposeMat(child.material);
            }
          });
        }
      }
    },
  };
}
