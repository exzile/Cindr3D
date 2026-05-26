import type { Feature } from '../../../../../types/cad';
import type { CADSliceContext } from '../../../sliceContext';
import type { CADState } from '../../../state';

export function createFaceFeatureDialogActions({ set, get }: CADSliceContext): Partial<CADState> {
  return {
    replaceFaceSourceId: null,
    replaceFaceTargetId: null,
    openReplaceFaceDialog: () => set({
      activeDialog: 'replace-face',
      replaceFaceSourceId: null,
      replaceFaceTargetId: null,
    }),
    setReplaceFaceSource: (id) => set({ replaceFaceSourceId: id }),
    setReplaceFaceTarget: (id) => set({ replaceFaceTargetId: id }),
    commitReplaceFace: () => {
      const { replaceFaceSourceId, replaceFaceTargetId, features, setActiveDialog } = get();
      if (!replaceFaceSourceId || !replaceFaceTargetId) return;
      const n = features.filter((f) => f.type === 'replace-face').length + 1;
      const feature: Feature = {
        id: crypto.randomUUID(),
        name: `Replace Face ${n}`,
        type: 'replace-face',
        params: { sourceId: replaceFaceSourceId, targetId: replaceFaceTargetId },
        visible: true,
        suppressed: false,
        timestamp: Date.now(),
      };
      get().addFeature(feature);
      setActiveDialog(null);
      set({ replaceFaceSourceId: null, replaceFaceTargetId: null });
    },

    directEditFaceId: null,
    openDirectEditDialog: () => set({
      activeDialog: 'direct-edit',
      directEditFaceId: null,
    }),
    setDirectEditFace: (id) => set({ directEditFaceId: id }),
    commitDirectEdit: (params) => {
      const { directEditFaceId, features, setActiveDialog } = get();
      get().pushUndo();
      const n = features.filter((f) => f.type === 'direct-edit').length + 1;
      const feature: Feature = {
        id: crypto.randomUUID(),
        name: `Direct Edit ${n}`,
        type: 'direct-edit',
        params: { faceId: directEditFaceId ?? '', ...params },
        visible: true,
        suppressed: false,
        timestamp: Date.now(),
      };
      get().addFeature(feature);
      setActiveDialog(null);
      set({ directEditFaceId: null });
    },

    textureExtrudeFaceId: null,
    openTextureExtrudeDialog: () => set({
      activeDialog: 'texture-extrude',
      textureExtrudeFaceId: null,
    }),
    setTextureExtrudeFace: (id) => set({ textureExtrudeFaceId: id }),
    commitTextureExtrude: (params) => {
      const { textureExtrudeFaceId, features, setActiveDialog } = get();
      const n = features.filter((f) => f.type === 'texture-extrude').length + 1;
      const feature: Feature = {
        id: crypto.randomUUID(),
        name: `Texture Extrude ${n}`,
        type: 'texture-extrude',
        params: { faceId: textureExtrudeFaceId ?? '', ...params },
        visible: true,
        suppressed: false,
        timestamp: Date.now(),
      };
      get().addFeature(feature);
      setActiveDialog(null);
      set({ textureExtrudeFaceId: null });
    },

    decalFaceId: null,
    decalFaceNormal: null,
    decalFaceCentroid: null,
    openDecalDialog: () => set({
      activeDialog: 'decal',
      decalFaceId: null,
      decalFaceNormal: null,
      decalFaceCentroid: null,
    }),
    setDecalFace: (id, normal, centroid) => set({
      decalFaceId: id,
      decalFaceNormal: normal,
      decalFaceCentroid: centroid,
    }),
    closeDecalDialog: () => set({
      activeDialog: null,
      decalFaceId: null,
      decalFaceNormal: null,
      decalFaceCentroid: null,
    }),
    commitDecal: (params) => {
      const { decalFaceId, decalFaceNormal, decalFaceCentroid, features, setActiveDialog } = get();
      const targetFeatureId = params.faceId ?? decalFaceId ?? '';
      if (!targetFeatureId || !decalFaceNormal || !decalFaceCentroid) {
        get().setStatusMessage('Decal: pick a face on a body first');
        return;
      }
      const n = features.filter((f) => f.type === 'decal').length + 1;
      const feature: Feature = {
        id: crypto.randomUUID(),
        name: `Decal ${n}`,
        type: 'decal',
        params: {
          ...params,
          faceId: targetFeatureId,
          targetFeatureId,
          point: decalFaceCentroid,
          normal: decalFaceNormal,
        },
        visible: true,
        suppressed: false,
        timestamp: Date.now(),
      };
      get().addFeature(feature);
      setActiveDialog(null);
      set({ decalFaceId: null, decalFaceNormal: null, decalFaceCentroid: null });
    },

    attachedCanvasId: null,
    openAttachedCanvasDialog: (canvasId) => set({
      activeDialog: 'attached-canvas',
      attachedCanvasId: canvasId ?? null,
    }),
    closeAttachedCanvasDialog: () => set({ activeDialog: null, attachedCanvasId: null }),
    updateCanvas: (id, changes) => set((state) => ({
      canvasReferences: state.canvasReferences.map((c) =>
        c.id === id ? { ...c, ...changes } : c
      ),
      features: state.features.map((f) => {
        if (f.id !== id) return f;
        return { ...f, params: { ...f.params, ...changes } };
      }),
    })),

    splitFaceId: null,
    openSplitFaceDialog: () => set({
      activeDialog: 'split-face',
      splitFaceId: null,
    }),
    setSplitFace: (id) => set({ splitFaceId: id }),
    closeSplitFaceDialog: () => set({ activeDialog: null, splitFaceId: null }),
    commitSplitFace: (params) => {
      const { splitFaceId, features, setActiveDialog } = get();
      const n = features.filter((f) => f.type === 'split-face').length + 1;
      const feature: Feature = {
        id: crypto.randomUUID(),
        name: `Split Face ${n}`,
        type: 'split-face',
        params: { ...params, faceId: params.faceId ?? splitFaceId ?? '' },
        visible: true,
        suppressed: false,
        timestamp: Date.now(),
      };
      get().addFeature(feature);
      setActiveDialog(null);
      set({ splitFaceId: null });
    },
  };
}
