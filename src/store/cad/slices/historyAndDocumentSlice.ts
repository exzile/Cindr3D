import * as THREE from 'three';
import type { Body, Component, Feature, FeatureGroup, Sketch, SketchEntity, SketchPlane } from '../../../types/cad';
import { GeometryEngine } from '../../../engine/GeometryEngine';
import { useComponentStore } from '../../componentStore';
import { deserializeFeature, deserializeSketch, serializeFeature } from '../persistence';
import { snapshotCADState } from '../historyUtils';
import type { CADSliceContext } from '../sliceContext';
import type { CADState } from '../state';
import type { DesignConfiguration } from '../state/coreState';

type HistorySketch = Sketch & {
  planeNormal: [number, number, number] | null;
  planeOrigin: [number, number, number] | null;
};

type HistorySnapshot = {
  features: Feature[];
  sketches: HistorySketch[];
  activeSketch?: HistorySketch | null;
  featureGroups: FeatureGroup[];
  designConfigurations?: DesignConfiguration[];
  activeDesignConfigurationId?: string;
  componentStore?: {
    rootComponentId: string;
    activeComponentId: string | null;
    selectedBodyId: string | null;
    components: Record<string, Component & { transform: number[] | { elements?: number[] } }>;
    bodies: Record<string, Body>;
  };
};

const restoreComponentStoreSnapshot = (snapshot: HistorySnapshot['componentStore']) => {
  if (!snapshot) return;

  useComponentStore.setState({
    rootComponentId: snapshot.rootComponentId,
    activeComponentId: snapshot.activeComponentId ?? snapshot.rootComponentId,
    selectedBodyId: snapshot.selectedBodyId,
    components: Object.fromEntries(Object.entries(snapshot.components).map(([id, component]) => {
      const rawTransform = component.transform;
      const transformArray = Array.isArray(rawTransform) ? rawTransform : rawTransform?.elements;
      return [
        id,
        {
          ...component,
          transform: Array.isArray(transformArray)
            ? new THREE.Matrix4().fromArray(transformArray)
            : new THREE.Matrix4(),
        },
      ];
    })),
    bodies: Object.fromEntries(Object.entries(snapshot.bodies).map(([id, body]) => [
      id,
      { ...body, mesh: null },
    ])),
  });
};

