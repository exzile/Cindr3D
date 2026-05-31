import type { CADSliceContext } from '../../../sliceContext';
import type { CADState } from '../../../state';

export function createFacePickerActions({ set }: CADSliceContext): Partial<CADState> {
  return {
    lipGrooveEdgeId: null,
    setLipGrooveEdge: (id) => set({ lipGrooveEdgeId: id }),
    snapFitFaceId: null,
    setSnapFitFace: (id) => set({ snapFitFaceId: id }),

    holeFaceId: null,
    holeFaceNormal: null,
    holeFaceCentroid: null,
    holeDraftDiameter: 5,
    holeDraftDepth: 10,
    openHoleDialog: () => set({
      activeDialog: 'hole',
      holeFaceId: null,
      holeFaceNormal: null,
      holeFaceCentroid: null,
      holeDraftDiameter: 5,
      holeDraftDepth: 10,
    }),
    setHoleFace: (id, normal, centroid) => set({
      holeFaceId: id,
      holeFaceNormal: normal,
      holeFaceCentroid: centroid,
    }),
    clearHoleFace: () => set({
      holeFaceId: null,
      holeFaceNormal: null,
      holeFaceCentroid: null,
    }),
    setHoleDraftDiameter: (d) => set({ holeDraftDiameter: d }),
    setHoleDraftDepth: (d) => set({ holeDraftDepth: d }),
    closeHoleDialog: () => set({
      activeDialog: null,
      holeFaceId: null,
      holeFaceNormal: null,
      holeFaceCentroid: null,
    }),

    shellRemoveFaceIds: [],
    shellRemoveFaceData: {},
    addShellRemoveFace: (id, data) => set((state) => ({
      shellRemoveFaceIds: state.shellRemoveFaceIds.includes(id)
        ? state.shellRemoveFaceIds
        : [...state.shellRemoveFaceIds, id],
      shellRemoveFaceData: data
        ? { ...state.shellRemoveFaceData, [id]: data }
        : state.shellRemoveFaceData,
    })),
    removeShellRemoveFace: (id) => set((state) => {
      const nextData = { ...state.shellRemoveFaceData };
      delete nextData[id];
      return {
        shellRemoveFaceIds: state.shellRemoveFaceIds.filter((x) => x !== id),
        shellRemoveFaceData: nextData,
      };
    }),
    clearShellRemoveFaces: () => set({ shellRemoveFaceIds: [], shellRemoveFaceData: {} }),

    shellTangentChain: true,
    setShellTangentChain: (v) => set({ shellTangentChain: v }),

    shellFaceThicknesses: {},
    setShellFaceThickness: (faceId, thickness) => set((state) => ({
      shellFaceThicknesses: { ...state.shellFaceThicknesses, [faceId]: thickness },
    })),
    clearShellFaceThicknesses: () => set({ shellFaceThicknesses: {} }),

    draftPartingFaceId: null,
    draftPartingOccBodyId: null,
    draftPartingOccFaceId: null,
    draftPartingFaceNormal: null,
    draftPartingFaceCentroid: null,
    setDraftPartingFace: (id, normal, centroid, occ) => set({
      draftPartingFaceId: id,
      draftPartingOccBodyId: occ?.bodyId ?? null,
      draftPartingOccFaceId: occ?.faceId ?? null,
      draftPartingFaceNormal: normal,
      draftPartingFaceCentroid: centroid,
    }),
    clearDraftPartingFace: () => set({
      draftPartingFaceId: null,
      draftPartingOccBodyId: null,
      draftPartingOccFaceId: null,
      draftPartingFaceNormal: null,
      draftPartingFaceCentroid: null,
    }),

    draftPullFaceId: null,
    draftPullOccBodyId: null,
    draftPullOccFaceId: null,
    draftPullFaceNormal: null,
    draftPullFaceCentroid: null,
    draftPullFacePickActive: false,
    setDraftPullFace: (id, normal, centroid, occ) => set({
      draftPullFaceId: id,
      draftPullOccBodyId: occ?.bodyId ?? null,
      draftPullOccFaceId: occ?.faceId ?? null,
      draftPullFaceNormal: normal,
      draftPullFaceCentroid: centroid,
      draftPullFacePickActive: false,
    }),
    clearDraftPullFace: () => set({
      draftPullFaceId: null,
      draftPullOccBodyId: null,
      draftPullOccFaceId: null,
      draftPullFaceNormal: null,
      draftPullFaceCentroid: null,
      draftPullFacePickActive: false,
    }),
    setDraftPullFacePickActive: (v) => set({ draftPullFacePickActive: v }),

    offsetFaceId: null,
    offsetOccBodyId: null,
    offsetOccFaceId: null,
    offsetFaceNormal: null,
    offsetFaceCentroid: null,
    offsetFaceIds: [],
    offsetFaceOccPairs: [],
    setOffsetFace: (id, normal, centroid, occ) => set({
      offsetFaceId: id,
      offsetOccBodyId: occ?.bodyId ?? null,
      offsetOccFaceId: occ?.faceId ?? null,
      offsetFaceNormal: normal,
      offsetFaceCentroid: centroid,
    }),
    addOffsetFace: (id, occ) => set((state) => {
      if (state.offsetFaceIds.includes(id)) return {};
      const nextPairs = occ
        ? [...state.offsetFaceOccPairs, { id, bodyId: occ.bodyId, faceId: occ.faceId }]
        : state.offsetFaceOccPairs;
      return {
        offsetFaceIds: [...state.offsetFaceIds, id],
        offsetFaceOccPairs: nextPairs,
      };
    }),
    removeOffsetFace: (id) => set((state) => ({
      offsetFaceIds: state.offsetFaceIds.filter((x) => x !== id),
      offsetFaceOccPairs: state.offsetFaceOccPairs.filter((p) => p.id !== id),
    })),
    clearOffsetFace: () => set({
      offsetFaceId: null,
      offsetOccBodyId: null,
      offsetOccFaceId: null,
      offsetFaceNormal: null,
      offsetFaceCentroid: null,
      offsetFaceIds: [],
      offsetFaceOccPairs: [],
    }),

    removeFaceFaceId: null,
    removeFaceFaceNormal: null,
    removeFaceFaceCentroid: null,
    setRemoveFaceFace: (id, normal, centroid) => set({
      removeFaceFaceId: id,
      removeFaceFaceNormal: normal,
      removeFaceFaceCentroid: centroid,
    }),
    clearRemoveFaceFace: () => set({
      removeFaceFaceId: null,
      removeFaceFaceNormal: null,
      removeFaceFaceCentroid: null,
    }),

    exportBodyId: null,
    exportBodyFormat: null,
    triggerBodyExport: (bodyId, format) => set({ exportBodyId: bodyId, exportBodyFormat: format }),
    clearBodyExport: () => set({ exportBodyId: null, exportBodyFormat: null }),
  };
}
