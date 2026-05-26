import * as THREE from 'three';
import type { Feature } from '../../../../../types/cad';
import { errorMessage } from '../../../../../utils/errorHandling';
import type { CADSliceContext } from '../../../sliceContext';
import type { CADState } from '../../../state';
import { applyBodyBooleanAsync } from '../../featureManagement/bodyBoolean';
import { computeBoundaryFillGeometry, pickBoundaryFillTarget } from '../boundaryFillHelpers';

export function createBoundaryFillActions({ set, get }: CADSliceContext): Partial<CADState> {
  return {
    commitBoundaryFill: async (toolFeatureIds, operation) => {
      const { features } = get();
      const idSet = new Set(toolFeatureIds);
      const toolFeatures = toolFeatureIds
        .map((id) => features.find((f) => f.id === id))
        .filter((f): f is Feature => !!f && f.mesh instanceof THREE.Mesh);
      if (toolFeatures.length === 0) {
        get().setStatusMessage('Boundary Fill: no valid tool bodies selected');
        return;
      }

      let fillResult: Awaited<ReturnType<typeof computeBoundaryFillGeometry>>;
      try {
        fillResult = await computeBoundaryFillGeometry(toolFeatures);
      } catch (err) {
        get().setStatusMessage(`Boundary Fill failed: ${errorMessage(err, 'OCC fill error')}`);
        return;
      }
      const { geometry: fillGeom, brepBodyId: fillBodyId, note: fillNote } = fillResult;

      let resultGeom: THREE.BufferGeometry = fillGeom;
      let resultBrepBodyId: string | undefined = fillBodyId;
      const opNote = '';
      let consumedTargetId: string | undefined;
      if (operation === 'join' || operation === 'cut') {
        const target = pickBoundaryFillTarget(features, idSet);
        if (!target || !(target.mesh instanceof THREE.Mesh)) {
          fillGeom.dispose();
          get().setStatusMessage(`Boundary Fill ${operation} failed: OCC target body required`);
          return;
        } else if (fillBodyId) {
          const tempFillMesh = new THREE.Mesh(fillGeom);
          tempFillMesh.userData['brepBodyId'] = fillBodyId;
          const boolMesh = await applyBodyBooleanAsync(target.mesh, tempFillMesh, operation);
          if (boolMesh) {
            fillGeom.dispose();
            resultGeom = boolMesh.geometry;
            resultBrepBodyId = boolMesh.userData['brepBodyId'] as string | undefined;
            consumedTargetId = target.id;
          } else {
            fillGeom.dispose();
            get().setStatusMessage(`Boundary Fill ${operation} failed: OCC boolean failed`);
            return;
          }
        } else {
          fillGeom.dispose();
          get().setStatusMessage(`Boundary Fill ${operation} failed: OCC fill body required`);
          return;
        }
      }

      const fillMesh = new THREE.Mesh(resultGeom);
      fillMesh.castShadow = true;
      fillMesh.receiveShadow = true;
      const featureId = crypto.randomUUID();
      fillMesh.userData.pickable = true;
      fillMesh.userData.featureId = featureId;
      if (resultBrepBodyId) fillMesh.userData['brepBodyId'] = resultBrepBodyId;
      const n = features.filter((f) => f.params?.featureKind === 'boundary-fill').length + 1;
      const feature: Feature = {
        id: featureId,
        name: `Boundary Fill ${n}`,
        type: 'boundary-fill',
        params: {
          featureKind: 'boundary-fill',
          toolFeatureIds: toolFeatureIds.join(','),
          operation,
          isBoundaryFill: true,
          ...(consumedTargetId ? { targetFeatureId: consumedTargetId } : {}),
        },
        mesh: fillMesh,
        bodyKind: 'solid',
        visible: true,
        suppressed: false,
        timestamp: Date.now(),
      };
      get().pushUndo();
      set((state) => {
        const updated = consumedTargetId
          ? state.features.map((f) =>
              f.id === consumedTargetId ? { ...f, suppressed: true, visible: false } : f,
            )
          : state.features;
        return {
          features: [...updated, feature],
          statusMessage: `Boundary Fill ${n} (${operation})${fillNote}${opNote}`,
        };
      });
    },
  };
}
