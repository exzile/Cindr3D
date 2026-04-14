import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import * as THREE from 'three';
import type { Tool, ViewMode, SketchPlane, Sketch, SketchEntity, Feature, Parameter } from '../types/cad';
import { evaluateExpression, resolveParameters } from '../utils/expressionEval';
import { GeometryEngine } from '../engine/GeometryEngine';

// ── IndexedDB storage adapter (same pattern as slicerStore) ────────────────
function openCadDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('dzign3d-cad', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

const idbStorage = {
  getItem: async (name: string): Promise<string | null> => {
    try {
      const db = await openCadDB();
      return new Promise((resolve) => {
        const tx  = db.transaction('kv', 'readonly');
        const req = tx.objectStore('kv').get(name);
        req.onsuccess = () => { db.close(); resolve(req.result ?? null); };
        req.onerror   = () => { db.close(); resolve(null); };
      });
    } catch { return null; }
  },
  setItem: async (name: string, value: string): Promise<void> => {
    try {
      const db = await openCadDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').put(value, name);
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror    = () => { db.close(); reject(tx.error); };
      });
    } catch { /* storage unavailable — silently skip */ }
  },
  removeItem: async (name: string): Promise<void> => {
    try {
      const db = await openCadDB();
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').delete(name);
      db.close();
    } catch { /* ignore */ }
  },
};

// ── THREE.js serialization helpers ─────────────────────────────────────────
/** Serialize a Sketch for JSON storage — converts THREE.Vector3 fields to {x,y,z} */
function serializeSketch(sketch: Sketch): any {
  return {
    ...sketch,
    planeNormal: { x: sketch.planeNormal.x, y: sketch.planeNormal.y, z: sketch.planeNormal.z },
    planeOrigin: { x: sketch.planeOrigin.x, y: sketch.planeOrigin.y, z: sketch.planeOrigin.z },
  };
}

/** Reconstruct THREE.Vector3 fields on a deserialized Sketch */
function deserializeSketch(raw: any): Sketch {
  return {
    ...raw,
    planeNormal: new THREE.Vector3(raw.planeNormal?.x ?? 0, raw.planeNormal?.y ?? 1, raw.planeNormal?.z ?? 0),
    planeOrigin: new THREE.Vector3(raw.planeOrigin?.x ?? 0, raw.planeOrigin?.y ?? 0, raw.planeOrigin?.z ?? 0),
  };
}

/** Serialize a Feature — strip the non-serializable mesh */
function serializeFeature(feature: Feature): any {
  const { mesh, ...rest } = feature;
  return rest;
}

/** Rebuild a Feature's mesh from its sketch data */
function rebuildFeatureMesh(feature: Feature, sketches: Sketch[]): Feature {
  if (feature.mesh) return feature; // already has a mesh
  const sketch = feature.sketchId ? sketches.find(s => s.id === feature.sketchId) : undefined;
  if (!sketch) return feature;

  try {
    if (feature.type === 'extrude') {
      const distance = (feature.params.distance as number) || 10;
      feature.mesh = GeometryEngine.extrudeSketch(sketch, distance) ?? undefined;
    } else if (feature.type === 'revolve') {
      const angle = ((feature.params.angle as number) || 360) * (Math.PI / 180);
      const axis = new THREE.Vector3(0, 1, 0);
      feature.mesh = GeometryEngine.revolveSketch(sketch, angle, axis) ?? undefined;
    }
  } catch {
    // Geometry reconstruction failed — feature will render without mesh
  }
  return feature;
}

interface CADState {
  // Tool state
  activeTool: Tool;
  setActiveTool: (tool: Tool) => void;

  // View state
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;

  // Workspace mode
  workspaceMode: 'design' | 'prepare';
  setWorkspaceMode: (mode: 'design' | 'prepare') => void;

  // Sketch state
  activeSketch: Sketch | null;
  sketches: Sketch[];
  sketchPlaneSelecting: boolean;  // true when user is picking a plane
  setSketchPlaneSelecting: (selecting: boolean) => void;
  startSketch: (plane: SketchPlane) => void;
  editSketch: (id: string) => void;
  finishSketch: () => void;
  cancelSketch: () => void;
  addSketchEntity: (entity: SketchEntity) => void;

  // Feature timeline
  features: Feature[];
  addFeature: (feature: Feature) => void;
  removeFeature: (id: string) => void;
  toggleFeatureVisibility: (id: string) => void;
  selectedFeatureId: string | null;
  setSelectedFeatureId: (id: string | null) => void;

  // Selection
  selectedEntityIds: string[];
  setSelectedEntityIds: (ids: string[]) => void;
  toggleEntitySelection: (id: string) => void;

