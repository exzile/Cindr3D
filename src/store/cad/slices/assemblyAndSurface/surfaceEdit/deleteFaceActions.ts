import * as THREE from 'three';
import { GeometryEngine } from '../../../../../engine/GeometryEngine';
import type { CADSliceContext } from '../../../sliceContext';
import type { CADState } from '../../../state';
import { disposeMeshesDeferred } from '../../../../../engine/occ/picking';

export function createDeleteFaceActions({ set, get }: CADSliceContext): Partial<CADState> {
  return {
    showDeleteFaceDialog: false,
    deleteFaceIds: [],
    deleteFacePicks: [],
    openDeleteFaceDialog: () => set({
      activeDialog: 'delete-face',
      showDeleteFaceDialog: true,
      deleteFaceIds: [],
      deleteFacePicks: [],
    }),
    addDeleteFace: (id) =>
      set((s) => ({
        deleteFaceIds: s.deleteFaceIds.includes(id) ? s.deleteFaceIds : [...s.deleteFaceIds, id],
      })),
    addDeleteFacePick: (featureId, normal, centroid) =>
      set((s) => {
        const id = centroid.map((v) => v.toFixed(3)).join(',');
        if (s.deleteFaceIds.includes(id)) return {};
        return {
          deleteFaceIds: [...s.deleteFaceIds, id],
          deleteFacePicks: [...s.deleteFacePicks, { featureId, normal, centroid }],
        };
      }),
    clearDeleteFaces: () => set({ deleteFaceIds: [], deleteFacePicks: [] }),
    closeDeleteFaceDialog: () => set({
      activeDialog: null,
      showDeleteFaceDialog: false,
      deleteFaceIds: [],
      deleteFacePicks: [],
    }),
    commitDeleteFace: (params) => {
      const { features, deleteFacePicks } = get();
      if (deleteFacePicks.length === 0) {
        get().setStatusMessage('Delete Face: click one or more faces in the viewport first');
        return;
      }
      const byFeature = new Map<string, typeof deleteFacePicks>();
      for (const p of deleteFacePicks) {
        const arr = byFeature.get(p.featureId);
        if (arr) arr.push(p);
        else byFeature.set(p.featureId, [p]);
      }
      let removed = 0;
      const nextMesh = new Map<string, THREE.Mesh>();
      const originalMeshes: THREE.Mesh[] = [];
      for (const [featureId, picks] of byFeature) {
        const srcMesh = features.find((f) => f.id === featureId)?.mesh as THREE.Mesh | undefined;
        if (!srcMesh?.isMesh) continue;
        originalMeshes.push(srcMesh);
        let working = srcMesh;
        for (const p of picks) {
          const prev = working;
          working = GeometryEngine.removeFaceAndHeal(
            prev,
            new THREE.Vector3(...p.normal),
            new THREE.Vector3(...p.centroid),
          );
          if (prev !== srcMesh) prev.geometry.dispose();
          removed++;
        }
        working.castShadow = true;
        working.receiveShadow = true;
        nextMesh.set(featureId, working);
      }
      if (nextMesh.size === 0) {
        get().setStatusMessage('Delete Face: picked faces are not on a body');
        return;
      }
      get().pushUndo();
      set({
        features: features.map((f) =>
          nextMesh.has(f.id)
            ? { ...f, mesh: nextMesh.get(f.id)!, params: { ...f.params, deleteFaceHealMode: params.healMode } }
            : f,
        ),
        activeDialog: null,
        showDeleteFaceDialog: false,
        deleteFaceIds: [],
        deleteFacePicks: [],
      });
      disposeMeshesDeferred(originalMeshes);
      get().setStatusMessage(`Delete Face: removed ${removed} face${removed !== 1 ? 's' : ''}`);
    },
  };
}
