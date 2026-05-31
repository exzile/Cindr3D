import * as THREE from 'three';
import type { CADSliceContext } from '../../../sliceContext';
import type { CADState } from '../../../state';
import { getOccSync } from '../../../../../engine/occ/loader';
import { globalBRepBodyRegistry } from '../../../../../engine/occ/globalRegistry';
import { occTransformBodyWithInstance } from '../../../../../engine/occ/ops/transformBody';
import { createRegisteredOccMesh } from '../../../../../engine/occ/registeredMesh';
import { disposeMeshDeferred } from '../../../../../engine/occ/picking';
import { recomputeBooleanDependents } from '../featureBooleanUtils';
import type { Feature } from '../../../../../types/cad';

export interface MoveBodyParams {
  dx: number; dy: number; dz: number;
  rx: number; ry: number; rz: number;
  copy: boolean;
}

export function createMoveBodyActions({ set, get }: CADSliceContext): Partial<CADState> {
  return {
    commitMoveBody: (featureId: string, params: MoveBodyParams) => {
      const { features } = get();
      const feature = features.find(f => f.id === featureId);
      if (!feature) { get().setStatusMessage('Move: feature not found'); return; }
      const srcMesh = feature.mesh as THREE.Mesh | undefined;
      if (!srcMesh?.isMesh) { get().setStatusMessage('Move: no mesh'); return; }

      const { dx, dy, dz, rx, ry, rz, copy } = params;
      // Build transform matrix
      const rotMat = new THREE.Matrix4().makeRotationFromEuler(
        new THREE.Euler(
          THREE.MathUtils.degToRad(rx),
          THREE.MathUtils.degToRad(ry),
          THREE.MathUtils.degToRad(rz),
          'XYZ',
        ),
      );
      const transMat = new THREE.Matrix4().makeTranslation(dx, dy, dz);
      const M = new THREE.Matrix4().multiplyMatrices(transMat, rotMat);

      get().pushUndo();

      const brepBodyId = srcMesh.userData['brepBodyId'] as string | undefined;
      const occ = brepBodyId ? getOccSync() : null;
      const srcBody = occ && brepBodyId ? globalBRepBodyRegistry.get(brepBodyId) : null;

      const newId = copy ? crypto.randomUUID() : featureId;

      if (occ && srcBody) {
        const newBody = occTransformBodyWithInstance(occ.oc, srcBody, M, { sourceFeatureId: newId });
        if (newBody) {
          const newMesh = createRegisteredOccMesh(occ.oc, newBody, srcMesh.material, newId);
          newMesh.castShadow = true;
          newMesh.receiveShadow = true;
          if (copy) {
            const n = features.filter(f => f.name.includes(feature.name)).length;
            const newFeature: Feature = {
              ...feature,
              id: newId,
              name: `${feature.name} Copy ${n}`,
              mesh: newMesh,
              timestamp: Date.now(),
            };
            set({ features: [...features, newFeature], statusMessage: `Copied ${feature.name}` });
          } else {
            set({
              features: recomputeBooleanDependents(
                features.map(f => f.id === featureId ? { ...f, mesh: newMesh } : f),
                [featureId],
              ),
              statusMessage: `Moved ${feature.name}`,
            });
            disposeMeshDeferred(srcMesh);
          }
          return;
        }
      }

      // Fallback: THREE mesh only
      const geom = srcMesh.geometry.clone();
      geom.applyMatrix4(M);
      geom.computeVertexNormals();
      const newMesh = new THREE.Mesh(geom, srcMesh.material);
      newMesh.userData = { ...srcMesh.userData };
      delete newMesh.userData['brepBodyId']; // stale after geometry transform
      newMesh.castShadow = true;
      newMesh.receiveShadow = true;

      if (copy) {
        const n = features.filter(f => f.name.includes(feature.name)).length;
        const newFeature: Feature = {
          ...feature,
          id: newId,
          name: `${feature.name} Copy ${n}`,
          mesh: newMesh,
          timestamp: Date.now(),
        };
        set({ features: [...features, newFeature], statusMessage: `Copied ${feature.name}` });
      } else {
        set({
          features: recomputeBooleanDependents(
            features.map(f => f.id === featureId ? { ...f, mesh: newMesh } : f),
            [featureId],
          ),
          statusMessage: `Moved ${feature.name}`,
        });
        disposeMeshDeferred(srcMesh);
      }
    },
  };
}
