import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import * as THREE from 'three';
import type { Tool, ViewMode, SketchPlane, Sketch, SketchEntity, SketchPoint, Feature, Parameter, BooleanOperation, FormCage, FormSelection, FormElementType } from '../types/cad';

export type ExtrudeDirection = 'normal' | 'symmetric' | 'reverse';
export type ExtrudeOperation = Extract<BooleanOperation, 'new-body' | 'join' | 'cut'>;
import { evaluateExpression, resolveParameters } from '../utils/expressionEval';
import { GeometryEngine } from '../engine/GeometryEngine';
import { useComponentStore } from './componentStore';

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

interface CADState {
  // Tool state
  activeTool: Tool;
  setActiveTool: (tool: Tool) => void;

  // View state
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;

  // Workspace mode
  workspaceMode: 'design' | 'prepare' | 'printer';
  setWorkspaceMode: (mode: 'design' | 'prepare' | 'printer') => void;

  // Sketch state
  activeSketch: Sketch | null;
  sketches: Sketch[];
  sketchPlaneSelecting: boolean;  // true when user is picking a plane
  setSketchPlaneSelecting: (selecting: boolean) => void;
  startSketch: (plane: SketchPlane) => void;
  startSketchOnFace: (normal: THREE.Vector3, origin: THREE.Vector3) => void;
  editSketch: (id: string) => void;
  finishSketch: () => void;
  cancelSketch: () => void;
  addSketchEntity: (entity: SketchEntity) => void;
  replaceSketchEntities: (entities: SketchEntity[]) => void;
  /** D57: toggle a single entity's linetype (line ↔ construction-line ↔ centerline) */
  cycleEntityLinetype: (entityId: string) => void;
  /** S6: remove the 'linked' flag on a projected entity so it becomes an independent editable entity */
  breakProjectionLink: (entityId: string) => void;
  copySketch: (id: string) => void;
  deleteSketch: (id: string) => void;
  renameSketch: (id: string, name: string) => void;
  /** D60: Redefine the plane of an existing sketch */
  redefineSketchPlane: (id: string, plane: SketchPlane, normal: THREE.Vector3, origin: THREE.Vector3) => void;

  // Feature timeline
  features: Feature[];
  addFeature: (feature: Feature) => void;
  addPrimitive: (kind: 'box' | 'cylinder' | 'sphere' | 'torus' | 'coil', params: Record<string, number>) => void;
  /** D119: Clone a feature's geometry as a new mesh-body primitive. */
  tessellateFeature: (featureId: string) => void;
  removeFeature: (id: string) => void;
  toggleFeatureVisibility: (id: string) => void;
  toggleFeatureSuppressed: (id: string) => void;
  /** D186: Feature currently being edited via a dialog (pre-fills dialog values). */
  editingFeatureId: string | null;
  setEditingFeatureId: (id: string | null) => void;
  /** D186: Update params on an existing feature in-place. */
  updateFeatureParams: (id: string, params: Record<string, number | string | boolean | number[]>) => void;
  /** D189: Move a feature to a new position in the timeline. */
  reorderFeature: (id: string, newIndex: number) => void;
  /** D190: Rollback index — features at index >= this are skipped when rendering. */
  rollbackIndex: number;
  setRollbackIndex: (index: number) => void;
  selectedFeatureId: string | null;
  setSelectedFeatureId: (id: string | null) => void;

  // Selection
  selectedEntityIds: string[];
  setSelectedEntityIds: (ids: string[]) => void;
  toggleEntitySelection: (id: string) => void;

  // ── Form (T-Spline / subdivision) state ─────────────────────────────
  formBodies: FormCage[];
  activeFormBodyId: string | null;
  formSelection: FormSelection | null;
  addFormBody: (cage: FormCage) => void;
  removeFormBody: (id: string) => void;
  setActiveFormBody: (id: string | null) => void;
  setFormSelection: (sel: FormSelection | null) => void;
  /** D167: Remove selected vertices/edges/faces from the active cage. */
  deleteFormElements: (type: FormElementType, ids: string[]) => void;
  /** D152: Move one or more vertices in a cage by updating their positions. */
  updateFormVertices: (bodyId: string, updates: { id: string; position: [number, number, number] }[]) => void;
  /** D155: Set the subdivision level (1–5) of a form body. */
  setFormBodySubdivisionLevel: (id: string, level: number) => void;
  /** D160: Set crease value on all vertices of a form body (0 = uncrease, 1 = crease). */
  setFormBodyCrease: (id: string, crease: number) => void;
  /** D166: Frozen vertices — dragging is blocked for these vertex ids. */
  frozenFormVertices: string[];
  toggleFrozenFormVertex: (id: string) => void;

  // Grid & snap
  gridSize: number;
  setGridSize: (size: number) => void;
  /** S7: Per-sketch grid spacing override (null = use global gridSize). */
  sketchGridSize: number | null;
  setSketchGridSize: (size: number | null) => void;
  snapEnabled: boolean;
  setSnapEnabled: (enabled: boolean) => void;

  // Sketch tool options
  sketchPolygonSides: number;
  setSketchPolygonSides: (sides: number) => void;
  sketchFilletRadius: number;
  setSketchFilletRadius: (r: number) => void;
  sketchSlotWidth: number;
  setSketchSlotWidth: (w: number) => void;
  // Sketch pattern state (D22/D23)
  sketchRectPatternCountX: number;
  sketchRectPatternCountY: number;
  sketchRectPatternSpacingX: number;
  sketchRectPatternSpacingY: number;
  setSketchRectPattern: (params: { countX?: number; countY?: number; spacingX?: number; spacingY?: number }) => void;
  commitSketchRectPattern: () => void;
  sketchCircPatternCount: number;
  sketchCircPatternRadius: number;
  sketchCircPatternAngle: number; // total sweep angle in degrees
  setSketchCircPattern: (params: { count?: number; radius?: number; angle?: number }) => void;
  commitSketchCircPattern: () => void;
  // Sketch transform state (D24/D25/D26)
  sketchMoveDx: number;
  sketchMoveDy: number;
  sketchMoveCopy: boolean;
  setSketchMove: (params: { dx?: number; dy?: number; copy?: boolean }) => void;
  commitSketchMove: () => void;
  sketchScaleFactor: number;
  setSketchScaleFactor: (f: number) => void;
  commitSketchScale: () => void;
  sketchRotateAngle: number; // degrees
  setSketchRotateAngle: (a: number) => void;
  commitSketchRotate: () => void;
  // Sketch offset (D20)
  sketchOffsetDistance: number;
  setSketchOffsetDistance: (d: number) => void;
  // Sketch mirror (D21)
  sketchMirrorAxis: 'horizontal' | 'vertical' | 'diagonal';
  setSketchMirrorAxis: (axis: 'horizontal' | 'vertical' | 'diagonal') => void;
  commitSketchMirror: () => void;
  // Conic curve rho (D11)
  conicRho: number;
  setConicRho: (r: number) => void;
  // Tangent circles (D40, D41)
  tangentCircleRadius: number;
  setTangentCircleRadius: (r: number) => void;
  // Blend curve continuity (D44)
  blendCurveMode: 'g1' | 'g2';
  setBlendCurveMode: (mode: 'g1' | 'g2') => void;
  // Sketch chamfer (D47)
  sketchChamferDist1: number;
  setSketchChamferDist1: (d: number) => void;
  sketchChamferDist2: number;
  setSketchChamferDist2: (d: number) => void;
  sketchChamferAngle: number;
  setSketchChamferAngle: (a: number) => void;
  // Show Profile toggle (D55)
  showSketchProfile: boolean;
  setShowSketchProfile: (show: boolean) => void;
  // Slice toggle (D54)
  sliceEnabled: boolean;
  setSliceEnabled: (enabled: boolean) => void;
  // Section Analysis (D38)
  sectionEnabled: boolean;
  sectionAxis: 'x' | 'y' | 'z';
  sectionOffset: number;
  sectionFlip: boolean;
  setSectionEnabled: (enabled: boolean) => void;
  setSectionAxis: (axis: 'x' | 'y' | 'z') => void;
  setSectionOffset: (offset: number) => void;
  setSectionFlip: (flip: boolean) => void;
  // D182 – Component color overlay
  showComponentColors: boolean;
  setShowComponentColors: (v: boolean) => void;

  // D185 – Canvas reference images
  canvasReferences: Array<{ id: string; dataUrl: string; plane: string; offsetX: number; offsetY: number; scale: number; opacity: number }>;
  addCanvasReference: (ref: { id: string; dataUrl: string; plane: string; offsetX: number; offsetY: number; scale: number; opacity: number }) => void;
  removeCanvasReference: (id: string) => void;

  // Visibility toggles (D56)
  showSketchPoints: boolean;
  setShowSketchPoints: (v: boolean) => void;
  showSketchDimensions: boolean;
  setShowSketchDimensions: (v: boolean) => void;
  showSketchConstraints: boolean;
  setShowSketchConstraints: (v: boolean) => void;
  showProjectedGeometries: boolean;
  setShowProjectedGeometries: (v: boolean) => void;
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