export function createHistoryAndDocumentSlice({ set, get }: CADSliceContext) {
  const slice: Partial<CADState> = {
  historyEnabled: true,
  toggleHistoryMode: () => {
    const next = !get().historyEnabled;
    set({
      historyEnabled: next,
      statusMessage: next
        ? 'Parametric mode — design history recording resumed'
        : 'Direct Modeling mode — design history not captured',
    });
  },

  // ── MM2 — Undo / Redo ────────────────────────────────────────────────────
  undoStack: [],
  redoStack: [],

  pushUndo: () => {
    const state = get();
    const snapshot = snapshotCADState(state);
    const next = [...state.undoStack, snapshot];
    set({ undoStack: next.length > 50 ? next.slice(next.length - 50) : next, redoStack: [] });
  },

  undo: () => {
    const state = get();
    if (state.undoStack.length === 0) return;
    const currentSnapshot = snapshotCADState(state);
    const stack = [...state.undoStack];
    const snapshot = stack.pop()!;
    try {
      const parsed = JSON.parse(snapshot) as HistorySnapshot;
      if (!parsed || !Array.isArray(parsed.features)) {
        throw new Error('Invalid snapshot: missing features array');
      }
      if (!Array.isArray(parsed.sketches)) {
        throw new Error('Invalid snapshot: missing sketches array');
      }
      // Carry over the live mesh from the current state when the same feature
      // id is being restored. Parametric features (extrude/revolve) rebuild
      // from sketch+params downstream, but mesh-op / import features have NO
      // source data — without this lookup, undo permanently destroys their
      // geometry. Map lookup keeps undo→redo round-trips loss-free as long as
      // the original mesh is still alive somewhere in the live state.
      const liveMeshById = new Map<string, Feature['mesh']>();
      for (const f of state.features) if (f.mesh) liveMeshById.set(f.id, f.mesh);
      const restoredSketches = parsed.sketches.map((s) => deserializeSketch(s as unknown as Sketch));
      const restoredActiveSketch = parsed.activeSketch
        ? deserializeSketch(parsed.activeSketch as unknown as Sketch)
        : null;
      restoreComponentStoreSnapshot(parsed.componentStore);
      set({
        undoStack: stack,
        redoStack: [...state.redoStack, currentSnapshot],
        features: parsed.features.map((f) => {
          const restored = deserializeFeature(f as Feature);
          const live = liveMeshById.get(restored.id);
          return live ? { ...restored, mesh: live } : restored;
        }),
        sketches: restoredSketches,
        activeSketch: restoredActiveSketch,
        featureGroups: parsed.featureGroups,
        designConfigurations: parsed.designConfigurations ?? state.designConfigurations,
        activeDesignConfigurationId: parsed.activeDesignConfigurationId ?? state.activeDesignConfigurationId,
        statusMessage: 'Undo',
      });
    } catch {
      // Malformed snapshot — POP it so the next undo doesn't hit the same
      // broken entry forever. Without `set({ undoStack: stack })` the failed
      // pop above is undone for the next call.
      set({ undoStack: stack, statusMessage: 'Undo: corrupted snapshot skipped' });
    }
  },

  redo: () => {
    const state = get();
    if (state.redoStack.length === 0) return;
    const currentSnapshot = snapshotCADState(state);
    const stack = [...state.redoStack];
    const snapshot = stack.pop()!;
    try {
      const parsed = JSON.parse(snapshot) as HistorySnapshot;
      if (!parsed || !Array.isArray(parsed.features)) {
        throw new Error('Invalid snapshot: missing features array');
      }
      if (!Array.isArray(parsed.sketches)) {
        throw new Error('Invalid snapshot: missing sketches array');
      }
      const liveMeshById = new Map<string, Feature['mesh']>();
      for (const f of state.features) if (f.mesh) liveMeshById.set(f.id, f.mesh);
      const restoredSketches = parsed.sketches.map((s) => deserializeSketch(s as unknown as Sketch));
      const restoredActiveSketch = parsed.activeSketch
        ? deserializeSketch(parsed.activeSketch as unknown as Sketch)
        : null;
      restoreComponentStoreSnapshot(parsed.componentStore);
      set({
        redoStack: stack,
        undoStack: [...state.undoStack, currentSnapshot],
        features: parsed.features.map((f) => {
          const restored = deserializeFeature(f as Feature);
          const live = liveMeshById.get(restored.id);
          return live ? { ...restored, mesh: live } : restored;
        }),
        sketches: restoredSketches,
        activeSketch: restoredActiveSketch,
        featureGroups: parsed.featureGroups,
        designConfigurations: parsed.designConfigurations ?? state.designConfigurations,
        activeDesignConfigurationId: parsed.activeDesignConfigurationId ?? state.activeDesignConfigurationId,
        statusMessage: 'Redo',
      });
    } catch {
      // Malformed snapshot — pop it so the user can keep redoing past it.
      set({ redoStack: stack, statusMessage: 'Redo: corrupted snapshot skipped' });
    }
  },

  // ── SLD7 — Linear Pattern ─────────────────────────────────────────────────
  commitLinearPattern: (featureId, params) => {
    const { features } = get();
    const srcFeature = features.find((f) => f.id === featureId);
    const srcMesh = srcFeature?.mesh as THREE.Mesh | undefined;
    if (!srcFeature || !srcMesh?.isMesh) {
      get().setStatusMessage('Linear Pattern: no mesh found for selected feature');
      return;
    }
    get().pushUndo();
    const copies = GeometryEngine.linearPattern(srcMesh, params);
    const newFeatures: Feature[] = copies.map((copy, idx) => ({
      id: crypto.randomUUID(),
      name: `${srcFeature.name} (Pattern ${idx + 2})`,
      type: 'primitive' as Feature['type'],
      params: { featureKind: 'linear-pattern-copy', sourceFeatureId: featureId, index: idx + 2 },
      mesh: copy,
      visible: true,
      suppressed: false,
      timestamp: Date.now(),
      bodyKind: srcFeature.bodyKind ?? 'solid',
    }));
    set({ features: [...features, ...newFeatures] });
    get().setStatusMessage(`Linear Pattern: created ${copies.length} copies`);
  },

  // ── SLD8 — Circular Pattern ───────────────────────────────────────────────
  commitCircularPattern: (featureId, params) => {
    const { features } = get();
    const srcFeature = features.find((f) => f.id === featureId);
    const srcMesh = srcFeature?.mesh as THREE.Mesh | undefined;
    if (!srcFeature || !srcMesh?.isMesh) {
      get().setStatusMessage('Circular Pattern: no mesh found for selected feature');
      return;
    }
    get().pushUndo();
    const copies = GeometryEngine.circularPattern(srcMesh, params);
    const newFeatures: Feature[] = copies.map((copy, idx) => ({
      id: crypto.randomUUID(),
      name: `${srcFeature.name} (Pattern ${idx + 2})`,
      type: 'primitive' as Feature['type'],
      params: { featureKind: 'circular-pattern-copy', sourceFeatureId: featureId, index: idx + 2 },
      mesh: copy,
      visible: true,
      suppressed: false,
      timestamp: Date.now(),
      bodyKind: srcFeature.bodyKind ?? 'solid',
    }));
    set({ features: [...features, ...newFeatures] });
    get().setStatusMessage(`Circular Pattern: created ${copies.length} copies`);
  },

  // ── MSH2 — Plane Cut ─────────────────────────────────────────────────────
  commitPlaneCut: (featureId, planeNormal, planeOffset, keepSide) => {
    if (
      !Number.isFinite(planeOffset) ||
      !Number.isFinite(planeNormal.x) ||
      !Number.isFinite(planeNormal.y) ||
      !Number.isFinite(planeNormal.z)
    ) {
      get().setStatusMessage('Plane Cut: invalid plane parameters (non-finite values)');
      return;
    }
    const { features } = get();
    const srcFeature = features.find((f) => f.id === featureId);
    const srcMesh = srcFeature?.mesh as THREE.Mesh | undefined;
    if (!srcFeature || !srcMesh?.isMesh) {
      get().setStatusMessage('Plane Cut: no mesh found for selected feature');
      return;
    }
    get().pushUndo();
    const result = GeometryEngine.planeCutMesh(srcMesh, planeNormal, planeOffset, keepSide);
    const n = features.filter((f) => f.params?.featureKind === 'plane-cut').length + 1;
    const newFeature: Feature = {
      id: crypto.randomUUID(),
      name: `Plane Cut ${n}`,
      type: 'split-body' as Feature['type'],
      params: {
        featureKind: 'plane-cut',
        sourceFeatureId: featureId,
        normalX: planeNormal.x, normalY: planeNormal.y, normalZ: planeNormal.z,
        offset: planeOffset, keepSide,
      },
      mesh: result,
      visible: true,
      suppressed: false,
      timestamp: Date.now(),
      bodyKind: srcFeature.bodyKind ?? 'mesh',
    };
    const nextFeatures = features.map((f) =>
      f.id === featureId ? { ...f, visible: false } : f,
    );
    set({ features: [...nextFeatures, newFeature] });
    get().setStatusMessage(`Plane Cut ${n}: applied`);
  },

  // ── MSH3 — Make Closed Mesh ──────────────────────────────────────────────
  commitMakeClosedMesh: (featureId) => {
    const { features } = get();
    const srcFeature = features.find((f) => f.id === featureId);
    const srcMesh = srcFeature?.mesh as THREE.Mesh | undefined;
    if (!srcFeature || !srcMesh?.isMesh) {
      get().setStatusMessage('Make Closed Mesh: no mesh found for selected feature');
      return;
    }
    const result = GeometryEngine.makeClosedMesh(srcMesh);
    const n = features.filter((f) => f.params?.featureKind === 'make-closed-mesh').length + 1;
    const newFeature: Feature = {
      id: crypto.randomUUID(),
      name: `Closed Mesh ${n}`,
      type: 'import' as Feature['type'],
      params: { featureKind: 'make-closed-mesh', sourceFeatureId: featureId },
      mesh: result,
      visible: true,
      suppressed: false,
      timestamp: Date.now(),
      bodyKind: 'mesh',
    };
    const nextFeatures = features.map((f) =>
      f.id === featureId ? { ...f, visible: false } : f,
    );
    set({ features: [...nextFeatures, newFeature] });
    get().setStatusMessage(`Closed Mesh ${n}: holes filled`);
  },

  // ── MSH5 — Mesh Smooth ───────────────────────────────────────────────────
  commitMeshSmooth: (featureId, iterations, factor) => {
    const { features } = get();
    const srcFeature = features.find((f) => f.id === featureId);
    const srcMesh = srcFeature?.mesh as THREE.Mesh | undefined;
    if (!srcFeature || !srcMesh?.isMesh) {
      get().setStatusMessage('Mesh Smooth: no mesh found for selected feature');
      return;
    }
    const result = GeometryEngine.smoothMesh(srcMesh, iterations, factor);
    const n = features.filter((f) => f.params?.featureKind === 'mesh-smooth').length + 1;
    const newFeature: Feature = {
      id: crypto.randomUUID(),
      name: `Mesh Smooth ${n}`,
      type: 'import' as Feature['type'],
      params: { featureKind: 'mesh-smooth', sourceFeatureId: featureId, iterations, factor },
      mesh: result,
      visible: true,
      suppressed: false,
      timestamp: Date.now(),
      bodyKind: 'mesh',
    };
    const nextFeatures = features.map((f) =>
      f.id === featureId ? { ...f, visible: false } : f,
    );
    set({ features: [...nextFeatures, newFeature] });
    get().setStatusMessage(`Mesh Smooth ${n}: ${iterations} iterations`);
  },

  // ── MSH10 — Separate ─────────────────────────────────────────────────────
  commitMeshSeparate: (featureId) => {
    const { features } = get();
    const srcFeature = features.find((f) => f.id === featureId);
    const srcMesh = srcFeature?.mesh as THREE.Mesh | undefined;
    if (!srcFeature || !srcMesh?.isMesh) {
      get().setStatusMessage('Mesh Separate: no mesh found for selected feature');
      return;
    }
    const geos = GeometryEngine.unstitchSurface(srcMesh);
    if (geos.length === 0) {
      get().setStatusMessage('Mesh separate failed: no parts produced');
      return;
    }
    const newFeatures: Feature[] = geos.map((geo, idx) => {
      const mat = new THREE.MeshPhysicalMaterial({
        color: 0x8899aa, metalness: 0.3, roughness: 0.4, side: THREE.DoubleSide,
      });
      const partMesh = new THREE.Mesh(geo, mat);
      partMesh.castShadow = true;
      partMesh.receiveShadow = true;
      return {
        id: crypto.randomUUID(),
        name: `${srcFeature.name} Part ${idx + 1}`,
        type: 'split-body' as Feature['type'],
        params: { featureKind: 'mesh-separate', sourceFeatureId: featureId, partIndex: idx },
        mesh: partMesh,
        visible: true,
        suppressed: false,
        timestamp: Date.now(),
        bodyKind: srcFeature.bodyKind ?? 'mesh',
      };
    });
    const nextFeatures = features
      .filter((f) => f.id !== featureId)
      .concat(newFeatures);
    set({ features: nextFeatures });
    // Dispose the source mesh's geometry — unstitchSurface produced fresh
    // BufferGeometries for each part, so the source is now an orphan.
    // Skip materials tagged userData.shared (singletons from GeometryEngine).
    if (srcMesh.geometry) srcMesh.geometry.dispose();
    const srcMat = srcMesh.material;
    const matArr = Array.isArray(srcMat) ? srcMat : [srcMat];
    for (const mm of matArr) {
      if (mm?.userData?.shared) continue;
      mm?.dispose?.();
    }
    get().setStatusMessage(`Mesh Separate: split into ${newFeatures.length} parts`);
  },

  // ── MSH13 — Mesh Section Sketch ──────────────────────────────────────────
  commitMeshSectionSketch: (featureId, plane) => {
    const { features, sketches } = get();
    const srcFeature = features.find((f) => f.id === featureId);
    const srcMesh = srcFeature?.mesh as THREE.Mesh | undefined;
    if (!srcFeature || !srcMesh?.isMesh) {
      get().setStatusMessage('Mesh Section Sketch: no mesh found for selected feature');
      return;
    }
    const segments = GeometryEngine.meshSectionSketch(srcMesh, plane);
    const entities: SketchEntity[] = segments.map(([a, b]) => ({
      id: crypto.randomUUID(),
      type: 'line' as SketchEntity['type'],
      points: [
        { id: crypto.randomUUID(), x: a.x, y: a.y, z: a.z },
        { id: crypto.randomUUID(), x: b.x, y: b.y, z: b.z },
      ],
    }));
    const n = sketches.filter((s) => s.name.startsWith('Section Sketch')).length + 1;
    const newSketch: Sketch = {
      id: crypto.randomUUID(),
      name: `Section Sketch ${n}`,
      plane: 'XY' as SketchPlane,
      planeNormal: plane.normal.clone(),
      planeOrigin: new THREE.Vector3().copy(plane.normal).multiplyScalar(-plane.constant),
      entities,
      constraints: [],
      dimensions: [],
      fullyConstrained: false,
    };
    set({ sketches: [...sketches, newSketch] });
    get().setStatusMessage(`Mesh Section Sketch ${n}: ${entities.length} segments`);
  },

  // ── UTL2 — Save / Load ───────────────────────────────────────────────────
  newDocument: () => {
    set({
      // Geometry content
      features: [],
      sketches: [],
      featureGroups: [],
      constructionPlanes: [],
      constructionAxes: [],
      constructionPoints: [],
      jointOrigins: [],
      contactSets: [],
      canvasReferences: [],
      parameters: [],
      // History
      undoStack: [],
      redoStack: [],
      // Selection / active state
      selectedEntityIds: [],
      selectedFeatureId: null,
      activeSketch: null,
      activeTool: 'select',
      activeDialog: null,
      dialogPayload: null,
      sketchPlaneSelecting: false,
      rollbackIndex: -1,
      statusMessage: 'New document',
    });
  },

  getDesignJSON: () => {
    const state = get();
    const saveObj = {
      version: 1,
      features: state.features.map((f) => serializeFeature(f)),
      sketches: state.sketches.map((s) => ({
        ...s,
        planeNormal: s.planeNormal ? [s.planeNormal.x, s.planeNormal.y, s.planeNormal.z] : null,
        planeOrigin: s.planeOrigin ? [s.planeOrigin.x, s.planeOrigin.y, s.planeOrigin.z] : null,
      })),
      featureGroups: state.featureGroups,
      historyEnabled: state.historyEnabled,
    };
    return JSON.stringify(saveObj, null, 2);
  },

  saveToFile: (filename = 'design.dznd') => {
    const json = get().getDesignJSON();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeName = filename.endsWith('.dznd') ? filename : `${filename}.dznd`;
    a.download = safeName;
    a.click();
    URL.revokeObjectURL(url);
    get().setStatusMessage(`Design saved: ${safeName}`);
  },

  loadFromFile: (json: string) => {
    try {
      const parsed = JSON.parse(json) as {
        version: number;
        features: Feature[];
        sketches: Array<Sketch & { planeNormal: [number, number, number] | null; planeOrigin: [number, number, number] | null }>;
        featureGroups: FeatureGroup[];
        historyEnabled?: boolean;
      };
      if (!parsed || !Array.isArray(parsed.features)) {
        throw new Error('Invalid snapshot: missing features array');
      }
      if (!Array.isArray(parsed.sketches)) {
        throw new Error('Invalid snapshot: missing sketches array');
      }
      set({
        features: (parsed.features ?? []).map((f) => deserializeFeature(f)),
        sketches: (parsed.sketches ?? []).map((s) => deserializeSketch(s as unknown as Sketch)),
        featureGroups: parsed.featureGroups ?? [],
        historyEnabled: parsed.historyEnabled ?? true,
        statusMessage: 'Design loaded from file',
      });
    } catch {
      get().setStatusMessage('Load failed: invalid file format');
    }
  },

  // ── SLD1 — Rib (dialog-based) ─────────────────────────────────────────────
  };

  return slice;
}