  // Grid & snap
  gridSize: number;
  setGridSize: (size: number) => void;
  snapEnabled: boolean;
  setSnapEnabled: (enabled: boolean) => void;
  gridVisible: boolean;
  setGridVisible: (visible: boolean) => void;
  gridLocked: boolean;
  setGridLocked: (locked: boolean) => void;
  incrementalMove: boolean;
  setIncrementalMove: (enabled: boolean) => void;
  moveIncrement: number;
  setMoveIncrement: (value: number) => void;
  rotateIncrement: number;
  setRotateIncrement: (value: number) => void;

  // Visual style
  visualStyle: 'shaded' | 'shadedEdges' | 'wireframe' | 'hiddenLines';
  setVisualStyle: (style: 'shaded' | 'shadedEdges' | 'wireframe' | 'hiddenLines') => void;
  showEnvironment: boolean;
  setShowEnvironment: (show: boolean) => void;
  showShadows: boolean;
  setShowShadows: (show: boolean) => void;
  showReflections: boolean;
  setShowReflections: (show: boolean) => void;
  showGroundPlane: boolean;
  setShowGroundPlane: (show: boolean) => void;

  // Camera target orientation (for ViewCube animated transitions)
  cameraTargetQuaternion: THREE.Quaternion | null;
  setCameraTargetQuaternion: (q: THREE.Quaternion | null) => void;
  // Orbit pivot to lerp toward during the next animation (e.g. sketch origin
  // when entering sketch mode). Captured by CameraController on animation start.
  cameraTargetOrbit: THREE.Vector3 | null;
  setCameraTargetOrbit: (v: THREE.Vector3 | null) => void;

  // Extrude dialog
  showExtrudeDialog: boolean;
  setShowExtrudeDialog: (show: boolean) => void;
  extrudeDistance: number;
  setExtrudeDistance: (distance: number) => void;

  // Export dialog
  showExportDialog: boolean;
  setShowExportDialog: (show: boolean) => void;

  // Active feature dialog
  activeDialog: string | null;
  setActiveDialog: (dialog: string | null) => void;

  // Measure
  measurePoints: { x: number; y: number; z: number }[];
  setMeasurePoints: (pts: { x: number; y: number; z: number }[]) => void;
  clearMeasure: () => void;

  // Status
  statusMessage: string;
  setStatusMessage: (message: string) => void;

  // Units
  units: 'mm' | 'cm' | 'in';
  setUnits: (units: 'mm' | 'cm' | 'in') => void;

  // Camera
  cameraHomeCounter: number;
  triggerCameraHome: () => void;

  // Parameters
  parameters: Parameter[];
  addParameter: (name: string, expression: string, description?: string, group?: string) => void;
  updateParameter: (id: string, updates: Partial<Pick<Parameter, 'name' | 'expression' | 'description' | 'group'>>) => void;
  removeParameter: (id: string) => void;
  evaluateExpression: (expr: string) => number | null;
}

// Plane normals consistent with the visual selector (Three.js Y-up):
//   XY = horizontal ground plane  → normal points UP   = (0, 1, 0)
//   XZ = vertical front plane     → normal points FWD  = (0, 0, 1)
//   YZ = vertical side plane      → normal points RIGHT = (1, 0, 0)
function getPlaneNormal(plane: SketchPlane): THREE.Vector3 {
  switch (plane) {
    case 'XY': return new THREE.Vector3(0, 1, 0);  // horizontal (ground)
    case 'XZ': return new THREE.Vector3(0, 0, 1);  // vertical front
    case 'YZ': return new THREE.Vector3(1, 0, 0);  // vertical side
    default:   return new THREE.Vector3(0, 1, 0);
  }
}