  // Extrude tool (Fusion 360-style interactive extrude)
  extrudeSelectedSketchId: string | null;
  extrudeSelectedSketchIds: string[];
  setExtrudeSelectedSketchId: (id: string | null) => void;
  setExtrudeSelectedSketchIds: (ids: string[]) => void;
  extrudeDistance: number;
  setExtrudeDistance: (distance: number) => void;
  extrudeDirection: ExtrudeDirection;
  setExtrudeDirection: (d: ExtrudeDirection) => void;
  extrudeOperation: ExtrudeOperation;
  setExtrudeOperation: (o: ExtrudeOperation) => void;
  startExtrudeTool: () => void;
  startExtrudeFromFace: (boundary: THREE.Vector3[], normal: THREE.Vector3, centroid: THREE.Vector3) => void;
  cancelExtrudeTool: () => void;
  commitExtrude: () => void;
  // Thin extrude (D66)
  extrudeThinEnabled: boolean;
  setExtrudeThinEnabled: (v: boolean) => void;
  extrudeThinThickness: number;
  setExtrudeThinThickness: (t: number) => void;
  extrudeThinSide: 'inside' | 'outside' | 'center';
  setExtrudeThinSide: (s: 'inside' | 'outside' | 'center') => void;
  // Extrude start options (D67)
  extrudeStartType: 'profile' | 'offset';
  setExtrudeStartType: (t: 'profile' | 'offset') => void;
  extrudeStartOffset: number;
  setExtrudeStartOffset: (v: number) => void;
  // Extrude extent types (D68)
  extrudeExtentType: 'distance' | 'all';
  setExtrudeExtentType: (t: 'distance' | 'all') => void;
  // Extrude taper angle (D69)
  extrudeTaperAngle: number;
  setExtrudeTaperAngle: (a: number) => void;
  // Extrude body kind (D102)
  extrudeBodyKind: 'solid' | 'surface';
  setExtrudeBodyKind: (k: 'solid' | 'surface') => void;

  // Revolve tool
  revolveSelectedSketchId: string | null;
  setRevolveSelectedSketchId: (id: string | null) => void;
  revolveAxis: 'X' | 'Y' | 'Z';
  setRevolveAxis: (a: 'X' | 'Y' | 'Z') => void;
  revolveAngle: number;
  setRevolveAngle: (angle: number) => void;
  // Revolve direction modes (D70)
  revolveDirection: 'one-side' | 'symmetric' | 'two-sides';
  setRevolveDirection: (d: 'one-side' | 'symmetric' | 'two-sides') => void;
  revolveAngle2: number;
  setRevolveAngle2: (a: number) => void;
  // Revolve body kind (D103)
  revolveBodyKind: 'solid' | 'surface';
  setRevolveBodyKind: (k: 'solid' | 'surface') => void;
  startRevolveTool: () => void;
  cancelRevolveTool: () => void;
  commitRevolve: () => void;

  // Sweep tool (D30)
  sweepProfileSketchId: string | null;
  setSweepProfileSketchId: (id: string | null) => void;
  sweepPathSketchId: string | null;
  setSweepPathSketchId: (id: string | null) => void;
  // D104 surface sweep
  sweepBodyKind: 'solid' | 'surface';
  setSweepBodyKind: (k: 'solid' | 'surface') => void;
  startSweepTool: () => void;
  cancelSweepTool: () => void;
  commitSweep: () => void;

  // Loft tool (D31 / D105)
  loftProfileSketchIds: string[];
  setLoftProfileSketchIds: (ids: string[]) => void;
  loftBodyKind: 'solid' | 'surface';
  setLoftBodyKind: (k: 'solid' | 'surface') => void;
  startLoftTool: () => void;
  cancelLoftTool: () => void;
  commitLoft: () => void;

  // Patch tool (D106)
  patchSelectedSketchId: string | null;
  setPatchSelectedSketchId: (id: string | null) => void;
  startPatchTool: () => void;
  cancelPatchTool: () => void;
  commitPatch: () => void;

  // Ruled Surface tool (D107)
  ruledSketchAId: string | null;
  setRuledSketchAId: (id: string | null) => void;
  ruledSketchBId: string | null;
  setRuledSketchBId: (id: string | null) => void;
  startRuledSurfaceTool: () => void;
  cancelRuledSurfaceTool: () => void;
  commitRuledSurface: () => void;

  // Rib tool (D73)
  ribSelectedSketchId: string | null;
  setRibSelectedSketchId: (id: string | null) => void;
  ribThickness: number;
  setRibThickness: (t: number) => void;
  ribHeight: number;
  setRibHeight: (h: number) => void;
  ribDirection: 'normal' | 'flip' | 'symmetric';
  setRibDirection: (d: 'normal' | 'flip' | 'symmetric') => void;
  startRibTool: () => void;
  cancelRibTool: () => void;
  commitRib: () => void;

  // Export dialog
  showExportDialog: boolean;
  setShowExportDialog: (show: boolean) => void;

  // D125 Mesh Reduce
  reduceMesh: (featureId: string, reductionPercent: number) => void;
  // D115 Reverse Normals
  reverseNormals: (featureId: string) => void;

  // Active feature dialog
  activeDialog: string | null;
  setActiveDialog: (dialog: string | null) => void;
  dialogPayload: string | null;
  setDialogPayload: (payload: string | null) => void;

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
  // D39 Selection Filter
  selectionFilter: 'all' | 'bodies' | 'faces' | 'edges' | 'sketches';
  setSelectionFilter: (filter: 'all' | 'bodies' | 'faces' | 'edges' | 'sketches') => void;

  // Camera
  cameraHomeCounter: number;
  triggerCameraHome: () => void;

  // Parameters
  parameters: Parameter[];
  addParameter: (name: string, expression: string, description?: string, group?: string) => void;
  updateParameter: (id: string, updates: Partial<Pick<Parameter, 'name' | 'expression' | 'description' | 'group'>>) => void;
  removeParameter: (id: string) => void;
  evaluateExpression: (expr: string) => number | null;

