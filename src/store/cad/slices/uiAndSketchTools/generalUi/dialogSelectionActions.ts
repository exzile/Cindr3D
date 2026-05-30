import type { CADSliceContext } from "../../../sliceContext";
import type { CADState } from "../../../state";

export function createDialogSelectionActions({ set }: CADSliceContext): Partial<CADState> {
  return {
    showExportDialog: false,
    setShowExportDialog: (show) => set({ showExportDialog: show }),
    filletEdgeIds: [],
    addFilletEdge: (id) =>
      set((state) => ({
        filletEdgeIds: state.filletEdgeIds.includes(id)
          ? state.filletEdgeIds
          : [...state.filletEdgeIds, id],
      })),
    removeFilletEdge: (id) =>
      set((state) => ({
        filletEdgeIds: state.filletEdgeIds.filter((edgeId) => edgeId !== id),
      })),
    clearFilletEdges: () => set({ filletEdgeIds: [] }),
    filletLiveRadius: 2,
    setFilletLiveRadius: (radius) => set({ filletLiveRadius: Math.max(0.01, radius) }),
    filletFullRoundCenterFaceId: null,
    filletFullRoundCenterOccBodyId: null,
    filletFullRoundCenterOccFaceId: null,
    filletFullRoundSide1FaceId: null,
    filletFullRoundSide1OccFaceId: null,
    filletFullRoundSide2FaceId: null,
    filletFullRoundSide2OccFaceId: null,
    filletFullRoundPickSlot: null,
    setFilletFullRoundFace: (slot, faceId, occBodyId, occFaceId) => set(
      slot === "center"
        ? {
            filletFullRoundCenterFaceId: faceId,
            filletFullRoundCenterOccBodyId: occBodyId,
            filletFullRoundCenterOccFaceId: occFaceId,
            filletFullRoundPickSlot: null,
          }
        : slot === "side1"
          ? {
              filletFullRoundSide1FaceId: faceId,
              filletFullRoundSide1OccFaceId: occFaceId,
              filletFullRoundPickSlot: null,
            }
          : {
              filletFullRoundSide2FaceId: faceId,
              filletFullRoundSide2OccFaceId: occFaceId,
              filletFullRoundPickSlot: null,
            },
    ),
    clearFilletFullRoundFaces: () => set({
      filletFullRoundCenterFaceId: null,
      filletFullRoundCenterOccBodyId: null,
      filletFullRoundCenterOccFaceId: null,
      filletFullRoundSide1FaceId: null,
      filletFullRoundSide1OccFaceId: null,
      filletFullRoundSide2FaceId: null,
      filletFullRoundSide2OccFaceId: null,
      filletFullRoundPickSlot: null,
    }),
    setFilletFullRoundPickSlot: (slot) => set({ filletFullRoundPickSlot: slot }),
    chamferEdgeIds: [],
    addChamferEdge: (id) =>
      set((state) => ({
        chamferEdgeIds: state.chamferEdgeIds.includes(id)
          ? state.chamferEdgeIds
          : [...state.chamferEdgeIds, id],
      })),
    removeChamferEdge: (id) =>
      set((state) => ({
        chamferEdgeIds: state.chamferEdgeIds.filter((edgeId) => edgeId !== id),
      })),
    clearChamferEdges: () => set({ chamferEdgeIds: [] }),
    chamferLiveDistance: 2,
    setChamferLiveDistance: (distance) => set({ chamferLiveDistance: Math.max(0.01, distance) }),
    edgeModInvalidPreview: null,
    setEdgeModInvalidPreview: (value) => set({ edgeModInvalidPreview: value }),
    activeDialog: null,
    setActiveDialog: (dialog) =>
      set((state) => ({
        activeDialog: dialog,
        editingFeatureId: dialog === null ? null : state.editingFeatureId,
        filletEdgeIds: dialog === "fillet" ? [] : state.filletEdgeIds,
        filletLiveRadius: dialog === "fillet" ? 2 : state.filletLiveRadius,
        filletFullRoundCenterFaceId: dialog === "fillet" ? null : state.filletFullRoundCenterFaceId,
        filletFullRoundCenterOccBodyId: dialog === "fillet" ? null : state.filletFullRoundCenterOccBodyId,
        filletFullRoundCenterOccFaceId: dialog === "fillet" ? null : state.filletFullRoundCenterOccFaceId,
        filletFullRoundSide1FaceId: dialog === "fillet" ? null : state.filletFullRoundSide1FaceId,
        filletFullRoundSide1OccFaceId: dialog === "fillet" ? null : state.filletFullRoundSide1OccFaceId,
        filletFullRoundSide2FaceId: dialog === "fillet" ? null : state.filletFullRoundSide2FaceId,
        filletFullRoundSide2OccFaceId: dialog === "fillet" ? null : state.filletFullRoundSide2OccFaceId,
        filletFullRoundPickSlot: dialog === "fillet" ? null : state.filletFullRoundPickSlot,
        chamferEdgeIds: dialog === "chamfer" ? [] : state.chamferEdgeIds,
        chamferLiveDistance: dialog === "chamfer" ? 2 : state.chamferLiveDistance,
        // Clear the live red-flash preview whenever a dialog opens/closes.
        edgeModInvalidPreview: null,
      })),
    dialogPayload: null,
    setDialogPayload: (payload) => set({ dialogPayload: payload }),
    measurePoints: [],
    setMeasurePoints: (points) => set({ measurePoints: points }),
    clearMeasure: () => set({ measurePoints: [] }),
    statusMessage: "Ready",
    setStatusMessage: (message) => set({ statusMessage: message }),
    units: "mm",
    setUnits: (units) => set({ units }),
    selectionFilter: {
      bodies: true,
      faces: true,
      edges: true,
      vertices: true,
      sketches: true,
      construction: true,
    },
    setSelectionFilter: (filter) =>
      set((state) => ({ selectionFilter: { ...state.selectionFilter, ...filter } })),
    sketchGridEnabled: true,
    sketchSnapEnabled: true,
    setSketchGridEnabled: (value) => set({ sketchGridEnabled: value }),
    setSketchSnapEnabled: (value) => set({ sketchSnapEnabled: value }),
  };
}
