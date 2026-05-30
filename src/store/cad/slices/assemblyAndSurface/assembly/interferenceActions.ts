import * as THREE from 'three';
import type { Feature, InterferenceResult } from '../../../../../types/cad';
import { GeometryEngine } from '../../../../../engine/GeometryEngine';
import { BODY_MATERIAL } from '../../../../../components/viewport/scene/bodyMaterial';
import { getOccSync } from '../../../../../engine/occ/loader';
import { performOccBooleanWithInstance } from '../../../../../engine/occ/ops/booleanCore';
import { globalBRepBodyRegistry } from '../../../../../engine/occ/globalRegistry';
import { createRegisteredOccMesh } from '../../../../../engine/occ/registeredMesh';
import type { CADSliceContext } from '../../../sliceContext';
import type { CADState } from '../../../state';

export function createInterferenceActions({ set, get }: CADSliceContext): Partial<CADState> {
  return {
    showInterferenceDialog: false,
    interferenceResults: [],
    openInterferenceDialog: () => set({ activeDialog: 'interference', showInterferenceDialog: true }),
    closeInterferenceDialog: () => set({ activeDialog: null, showInterferenceDialog: false }),
    computeInterference: () => {
      const { features } = get();
      const solidFeatures = features.filter(
        (f) => f.mesh && f.visible && (!f.bodyKind || f.bodyKind === 'solid') && (f.mesh as THREE.Mesh).isMesh,
      );
      const results: InterferenceResult[] = [];
      for (let i = 0; i < solidFeatures.length; i++) {
        for (let j = i + 1; j < solidFeatures.length; j++) {
          const fA = solidFeatures[i];
          const fB = solidFeatures[j];
          const meshA = fA.mesh as THREE.Mesh;
          const meshB = fB.mesh as THREE.Mesh;
          const boxA = new THREE.Box3().setFromObject(meshA);
          const boxB = new THREE.Box3().setFromObject(meshB);
          let hasInterference = false;
          let intersectionCurveCount = 0;
          if (boxA.intersectsBox(boxB)) {
            const curves = GeometryEngine.computeMeshIntersectionCurve(meshA, meshB, 1e-3);
            hasInterference = curves.length > 0;
            intersectionCurveCount = curves.length;
          }
          results.push({
            bodyAName: fA.name,
            bodyBName: fB.name,
            hasInterference,
            intersectionCurveCount,
          });
        }
      }
      set({ interferenceResults: results });
    },
    commitInterferenceBodies: async () => {
      const { features } = get();
      const solidFeatures = features.filter(
        (f) => f.mesh && f.visible && (!f.bodyKind || f.bodyKind === 'solid') && (f.mesh as THREE.Mesh).isMesh,
      );
      const newFeatures: Feature[] = [];
      let baseIndex = features.filter((f) => f.name.startsWith('Interference')).length;
      for (let i = 0; i < solidFeatures.length; i++) {
        for (let j = i + 1; j < solidFeatures.length; j++) {
          const fA = solidFeatures[i];
          const fB = solidFeatures[j];
          const meshA = fA.mesh as THREE.Mesh;
          const meshB = fB.mesh as THREE.Mesh;
          const boxA = new THREE.Box3().setFromObject(meshA);
          const boxB = new THREE.Box3().setFromObject(meshB);
          if (!boxA.intersectsBox(boxB)) continue;
          const idA = meshA.userData['brepBodyId'] as string | undefined;
          const idB = meshB.userData['brepBodyId'] as string | undefined;
          const occ = getOccSync();
          if (!idA || !idB || !occ) continue;
          try {
            const bodyA = globalBRepBodyRegistry.get(idA);
            const bodyB = globalBRepBodyRegistry.get(idB);
            if (!bodyA || !bodyB) continue;
            const resultBody = performOccBooleanWithInstance(occ.oc, 'intersect', bodyA, bodyB);
            if (!resultBody) continue;
            const featureId = crypto.randomUUID();
            resultBody.sourceFeatureId = featureId;
            const mesh = createRegisteredOccMesh(occ.oc, resultBody, BODY_MATERIAL, featureId);
            const result = mesh.geometry;
            if (result.getAttribute('position').count > 6) {
              baseIndex += 1;
              const interferenceFeature: Feature = {
                id: featureId,
                name: `Interference ${baseIndex} (${fA.name} intersection ${fB.name})`,
                type: 'combine',
                params: {
                  featureKind: 'interference',
                  operation: 'intersect',
                  sourceIds: [fA.id, fB.id],
                },
                mesh,
                bodyKind: 'solid',
                visible: true,
                suppressed: false,
                timestamp: Date.now(),
              };
              newFeatures.push(interferenceFeature);
            } else {
              const bodyId = mesh.userData['brepBodyId'] as string | undefined;
              if (bodyId) globalBRepBodyRegistry.delete(bodyId);
              result.dispose();
            }
          } catch (err) {
            get().setStatusMessage(
              `Interference body (${fA.name} intersection ${fB.name}) skipped: ${
                err instanceof Error ? err.message : 'OCC error'
              }`,
            );
          }
        }
      }
      if (newFeatures.length === 0) {
        get().setStatusMessage('Interference: no overlapping volumes to create bodies from');
        return;
      }
      get().pushUndo();
      set((state) => ({
        features: [...state.features, ...newFeatures],
        statusMessage: `Created ${newFeatures.length} interference ${
          newFeatures.length === 1 ? 'body' : 'bodies'
        }`,
      }));
    },
  };
}