  // A5 — ground/unground a component (stub; components array populated in A1)
  groundComponent: (id: string, grounded: boolean) => void;
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

const toVector3 = (
  value: unknown,
  fallback: [number, number, number],
): THREE.Vector3 => {
  if (value instanceof THREE.Vector3) return value.clone();
  if (Array.isArray(value) && value.length >= 3) {
    return new THREE.Vector3(Number(value[0]) || 0, Number(value[1]) || 0, Number(value[2]) || 0);
  }
  if (value && typeof value === 'object') {
    const v = value as { x?: number; y?: number; z?: number };
    return new THREE.Vector3(Number(v.x) || 0, Number(v.y) || 0, Number(v.z) || 0);
  }
  return new THREE.Vector3(fallback[0], fallback[1], fallback[2]);
};

const deserializeSketch = (sketch: Sketch): Sketch => ({
  ...sketch,
  planeNormal: toVector3((sketch as unknown as { planeNormal: unknown }).planeNormal, [0, 1, 0]),
  planeOrigin: toVector3((sketch as unknown as { planeOrigin: unknown }).planeOrigin, [0, 0, 0]),
});

const serializeFeature = (feature: Feature) => {
  const { mesh, ...rest } = feature;
  void mesh;
  return rest;
};

const deserializeFeature = (feature: Feature): Feature => ({
  ...feature,
  mesh: undefined,
});

// Default values shared between startExtrudeTool and resetExtrudeState
const EXTRUDE_DEFAULTS = {
  extrudeSelectedSketchId: null,
  extrudeSelectedSketchIds: [] as string[],
  extrudeDistance: 10,
  extrudeDirection: 'normal' as ExtrudeDirection,
  extrudeOperation: 'new-body' as ExtrudeOperation,
  extrudeThinEnabled: false,
  extrudeThinThickness: 2,
  extrudeThinSide: 'inside' as 'inside' | 'outside' | 'center',
  // D67 start options
  extrudeStartType: 'profile' as 'profile' | 'offset',
  extrudeStartOffset: 0,
  // D68 extent types
  extrudeExtentType: 'distance' as 'distance' | 'all',
  // D69 taper angle
  extrudeTaperAngle: 0,
  // D102 body kind
  extrudeBodyKind: 'solid' as 'solid' | 'surface',
};

const REVOLVE_DEFAULTS = {
  revolveSelectedSketchId: null as string | null,
  revolveAxis: 'Y' as 'X' | 'Y' | 'Z',
  revolveAngle: 360,
  // D70 direction modes
  revolveDirection: 'one-side' as 'one-side' | 'symmetric' | 'two-sides',
  revolveAngle2: 360,
  // D103 body kind
  revolveBodyKind: 'solid' as 'solid' | 'surface',
};

export const useCADStore = create<CADState>()(persist((set, get) => ({
  activeTool: 'select',
  setActiveTool: (tool) => set({
    activeTool: tool,
    measurePoints: [],
    // Reset transient extrude/revolve state when switching away from them
    ...(tool !== 'extrude' ? EXTRUDE_DEFAULTS : {}),
    ...(tool !== 'revolve' ? REVOLVE_DEFAULTS : {}),
  }),

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
  startSketchOnFace: (normal, origin) => {
    // Normalize the face normal once
    const n = normal.clone().normalize();
    const o = origin.clone();

    const sketch: Sketch = {
      id: crypto.randomUUID(),
      name: `Sketch ${get().sketches.length + 1}`,
      plane: 'custom',
      planeNormal: n,
      planeOrigin: o,
      entities: [],
      constraints: [],
      dimensions: [],
      fullyConstrained: false,
    };

    // Camera looks AT the face from `origin + normal * distance` along -normal.
    // Pick an "up" vector that lies in the face plane (least aligned world axis,
    // then orthogonalized against the normal so it's truly in-plane).
    const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
    let candidateUp: THREE.Vector3;
    if (ay <= ax && ay <= az) candidateUp = new THREE.Vector3(0, 1, 0);
    else if (ax <= az)        candidateUp = new THREE.Vector3(1, 0, 0);
    else                      candidateUp = new THREE.Vector3(0, 0, 1);
    // Project candidateUp onto the plane: up = candidateUp - (candidateUp·n) * n
    const up = candidateUp.clone().sub(n.clone().multiplyScalar(candidateUp.dot(n))).normalize();

    const camDir = n.clone().multiplyScalar(50);
    const camPos = o.clone().add(camDir);
    const m = new THREE.Matrix4().lookAt(camPos, o, up);
    const targetQuat = new THREE.Quaternion().setFromRotationMatrix(m);

    set({
      activeSketch: sketch,
      sketchPlaneSelecting: false,
      viewMode: 'sketch',
      activeTool: 'line',
      cameraTargetQuaternion: targetQuat,
      cameraTargetOrbit: o,
      statusMessage: 'Sketching on face',
    });
  },
  editSketch: (id) => {
    // If already editing a sketch, finish it first so it isn't lost
    if (get().activeSketch) get().finishSketch();

    const { sketches } = get();
    const sketch = sketches.find((s) => s.id === id);
    if (!sketch) return;

    // Reuse the same camera-orient logic as startSketch.
    // For 'custom' planes the normal/origin are stored on the sketch.
    const isCustom = sketch.plane === 'custom';
    const normal = isCustom ? sketch.planeNormal.clone().normalize() : getPlaneNormal(sketch.plane);
    const origin = isCustom ? sketch.planeOrigin.clone() : new THREE.Vector3(0, 0, 0);

    let up: THREE.Vector3;
    if (isCustom) {
      const ax = Math.abs(normal.x), ay = Math.abs(normal.y), az = Math.abs(normal.z);
      const candidate =
        ay <= ax && ay <= az ? new THREE.Vector3(0, 1, 0)
        : ax <= az          ? new THREE.Vector3(1, 0, 0)
        :                     new THREE.Vector3(0, 0, 1);
      up = candidate.sub(normal.clone().multiplyScalar(candidate.dot(normal))).normalize();
    } else {
      up = sketch.plane === 'XY' ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(0, 1, 0);
    }

    const camDist = isCustom ? 50 : 5;
    const camPos = origin.clone().add(normal.clone().multiplyScalar(camDist));
    const m = new THREE.Matrix4().lookAt(camPos, origin, up);
    const targetQuat = new THREE.Quaternion().setFromRotationMatrix(m);

    set({
      // Pull the sketch out of the completed list and back into editing
      activeSketch: sketch,
      sketches: sketches.filter((s) => s.id !== id),
      sketchPlaneSelecting: false,
      viewMode: 'sketch',
      activeTool: 'line',
      cameraTargetQuaternion: targetQuat,
      cameraTargetOrbit: origin,
      statusMessage: `Editing ${sketch.name}${isCustom ? ' on face' : ` on ${sketch.plane} plane`}`,
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

  replaceSketchEntities: (entities) => {
    const { activeSketch } = get();
    if (activeSketch) {
      set({ activeSketch: { ...activeSketch, entities } });
    }
  },

  cycleEntityLinetype: (entityId) => {
    const { activeSketch } = get();
    if (!activeSketch) return;
    const CYCLE: Record<string, 'line' | 'construction-line' | 'centerline'> = {
      'line': 'construction-line',
      'construction-line': 'centerline',
      'centerline': 'line',
    };
    const updated = activeSketch.entities.map((e) => {
      if (e.id !== entityId) return e;
      const next = CYCLE[e.type];
      if (!next) return e; // non-line types unchanged
      return { ...e, type: next };
    });
    set({ activeSketch: { ...activeSketch, entities: updated } });
  },

  // S6 Break Link — remove the 'linked' flag so a projected entity becomes editable
  breakProjectionLink: (entityId) => {
    const { activeSketch } = get();
    if (!activeSketch) return;
    const updated = activeSketch.entities.map((e) =>
      e.id === entityId ? { ...e, linked: false } : e,
    );
    set({
      activeSketch: { ...activeSketch, entities: updated },
      statusMessage: 'Projection link broken — entity is now independent',
    });
  },

  copySketch: (id) => set((state) => {
    const src = state.sketches.find((s) => s.id === id);
    if (!src) return state;
    const copy: Sketch = {
      ...src,
      id: crypto.randomUUID(),
      name: `${src.name} (Copy)`,
      entities: src.entities.map((e) => ({
        ...e,
        id: crypto.randomUUID(),
        points: e.points.map((p) => ({ ...p, id: crypto.randomUUID() })),
      })),
      constraints: [],
      dimensions: [],
    };
    const copyFeature: Feature = {
      id: crypto.randomUUID(),
      name: copy.name,
      type: 'sketch',
      sketchId: copy.id,
      params: { plane: copy.plane },
      visible: true,
      suppressed: false,
      timestamp: Date.now(),
    };
    return {
      sketches: [...state.sketches, copy],
      features: [...state.features, copyFeature],
      statusMessage: `Sketch copied as "${copy.name}"`,
    };
  }),

  deleteSketch: (id) => set((state) => {
    const activeSketch = state.activeSketch?.id === id ? null : state.activeSketch;
    return {
      sketches: state.sketches.filter((s) => s.id !== id),
      features: state.features.filter((f) => !(f.type === 'sketch' && f.sketchId === id)),
      activeSketch,
      statusMessage: 'Sketch deleted',
    };
  }),

  renameSketch: (id, name) => set((state) => ({
    sketches: state.sketches.map((s) => s.id !== id ? s : { ...s, name }),
    features: state.features.map((f) => f.type === 'sketch' && f.sketchId === id ? { ...f, name } : f),
    statusMessage: `Sketch renamed to "${name}"`,
  })),

  redefineSketchPlane: (id, plane, normal, origin) => set((state) => ({
    sketches: state.sketches.map((s) =>
      s.id !== id ? s : { ...s, plane, planeNormal: normal.clone(), planeOrigin: origin.clone() }
    ),
    statusMessage: `Sketch plane redefined`,
  })),

  features: [],
  addFeature: (feature) => set((state) => ({
    features: [...state.features, feature],
  })),
  addPrimitive: (kind, params) => set((state) => {
    const label =
      kind === 'box' ? 'Box' :
      kind === 'cylinder' ? 'Cylinder' :
      kind === 'sphere' ? 'Sphere' :
      kind === 'coil' ? 'Coil' : 'Torus';
    const count = state.features.filter((f) => f.type === 'primitive').length + 1;

    // For coil we pre-build the mesh so PrimitiveBodies doesn't need to handle it
    let mesh: Feature['mesh'] | undefined;
    if (kind === 'coil') {
      const geom = GeometryEngine.coilGeometry(
        (params.outerRadius as number) || 15,
        (params.wireRadius as number) || 2,
        (params.pitch as number) || 10,
        (params.turns as number) || 5,
      );
      // Use a fresh MeshPhysicalMaterial matching the EXTRUDE_MATERIAL style
      const mat = new THREE.MeshPhysicalMaterial({ color: 0x8899aa, metalness: 0.3, roughness: 0.4, side: THREE.DoubleSide });
      const m = new THREE.Mesh(geom, mat);
      m.castShadow = true;
      m.receiveShadow = true;
      mesh = m;
    }

    const feature: Feature = {
      id: crypto.randomUUID(),
      name: `${label} ${count}`,
      type: 'primitive',
      params: { kind, ...params },
      visible: true,
      suppressed: false,
      timestamp: Date.now(),
      ...(mesh ? { mesh } : {}),
    };
    return {
      features: [...state.features, feature],
      statusMessage: `${label} added`,
    };
  }),
  removeFeature: (id) => set((state) => {
    const target = state.features.find((f) => f.id === id);
    if (target?.mesh) target.mesh.geometry?.dispose();
    return { features: state.features.filter((f) => f.id !== id) };
  }),
  // D186 Edit Feature state
  editingFeatureId: null,
  setEditingFeatureId: (id) => set({ editingFeatureId: id }),
  updateFeatureParams: (id, params) => set((state) => ({
    features: state.features.map((f) =>
      f.id === id ? { ...f, params: { ...f.params, ...params } } : f,
    ),
    statusMessage: 'Feature parameters updated',
  })),
  // D189 reorder feature
  reorderFeature: (id, newIndex) => set((state) => {
    const idx = state.features.findIndex((f) => f.id === id);
    if (idx === -1) return {};
    const next = [...state.features];
    const [moved] = next.splice(idx, 1);
    const clamped = Math.max(0, Math.min(newIndex, next.length));
    next.splice(clamped, 0, moved);
    return { features: next, statusMessage: `Moved ${moved.name}` };
  }),
  // D190 rollback bar
  rollbackIndex: -1,
  setRollbackIndex: (index) => set({ rollbackIndex: index }),
  // D119 Tessellate
  tessellateFeature: (featureId) => {
    const { features } = get();
    const feature = features.find((f) => f.id === featureId);
    if (!feature?.mesh) {
      get().setStatusMessage('No mesh found on selected feature');
      return;
    }
    const geom = GeometryEngine.extractMeshGeometry(feature.mesh as THREE.Mesh | THREE.Group);
    if (!geom) {
      get().setStatusMessage('No mesh found on selected feature');
      return;
    }
    const mat = new THREE.MeshPhysicalMaterial({ color: 0x8899aa, metalness: 0.3, roughness: 0.4, side: THREE.DoubleSide });
    const newMesh = new THREE.Mesh(geom, mat);
    newMesh.castShadow = true;
    newMesh.receiveShadow = true;
    const n = features.filter((f) => f.params.kind === 'tessellate').length + 1;
    const newFeature: Feature = {
      id: crypto.randomUUID(),
      name: `Tessellate ${n}`,
      type: 'primitive',
      params: { kind: 'tessellate' },
      visible: true,
      suppressed: false,
      timestamp: Date.now(),
      mesh: newMesh,
      bodyKind: 'mesh',
    };
    set((state) => ({
      features: [...state.features, newFeature],
      statusMessage: 'Feature tessellated as mesh body',
    }));
  },
  // D125 Mesh Reduce
  reduceMesh: (featureId, reductionPercent) => {
    const { features, setStatusMessage } = get();
    const feature = features.find((f) => f.id === featureId);
    if (!feature?.mesh) {
      get().setStatusMessage('Mesh Reduce: selected feature has no mesh');
      return;
    }
    const applyToMesh = async (m: THREE.Mesh) => {
      const oldGeom = m.geometry;
      const newGeom = await GeometryEngine.simplifyGeometry(oldGeom, reductionPercent);
      m.geometry = newGeom;
      oldGeom.dispose();
    };
    const featureMesh = feature.mesh as THREE.Object3D;
    if (featureMesh instanceof THREE.Mesh) {
      applyToMesh(featureMesh).then(() => {
        get().setStatusMessage(`Mesh reduced by ${reductionPercent}%`);
      });
    } else if (featureMesh instanceof THREE.Group) {
      const meshes: THREE.Mesh[] = [];
      featureMesh.traverse((child) => {
        if (child instanceof THREE.Mesh) meshes.push(child);
      });
      Promise.all(meshes.map(applyToMesh)).then(() => {
        get().setStatusMessage(`Mesh reduced by ${reductionPercent}%`);
      });
    } else {
      setStatusMessage('Mesh Reduce: feature is not simplifiable');
    }
  },
  // D115 Reverse Normals
  reverseNormals: (featureId) => {
    const { features } = get();
    const feature = features.find((f) => f.id === featureId);
    if (!feature?.mesh) {
      get().setStatusMessage('Reverse Normal: selected feature has no mesh');
      return;
    }
    const featureMesh = feature.mesh as THREE.Object3D;
    if (featureMesh instanceof THREE.Mesh) {
      GeometryEngine.reverseNormals(featureMesh.geometry);
    } else if (featureMesh instanceof THREE.Group) {
      featureMesh.traverse((child) => {
        if (child instanceof THREE.Mesh) GeometryEngine.reverseNormals(child.geometry);
      });
    }
    get().setStatusMessage('Normals reversed');
  },
  toggleFeatureVisibility: (id) => set((state) => ({
    features: state.features.map((f) =>
      f.id === id ? { ...f, visible: !f.visible } : f
    ),
  })),
  toggleFeatureSuppressed: (id) => set((state) => ({
    features: state.features.map((f) =>
      f.id === id ? { ...f, suppressed: !f.suppressed } : f
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

  // ── Form state ───────────────────────────────────────────────────────
  formBodies: [],
  activeFormBodyId: null,
  formSelection: null,
  addFormBody: (cage) => set((state) => ({ formBodies: [...state.formBodies, cage] })),
  removeFormBody: (id) => set((state) => ({
    formBodies: state.formBodies.filter((b) => b.id !== id),
    activeFormBodyId: state.activeFormBodyId === id ? null : state.activeFormBodyId,
    formSelection: state.formSelection?.bodyId === id ? null : state.formSelection,
  })),
  setActiveFormBody: (id) => set({ activeFormBodyId: id }),
  setFormSelection: (sel) => set({ formSelection: sel }),
  deleteFormElements: (type, ids) => set((state) => {
    const body = state.formBodies.find((b) => b.id === state.activeFormBodyId);
    if (!body) return {};
    let updated: FormCage;
    if (type === 'vertex') {
      const removed = new Set(ids);
      // Remove vertex + any edges/faces that reference it
      const cleanEdges = body.edges.filter(
        (e) => !removed.has(e.vertexIds[0]) && !removed.has(e.vertexIds[1])
      );
      const cleanFaces = body.faces.filter(
        (f) => !f.vertexIds.some((v) => removed.has(v))
      );
      updated = { ...body, vertices: body.vertices.filter((v) => !removed.has(v.id)), edges: cleanEdges, faces: cleanFaces };
    } else if (type === 'edge') {
      const removed = new Set(ids);
      updated = { ...body, edges: body.edges.filter((e) => !removed.has(e.id)) };
    } else {
      const removed = new Set(ids);
      updated = { ...body, faces: body.faces.filter((f) => !removed.has(f.id)) };
    }
    return { formBodies: state.formBodies.map((b) => b.id === updated.id ? updated : b), formSelection: null };
  }),

  updateFormVertices: (bodyId, updates) => set((state) => {
    const body = state.formBodies.find((b) => b.id === bodyId);
    if (!body) return {};
    const posMap = new Map(updates.map((u) => [u.id, u.position]));
    const newVerts = body.vertices.map((v) =>
      posMap.has(v.id) ? { ...v, position: posMap.get(v.id)! } : v
    );
    return { formBodies: state.formBodies.map((b) => b.id === bodyId ? { ...body, vertices: newVerts } : b) };
  }),

  setFormBodySubdivisionLevel: (id, level) => set((state) => ({
    formBodies: state.formBodies.map((b) =>
      b.id !== id ? b : { ...b, subdivisionLevel: Math.max(1, Math.min(5, level)) }
    ),
  })),

  setFormBodyCrease: (id, crease) => set((state) => ({
    formBodies: state.formBodies.map((b) =>
      b.id !== id ? b : { ...b, vertices: b.vertices.map((v) => ({ ...v, crease })) }
    ),
  })),

  frozenFormVertices: [],
  toggleFrozenFormVertex: (id) => set((state) => {
    const frozen = state.frozenFormVertices;
    return {
      frozenFormVertices: frozen.includes(id)
        ? frozen.filter((v) => v !== id)
        : [...frozen, id],
    };
  }),

  gridSize: 10,
  setGridSize: (size) => set({ gridSize: size }),
  sketchGridSize: null,
  setSketchGridSize: (size) => set({ sketchGridSize: size }),
  snapEnabled: true,
  setSnapEnabled: (enabled) => set({ snapEnabled: enabled }),
  gridVisible: true,
  setGridVisible: (visible) => set({ gridVisible: visible }),
  sketchPolygonSides: 6,
  setSketchPolygonSides: (sides) => set({ sketchPolygonSides: Math.max(3, Math.min(128, Math.round(sides))) }),
  sketchFilletRadius: 2,
  setSketchFilletRadius: (r) => set({ sketchFilletRadius: Math.max(0.01, r) }),
  sketchSlotWidth: 4,
  setSketchSlotWidth: (w) => set({ sketchSlotWidth: Math.max(0.01, w) }),

  sketchRectPatternCountX: 3,
  sketchRectPatternCountY: 2,
  sketchRectPatternSpacingX: 10,
  sketchRectPatternSpacingY: 10,
  setSketchRectPattern: (params) => set((state) => ({
    sketchRectPatternCountX: params.countX ?? state.sketchRectPatternCountX,
    sketchRectPatternCountY: params.countY ?? state.sketchRectPatternCountY,
    sketchRectPatternSpacingX: params.spacingX ?? state.sketchRectPatternSpacingX,
    sketchRectPatternSpacingY: params.spacingY ?? state.sketchRectPatternSpacingY,
  })),
  commitSketchRectPattern: () => {
    const { activeSketch, sketchRectPatternCountX: cx, sketchRectPatternCountY: cy,
            sketchRectPatternSpacingX: sx, sketchRectPatternSpacingY: sy } = get();
    if (!activeSketch || activeSketch.entities.length === 0) return;
    const { t1, t2 } = GeometryEngine.getSketchAxes(activeSketch);
    const copies: SketchEntity[] = [];
    for (let row = 0; row < cy; row++) {
      for (let col = 0; col < cx; col++) {
        if (row === 0 && col === 0) continue; // skip the original instance
        const dx = t1.x * sx * col + t2.x * sy * row;
        const dy = t1.y * sx * col + t2.y * sy * row;
        const dz = t1.z * sx * col + t2.z * sy * row;
        for (const ent of activeSketch.entities) {
          copies.push({
            ...ent,
            id: crypto.randomUUID(),
            points: ent.points.map((p) => ({ ...p, id: crypto.randomUUID(), x: p.x + dx, y: p.y + dy, z: p.z + dz })),
          });
        }
      }
    }
    set({
      activeSketch: { ...activeSketch, entities: [...activeSketch.entities, ...copies] },
      statusMessage: `Rectangular pattern: ${cx}×${cy} (${copies.length} new entities added)`,
    });
  },

  sketchCircPatternCount: 6,
  sketchCircPatternRadius: 10,
  sketchCircPatternAngle: 360,
  setSketchCircPattern: (params) => set((state) => ({
    sketchCircPatternCount: params.count ?? state.sketchCircPatternCount,
    sketchCircPatternRadius: params.radius ?? state.sketchCircPatternRadius,
    sketchCircPatternAngle: params.angle ?? state.sketchCircPatternAngle,
  })),
  commitSketchCircPattern: () => {
    const { activeSketch, sketchCircPatternCount: cnt,
            sketchCircPatternAngle: totalDeg } = get();
    if (!activeSketch || activeSketch.entities.length === 0) return;
    const { t1, t2 } = GeometryEngine.getSketchAxes(activeSketch);
    // Compute centroid of current sketch entities as pattern origin
    let cx = 0, cy2 = 0, cz = 0, ptCount = 0;
    for (const ent of activeSketch.entities) {
      for (const p of ent.points) { cx += p.x; cy2 += p.y; cz += p.z; ptCount++; }
    }
    if (ptCount === 0) return;
    cx /= ptCount; cy2 /= ptCount; cz /= ptCount;
    const copies: SketchEntity[] = [];
    const totalRad = (totalDeg * Math.PI) / 180;
    for (let i = 1; i < cnt; i++) {
      const angle = (totalRad / cnt) * i;
      const cosA = Math.cos(angle), sinA = Math.sin(angle);
      for (const ent of activeSketch.entities) {
        copies.push({
          ...ent,
          id: crypto.randomUUID(),
          points: ent.points.map((p) => {
            // Translate to centroid, rotate in t1/t2 plane, translate back
            const lx = (p.x - cx) * t1.x + (p.y - cy2) * t1.y + (p.z - cz) * t1.z;
            const ly = (p.x - cx) * t2.x + (p.y - cy2) * t2.y + (p.z - cz) * t2.z;
            const rx = lx * cosA - ly * sinA;
            const ry = lx * sinA + ly * cosA;
            return {
              ...p, id: crypto.randomUUID(),
              x: cx + t1.x * rx + t2.x * ry,
              y: cy2 + t1.y * rx + t2.y * ry,
              z: cz + t1.z * rx + t2.z * ry,
            };
          }),
        });
      }
    }
    set({
      activeSketch: { ...activeSketch, entities: [...activeSketch.entities, ...copies] },
      statusMessage: `Circular pattern: ${cnt} instances (${copies.length} new entities added)`,
    });
  },

  // Sketch Move / Copy (D24)
  sketchMoveDx: 10,
  sketchMoveDy: 0,
  sketchMoveCopy: false,
  setSketchMove: (params) => set((state) => ({
    sketchMoveDx: params.dx ?? state.sketchMoveDx,
    sketchMoveDy: params.dy ?? state.sketchMoveDy,
    sketchMoveCopy: params.copy ?? state.sketchMoveCopy,
  })),
  commitSketchMove: () => {
    const { activeSketch, sketchMoveDx: dx, sketchMoveDy: dy, sketchMoveCopy: copy } = get();
    if (!activeSketch || activeSketch.entities.length === 0) return;
    const { t1, t2 } = GeometryEngine.getSketchAxes(activeSketch);
    const offsetX = t1.x * dx + t2.x * dy;
    const offsetY = t1.y * dx + t2.y * dy;
    const offsetZ = t1.z * dx + t2.z * dy;
    const translatePts = (ents: SketchEntity[]): SketchEntity[] =>
      ents.map((e) => ({
        ...e,
        id: crypto.randomUUID(),
        points: e.points.map((p) => ({ ...p, id: crypto.randomUUID(), x: p.x + offsetX, y: p.y + offsetY, z: p.z + offsetZ })),
      }));
    const translated = translatePts(activeSketch.entities);
    const newEntities = copy
      ? [...activeSketch.entities, ...translated]
      : translated;
    set({
      activeSketch: { ...activeSketch, entities: newEntities },
      statusMessage: copy ? `Copy moved by (${dx}, ${dy})` : `Sketch moved by (${dx}, ${dy})`,
    });
  },

  // Sketch Scale (D25)
  sketchScaleFactor: 2,
  setSketchScaleFactor: (f) => set({ sketchScaleFactor: Math.max(0.001, f) }),
  commitSketchScale: () => {
    const { activeSketch, sketchScaleFactor: factor } = get();
    if (!activeSketch || activeSketch.entities.length === 0) return;
    // Compute centroid as scale anchor
    let cx = 0, cy2 = 0, cz = 0, n = 0;
    for (const e of activeSketch.entities) {
      for (const p of e.points) { cx += p.x; cy2 += p.y; cz += p.z; n++; }
    }
    if (n === 0) return;
    cx /= n; cy2 /= n; cz /= n;
    const scaled = activeSketch.entities.map((e) => ({
      ...e,
      id: crypto.randomUUID(),
      points: e.points.map((p) => ({
        ...p, id: crypto.randomUUID(),
        x: cx + (p.x - cx) * factor,
        y: cy2 + (p.y - cy2) * factor,
        z: cz + (p.z - cz) * factor,
      })),
      radius: e.radius !== undefined ? e.radius * Math.abs(factor) : undefined,
    }));
    set({
      activeSketch: { ...activeSketch, entities: scaled },
      statusMessage: `Sketch scaled by ${factor}×`,
    });
  },

  // Sketch Rotate (D26)
  sketchRotateAngle: 90,
  setSketchRotateAngle: (a) => set({ sketchRotateAngle: a }),
  commitSketchRotate: () => {
    const { activeSketch, sketchRotateAngle: angleDeg } = get();
    if (!activeSketch || activeSketch.entities.length === 0) return;
    const { t1, t2 } = GeometryEngine.getSketchAxes(activeSketch);
    // Compute centroid as pivot
    let cx = 0, cy2 = 0, cz = 0, n = 0;
    for (const e of activeSketch.entities) {
      for (const p of e.points) { cx += p.x; cy2 += p.y; cz += p.z; n++; }
    }
    if (n === 0) return;
    cx /= n; cy2 /= n; cz /= n;
    const angle = (angleDeg * Math.PI) / 180;
    const cosA = Math.cos(angle), sinA = Math.sin(angle);
    const rotPt = (p: SketchPoint): SketchPoint => {
      const lx = (p.x - cx) * t1.x + (p.y - cy2) * t1.y + (p.z - cz) * t1.z;
      const ly = (p.x - cx) * t2.x + (p.y - cy2) * t2.y + (p.z - cz) * t2.z;
      const rx = lx * cosA - ly * sinA;
      const ry = lx * sinA + ly * cosA;
      return { ...p, id: crypto.randomUUID(), x: cx + t1.x * rx + t2.x * ry, y: cy2 + t1.y * rx + t2.y * ry, z: cz + t1.z * rx + t2.z * ry };
    };
    const rotated = activeSketch.entities.map((e) => ({
      ...e,
      id: crypto.randomUUID(),
      points: e.points.map(rotPt),
    }));
    set({
      activeSketch: { ...activeSketch, entities: rotated },
      statusMessage: `Sketch rotated ${angleDeg}°`,
    });
  },

  // Sketch Offset (D20)
  sketchOffsetDistance: 2,
  setSketchOffsetDistance: (d) => set({ sketchOffsetDistance: Math.max(0.001, Math.abs(d)) }),

  // Sketch Mirror (D21)
  sketchMirrorAxis: 'vertical',
  setSketchMirrorAxis: (axis) => set({ sketchMirrorAxis: axis }),
  commitSketchMirror: () => {
    const { activeSketch, sketchMirrorAxis } = get();
    if (!activeSketch || activeSketch.entities.length === 0) return;
    const { t1, t2 } = GeometryEngine.getSketchAxes(activeSketch);
    // Centroid as mirror origin
    let cx = 0, cy2 = 0, cz = 0, n = 0;
    for (const e of activeSketch.entities) {
      for (const p of e.points) { cx += p.x; cy2 += p.y; cz += p.z; n++; }
    }
    if (n === 0) return;
    cx /= n; cy2 /= n; cz /= n;
    const mirrorPt = (p: SketchPoint): SketchPoint => {
      const lx = (p.x - cx) * t1.x + (p.y - cy2) * t1.y + (p.z - cz) * t1.z;
      const ly = (p.x - cx) * t2.x + (p.y - cy2) * t2.y + (p.z - cz) * t2.z;
      let mx = lx, my = ly;
      if (sketchMirrorAxis === 'horizontal') my = -ly;       // mirror over t1 axis
      else if (sketchMirrorAxis === 'vertical') mx = -lx;    // mirror over t2 axis
      else { const tmp = lx; mx = ly; my = tmp; }            // diagonal (swap)
      return {
        ...p, id: crypto.randomUUID(),
        x: cx + t1.x * mx + t2.x * my,
        y: cy2 + t1.y * mx + t2.y * my,
        z: cz + t1.z * mx + t2.z * my,
      };
    };
    const mirrored: SketchEntity[] = activeSketch.entities.map((e) => ({
      ...e,
      id: crypto.randomUUID(),
      points: e.points.map(mirrorPt),
      startAngle: e.startAngle !== undefined ? -e.endAngle! : undefined,
      endAngle: e.endAngle !== undefined ? -e.startAngle! : undefined,
    }));
    set({
      activeSketch: { ...activeSketch, entities: [...activeSketch.entities, ...mirrored] },
      statusMessage: `Mirror: ${mirrored.length} entities added (${sketchMirrorAxis})`,
    });
  },

  // Conic curve rho (D11)
  conicRho: 0.5,
  setConicRho: (r) => set({ conicRho: Math.max(0.01, Math.min(0.99, r)) }),

  // Tangent circles (D40, D41)
  tangentCircleRadius: 5,
  setTangentCircleRadius: (r) => set({ tangentCircleRadius: Math.max(0.01, r) }),

  // Blend curve continuity (D44)
  blendCurveMode: 'g1' as 'g1' | 'g2',
  setBlendCurveMode: (mode) => set({ blendCurveMode: mode }),

  // Sketch chamfer (D47)
  sketchChamferDist1: 2,
  setSketchChamferDist1: (d) => set({ sketchChamferDist1: Math.max(0.01, d) }),
  sketchChamferDist2: 2,
  setSketchChamferDist2: (d) => set({ sketchChamferDist2: Math.max(0.01, d) }),
  sketchChamferAngle: 45,
  setSketchChamferAngle: (a) => set({ sketchChamferAngle: Math.max(1, Math.min(89, a)) }),

  // Show Profile (D55)
  showSketchProfile: false,
  setShowSketchProfile: (show) => set({ showSketchProfile: show }),

  // Slice (D54)
  sliceEnabled: false,
  setSliceEnabled: (enabled) => set({ sliceEnabled: enabled }),

  // Section Analysis (D38)
  sectionEnabled: false,
  sectionAxis: 'y',
  sectionOffset: 0,
  sectionFlip: false,
  setSectionEnabled: (enabled) => set({ sectionEnabled: enabled }),
  setSectionAxis: (axis) => set({ sectionAxis: axis }),
  setSectionOffset: (offset) => set({ sectionOffset: offset }),
  setSectionFlip: (flip) => set({ sectionFlip: flip }),

  // D182 – Component color overlay
  showComponentColors: false,
  setShowComponentColors: (v) => set({ showComponentColors: v }),

  // D185 – Canvas reference images
  canvasReferences: [],
  addCanvasReference: (ref) => set((state) => ({ canvasReferences: [...state.canvasReferences, ref] })),
  removeCanvasReference: (id) => set((state) => ({ canvasReferences: state.canvasReferences.filter((r) => r.id !== id) })),

  // Visibility toggles (D56)
  showSketchPoints: true,
  setShowSketchPoints: (v) => set({ showSketchPoints: v }),
  showSketchDimensions: true,
  setShowSketchDimensions: (v) => set({ showSketchDimensions: v }),
  showSketchConstraints: true,
  setShowSketchConstraints: (v) => set({ showSketchConstraints: v }),
  showProjectedGeometries: true,
  setShowProjectedGeometries: (v) => set({ showProjectedGeometries: v }),

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

  ...EXTRUDE_DEFAULTS,
  setExtrudeSelectedSketchId: (id) => set({
    extrudeSelectedSketchId: id,
    extrudeSelectedSketchIds: id ? [id] : [],
  }),
  setExtrudeSelectedSketchIds: (ids) => set({
    extrudeSelectedSketchIds: ids,
    extrudeSelectedSketchId: ids[0] ?? null,
  }),
  setExtrudeDistance: (distance) => set({ extrudeDistance: distance }),
  setExtrudeDirection: (d) => set({ extrudeDirection: d }),
  setExtrudeOperation: (o) => set({ extrudeOperation: o }),
  // Thin extrude (D66)
  setExtrudeThinEnabled: (v) => set({ extrudeThinEnabled: v }),
  setExtrudeThinThickness: (t) => set({ extrudeThinThickness: Math.max(0.01, t) }),
  setExtrudeThinSide: (s) => set({ extrudeThinSide: s }),
  // D67 start options
  setExtrudeStartType: (t) => set({ extrudeStartType: t }),
  setExtrudeStartOffset: (v) => set({ extrudeStartOffset: v }),
  // D68 extent types
  setExtrudeExtentType: (t) => set({ extrudeExtentType: t }),
  // D69 taper angle
  setExtrudeTaperAngle: (a) => set({ extrudeTaperAngle: a }),
  // D102 body kind
  setExtrudeBodyKind: (k) => set({ extrudeBodyKind: k }),
  startExtrudeTool: () => {
    set({
      activeTool: 'extrude',
      ...EXTRUDE_DEFAULTS,
      extrudeSelectedSketchId: null, // Wait for the user to pick — no auto-select
      statusMessage: 'Click a profile or face to extrude',
    });
  },
  startExtrudeFromFace: (boundary, normal, centroid) => {
    if (boundary.length < 3) {
      set({ statusMessage: 'Cannot extrude — face boundary too small' });
      return;
    }
    // Build a synthetic Sketch in the 'custom' face plane. Each consecutive
    // pair of boundary points becomes a 'line' SketchEntity. The loop is
    // closed by the final segment from boundary[n-1] back to boundary[0].
    const points: SketchPoint[] = boundary.map((p) => ({
      id: crypto.randomUUID(),
      x: p.x, y: p.y, z: p.z,
    }));
    const entities: SketchEntity[] = [];
    for (let i = 0; i < points.length; i++) {
      const next = (i + 1) % points.length;
      entities.push({
        id: crypto.randomUUID(),
        type: 'line',
        points: [points[i], points[next]],
      });
    }
    const { sketches } = get();
    const pressPullCount = sketches.filter((s) => s.name.startsWith('Press Pull Profile')).length;
    const sketch: Sketch = {
      id: crypto.randomUUID(),
      name: `Press Pull Profile ${pressPullCount + 1}`,
      plane: 'custom',
      planeNormal: normal.clone().normalize(),
      planeOrigin: centroid.clone(),
      entities,
      constraints: [],
      dimensions: [],
      fullyConstrained: false,
    };
    set({
      sketches: [...sketches, sketch],
      extrudeSelectedSketchId: sketch.id,
      extrudeSelectedSketchIds: [sketch.id],
      extrudeDirection: 'normal',
      statusMessage: 'Press-pull profile selected — drag arrow or set distance, then OK',
    });
  },
  cancelExtrudeTool: () => {
    // Discard any auto-generated press-pull profiles that were never committed
    const { sketches, features } = get();
    const usedSketchIds = new Set(features.map((f) => f.sketchId).filter(Boolean));
    const cleanedSketches = sketches.filter(
      (s) => !s.name.startsWith('Press Pull Profile') || usedSketchIds.has(s.id),
    );
    set({
      activeTool: 'select',
      ...EXTRUDE_DEFAULTS,
      sketches: cleanedSketches,
      statusMessage: 'Extrude cancelled',
    });
  },
  commitExtrude: () => {
    const {
      extrudeSelectedSketchId, extrudeSelectedSketchIds, extrudeDistance, extrudeDirection,
      extrudeOperation, extrudeThinEnabled, extrudeThinThickness, extrudeThinSide,
      extrudeStartType, extrudeStartOffset, extrudeExtentType, extrudeTaperAngle,
      extrudeBodyKind,
      sketches, features, units,
    } = get();
    const selectedSketchIds =
      extrudeSelectedSketchIds.length > 0
        ? extrudeSelectedSketchIds
        : (extrudeSelectedSketchId ? [extrudeSelectedSketchId] : []);
    if (selectedSketchIds.length === 0) {
      set({ statusMessage: 'No profile selected' });
      return;
    }
    const selectedProfiles = selectedSketchIds
      .map((id) => {
        const [sketchId, rawIndex] = id.split('::');
        const sourceSketch = sketches.find((s) => s.id === sketchId);
        if (!sourceSketch) return null;
        if (rawIndex === undefined) {
          return { sourceSketch, sketchForOp: sourceSketch, selectionId: id };
        }
        const parsed = Number(rawIndex);
        if (!Number.isFinite(parsed)) return null;
        const profileSketch = GeometryEngine.createProfileSketch(sourceSketch, parsed);
        if (!profileSketch) return null;
        return { sourceSketch, sketchForOp: profileSketch, selectionId: id };
      })
      .filter(Boolean) as { sourceSketch: Sketch; sketchForOp: Sketch; selectionId: string }[];

    if (selectedProfiles.length === 0) {
      set({ statusMessage: 'Selected profile not found' });
      return;
    }
    if (extrudeExtentType === 'distance' && Math.abs(extrudeDistance) < 0.01) {
      set({ statusMessage: 'Distance must be non-zero' });
      return;
    }
    // Signed distance: negative means press-pull INTO the body → cut.
    const isCutDrag = extrudeDistance < 0;
    // 'all' extent uses a large through-all distance
    const absDistance = extrudeExtentType === 'all' ? 10000 : Math.abs(extrudeDistance);
    const finalDirection = isCutDrag ? 'reverse' : extrudeDirection;
    const finalOperation = isCutDrag ? 'cut' : extrudeOperation;

    const nextFeatures = [...features];
    let createdCount = 0;
    let firstCreatedSketchName: string | null = null;

    for (const selected of selectedProfiles) {
      const { sourceSketch, sketchForOp } = selected;
      const isClosedProfile = GeometryEngine.isSketchClosedProfile(sketchForOp);
      const resolvedBodyKind: 'solid' | 'surface' = (!isClosedProfile || extrudeBodyKind === 'surface') ? 'surface' : 'solid';

      // Generate mesh: surface → thin → taper → standard
      let featureMesh: THREE.Mesh | undefined;
      if (resolvedBodyKind === 'surface') {
        featureMesh = GeometryEngine.extrudeSketchSurface(sketchForOp, absDistance) ?? undefined;
      } else if (extrudeThinEnabled) {
        featureMesh = GeometryEngine.extrudeThinSketch(sketchForOp, absDistance, extrudeThinThickness, extrudeThinSide) ?? undefined;
      } else if (Math.abs(extrudeTaperAngle) > 0.01) {
        featureMesh = GeometryEngine.extrudeSketchWithTaper(sketchForOp, absDistance, extrudeTaperAngle) ?? undefined;
      }

      // Apply start offset: shift the mesh along the extrude normal
      if (featureMesh && extrudeStartType === 'offset' && Math.abs(extrudeStartOffset) > 0.001) {
        const n = GeometryEngine.getSketchExtrudeNormal(sketchForOp);
        featureMesh.position.addScaledVector(n, extrudeStartOffset);
      }

      const featureId = crypto.randomUUID();
      let componentId: string | undefined;
      let bodyId: string | undefined;
      if (finalOperation === 'new-body') {
        const componentStore = useComponentStore.getState();
        componentId = componentStore.activeComponentId;
        const bodyCount = Object.keys(componentStore.bodies).length + 1;
        const bodyLabel = `${resolvedBodyKind === 'surface' ? 'Surface' : 'Body'} ${bodyCount}`;
        const createdBodyId = componentStore.addBody(componentId, bodyLabel);
        if (createdBodyId) {
          bodyId = createdBodyId;
          componentStore.addFeatureToBody(createdBodyId, featureId);
          if (featureMesh) componentStore.setBodyMesh(createdBodyId, featureMesh);
        }
      }

      const feature: Feature = {
        id: featureId,
        name: `${extrudeThinEnabled ? 'Thin ' : ''}${finalOperation === 'cut' ? 'Cut' : 'Extrude'} ${features.filter(f => f.type === 'extrude').length + createdCount + 1}`,
        type: 'extrude',
        sketchId: sourceSketch.id,
        bodyId,
        componentId,
        params: {
          distance: finalDirection === 'symmetric' ? absDistance / 2 : absDistance,
          distanceExpr: String(absDistance),
          direction: finalDirection,
          operation: finalOperation,
          thin: extrudeThinEnabled,
          thinThickness: extrudeThinThickness,
          thinSide: extrudeThinSide,
          startType: extrudeStartType,
          startOffset: extrudeStartOffset,
          extentType: extrudeExtentType,
          taperAngle: extrudeTaperAngle,
        },
        visible: true,
        suppressed: false,
        timestamp: Date.now(),
        mesh: featureMesh,
        bodyKind: resolvedBodyKind,
      };

      nextFeatures.push(feature);
      createdCount += 1;
      if (!firstCreatedSketchName) firstCreatedSketchName = sourceSketch.name;
    }

    set({
      features: nextFeatures,
      activeTool: 'select',
      ...EXTRUDE_DEFAULTS,
      statusMessage:
        createdCount > 1
          ? `${finalOperation === 'cut' ? 'Cut' : 'Extruded'} ${createdCount} profiles${extrudeExtentType === 'all' ? ' (All)' : ` by ${absDistance}${units}`}`
          : `${finalOperation === 'cut' ? 'Cut' : 'Extruded'} ${firstCreatedSketchName ?? 'profile'}${extrudeExtentType === 'all' ? ' (All)' : ` by ${absDistance}${units}`}`,
    });
  },

  // ─── Revolve tool ──────────────────────────────────────────────────────
  ...REVOLVE_DEFAULTS,
  setRevolveSelectedSketchId: (id) => set({ revolveSelectedSketchId: id }),
  setRevolveAxis: (a) => set({ revolveAxis: a }),
  setRevolveAngle: (angle) => set({ revolveAngle: angle }),
  // D70 direction modes
  setRevolveDirection: (d) => set({ revolveDirection: d }),
  setRevolveAngle2: (a) => set({ revolveAngle2: a }),
  // D103 body kind
  setRevolveBodyKind: (k) => set({ revolveBodyKind: k }),
  startRevolveTool: () => {
    const extrudable = get().sketches.filter((s) => s.entities.length > 0);
    if (extrudable.length === 0) {
      set({ statusMessage: 'Create a sketch first before revolving' });
      return;
    }
    set({
      activeTool: 'revolve',
      ...REVOLVE_DEFAULTS,
      statusMessage: 'Revolve — pick a profile from the panel',
    });
  },
  cancelRevolveTool: () => {
    set({
      activeTool: 'select',
      ...REVOLVE_DEFAULTS,
      statusMessage: 'Revolve cancelled',
    });
  },
  commitRevolve: () => {
    const { revolveSelectedSketchId, revolveAxis, revolveAngle, revolveDirection, revolveAngle2, revolveBodyKind, sketches, features, units } = get();
    if (!revolveSelectedSketchId) {
      set({ statusMessage: 'No profile selected for revolve' });
      return;
    }
    const sketch = sketches.find((s) => s.id === revolveSelectedSketchId);
    if (!sketch) {
      set({ statusMessage: 'Selected profile not found' });
      return;
    }
    // For symmetric, each side gets angle/2; for two-sides, side1=revolveAngle, side2=revolveAngle2.
    // The stored angle is always the primary (or full) angle — the renderer uses revolveDirection.
    const primaryAngle = revolveDirection === 'symmetric' ? revolveAngle / 2 : revolveAngle;
    if (Math.abs(primaryAngle) < 0.5) {
      set({ statusMessage: 'Angle must be greater than 0' });
      return;
    }
    const feature: Feature = {
      id: crypto.randomUUID(),
      name: `${revolveBodyKind === 'surface' ? 'Surface ' : ''}Revolve ${features.filter((f) => f.type === 'revolve').length + 1}`,
      type: 'revolve',
      sketchId: revolveSelectedSketchId,
      params: {
        angle: revolveAngle,
        axis: revolveAxis,
        direction: revolveDirection,
        angle2: revolveAngle2,
      },
      visible: true,
      suppressed: false,
      timestamp: Date.now(),
      bodyKind: revolveBodyKind === 'surface' ? 'surface' : 'solid',
    };
    const angleDesc = revolveDirection === 'symmetric'
      ? `±${revolveAngle / 2}°`
      : revolveDirection === 'two-sides'
        ? `${revolveAngle}°/${revolveAngle2}°`
        : `${revolveAngle}°`;
    set({
      features: [...features, feature],
      activeTool: 'select',
      ...REVOLVE_DEFAULTS,
      statusMessage: `Revolved ${sketch.name} by ${angleDesc} around ${revolveAxis} (${units})`,
    });
  },

  // ─── Sweep tool (D30 / D104) ───────────────────────────────────────────
  sweepProfileSketchId: null,
  setSweepProfileSketchId: (id) => set({ sweepProfileSketchId: id }),
  sweepPathSketchId: null,
  setSweepPathSketchId: (id) => set({ sweepPathSketchId: id }),
  sweepBodyKind: 'solid',
  setSweepBodyKind: (k) => set({ sweepBodyKind: k }),
  startSweepTool: () => {
    const extrudable = get().sketches.filter((s) => s.entities.length > 0);
    if (extrudable.length < 2) {
      set({ statusMessage: 'Sweep requires at least 2 sketches — a profile and a path' });
      return;
    }
    set({ activeTool: 'sweep', sweepProfileSketchId: null, sweepPathSketchId: null, statusMessage: 'Sweep — pick a profile sketch, then a path sketch in the panel' });
  },
  cancelSweepTool: () => set({ activeTool: 'select', sweepProfileSketchId: null, sweepPathSketchId: null, statusMessage: 'Sweep cancelled' }),
  commitSweep: () => {
    const { sweepProfileSketchId, sweepPathSketchId, sweepBodyKind, sketches, features, units } = get();
    if (!sweepProfileSketchId || !sweepPathSketchId) {
      set({ statusMessage: 'Select both a profile sketch and a path sketch' });
      return;
    }
    const profileSketch = sketches.find((s) => s.id === sweepProfileSketchId);
    const pathSketch = sketches.find((s) => s.id === sweepPathSketchId);
    if (!profileSketch || !pathSketch) {
      set({ statusMessage: 'Selected sketch(es) not found' });
      return;
    }
    const mesh = GeometryEngine.sweepSketchInternal(profileSketch, pathSketch, sweepBodyKind === 'surface');
    const feature: Feature = {
      id: crypto.randomUUID(),
      name: `${sweepBodyKind === 'surface' ? 'Surface ' : ''}Sweep ${features.filter((f) => f.type === 'sweep').length + 1}`,
      type: 'sweep',
      sketchId: sweepProfileSketchId,
      params: { pathSketchId: sweepPathSketchId },
      visible: true,
      suppressed: false,
      timestamp: Date.now(),
      mesh: mesh ?? undefined,
      bodyKind: sweepBodyKind === 'surface' ? 'surface' : 'solid',
    };
    set({
      features: [...features, feature],
      activeTool: 'select',
      sweepProfileSketchId: null,
      sweepPathSketchId: null,
      sweepBodyKind: 'solid',
      statusMessage: `${sweepBodyKind === 'surface' ? 'Surface ' : ''}Sweep created (${units})`,
    });
  },

  // ─── Loft tool (D31 / D105) ───────────────────────────────────────────
  loftProfileSketchIds: [],
  setLoftProfileSketchIds: (ids) => set({ loftProfileSketchIds: ids }),
  loftBodyKind: 'solid',
  setLoftBodyKind: (k) => set({ loftBodyKind: k }),
  startLoftTool: () => {
    const extrudable = get().sketches.filter((s) => s.entities.length > 0);
    if (extrudable.length < 2) {
      set({ statusMessage: 'Loft requires at least 2 profile sketches' });
      return;
    }
    set({ activeTool: 'loft', loftProfileSketchIds: ['', ''], statusMessage: 'Loft — select 2+ profile sketches in the panel, then OK' });
  },
  cancelLoftTool: () => set({ activeTool: 'select', loftProfileSketchIds: [], statusMessage: 'Loft cancelled' }),
  commitLoft: () => {
    const { loftProfileSketchIds, loftBodyKind, sketches, features, units } = get();
    const validIds = loftProfileSketchIds.filter(Boolean);
    if (validIds.length < 2) {
      set({ statusMessage: 'Select at least 2 profile sketches' });
      return;
    }
    const profileSketches = validIds.map((id) => sketches.find((s) => s.id === id)).filter(Boolean) as typeof sketches;
    if (profileSketches.length < 2) {
      set({ statusMessage: 'One or more selected profiles not found' });
      return;
    }
    const mesh = GeometryEngine.loftSketches(profileSketches, loftBodyKind === 'surface');
    const feature: Feature = {
      id: crypto.randomUUID(),
      name: `${loftBodyKind === 'surface' ? 'Surface ' : ''}Loft ${features.filter((f) => f.type === 'loft').length + 1}`,
      type: 'loft',
      sketchId: validIds[0],
      params: { loftProfileIds: validIds.join(',') },
      visible: true,
      suppressed: false,
      timestamp: Date.now(),
      mesh: mesh ?? undefined,
      bodyKind: loftBodyKind === 'surface' ? 'surface' : 'solid',
    };
    set({
      features: [...features, feature],
      activeTool: 'select',
      loftProfileSketchIds: [],
      statusMessage: `${loftBodyKind === 'surface' ? 'Surface ' : ''}Loft created across ${profileSketches.length} profiles (${units})`,
    });
  },

  // ─── Patch tool (D106) ────────────────────────────────────────────────
  patchSelectedSketchId: null,
  setPatchSelectedSketchId: (id) => set({ patchSelectedSketchId: id }),
  startPatchTool: () => {
    const sketches = get().sketches.filter((s) => s.entities.length > 0);
    if (sketches.length === 0) {
      set({ statusMessage: 'Create a sketch first before using Patch' });
      return;
    }
    set({ activeTool: 'patch' as Tool, patchSelectedSketchId: null, statusMessage: 'Patch — select a closed profile sketch in the panel' });
  },
  cancelPatchTool: () => set({ activeTool: 'select', patchSelectedSketchId: null, statusMessage: 'Patch cancelled' }),
  commitPatch: () => {
    const { patchSelectedSketchId, sketches, features, units } = get();
    if (!patchSelectedSketchId) {
      set({ statusMessage: 'No profile selected for Patch' });
      return;
    }
    const sketch = sketches.find((s) => s.id === patchSelectedSketchId);
    if (!sketch) {
      set({ statusMessage: 'Selected sketch not found' });
      return;
    }
    const mesh = GeometryEngine.patchSketch(sketch);
    const feature: Feature = {
      id: crypto.randomUUID(),
      name: `Patch ${features.filter((f) => f.type === 'extrude' && f.bodyKind === 'surface' && f.params.patchSketchId !== undefined).length + 1}`,
      type: 'extrude',
      sketchId: patchSelectedSketchId,
      params: { patchSketchId: patchSelectedSketchId },
      visible: true,
      suppressed: false,
      timestamp: Date.now(),
      mesh: mesh ?? undefined,
      bodyKind: 'surface',
    };
    set({
      features: [...features, feature],
      activeTool: 'select',
      patchSelectedSketchId: null,
      statusMessage: `Patch surface created (${units})`,
    });
  },

  // ─── Ruled Surface tool (D107) ────────────────────────────────────────
  ruledSketchAId: null,
  setRuledSketchAId: (id) => set({ ruledSketchAId: id }),
  ruledSketchBId: null,
  setRuledSketchBId: (id) => set({ ruledSketchBId: id }),
  startRuledSurfaceTool: () => {
    const sketches = get().sketches.filter((s) => s.entities.length > 0);
    if (sketches.length < 2) {
      set({ statusMessage: 'Ruled Surface requires at least 2 sketches' });
      return;
    }
    set({ activeTool: 'ruled-surface' as Tool, ruledSketchAId: null, ruledSketchBId: null, statusMessage: 'Ruled Surface — select Curve A and Curve B sketches in the panel' });
  },
  cancelRuledSurfaceTool: () => set({ activeTool: 'select', ruledSketchAId: null, ruledSketchBId: null, statusMessage: 'Ruled Surface cancelled' }),
  commitRuledSurface: () => {
    const { ruledSketchAId, ruledSketchBId, sketches, features, units } = get();
    if (!ruledSketchAId || !ruledSketchBId) {
      set({ statusMessage: 'Select two curve sketches for Ruled Surface' });
      return;
    }
    const sketchA = sketches.find((s) => s.id === ruledSketchAId);
    const sketchB = sketches.find((s) => s.id === ruledSketchBId);
    if (!sketchA || !sketchB) {
      set({ statusMessage: 'One or more selected sketches not found' });
      return;
    }
    const mesh = GeometryEngine.ruledSurface(sketchA, sketchB);
    const feature: Feature = {
      id: crypto.randomUUID(),
      name: `Ruled Surface ${features.filter((f) => f.type === 'loft' && f.bodyKind === 'surface').length + 1}`,
      type: 'loft',
      sketchId: ruledSketchAId,
      params: { ruledSketchAId, ruledSketchBId },
      visible: true,
      suppressed: false,
      timestamp: Date.now(),
      mesh: mesh ?? undefined,
      bodyKind: 'surface',
    };
    set({
      features: [...features, feature],
      activeTool: 'select',
      ruledSketchAId: null,
      ruledSketchBId: null,
      statusMessage: `Ruled Surface created (${units})`,
    });
  },

  // ─── Rib tool (D73) ───────────────────────────────────────────────────
  ribSelectedSketchId: null,
  setRibSelectedSketchId: (id) => set({ ribSelectedSketchId: id }),
  ribThickness: 2,
  setRibThickness: (t) => set({ ribThickness: Math.max(0.01, t) }),
  ribHeight: 10,
  setRibHeight: (h) => set({ ribHeight: Math.max(0.01, h) }),
  ribDirection: 'normal',
  setRibDirection: (d) => set({ ribDirection: d }),
  startRibTool: () => {
    const sketches = get().sketches.filter((s) => s.entities.length > 0);
    if (sketches.length === 0) {
      set({ statusMessage: 'Create a sketch first before adding a rib' });
      return;
    }
    set({ activeTool: 'rib' as Tool, ribSelectedSketchId: null, statusMessage: 'Rib — pick a profile sketch in the panel' });
  },
  cancelRibTool: () => set({ activeTool: 'select', ribSelectedSketchId: null, statusMessage: 'Rib cancelled' }),
  commitRib: () => {
    const { ribSelectedSketchId, ribThickness, ribHeight, ribDirection, sketches, features, units } = get();
    if (!ribSelectedSketchId) {
      set({ statusMessage: 'No profile selected for rib' });
      return;
    }
    const sketch = sketches.find((s) => s.id === ribSelectedSketchId);
    if (!sketch) {
      set({ statusMessage: 'Selected sketch not found' });
      return;
    }
    // Rib = thin extrude of open profile in center mode, height along sketch normal.
    // For 'flip', pass height as negative (mirrors direction).
    const signedHeight = ribDirection === 'flip' ? -ribHeight : ribHeight;
    const ribMesh = GeometryEngine.extrudeThinSketch(sketch, Math.abs(signedHeight), ribThickness, 'center') ?? undefined;
    const feature: Feature = {
      id: crypto.randomUUID(),
      name: `Rib ${features.filter((f) => f.type === 'rib').length + 1}`,
      type: 'rib',
      sketchId: ribSelectedSketchId,
      params: { thickness: ribThickness, height: ribHeight, direction: ribDirection },
      visible: true,
      suppressed: false,
      timestamp: Date.now(),
      mesh: ribMesh,
    };
    set({
      features: [...features, feature],
      activeTool: 'select',
      ribSelectedSketchId: null,
      statusMessage: `Rib created: ${ribThickness}mm thick, ${ribHeight}${units} tall`,
    });
  },

  showExportDialog: false,
  setShowExportDialog: (show) => set({ showExportDialog: show }),

  activeDialog: null,
  setActiveDialog: (dialog) => set((state) => ({
    activeDialog: dialog,
    // D186: closing the dialog also clears editing state so the next one opens fresh
    editingFeatureId: dialog === null ? null : state.editingFeatureId,
  })),
  dialogPayload: null,
  setDialogPayload: (payload) => set({ dialogPayload: payload }),

  measurePoints: [],
  setMeasurePoints: (pts) => set({ measurePoints: pts }),
  clearMeasure: () => set({ measurePoints: [] }),

  statusMessage: 'Ready',
  setStatusMessage: (message) => set({ statusMessage: message }),

  units: 'mm',
  setUnits: (units) => set({ units: units }),
  selectionFilter: 'all',
  setSelectionFilter: (filter) => set({ selectionFilter: filter }),

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

  // A5 — stub until Component Browser (A1) populates a components array
  groundComponent: (_id, _grounded) => {
    /* no components array yet; will be populated with A1 Component Browser */
  },
}),
{
  name: 'dzign3d-cad',
  storage: idbStorage as any,
  version: 3,
  migrate: (persistedState: unknown, _version: number) => {
    const state = (persistedState ?? {}) as Partial<CADState>;
    return {
      ...state,
      sketches: (state.sketches ?? []).map((s) => deserializeSketch(s as Sketch)),
      features: (state.features ?? []).map((f) => deserializeFeature(f as Feature)),
    };
  },

  merge: (persistedState: unknown, currentState: CADState): CADState => {
    const state = (persistedState ?? {}) as Partial<CADState>;
    return {
      ...currentState,
      ...state,
      activeSketch: state.activeSketch ? deserializeSketch(state.activeSketch as Sketch) : currentState.activeSketch,
      sketches: (state.sketches ?? currentState.sketches).map((s) => deserializeSketch(s as Sketch)),
      features: (state.features ?? currentState.features).map((f) => deserializeFeature(f as Feature)),
    };
  },

  // Persist user preferences + model timeline/sketch data.
  partialize: (state) => ({
    // User preferences
    gridSize: state.gridSize,
    snapEnabled: state.snapEnabled,
    gridVisible: state.gridVisible,
    sketchPolygonSides: state.sketchPolygonSides,
    sketchFilletRadius: state.sketchFilletRadius,
    units: state.units,
    visualStyle: state.visualStyle,
    showEnvironment: state.showEnvironment,
    showShadows: state.showShadows,
    showGroundPlane: state.showGroundPlane,
    showComponentColors: state.showComponentColors,
    // Model data
    sketches: state.sketches,
    features: state.features.map((f) => serializeFeature(f) as Feature),
    parameters: state.parameters,
    frozenFormVertices: state.frozenFormVertices,
  }),

}));