export const useCADStore = create<CADState>()(persist((set, get) => ({
  activeTool: 'select',
  setActiveTool: (tool) => set({ activeTool: tool, measurePoints: [] }),

  viewMode: '3d',
  setViewMode: (mode) => set({ viewMode: mode }),

  workspaceMode: 'design',
  setWorkspaceMode: (mode) => set({ workspaceMode: mode }),

  activeSketch: null,
  sketches: [],
  sketchPlaneSelecting: false,
  setSketchPlaneSelecting: (selecting) => set({
    sketchPlaneSelecting: selecting,
    statusMessage: selecting ? 'Select a plane or planar face to start sketching' : 'Ready',
  }),
  startSketch: (plane) => {
    const sketch: Sketch = {
      id: crypto.randomUUID(),
      name: `Sketch ${get().sketches.length + 1}`,
      plane,
      planeNormal: getPlaneNormal(plane),
      planeOrigin: new THREE.Vector3(0, 0, 0),
      entities: [],
      constraints: [],
      dimensions: [],
      fullyConstrained: false,
    };

    // Compute camera orientation to look at the sketch plane from the normal direction.
    // For the horizontal XY plane the camera looks from above → up must be in-plane (not Y).
    const normal = getPlaneNormal(plane);
    const camDir = normal.clone().multiplyScalar(5);
    // Choose an "up" vector that lies in the sketch plane (can't be parallel to normal):
    //   XY (horizontal) → look from above → up = -Z  (south direction on ground)
    //   XZ (vertical front) → standard world up Y
    //   YZ (vertical side) → standard world up Y
    const up = plane === 'XY' ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(0, 1, 0);
    const m = new THREE.Matrix4();
    m.lookAt(camDir, new THREE.Vector3(0, 0, 0), up);
    const targetQuat = new THREE.Quaternion().setFromRotationMatrix(m);

    set({
      activeSketch: sketch,
      sketchPlaneSelecting: false,
      viewMode: 'sketch',
      activeTool: 'line',
      cameraTargetQuaternion: targetQuat,
      cameraTargetOrbit: new THREE.Vector3(0, 0, 0),
      statusMessage: `Sketching on ${plane} plane`,
    });
  },
  editSketch: (id) => {
    // If already editing a sketch, finish it first so it isn't lost
    if (get().activeSketch) get().finishSketch();

    const { sketches } = get();
    const sketch = sketches.find((s) => s.id === id);
    if (!sketch) return;

    // Reuse the same camera-orient logic as startSketch
    const normal = getPlaneNormal(sketch.plane);
    const camDir = normal.clone().multiplyScalar(5);
    const up = sketch.plane === 'XY' ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(0, 1, 0);
    const m = new THREE.Matrix4();
    m.lookAt(camDir, new THREE.Vector3(0, 0, 0), up);
    const targetQuat = new THREE.Quaternion().setFromRotationMatrix(m);

    set({
      // Pull the sketch out of the completed list and back into editing
      activeSketch: sketch,
      sketches: sketches.filter((s) => s.id !== id),
      sketchPlaneSelecting: false,
      viewMode: 'sketch',
      activeTool: 'line',
      cameraTargetQuaternion: targetQuat,
      cameraTargetOrbit: new THREE.Vector3(0, 0, 0),
      statusMessage: `Editing ${sketch.name} on ${sketch.plane} plane`,
    });
  },
  finishSketch: () => {
    const { activeSketch, sketches, features } = get();
    if (!activeSketch) return;

    if (activeSketch.entities.length > 0) {
      // Only create a new Feature entry when this sketch doesn't already have one.
      // When editing an existing sketch the feature is already in the timeline.
      const alreadyHasFeature = features.some((f) => f.sketchId === activeSketch.id);
      const newFeatures = alreadyHasFeature
        ? features
        : [
            ...features,
            {
              id: crypto.randomUUID(),
              name: activeSketch.name,
              type: 'sketch' as const,
              sketchId: activeSketch.id,
              params: { plane: activeSketch.plane },
              visible: true,
              suppressed: false,
              timestamp: Date.now(),
            },
          ];

      set({
        activeSketch: null,
        sketchPlaneSelecting: false,
        sketches: [...sketches, activeSketch],
        features: newFeatures,
        viewMode: '3d',
        activeTool: 'select',
        statusMessage: 'Sketch completed',
      });
    } else {
      // Empty sketch — just exit without saving to timeline.
      // If editing an existing sketch that had entities before, put it back as-is.
      const alreadyHasFeature = features.some((f) => f.sketchId === activeSketch.id);
      set({
        activeSketch: null,
        sketchPlaneSelecting: false,
        sketches: alreadyHasFeature ? [...sketches, activeSketch] : sketches,
        viewMode: '3d',
        activeTool: 'select',
        statusMessage: '',
      });
    }
  },
  cancelSketch: () => {
    const { activeSketch, sketches, features } = get();
    // If cancelling an edit of an existing sketch, restore it to the completed list
    // so it doesn't disappear from the browser permanently.
    const wasEditing = activeSketch ? features.some((f) => f.sketchId === activeSketch.id) : false;
    set({
      activeSketch: null,
      sketchPlaneSelecting: false,
      sketches: wasEditing && activeSketch ? [...sketches, activeSketch] : sketches,
      viewMode: '3d',
      activeTool: 'select',
      statusMessage: 'Sketch cancelled',
    });
  },
  addSketchEntity: (entity) => {
    const { activeSketch } = get();
    if (activeSketch) {
      set({
        activeSketch: {
          ...activeSketch,
          entities: [...activeSketch.entities, entity],
        },
      });
    }
  },

  features: [],
  addFeature: (feature) => set((state) => ({
    features: [...state.features, feature],
  })),
  removeFeature: (id) => set((state) => ({
    features: state.features.filter((f) => f.id !== id),
  })),
  toggleFeatureVisibility: (id) => set((state) => ({
    features: state.features.map((f) =>
      f.id === id ? { ...f, visible: !f.visible } : f
    ),
  })),
  selectedFeatureId: null,
  setSelectedFeatureId: (id) => set({ selectedFeatureId: id }),

  selectedEntityIds: [],
  setSelectedEntityIds: (ids) => set({ selectedEntityIds: ids }),
  toggleEntitySelection: (id) => set((state) => {
    const ids = state.selectedEntityIds;
    return {
      selectedEntityIds: ids.includes(id)
        ? ids.filter((i) => i !== id)
        : [...ids, id],
    };
  }),

  gridSize: 10,
  setGridSize: (size) => set({ gridSize: size }),
  snapEnabled: true,
  setSnapEnabled: (enabled) => set({ snapEnabled: enabled }),
  gridVisible: true,
  setGridVisible: (visible) => set({ gridVisible: visible }),
  gridLocked: false,
  setGridLocked: (locked) => set({ gridLocked: locked }),
  incrementalMove: false,
  setIncrementalMove: (enabled) => set({ incrementalMove: enabled }),
  moveIncrement: 1,
  setMoveIncrement: (value) => set({ moveIncrement: value }),
  rotateIncrement: 15,
  setRotateIncrement: (value) => set({ rotateIncrement: value }),

  visualStyle: 'shadedEdges',
  setVisualStyle: (style) => set({ visualStyle: style }),
  showEnvironment: true,
  setShowEnvironment: (show) => set({ showEnvironment: show }),
  showShadows: true,
  setShowShadows: (show) => set({ showShadows: show }),
  showReflections: true,
  setShowReflections: (show) => set({ showReflections: show }),
  showGroundPlane: true,
  setShowGroundPlane: (show) => set({ showGroundPlane: show }),

  cameraTargetQuaternion: null,
  setCameraTargetQuaternion: (q) => set({ cameraTargetQuaternion: q }),
  cameraTargetOrbit: null,
  setCameraTargetOrbit: (v) => set({ cameraTargetOrbit: v }),

  showExtrudeDialog: false,
  setShowExtrudeDialog: (show) => set({ showExtrudeDialog: show }),
  extrudeDistance: 10,
  setExtrudeDistance: (distance) => set({ extrudeDistance: distance }),

  showExportDialog: false,
  setShowExportDialog: (show) => set({ showExportDialog: show }),

  activeDialog: null,
  setActiveDialog: (dialog) => set({ activeDialog: dialog }),

  measurePoints: [],
  setMeasurePoints: (pts) => set({ measurePoints: pts }),
  clearMeasure: () => set({ measurePoints: [] }),

  statusMessage: 'Ready',
  setStatusMessage: (message) => set({ statusMessage: message }),

  units: 'mm',
  setUnits: (units) => set({ units: units }),

  cameraHomeCounter: 0,
  triggerCameraHome: () => set((state) => ({ cameraHomeCounter: state.cameraHomeCounter + 1 })),

  parameters: [],
  addParameter: (name, expression, description, group) => {
    const newParam: Parameter = {
      id: crypto.randomUUID(),
      name,
      expression,
      value: NaN,
      description,
      group,
    };
    set((state) => ({
      parameters: resolveParameters([...state.parameters, newParam]),
    }));
  },
  updateParameter: (id, updates) => {
    set((state) => {
      const updated = state.parameters.map(p =>
        p.id === id ? { ...p, ...updates } : p
      );
      return { parameters: resolveParameters(updated) };
    });
  },
  removeParameter: (id) => {
    set((state) => ({
      parameters: resolveParameters(state.parameters.filter(p => p.id !== id)),
    }));
  },
  evaluateExpression: (expr) => {
    return evaluateExpression(expr, get().parameters);
  },
}),
{
  name: 'dzign3d-cad',
  storage: idbStorage,

  // Only persist design data and user preferences — NOT ephemeral UI state
  partialize: (state) => ({
    sketches: state.sketches.map(serializeSketch),
    features: state.features.map(serializeFeature),
    parameters: state.parameters,
    // User preferences
    gridSize: state.gridSize,
    snapEnabled: state.snapEnabled,
    gridVisible: state.gridVisible,
    units: state.units,
    visualStyle: state.visualStyle,
    showEnvironment: state.showEnvironment,
    showShadows: state.showShadows,
    showGroundPlane: state.showGroundPlane,
  }),

  // After loading from IDB, reconstruct THREE.js objects and rebuild feature meshes
  onRehydrateStorage: () => (state) => {
    if (!state) return;
    // Reconstruct THREE.Vector3 fields on sketches
    if (state.sketches) {
      state.sketches = state.sketches.map((s: any) => deserializeSketch(s));
    }
    // Rebuild feature meshes from sketch + params
    if (state.features && state.sketches) {
      state.features = state.features.map((f: any) => rebuildFeatureMesh(f, state.sketches));
    }
  },
}));
