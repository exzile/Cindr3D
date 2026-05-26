import * as THREE from 'three';
import type { Feature } from '../../../../../types/cad';
import { GeometryEngine } from '../../../../../engine/GeometryEngine';
import { disposeMeshDeferred } from '../../../../../engine/occ/picking';
import { liveBodyMeshes } from '../../../../meshRegistry';
import type { CADSliceContext } from '../../../sliceContext';
import type { CADState } from '../../../state';
import { requireMesh } from '../advancedOpsUtils';

export function createSplitBodyActions({ set, get }: CADSliceContext): Partial<CADState> {
  return {
    commitSplitBody: ({ bodyFeatureId, toolType, toolId }) => {
      get().pushUndo();
      const { features } = get();
      const srcFeature = features.find((f) => f.id === bodyFeatureId);

      let srcMesh = srcFeature?.mesh as THREE.Mesh | undefined;
      if (!srcMesh?.isMesh) {
        for (const [, m] of liveBodyMeshes) {
          if ((m as THREE.Mesh).userData?.featureId === bodyFeatureId) {
            srcMesh = m as THREE.Mesh;
            break;
          }
        }
      }
      if (!srcFeature || !srcMesh?.isMesh) {
        get().setStatusMessage('Split Body: mesh not found for selected feature');
        return;
      }

      if (toolType !== 'plane') {
        get().setStatusMessage('Split Body: sketch/face splitting tools require a face or surface pick - use Silhouette Split for plane cuts');
        return;
      }

      const normals: Record<string, THREE.Vector3> = {
        XY: new THREE.Vector3(0, 0, 1),
        XZ: new THREE.Vector3(0, 1, 0),
        YZ: new THREE.Vector3(1, 0, 0),
      };
      const planeNormal = normals[toolId.toUpperCase()];
      if (!planeNormal) {
        get().setStatusMessage(`Split Body: unknown plane "${toolId}" - use XY, XZ, or YZ`);
        return;
      }

      const partA = GeometryEngine.planeCutMesh(srcMesh, planeNormal, 0, 'positive');
      const partB = GeometryEngine.planeCutMesh(srcMesh, planeNormal, 0, 'negative');
      partA.castShadow = true; partA.receiveShadow = true;
      partB.castShadow = true; partB.receiveShadow = true;

      const n = features.filter((f) => f.params?.featureKind === 'split-body-plane').length + 1;
      const featureA: Feature = {
        id: crypto.randomUUID(),
        name: `${srcFeature.name} Split ${n}A`,
        type: 'split-body' as Feature['type'],
        params: { featureKind: 'split-body-plane', sourceFeatureId: bodyFeatureId, half: 'positive', toolId },
        mesh: partA,
        visible: true,
        suppressed: false,
        timestamp: Date.now(),
        bodyKind: srcFeature.bodyKind ?? 'solid',
      };
      const featureB: Feature = {
        id: crypto.randomUUID(),
        name: `${srcFeature.name} Split ${n}B`,
        type: 'split-body' as Feature['type'],
        params: { featureKind: 'split-body-plane', sourceFeatureId: bodyFeatureId, half: 'negative', toolId },
        mesh: partB,
        visible: true,
        suppressed: false,
        timestamp: Date.now(),
        bodyKind: srcFeature.bodyKind ?? 'solid',
      };

      const nextFeatures = features.map((f) =>
        f.id === bodyFeatureId ? { ...f, visible: false } : f,
      );
      set({ features: [...nextFeatures, featureA, featureB] });
      disposeMeshDeferred(srcMesh);
      get().setStatusMessage(`Split Body ${n}: split by ${toolId} plane into two parts`);
    },

    commitSilhouetteSplit: (featureId, planeNormal, planeOffset) => {
      const { features } = get();
      const r = requireMesh(features, featureId, 'Split Body', get().setStatusMessage);
      if (!r) return;
      const { srcFeature, srcMesh } = r;
      const partA = GeometryEngine.planeCutMesh(srcMesh, planeNormal, planeOffset, 'positive');
      const partB = GeometryEngine.planeCutMesh(srcMesh, planeNormal, planeOffset, 'negative');
      partA.castShadow = true; partA.receiveShadow = true;
      partB.castShadow = true; partB.receiveShadow = true;
      const n = features.filter((f) => f.params?.featureKind === 'silhouette-split').length + 1;
      const featureA: Feature = {
        id: crypto.randomUUID(),
        name: `${srcFeature.name} Split ${n}A`,
        type: 'split-body' as Feature['type'],
        params: { featureKind: 'silhouette-split', sourceFeatureId: featureId, half: 'positive' },
        mesh: partA,
        visible: true,
        suppressed: false,
        timestamp: Date.now(),
        bodyKind: srcFeature.bodyKind ?? 'solid',
      };
      const featureB: Feature = {
        id: crypto.randomUUID(),
        name: `${srcFeature.name} Split ${n}B`,
        type: 'split-body' as Feature['type'],
        params: { featureKind: 'silhouette-split', sourceFeatureId: featureId, half: 'negative' },
        mesh: partB,
        visible: true,
        suppressed: false,
        timestamp: Date.now(),
        bodyKind: srcFeature.bodyKind ?? 'solid',
      };
      const nextFeatures = features.map((f) =>
        f.id === featureId ? { ...f, visible: false } : f,
      );
      set({ features: [...nextFeatures, featureA, featureB] });
      disposeMeshDeferred(srcMesh);
      get().setStatusMessage(`Split Body ${n}: split into two parts`);
    },
  };
}
