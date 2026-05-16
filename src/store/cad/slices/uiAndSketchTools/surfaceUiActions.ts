import * as THREE from 'three';
import type { Feature } from '../../../../types/cad';
import type { CADSliceContext } from '../../sliceContext';
import type { CADState } from '../../state';

export function createSurfaceUiActions({ set, get }: CADSliceContext): Partial<CADState> {
  return {
  // Ã¢â€â‚¬Ã¢â€â‚¬ CONSTRUCTION GEOMETRY (D175Ã¢â‚¬â€œD180) Ã¢â€â‚¬Ã¢â€â‚¬
  constructionPlanes: [],
  constructionAxes: [],
  constructionPoints: [],
  addConstructionPlane: (p) => set((state) => ({
    constructionPlanes: [
      ...state.constructionPlanes,
      {
        ...p,
        id: crypto.randomUUID(),
        name: 'Plane ' + (state.constructionPlanes.length + 1),
      },
    ],
  })),
  addConstructionAxis: (a) => set((state) => ({
    constructionAxes: [
      ...state.constructionAxes,
      {
        ...a,
        id: crypto.randomUUID(),
        name: 'Axis ' + (state.constructionAxes.length + 1),
      },
    ],
  })),
  addConstructionPoint: (p) => set((state) => ({
    constructionPoints: [
      ...state.constructionPoints,
      {
        ...p,
        id: crypto.randomUUID(),
        name: 'Point ' + (state.constructionPoints.length + 1),
      },
    ],
  })),
  cancelConstructTool: () => set({ activeTool: 'select' }),

  // Ã¢â€â‚¬Ã¢â€â‚¬ D171 Replace Face Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
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

  // Ã¢â€â‚¬Ã¢â€â‚¬ D123 Direct Edit Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
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

  // Ã¢â€â‚¬Ã¢â€â‚¬ D137 Texture Extrude Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
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

  // Ã¢â€â‚¬Ã¢â€â‚¬ D192 Decal Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  decalFaceId: null,
  decalFaceNormal: null,
  decalFaceCentroid: null,
  openDecalDialog: () => set({
    activeDialog: 'decal',
    decalFaceId: null,
    decalFaceNormal: null,
    decalFaceCentroid: null,
  }),
  setDecalFace: (id, normal, centroid) => set({ decalFaceId: id, decalFaceNormal: normal, decalFaceCentroid: centroid }),
  closeDecalDialog: () => set({ activeDialog: null, decalFaceId: null, decalFaceNormal: null, decalFaceCentroid: null }),
  commitDecal: (params) => {
    const { decalFaceId, decalFaceNormal, decalFaceCentroid, features, setActiveDialog } = get();
    // `decalFaceId` carries the picked body's *featureId* (set by the face
    // picker). The decal projects onto that body's mesh; render+geometry are
    // handled by the DecalProjections scene component from these params — we
    // deliberately do NOT set feature.mesh (ExtrudedBodies' material-override
    // effect would clobber the textured material).
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

  // Ã¢â€â‚¬Ã¢â€â‚¬ D193 Attached Canvas Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
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
    // Also update matching feature params
    features: state.features.map((f) => {
      if (f.id !== id) return f;
      return { ...f, params: { ...f.params, ...changes } };
    }),
  })),

  // Ã¢â€â‚¬Ã¢â€â‚¬ D182/D183 picker slices Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  lipGrooveEdgeId: null,
  setLipGrooveEdge: (id) => set({ lipGrooveEdgeId: id }),
  snapFitFaceId: null,
  setSnapFitFace: (id) => set({ snapFitFaceId: id }),

  // Ã¢â€â‚¬Ã¢â€â‚¬ D185 Split Face Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
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

  // Ã¢â€â‚¬Ã¢â€â‚¬ Hole face placement Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
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

  // Ã¢â€â‚¬Ã¢â€â‚¬ SOL-I2: Shell face removal selection Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  shellRemoveFaceIds: [],
  addShellRemoveFace: (id) => set((state) => ({
    shellRemoveFaceIds: state.shellRemoveFaceIds.includes(id)
      ? state.shellRemoveFaceIds
      : [...state.shellRemoveFaceIds, id],
  })),
  removeShellRemoveFace: (id) => set((state) => ({
    shellRemoveFaceIds: state.shellRemoveFaceIds.filter((x) => x !== id),
  })),
  clearShellRemoveFaces: () => set({ shellRemoveFaceIds: [] }),

  // Ã¢â€â‚¬Ã¢â€â‚¬ SOL-I7: Shell individual face thickness overrides Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  shellFaceThicknesses: {},
  setShellFaceThickness: (faceId, thickness) => set((state) => ({
    shellFaceThicknesses: { ...state.shellFaceThicknesses, [faceId]: thickness },
  })),
  clearShellFaceThicknesses: () => set({ shellFaceThicknesses: {} }),

  // Ã¢â€â‚¬Ã¢â€â‚¬ SOL-I3: Draft parting line face picker Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  draftPartingFaceId: null,
  draftPartingFaceNormal: null,
  draftPartingFaceCentroid: null,
  setDraftPartingFace: (id, normal, centroid) => set({
    draftPartingFaceId: id,
    draftPartingFaceNormal: normal,
    draftPartingFaceCentroid: centroid,
  }),
  clearDraftPartingFace: () => set({
    draftPartingFaceId: null,
    draftPartingFaceNormal: null,
    draftPartingFaceCentroid: null,
  }),

  // ── SOL-F2: Draft pull direction face picker ──────────────────────────
  draftPullFaceId: null,
  draftPullFaceNormal: null,
  draftPullFaceCentroid: null,
  draftPullFacePickActive: false,
  setDraftPullFace: (id, normal, centroid) => set({
    draftPullFaceId: id,
    draftPullFaceNormal: normal,
    draftPullFaceCentroid: centroid,
    draftPullFacePickActive: false,
  }),
  clearDraftPullFace: () => set({
    draftPullFaceId: null,
    draftPullFaceNormal: null,
    draftPullFaceCentroid: null,
    draftPullFacePickActive: false,
  }),
  setDraftPullFacePickActive: (v) => set({ draftPullFacePickActive: v }),

  // Ã¢â€â‚¬Ã¢â€â‚¬ SOL-I5: Remove Face face picker Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
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

  // Ã¢â€â‚¬Ã¢â€â‚¬ CTX-8: Mesh export trigger Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  exportBodyId: null,
  exportBodyFormat: null,
  triggerBodyExport: (bodyId, format) => set({ exportBodyId: bodyId, exportBodyFormat: format }),
  clearBodyExport: () => set({ exportBodyId: null, exportBodyFormat: null }),

  // Ã¢â€â‚¬Ã¢â€â‚¬ D183 Bounding Solid Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  openBoundingSolidDialog: () => set({ activeDialog: 'bounding-solid' }),
  closeBoundingSolidDialog: () => set({ activeDialog: null }),
  commitBoundingSolid: (params) => {
    const { features, setActiveDialog } = get();
    const { shape, padding } = params;
    const n = features.filter((f) => f.type === 'bounding-solid').length + 1;

    // Compute the combined Box3 of all feature meshes
    const box = new THREE.Box3();
    let hasGeometry = false;
    for (const f of features) {
      if (!f.mesh || !f.visible) continue;
      const b = new THREE.Box3().setFromObject(f.mesh);
      if (!b.isEmpty()) {
        box.union(b);
        hasGeometry = true;
      }
    }

    let geom: THREE.BufferGeometry;
    if (!hasGeometry) {
      // Fallback: unit box
      geom = new THREE.BoxGeometry(1, 1, 1);
    } else {
      box.expandByScalar(padding);
      const size = new THREE.Vector3();
      box.getSize(size);
      const center = new THREE.Vector3();
      box.getCenter(center);

      if (shape === 'box') {
        geom = new THREE.BoxGeometry(size.x, size.y, size.z);
      } else {
        // Cylinder: bounding sphere radius
        const sphere = new THREE.Sphere();
        box.getBoundingSphere(sphere);
        const r = sphere.radius;
        geom = new THREE.CylinderGeometry(r, r, size.y + padding * 2, 32);
      }

      const mat = new THREE.MeshStandardMaterial({ color: 0x4488ff, transparent: true, opacity: 0.3, wireframe: false });
      const mesh = new THREE.Mesh(geom, mat);

      const center2 = new THREE.Vector3();
      box.getCenter(center2);
      mesh.position.copy(center2);

      const feature: Feature = {
        id: crypto.randomUUID(),
        name: `Bounding Solid ${n}`,
        type: 'bounding-solid',
        params: { shape, padding },
        mesh,
        visible: true,
        suppressed: false,
        timestamp: Date.now(),
      };
      get().addFeature(feature);
      setActiveDialog(null);
      return;
    }

    // Fallback path (no geometry)
    const mat = new THREE.MeshStandardMaterial({ color: 0x4488ff, transparent: true, opacity: 0.3 });
    const mesh = new THREE.Mesh(geom, mat);
    const feature: Feature = {
      id: crypto.randomUUID(),
      name: `Bounding Solid ${n}`,
      type: 'bounding-solid',
      params: { shape, padding },
      mesh,
      visible: true,
      suppressed: false,
      timestamp: Date.now(),
    };
    get().addFeature(feature);
    setActiveDialog(null);
  },

  };
}
