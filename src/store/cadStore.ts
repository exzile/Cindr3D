import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { PersistStorage } from 'zustand/middleware';
import * as THREE from 'three';
import type { Tool, ViewMode, SketchPlane, Sketch, SketchEntity, SketchPoint, SketchConstraint, SketchDimension, Feature, FeatureGroup, Parameter, FormCage, FormSelection, FormElementType, ConstructionPlane, ConstructionAxis, ConstructionPoint, JointOriginRecord, InterferenceResult, ContactSetEntry } from '../types/cad';
import type { InsertComponentParams } from '../components/dialogs/assembly/InsertComponentDialog';
import type { DirectEditParams } from '../components/dialogs/solid/DirectEditDialog';
import type { TextureExtrudeParams } from '../components/dialogs/solid/TextureExtrudeDialog';

/** CORR-2: 'two-sides' enables asymmetric extrude with separate side distances */
export type ExtrudeDirection = 'positive' | 'symmetric' | 'negative' | 'two-sides';
export type ExtrudeOperation = 'new-body' | 'join' | 'cut' | 'intersect' | 'new-component';
import { evaluateExpression, resolveParameters } from '../utils/expressionEval';
import { GeometryEngine } from '../engine/GeometryEngine';
import { solveConstraints } from '../engine/ConstraintSolver';
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
      // Wait for the delete transaction to commit before closing the db.
      // Calling db.close() synchronously after .delete() can abort the
      // transaction so the remove never actually persists.
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').delete(name);
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror    = () => { db.close(); reject(tx.error); };
      });
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
  /** D50: Auto-detect and apply geometric constraints (horizontal/vertical/coincident/parallel/equal) */
  autoConstrainSketch: () => void;
  /** D27: Run the Newton-Raphson constraint solver on the active sketch. */
  solveSketch: () => void;
  /** CORR-7: when true, constraint solver is not called automatically on entity/constraint changes */
  sketchComputeDeferred: boolean;
  setSketchComputeDeferred: (v: boolean) => void;
  // D52: Constraint application state — accumulates clicked entity IDs before applying
  constraintSelection: string[];
  setConstraintSelection: (ids: string[]) => void;
  addToConstraintSelection: (id: string) => void;
  clearConstraintSelection: () => void;
  /** SK-A9: offset distance for the 'constrain-offset' tool */
  constraintOffsetValue: number;
  setConstraintOffsetValue: (v: number) => void;
  /** SK-A1: surface constraint pending surface pick */
  constraintSurfacePlane: { nu: number; nv: number; d: number } | null;
  setConstraintSurfacePlane: (plane: { nu: number; nv: number; d: number } | null) => void;
  /** D52: Add a single constraint to the active sketch (deduplicates by type+entityIds). */
  addSketchConstraint: (constraint: SketchConstraint) => void;

  // Feature timeline
  features: Feature[];
  addFeature: (feature: Feature) => void;
  addPrimitive: (kind: 'box' | 'cylinder' | 'sphere' | 'torus' | 'coil', params: Record<string, number>) => void;
  /** D194: Insert a fastener from the fastener library as a solid body feature. */
  insertFastener: (params: {
    type: string; size: string;
    diameter: number; headDiameter: number; headHeight: number; length: number;
    x: number; y: number; z: number;
  }) => void;
  /** D195: import selected items from a derived source file */
  deriveFromDesign: (itemIds: string[], sourceFileName: string) => void;
  /** D119: Clone a feature's geometry as a new mesh-body primitive. */
  tessellateFeature: (featureId: string) => void;
  removeFeature: (id: string) => void;
  renameFeature: (id: string, name: string) => void;
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

  // MM3 — Base Feature container
  baseFeatureActive: boolean;
  openBaseFeature: (name: string) => void;
  finishBaseFeature: () => void;

  // MM4 — Timeline feature groups
  featureGroups: FeatureGroup[];
  createFeatureGroup: (name: string, featureIds: string[]) => void;
  renameFeatureGroup: (groupId: string, name: string) => void;
  deleteFeatureGroup: (groupId: string) => void;
  toggleFeatureGroup: (groupId: string) => void;
  /** CTX-12: Move a feature into an existing group (or pass null to ungroup) */
  moveFeatureToGroup: (featureId: string, groupId: string | null) => void;
  /** CORR-17: Nest a group inside another group (or pass null to move to top level) */
  nestGroupInGroup: (childGroupId: string, parentGroupId: string | null) => void;

  // Selection
  selectedEntityIds: string[];
  setSelectedEntityIds: (ids: string[]) => void;
  toggleEntitySelection: (id: string) => void;

  // D204 — Window Selection
  windowSelecting: boolean;
  windowSelectStart: { x: number; y: number } | null;
  windowSelectEnd: { x: number; y: number } | null;
  setWindowSelectStart: (p: { x: number; y: number }) => void;
  setWindowSelectEnd: (p: { x: number; y: number }) => void;
  clearWindowSelect: () => void;

  // D205 — Lasso Selection
  lassoSelecting: boolean;
  lassoPoints: { x: number; y: number }[];
  setLassoSelecting: (v: boolean) => void;
  setLassoPoints: (pts: { x: number; y: number }[]) => void;
  clearLasso: () => void;

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
  // NAV-24: per-type object snap toggles (master toggle + six types)
  objectSnapEnabled: boolean;
  setObjectSnapEnabled: (v: boolean) => void;
  snapToEndpoint: boolean;
  setSnapToEndpoint: (v: boolean) => void;
  snapToMidpoint: boolean;
  setSnapToMidpoint: (v: boolean) => void;
  snapToCenter: boolean;
  setSnapToCenter: (v: boolean) => void;
  snapToIntersection: boolean;
  setSnapToIntersection: (v: boolean) => void;
  snapToPerpendicular: boolean;
  setSnapToPerpendicular: (v: boolean) => void;
  snapToTangent: boolean;
  setSnapToTangent: (v: boolean) => void;

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
  // SK-A2: Sketch Pattern on Path
  sketchPathPatternCount: number;
  sketchPathPatternPathEntityId: string;
  sketchPathPatternAlignment: 'tangent' | 'fixed';
  setSketchPathPattern: (params: { count?: number; pathEntityId?: string; alignment?: 'tangent' | 'fixed' }) => void;
  commitSketchPathPattern: () => void;
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
  // D58: 3D Sketch mode — shows planar manipulator gizmo
  sketch3DMode: boolean;
  setSketch3DMode: (v: boolean) => void;
  toggleSketch3DMode: () => void;
  // S7: active draw plane override for 3D sketch multi-plane support
  sketch3DActivePlane: { normal: [number, number, number]; origin: [number, number, number] } | null;
  setSketch3DActivePlane: (plane: { normal: [number, number, number]; origin: [number, number, number] } | null) => void;
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
  /** SK-A7: toggle construction geometry visibility in the active sketch */
  showConstructionGeometries: boolean;
  setShowConstructionGeometries: (v: boolean) => void;
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
  // NAV-25: ground plane Y offset
  groundPlaneOffset: number;
  setGroundPlaneOffset: (v: number) => void;
  // NAV-26: shadow softness (ContactShadows blur)
  shadowSoftness: number;
  setShadowSoftness: (v: number) => void;
  // NAV-21: Ambient Occlusion (SSAO via @react-three/postprocessing)
  ambientOcclusionEnabled: boolean;
  setAmbientOcclusionEnabled: (enabled: boolean) => void;
  environmentPreset: string;
  setEnvironmentPreset: (preset: string) => void;

  // NAV-23: Object Visibility per entity type
  entityVisSketchBodies: boolean;   // non-active sketch outlines
  entityVisConstruction: boolean;    // construction planes/axes/points
  entityVisOrigins: boolean;         // world axes (X/Y/Z)
  entityVisJoints: boolean;          // joint gizmos
  setEntityVisSketchBodies: (v: boolean) => void;
  setEntityVisConstruction: (v: boolean) => void;
  setEntityVisOrigins: (v: boolean) => void;
  setEntityVisJoints: (v: boolean) => void;

  // NAV-20: Camera projection
  cameraProjection: 'perspective' | 'orthographic';
  setCameraProjection: (p: 'perspective' | 'orthographic') => void;

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
  /** CORR-2: second side distance used when direction === 'two-sides' */
  extrudeDistance2: number;
  setExtrudeDistance2: (distance: number) => void;
  extrudeDirection: ExtrudeDirection;
  setExtrudeDirection: (d: ExtrudeDirection) => void;
  extrudeOperation: ExtrudeOperation;
  setExtrudeOperation: (o: ExtrudeOperation) => void;
  startExtrudeTool: () => void;
  startExtrudeFromFace: (boundary: THREE.Vector3[], normal: THREE.Vector3, centroid: THREE.Vector3) => void;
  /** EX-13: load an existing extrude feature into the panel for editing. */
  loadExtrudeForEdit: (featureId: string) => void;
  cancelExtrudeTool: () => void;
  commitExtrude: () => void;
  // Thin extrude (D66)
  extrudeThinEnabled: boolean;
  setExtrudeThinEnabled: (v: boolean) => void;
  extrudeThinThickness: number;
  setExtrudeThinThickness: (t: number) => void;
  extrudeThinSide: 'side1' | 'side2' | 'center';
  setExtrudeThinSide: (s: 'side1' | 'side2' | 'center') => void;
  // EX-7: independent wall location per side for two-sided thin extrude
  extrudeThinSide2: 'side1' | 'side2' | 'center';
  setExtrudeThinSide2: (s: 'side1' | 'side2' | 'center') => void;
  // EX-8: independent thickness per side for two-sided thin extrude
  extrudeThinThickness2: number;
  setExtrudeThinThickness2: (t: number) => void;
  // Extrude start options (D67 / CORR-8)
  extrudeStartType: 'profile' | 'offset' | 'entity';
  setExtrudeStartType: (t: 'profile' | 'offset' | 'entity') => void;
  extrudeStartOffset: number;
  setExtrudeStartOffset: (v: number) => void;
  // CORR-8: EntityStartDefinition — face/plane ID to start from
  extrudeStartEntityId: string | null;
  setExtrudeStartEntityId: (id: string | null) => void;
  /** EX-4: face normal + centroid for From-Entity start (picked via viewport) */
  extrudeStartFaceNormal: [number, number, number] | null;
  extrudeStartFaceCentroid: [number, number, number] | null;
  setExtrudeStartFace: (normal: [number, number, number], centroid: [number, number, number]) => void;
  clearExtrudeStartFace: () => void;
  // Extrude extent types (D68) — EX-3: added 'to-object'
  extrudeExtentType: 'distance' | 'all' | 'to-object';
  setExtrudeExtentType: (t: 'distance' | 'all' | 'to-object') => void;
  // EX-10: independent extent type for side 2 when direction=two-sides
  extrudeExtentType2: 'distance' | 'all' | 'to-object';
  setExtrudeExtentType2: (t: 'distance' | 'all' | 'to-object') => void;
  /** EX-3: face data for To-Object terminus (picked via viewport) */
  extrudeToEntityFaceId: string | null;
  extrudeToEntityFaceNormal: [number, number, number] | null;
  extrudeToEntityFaceCentroid: [number, number, number] | null;
  setExtrudeToEntityFace: (id: string, normal: [number, number, number], centroid: [number, number, number]) => void;
  clearExtrudeToEntityFace: () => void;
  /** EX-12: directionHint — flip the "to-object" direction when the face is behind the profile */
  extrudeToObjectFlipDirection: boolean;
  setExtrudeToObjectFlipDirection: (v: boolean) => void;
  /** EX-11: add a planar face as an additional profile while a sketch is already selected */
  addFaceToExtrude: (boundary: THREE.Vector3[], normal: THREE.Vector3, centroid: THREE.Vector3) => void;
  // Extrude taper angle (D69)
  extrudeTaperAngle: number;
  setExtrudeTaperAngle: (a: number) => void;
  // EX-6: independent taper angle for side 2
  extrudeTaperAngle2: number;
  setExtrudeTaperAngle2: (a: number) => void;
  // Symmetric full-length toggle (EX-5)
  extrudeSymmetricFullLength: boolean;
  setExtrudeSymmetricFullLength: (v: boolean) => void;
  // Extrude body kind (D102)
  extrudeBodyKind: 'solid' | 'surface';
  setExtrudeBodyKind: (k: 'solid' | 'surface') => void;
  // EX-9 / CORR-14: participant bodies (empty = apply to all)
  extrudeParticipantBodyIds: string[];
  setExtrudeParticipantBodyIds: (ids: string[]) => void;
  // SDK-12: confined faces (bounding faces that restrict extude extent)
  extrudeConfinedFaceIds: string[];
  setExtrudeConfinedFaceIds: (ids: string[]) => void;
  // EX-15: creationOccurrence — the ComponentOccurrence context the profile lives in (CORR-4 prerequisite now satisfied)
  extrudeCreationOccurrence: string | null;
  setExtrudeCreationOccurrence: (id: string | null) => void;
  // EX-16: targetBaseFeature — direct-modeling context: place this extrude inside a base feature container
  extrudeTargetBaseFeature: string | null;
  setExtrudeTargetBaseFeature: (id: string | null) => void;

  // Revolve tool
  revolveSelectedSketchId: string | null;
  setRevolveSelectedSketchId: (id: string | null) => void;
  revolveAxis: 'X' | 'Y' | 'Z' | 'centerline';
  setRevolveAxis: (a: 'X' | 'Y' | 'Z' | 'centerline') => void;
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
  // CORR-10: project axis onto profile plane before revolving
  revolveIsProjectAxis: boolean;
  setRevolveIsProjectAxis: (v: boolean) => void;
  revolveProfileMode: 'sketch' | 'face';
  setRevolveProfileMode: (m: 'sketch' | 'face') => void;
  revolveFaceBoundary: number[] | null;
  revolveFaceNormal: [number, number, number] | null;
  startRevolveFromFace: (boundary: THREE.Vector3[], normal: THREE.Vector3) => void;
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
  // D71 sweep upgrades
  sweepOrientation: 'perpendicular' | 'parallel' | 'default';
  sweepProfileScaling: 'none' | 'scale-to-path' | 'scale-to-rail';  // SDK-4
  sweepTwistAngle: number;
  sweepTaperAngle: number;
  sweepGuideRailId: string | null;
  sweepOperation: 'new-body' | 'join' | 'cut';
  sweepDistance: 'entire' | 'distance';
  // SDK-5: path parametric start/end (0–1 fraction of path length)
  sweepDistanceOne: number;
  sweepDistanceTwo: number;
  setSweepDistanceOne: (v: number) => void;
  setSweepDistanceTwo: (v: number) => void;
  setSweepOrientation: (v: 'perpendicular' | 'parallel' | 'default') => void;
  setSweepProfileScaling: (v: 'none' | 'scale-to-path' | 'scale-to-rail') => void;  // SDK-4
  setSweepTwistAngle: (v: number) => void;
  setSweepTaperAngle: (v: number) => void;
  setSweepGuideRailId: (v: string | null) => void;
  setSweepOperation: (v: 'new-body' | 'join' | 'cut') => void;
  setSweepDistance: (v: 'entire' | 'distance') => void;
  startSweepTool: () => void;
  cancelSweepTool: () => void;
  commitSweep: () => void;

  // Loft tool (D31 / D105)
  loftProfileSketchIds: string[];
  setLoftProfileSketchIds: (ids: string[]) => void;
  loftBodyKind: 'solid' | 'surface';
  setLoftBodyKind: (k: 'solid' | 'surface') => void;
  // D72 loft upgrades
  loftClosed: boolean;
  loftTangentEdgesMerged: boolean;  // SDK-8
  loftStartCondition: 'free' | 'tangent' | 'curvature';
  loftEndCondition: 'free' | 'tangent' | 'curvature';
  loftRailSketchId: string | null;
  setLoftClosed: (v: boolean) => void;
  setLoftTangentEdgesMerged: (v: boolean) => void;  // SDK-8
  setLoftStartCondition: (v: 'free' | 'tangent' | 'curvature') => void;
  setLoftEndCondition: (v: 'free' | 'tangent' | 'curvature') => void;
  setLoftRailSketchId: (v: string | null) => void;
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

  // UTL1 — Show All / Hide
  showAllFeatures: () => void;
  hideFeature: (id: string) => void;

  // MSH8 — Reverse Normal (commit)
  commitReverseNormal: (featureId: string) => void;

  // MSH7 — Mesh Combine (commit)
  commitMeshCombine: (featureIds: string[]) => void;

  // MSH11 — Mesh Transform (commit)
  commitMeshTransform: (featureId: string, params: { tx: number; ty: number; tz: number; rx: number; ry: number; rz: number; scale: number }) => void;

  // SLD13 — Scale (commit)
  commitScale: (featureId: string, sx: number, sy: number, sz: number) => void;

  // SLD12 — Combine / Boolean (commit)
  commitCombine: (targetFeatureId: string, toolFeatureId: string, operation: 'join' | 'cut' | 'intersect', keepTool: boolean) => void;

  // SLD17 — Mirror feature (commit)
  commitMirrorFeature: (featureId: string, plane: 'XY' | 'XZ' | 'YZ') => void;

  // D6 Fillet edge selection
  filletEdgeIds: string[];
  addFilletEdge: (id: string) => void;
  removeFilletEdge: (id: string) => void;
  clearFilletEdges: () => void;

  // D7 Chamfer edge selection
  chamferEdgeIds: string[];
  addChamferEdge: (id: string) => void;
  removeChamferEdge: (id: string) => void;
  clearChamferEdges: () => void;

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
  // D39/D206 Selection Filter — multi-toggle object
  selectionFilter: {
    bodies: boolean;
    faces: boolean;
    edges: boolean;
    vertices: boolean;
    sketches: boolean;
    construction: boolean;
  };
  setSelectionFilter: (f: Partial<CADState['selectionFilter']>) => void;

  // D207 — Sketch Grid / Snap settings
  sketchGridEnabled: boolean;
  sketchSnapEnabled: boolean;
  setSketchGridEnabled: (v: boolean) => void;
  setSketchSnapEnabled: (v: boolean) => void;

  // Camera
  cameraHomeCounter: number;
  triggerCameraHome: () => void;
  cameraNavMode: 'orbit' | 'pan' | 'zoom' | 'zoom-window' | 'look-at' | null;
  setCameraNavMode: (mode: 'orbit' | 'pan' | 'zoom' | 'zoom-window' | 'look-at' | null) => void;
  // NAV-19: multi-viewport layout
  viewportLayout: '1' | '2h' | '2v' | '4';
  setViewportLayout: (layout: '1' | '2h' | '2v' | '4') => void;
  zoomToFitCounter: number;
  triggerZoomToFit: () => void;
  // NAV-5: Zoom Window
  zoomWindowTrigger: { x1: number; y1: number; x2: number; y2: number; vpW: number; vpH: number } | null;
  triggerZoomWindow: (rect: { x1: number; y1: number; x2: number; y2: number; vpW: number; vpH: number }) => void;
  clearZoomWindow: () => void;

  // Parameters
  parameters: Parameter[];
  addParameter: (name: string, expression: string, description?: string, group?: string) => void;
  updateParameter: (id: string, updates: Partial<Pick<Parameter, 'name' | 'expression' | 'description' | 'group'>>) => void;
  removeParameter: (id: string) => void;
  evaluateExpression: (expr: string) => number | null;

  // A5 — ground/unground a component (stub; components array populated in A1)
  groundComponent: (id: string, grounded: boolean) => void;

  // D12 — Sketch Text tool
  sketchTextContent: string;
  sketchTextHeight: number;
  sketchTextFont: string;
  /** SK-A6: bold / italic formatting flags */
  sketchTextBold: boolean;
  sketchTextItalic: boolean;
  setSketchTextContent: (v: string) => void;
  setSketchTextHeight: (v: number) => void;
  setSketchTextFont: (v: string) => void;
  setSketchTextBold: (v: boolean) => void;
  setSketchTextItalic: (v: boolean) => void;
  startSketchTextTool: () => void;
  commitSketchTextEntities: (segments: Array<{ x1: number; y1: number; z1: number; x2: number; y2: number; z2: number }>) => void;
  cancelSketchTextTool: () => void;

  // D28 — Dimension tool
  activeDimensionType: 'linear' | 'angular' | 'radial' | 'diameter' | 'arc-length' | 'aligned';
  dimensionOffset: number;
  /** SK-A3: when true, newly created dimensions are marked driven (reference) */
  dimensionDrivenMode: boolean;
  /** CORR-1: orientation for newly created linear/aligned dimensions */
  dimensionOrientation: 'horizontal' | 'vertical' | 'auto';
  /** SK-A8: tolerance mode and values for newly created dimensions */
  dimensionToleranceMode: 'none' | 'symmetric' | 'deviation';
  dimensionToleranceUpper: number;
  dimensionToleranceLower: number;
  pendingDimensionEntityIds: string[];
  setActiveDimensionType: (t: 'linear' | 'angular' | 'radial' | 'diameter' | 'arc-length' | 'aligned') => void;
  setDimensionOffset: (v: number) => void;
  setDimensionDrivenMode: (v: boolean) => void;
  setDimensionOrientation: (v: 'horizontal' | 'vertical' | 'auto') => void;
  setDimensionToleranceMode: (v: 'none' | 'symmetric' | 'deviation') => void;
  setDimensionToleranceUpper: (v: number) => void;
  setDimensionToleranceLower: (v: number) => void;
  startDimensionTool: () => void;
  cancelDimensionTool: () => void;
  addPendingDimensionEntity: (id: string) => void;
  addSketchDimension: (dim: SketchDimension) => void;
  removeDimension: (dimId: string) => void;

  // A9 — Component Pattern (linear/circular array of component instances)
  createComponentPattern: (
    sourceId: string,
    type: 'linear' | 'circular',
    params: { axis: 'X' | 'Y' | 'Z'; count: number; spacing: number; circularAxis: 'X' | 'Y' | 'Z'; circularCount: number }
  ) => void;

  // S10 — Spline post-commit handle editing
  editingSplineEntityId: string | null;
  hoveredSplinePointIndex: number | null;
  draggingSplinePointIndex: number | null;
  setEditingSplineEntityId: (id: string | null) => void;
  setHoveredSplinePointIndex: (i: number | null) => void;
  setDraggingSplinePointIndex: (i: number | null) => void;
  updateSplineControlPoint: (entityId: string, pointIndex: number, x: number, y: number, z: number) => void;

  // D45 — Project / Include live-link toggle
  projectLiveLink: boolean;
  setProjectLiveLink: (v: boolean) => void;
  cancelSketchProjectTool: () => void;

  // S3 — Intersection Curve
  startSketchIntersectTool: () => void;
  cancelSketchIntersectTool: () => void;

  // D46 — Project to Surface
  startSketchProjectSurfaceTool: () => void;
  cancelSketchProjectSurfaceTool: () => void;

  // ── CONSTRUCTION GEOMETRY (D175–D180) ──
  constructionPlanes: ConstructionPlane[];
  constructionAxes: ConstructionAxis[];
  constructionPoints: ConstructionPoint[];
  addConstructionPlane: (p: Omit<ConstructionPlane, 'id' | 'name'>) => void;
  addConstructionAxis: (a: Omit<ConstructionAxis, 'id' | 'name'>) => void;
  addConstructionPoint: (p: Omit<ConstructionPoint, 'id' | 'name'>) => void;
  cancelConstructTool: () => void;

  // ── D171 Replace Face ────────────────────────────────────────────────────
  replaceFaceSourceId: string | null;
  replaceFaceTargetId: string | null;
  openReplaceFaceDialog: () => void;
  setReplaceFaceSource: (id: string) => void;
  setReplaceFaceTarget: (id: string) => void;
  commitReplaceFace: () => void;

  // ── D192 Decal ───────────────────────────────────────────────────────────
  decalFaceId: string | null;
  decalFaceNormal: [number, number, number] | null;
  decalFaceCentroid: [number, number, number] | null;
  openDecalDialog: () => void;
  setDecalFace: (id: string, normal: [number, number, number], centroid: [number, number, number]) => void;
  closeDecalDialog: () => void;
  commitDecal: (params: import('../components/dialogs/insert/DecalDialog').DecalParams) => void;

  // ── D193 Attached Canvas ─────────────────────────────────────────────────
  attachedCanvasId: string | null;
  openAttachedCanvasDialog: (canvasId?: string) => void;
  closeAttachedCanvasDialog: () => void;
  updateCanvas: (id: string, changes: Partial<{ dataUrl: string; plane: string; offsetX: number; offsetY: number; scale: number; opacity: number }>) => void;

  // ── D185 Split Face ──────────────────────────────────────────────────────
  splitFaceId: string | null;
  openSplitFaceDialog: () => void;
  setSplitFace: (id: string) => void;
  closeSplitFaceDialog: () => void;
  commitSplitFace: (params: import('../components/dialogs/solid/SplitFaceDialog').SplitFaceParams) => void;

  // ── Hole face placement ──────────────────────────────────────────────────
  holeFaceId: string | null;
  holeFaceNormal: [number, number, number] | null;
  holeFaceCentroid: [number, number, number] | null;
  /** Live diameter shared between the dialog and the in-viewport floating chip. */
  holeDraftDiameter: number;
  /** Live depth shared between the dialog and the cylindrical preview. */
  holeDraftDepth: number;
  openHoleDialog: () => void;
  setHoleFace: (
    id: string,
    normal: [number, number, number],
    centroid: [number, number, number],
  ) => void;
  clearHoleFace: () => void;
  setHoleDraftDiameter: (d: number) => void;
  setHoleDraftDepth: (d: number) => void;
  closeHoleDialog: () => void;

  // ── SOL-I2: Shell face removal selection ────────────────────────────────
  shellRemoveFaceIds: string[];
  addShellRemoveFace: (id: string) => void;
  removeShellRemoveFace: (id: string) => void;
  clearShellRemoveFaces: () => void;

  // ── SOL-I7: Shell individual face thickness overrides ────────────────────
  shellFaceThicknesses: Record<string, number>;
  setShellFaceThickness: (faceId: string, thickness: number) => void;
  clearShellFaceThicknesses: () => void;

  // ── SOL-I3: Draft parting line face picker ───────────────────────────────
  draftPartingFaceId: string | null;
  draftPartingFaceNormal: [number, number, number] | null;
  draftPartingFaceCentroid: [number, number, number] | null;
  setDraftPartingFace: (
    id: string,
    normal: [number, number, number],
    centroid: [number, number, number],
  ) => void;
  clearDraftPartingFace: () => void;

  // ── SOL-I5: Remove Face face picker ─────────────────────────────────────
  removeFaceFaceId: string | null;
  removeFaceFaceNormal: [number, number, number] | null;
  removeFaceFaceCentroid: [number, number, number] | null;
  setRemoveFaceFace: (
    id: string,
    normal: [number, number, number],
    centroid: [number, number, number],
  ) => void;
  clearRemoveFaceFace: () => void;

  // ── CTX-8: Mesh export trigger ───────────────────────────────────────────
  exportBodyId: string | null;
  exportBodyFormat: 'stl' | 'glb' | null;
  triggerBodyExport: (bodyId: string, format: 'stl' | 'glb') => void;
  clearBodyExport: () => void;

  // ── D183 Bounding Solid ──────────────────────────────────────────────────
  openBoundingSolidDialog: () => void;
  closeBoundingSolidDialog: () => void;
  commitBoundingSolid: (params: import('../components/dialogs/solid/BoundingSolidDialog').BoundingSolidParams) => void;

  // ── D123 Direct Edit ────────────────────────────────────────────────────
  directEditFaceId: string | null;
  openDirectEditDialog: () => void;
  setDirectEditFace: (id: string) => void;
  commitDirectEdit: (params: DirectEditParams) => void;

  // ── D137 Texture Extrude ────────────────────────────────────────────────
  textureExtrudeFaceId: string | null;
  openTextureExtrudeDialog: () => void;
  setTextureExtrudeFace: (id: string) => void;
  commitTextureExtrude: (params: TextureExtrudeParams) => void;

  // ── A11 — Joint Origins ────────────────────────────────────────────────
  jointOrigins: JointOriginRecord[];
  showJointOriginDialog: boolean;
  jointOriginPickedPoint: [number, number, number] | null;
  openJointOriginDialog(): void;
  closeJointOriginDialog(): void;
  setJointOriginPoint(p: [number, number, number]): void;
  commitJointOrigin(params: { name: string; componentId: string | null; alignmentType: 'default' | 'between-two-faces' | 'on-face' }): void;

  // ── D196 — Interference ─────────────────────────────────────────────────
  showInterferenceDialog: boolean;
  interferenceResults: InterferenceResult[];
  openInterferenceDialog(): void;
  closeInterferenceDialog(): void;
  computeInterference(): void;

  // ── A22 — Mirror Component ────────────────────────────────────────────────
  showMirrorComponentDialog: boolean;
  openMirrorComponentDialog(): void;
  closeMirrorComponentDialog(): void;

  // ── A23 — Duplicate With Joints ──────────────────────────────────────────
  showDuplicateWithJointsDialog: boolean;
  duplicateWithJointsTargetId: string | null;
  openDuplicateWithJointsDialog(componentId: string): void;
  closeDuplicateWithJointsDialog(): void;

  // ── A26 — Bill of Materials ───────────────────────────────────────────────
  showBOMDialog: boolean;
  openBOMDialog(): void;
  closeBOMDialog(): void;
  getBOMEntries(): import('../components/dialogs/assembly/BOMDialog').BOMEntry[];

  // ── A12 — Contact Sets ────────────────────────────────────────────────────
  contactSets: ContactSetEntry[];
  showContactSetsDialog: boolean;
  openContactSetsDialog(): void;
  closeContactSetsDialog(): void;
  addContactSet(comp1Id: string, comp2Id: string): void;
  toggleContactSet(id: string): void;
  removeContactSet(id: string): void;
  /** A25: set enabled=true on every contact set */
  enableAllContactSets(): void;
  /** A25: set enabled=false on every contact set */
  disableAllContactSets(): void;

  // ── A13 — Insert Component ────────────────────────────────────────────────
  showInsertComponentDialog: boolean;
  openInsertComponentDialog(): void;
  closeInsertComponentDialog(): void;
  commitInsertComponent(params: InsertComponentParams): void;

// ── D197–D203 Surface & Body Analysis Overlays ──────────────────────────
  activeAnalysis: 'zebra' | 'draft' | 'curvature-map' | 'isocurve' | 'accessibility' | 'min-radius' | 'curvature-comb' | null;
  setActiveAnalysis: (a: 'zebra' | 'draft' | 'curvature-map' | 'isocurve' | 'accessibility' | 'min-radius' | 'curvature-comb' | null) => void;
  analysisParams: {
    direction: 'x' | 'y' | 'z';
    frequency: number;
    minAngle: number;
    uCount: number;
    vCount: number;
    minRadius: number;
    combScale: number;
  };
  setAnalysisParams: (p: Partial<CADState['analysisParams']>) => void;

  // ── SFC7 — Fill Surface ──────────────────────────────────────────────────
  showFillDialog: boolean;
  fillBoundaryEdgeIds: string[];
  /** Per-edge endpoint data captured at pick time so commitFill can assemble a real boundary loop. */
  fillBoundaryEdgeData: Array<{ id: string; a: [number, number, number]; b: [number, number, number] }>;
  openFillDialog(): void;
  addFillBoundaryEdge(id: string, a?: [number, number, number], b?: [number, number, number]): void;
  closeFillDialog(): void;
  commitFill(params: import('../components/dialogs/surface/FillDialog').FillParams): void;

  // ── SFC8 — Offset Curve to Surface ──────────────────────────────────────
  showOffsetCurveDialog: boolean;
  openOffsetCurveDialog(): void;
  closeOffsetCurveDialog(): void;
  commitOffsetCurve(params: import('../components/dialogs/surface/OffsetCurveDialog').OffsetCurveParams): void;

  // ── SFC16 — Surface Merge (face-picker) ──────────────────────────────────
  showSurfaceMergeDialog: boolean;
  surfaceMergeFace1Id: string | null;
  surfaceMergeFace2Id: string | null;
  openSurfaceMergeDialog(): void;
  setSurfaceMergeFace1(id: string): void;
  setSurfaceMergeFace2(id: string): void;
  closeSurfaceMergeDialog(): void;
  commitSurfaceMerge(params: import('../components/dialogs/surface/SurfaceMergeDialog').SurfaceMergeParams): void;

  // ── SFC18 — Delete Face ──────────────────────────────────────────────────
  showDeleteFaceDialog: boolean;
  deleteFaceIds: string[];
  openDeleteFaceDialog(): void;
  addDeleteFace(id: string): void;
  clearDeleteFaces(): void;
  closeDeleteFaceDialog(): void;
  commitDeleteFace(params: import('../components/dialogs/surface/DeleteFaceDialog').DeleteFaceParams): void;

  // ── SFC10 — Surface Trim ──────────────────────────────────────────────────
  commitSurfaceTrim(params: {
    sourceFeatureId: string;
    trimmerFeatureId: string;
    keepSide: 'inside' | 'outside';
  }): void;

  // ── SFC14 — Surface Split ─────────────────────────────────────────────────
  commitSurfaceSplit(params: {
    sourceFeatureId: string;
    splitterFeatureId: string;
  }): void;

  // ── SFC15 — Untrim ────────────────────────────────────────────────────────
  commitUntrim(params: {
    sourceFeatureId: string;
    expandFactor: number;
  }): void;

  // ── SFC9 — Offset Surface ────────────────────────────────────────────────
  commitOffsetSurface(params: {
    offsetDistance: number;
    direction: 'outward' | 'inward' | 'both';
    operation: 'new-body' | 'join';
  }): void;

  // ── SFC11 — Surface Extend ───────────────────────────────────────────────
  commitSurfaceExtend(params: {
    extendDistance: number;
    extensionType: 'natural' | 'linear' | 'curvature';
    merge: boolean;
  }): void;

  // ── SFC12 — Stitch ───────────────────────────────────────────────────────
  commitStitch(params: {
    sourceFeatureIds: string[];
    tolerance: number;
    closeOpenEdges: boolean;
    keepOriginal: boolean;
  }): void;

  // ── SFC13 — Unstitch ─────────────────────────────────────────────────────
  commitUnstitch(params: {
    sourceFeatureId: string;
    keepOriginal: boolean;
  }): void;

  // ── SFC17 — Thicken ──────────────────────────────────────────────────────
  commitThicken(params: {
    thickness: number;
    direction: 'inside' | 'outside' | 'symmetric';
    operation: 'new-body' | 'join' | 'cut';
  }): void;

  // ── SFC22 — Surface Primitives ───────────────────────────────────────────
  showSurfacePrimitivesDialog: boolean;
  openSurfacePrimitivesDialog(): void;
  closeSurfacePrimitivesDialog(): void;
  commitSurfacePrimitive(params: import('../components/dialogs/surface/SurfacePrimitivesDialog').SurfacePrimitiveParams): void;

  // ── MM1 — Design history mode ───────────────────────────────────────────
  historyEnabled: boolean;
  toggleHistoryMode: () => void;

  // ── MM2 — Undo / Redo ────────────────────────────────────────────────────
  undoStack: string[];
  redoStack: string[];
  pushUndo(): void;
  undo(): void;
  redo(): void;

  // ── SLD7 — Linear Pattern ─────────────────────────────────────────────────
  commitLinearPattern(featureId: string, params: {
    dirX: number; dirY: number; dirZ: number;
    spacing: number; count: number;
    dir2X?: number; dir2Y?: number; dir2Z?: number;
    spacing2?: number; count2?: number;
  }): void;

  // ── SLD8 — Circular Pattern ───────────────────────────────────────────────
  commitCircularPattern(featureId: string, params: {
    axisX: number; axisY: number; axisZ: number;
    originX: number; originY: number; originZ: number;
    count: number; totalAngle: number;
  }): void;

  // ── MSH2 — Plane Cut ─────────────────────────────────────────────────────
  commitPlaneCut(featureId: string, planeNormal: THREE.Vector3, planeOffset: number, keepSide: 'positive' | 'negative'): void;

  // ── MSH3 — Make Closed Mesh ──────────────────────────────────────────────
  commitMakeClosedMesh(featureId: string): void;

  // ── MSH5 — Mesh Smooth ───────────────────────────────────────────────────
  commitMeshSmooth(featureId: string, iterations: number, factor: number): void;

  // ── MSH10 — Separate ─────────────────────────────────────────────────────
  commitMeshSeparate(featureId: string): void;

  // ── MSH13 — Mesh Section Sketch ──────────────────────────────────────────
  commitMeshSectionSketch(featureId: string, plane: THREE.Plane): void;

  // ── UTL2 — Save / Load ───────────────────────────────────────────────────
  saveToFile(): void;
  loadFromFile(json: string): void;

  // ── SLD1 — Rib (dialog-based) ────────────────────────────────────────────
  commitRibFromDialog(sketchId: string, thickness: number, height: number): void;

  // ── SLD2 — Web (dialog-based) ────────────────────────────────────────────
  commitWeb(sketchId: string, thickness: number, height: number): void;

  // ── SLD4 — Rest ──────────────────────────────────────────────────────────
  commitRest(params: { profileId: string; width: number; depth: number; thickness: number; normalX: number; normalY: number; normalZ: number; centerX: number; centerY: number; centerZ: number }): void;

  // ── SLD5 — Thread (cosmetic) ─────────────────────────────────────────────
  commitThread(featureId: string, radius: number, pitch: number, length: number): void;

  // ── SLD9 — Pattern on Path ───────────────────────────────────────────────
  commitPatternOnPath(featureId: string, sketchId: string, count: number): void;

  // ── MSH1 — Remesh ────────────────────────────────────────────────────────
  commitRemesh(featureId: string, mode: 'refine' | 'coarsen', iterations: number): void;

// ── SLD10 — Shell ────────────────────────────────────────────────────────
  commitShell(featureId: string, thickness: number, direction: 'inward' | 'outward' | 'symmetric'): void;

  // ── SLD11 — Draft ────────────────────────────────────────────────────────
  commitDraft(featureId: string, pullAxisDir: THREE.Vector3, draftAngle: number, fixedPlaneY: number): void;

  // ── SLD14 — Offset Face ──────────────────────────────────────────────────
  commitOffsetFace(featureId: string, distance: number): void;

  // ── SLD16 — Remove Face ──────────────────────────────────────────────────
  commitRemoveFace(featureId: string, faceNormal: THREE.Vector3, faceCentroid: THREE.Vector3): void;

  // ── SLD3 — Emboss ────────────────────────────────────────────────────────
  commitEmboss(sketchId: string, depth: number, style: 'emboss' | 'deboss'): void;

  // ── SLD6 — Boundary Fill ─────────────────────────────────────────────────
  commitBoundaryFill(toolFeatureIds: string[], operation: 'new-body' | 'join' | 'cut'): void;

  // ── SLD15 — Silhouette Split ─────────────────────────────────────────────
  commitSilhouetteSplit(featureId: string, planeNormal: THREE.Vector3, planeOffset: number): void;

  // ── MSH4 — Erase and Fill ────────────────────────────────────────────────
  commitEraseAndFill(featureId: string, faceNormal: THREE.Vector3, faceCentroid: THREE.Vector3): void;

  // ── MSH6 — Mesh Shell ────────────────────────────────────────────────────
  commitMeshShell(featureId: string, thickness: number, direction: 'inward' | 'outward' | 'symmetric'): void;

  // ── MSH9 — Mesh Align ────────────────────────────────────────────────────
  commitMeshAlign(sourceFeatureId: string, targetFeatureId: string): void;

  // ── MSH12 — Convert Mesh to BRep ─────────────────────────────────────────
  commitConvertMeshToBRep(featureId: string, mode: 'facet' | 'prismatic'): void;

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
  extrudeDistance2: 10,
  extrudeDirection: 'positive' as ExtrudeDirection,
  extrudeOperation: 'new-body' as ExtrudeOperation,
  extrudeThinEnabled: false,
  extrudeThinThickness: 2,
  extrudeThinSide: 'side1' as 'side1' | 'side2' | 'center',
  // EX-7/EX-8: per-side two values (used when direction=two-sides)
  extrudeThinSide2: 'side1' as 'side1' | 'side2' | 'center',
  extrudeThinThickness2: 2,
  // D67 / CORR-8 start options
  extrudeStartType: 'profile' as 'profile' | 'offset' | 'entity',
  extrudeStartOffset: 0,
  extrudeStartEntityId: null as string | null,
  // EX-4: face data for From-Entity start
  extrudeStartFaceNormal: null as [number, number, number] | null,
  extrudeStartFaceCentroid: null as [number, number, number] | null,
  // D68 extent types (EX-10: independent per side; EX-3: 'to-object' added)
  extrudeExtentType: 'distance' as 'distance' | 'all' | 'to-object',
  extrudeExtentType2: 'distance' as 'distance' | 'all' | 'to-object',
  // EX-3: face data for To-Object terminus
  extrudeToEntityFaceId: null as string | null,
  extrudeToEntityFaceNormal: null as [number, number, number] | null,
  extrudeToEntityFaceCentroid: null as [number, number, number] | null,
  // EX-12: directionHint — flip direction when to-object face is behind profile
  extrudeToObjectFlipDirection: false,
  // D69 taper angle
  extrudeTaperAngle: 0,
  // EX-6 taper angle side 2
  extrudeTaperAngle2: 0,
  // EX-5 symmetric full-length
  extrudeSymmetricFullLength: false,
  // D102 body kind
  extrudeBodyKind: 'solid' as 'solid' | 'surface',
  // EX-9 / CORR-14: participant bodies
  extrudeParticipantBodyIds: [] as string[],
  // SDK-12: confined faces (limit extrude within a cage of bounding faces)
  extrudeConfinedFaceIds: [] as string[],
  // EX-15: creationOccurrence
  extrudeCreationOccurrence: null as string | null,
  // EX-16: targetBaseFeature
  extrudeTargetBaseFeature: null as string | null,
};

const REVOLVE_DEFAULTS = {
  revolveSelectedSketchId: null as string | null,
  revolveAxis: 'Y' as 'X' | 'Y' | 'Z' | 'centerline',
  revolveAngle: 360,
  // D70 direction modes
  revolveDirection: 'one-side' as 'one-side' | 'symmetric' | 'two-sides',
  revolveAngle2: 360,
  // D103 body kind
  revolveBodyKind: 'solid' as 'solid' | 'surface',
  // CORR-10: project axis onto profile plane before revolving
  revolveIsProjectAxis: false as boolean,
  // Face-based revolve
  revolveProfileMode: 'sketch' as 'sketch' | 'face',
  revolveFaceBoundary: null as number[] | null, // flat [x0,y0,z0,x1,y1,z1,...]
  revolveFaceNormal: null as [number, number, number] | null,
};

// ── MM2: snapshot helper ─────────────────────────────────────────────────
function _snapshotState(state: CADState): string {
  return JSON.stringify({
    features: state.features.map((f) => ({
      ...f,
      // Strip non-serialisable THREE objects — same approach as serializeFeature
      mesh: undefined,
    })),
    sketches: state.sketches.map((s) => ({
      ...s,
      planeNormal: s.planeNormal ? [s.planeNormal.x, s.planeNormal.y, s.planeNormal.z] : null,
      planeOrigin: s.planeOrigin ? [s.planeOrigin.x, s.planeOrigin.y, s.planeOrigin.z] : null,
    })),
    featureGroups: state.featureGroups,
  });
}

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

  workspaceMode: (localStorage.getItem('dzign3d-workspace-mode') as 'design' | 'prepare' | 'printer') ?? 'design',
  setWorkspaceMode: (mode) => {
    localStorage.setItem('dzign3d-workspace-mode', mode);
    set({ workspaceMode: mode });
  },

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
      // CORR-6: restore per-sketch display flags (fallback to global defaults if undefined)
      ...(sketch.arePointsShown !== undefined ? { showSketchPoints: sketch.arePointsShown } : {}),
      ...(sketch.areProfilesShown !== undefined ? { showSketchProfile: sketch.areProfilesShown } : {}),
      ...(sketch.areDimensionsShown !== undefined ? { showSketchDimensions: sketch.areDimensionsShown } : {}),
      ...(sketch.areConstraintsShown !== undefined ? { showSketchConstraints: sketch.areConstraintsShown } : {}),
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
        sketch3DActivePlane: null, // S7: clear per-session plane override
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
        sketch3DActivePlane: null, // S7: clear per-session plane override
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
      sketch3DActivePlane: null, // S7: clear per-session plane override
    });
  },
  addSketchEntity: (entity) => {
    const { activeSketch } = get();
    if (activeSketch) {
      get().pushUndo();
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

  deleteSketch: (id) => {
    get().pushUndo();
    set((state) => {
      const activeSketch = state.activeSketch?.id === id ? null : state.activeSketch;
      return {
        sketches: state.sketches.filter((s) => s.id !== id),
        features: state.features.filter((f) => !(f.type === 'sketch' && f.sketchId === id)),
        activeSketch,
        statusMessage: 'Sketch deleted',
      };
    });
  },

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
  addFeature: (feature) => {
    const { historyEnabled } = get();
    if (historyEnabled) get().pushUndo();
    const f = historyEnabled ? feature : { ...feature, suppressTimeline: true };
    set((state) => ({ features: [...state.features, f] }));
  },
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

  insertFastener: (params) => {
    get().pushUndo();
    const { features, units } = get();
    const componentStore = useComponentStore.getState();
    const { rootComponentId } = componentStore;
    const scale = units === 'in' ? 1 / 25.4 : 1;
    const d = params.diameter * scale;
    const hd = params.headDiameter * scale;
    const hh = params.headHeight * scale;
    const len = params.length * scale;

    const group = new THREE.Group();

    const isNut = params.type === 'hex-nut';
    const isWasher = params.type === 'washer';

    if (!isNut && !isWasher) {
      const shankGeo = new THREE.CylinderGeometry(d / 2, d / 2, len, 16);
      const shankMesh = new THREE.Mesh(shankGeo, new THREE.MeshStandardMaterial({ color: '#B0B8C0', metalness: 0.8, roughness: 0.3 }));
      shankMesh.position.y = -len / 2;
      group.add(shankMesh);
    }

    const headSegs = (params.type === 'hex-bolt' || params.type === 'hex-nut') ? 6 : 16;
    const headGeo = new THREE.CylinderGeometry(hd / 2, hd / 2, hh, headSegs);
    const headMesh = new THREE.Mesh(headGeo, new THREE.MeshStandardMaterial({ color: '#B0B8C0', metalness: 0.8, roughness: 0.3 }));

    if (isNut || isWasher) {
      headMesh.position.y = 0;
    } else if (params.type === 'flat-head') {
      headMesh.position.y = -hh / 2;
    } else {
      headMesh.position.y = hh / 2;
    }
    group.add(headMesh);

    group.position.set(params.x * scale, params.y * scale, params.z * scale);

    const featureId = crypto.randomUUID();
    const bodyId = componentStore.addBody(rootComponentId, `${params.size} ${params.type}`);
    if (bodyId) {
      componentStore.addFeatureToBody(bodyId, featureId);
    }
    const feature: Feature = {
      id: featureId,
      name: `${params.size} ${params.type.replace(/-/g, ' ')}`,
      type: 'fastener',
      params: { ...params } as unknown as Record<string, number | string | boolean | number[]>,
      mesh: group as unknown as THREE.Mesh,
      visible: true,
      suppressed: false,
      timestamp: Date.now(),
      bodyKind: 'brep',
    };
    set({ features: [...features, feature], statusMessage: `${params.size} ${params.type} inserted` });
  },

  removeFeature: (id) => {
    get().pushUndo();
    // Capture the mesh reference before removal so we can dispose AFTER
    // the feature is out of state (prevents renderer accessing disposed GPU resources).
    const target = get().features.find((f) => f.id === id);
    set((state) => ({ features: state.features.filter((f) => f.id !== id) }));
    // Now safe to dispose — feature is no longer in state.
    //
    // CRITICAL: skip materials tagged `userData.shared = true` — those are
    // module-level singletons (EXTRUDE_MATERIAL, SKETCH_MATERIAL, etc. in
    // GeometryEngine.ts). Disposing them turns every other feature still
    // using them into a black/broken material instance.
    const disposeMat = (mat: THREE.Material | THREE.Material[] | null | undefined) => {
      if (!mat) return;
      const arr = Array.isArray(mat) ? mat : [mat];
      for (const m of arr) {
        if (m?.userData?.shared) continue;
        m?.dispose?.();
      }
    };
    if (target?.mesh) {
      const m = target.mesh as THREE.Object3D;
      if (m instanceof THREE.Mesh) {
        m.geometry?.dispose();
        disposeMat(m.material);
      } else if (m instanceof THREE.Group) {
        m.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.geometry?.dispose();
            disposeMat(child.material);
          }
        });
      }
    }
  },
  deriveFromDesign: (itemIds, sourceFileName) => {
    get().pushUndo();
    const { features } = get();
    const now = Date.now();
    const newFeatures: Feature[] = itemIds.map((itemId, i) => ({
      id: crypto.randomUUID(),
      name: `Derived: ${itemId.slice(0, 8)}\u2026`,
      type: 'derive' as import('../types/cad').FeatureType,
      params: { sourceFileName, sourceItemId: itemId } as unknown as Record<string, number | string | boolean | number[]>,
      visible: true,
      suppressed: false,
      timestamp: now + i,
      derivedFrom: sourceFileName,
    }));
    set({ features: [...features, ...newFeatures], statusMessage: `Derived ${newFeatures.length} item(s) from ${sourceFileName}` });
  },
  renameFeature: (id, name) => set((state) => ({
    features: state.features.map((f) => f.id === id ? { ...f, name } : f),
  })),
  // D186 Edit Feature state
  editingFeatureId: null,
  setEditingFeatureId: (id) => set({ editingFeatureId: id }),
  updateFeatureParams: (id, params) => {
    get().pushUndo();
    set((state) => ({
      features: state.features.map((f) =>
        f.id === id ? { ...f, params: { ...f.params, ...params } } : f,
      ),
      statusMessage: 'Feature parameters updated',
    }));
  },
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

  // MM3 — Base Feature container
  baseFeatureActive: false,
  openBaseFeature: (name) => {
    const { features } = get();
    const n = features.filter((f) => f.type === 'base-feature').length + 1;
    const feature: Feature = {
      id: crypto.randomUUID(),
      name: name || `Base Feature ${n}`,
      type: 'base-feature',
      params: {},
      visible: true,
      suppressed: false,
      timestamp: Date.now(),
      isBaseFeatureContainer: true,
      baseFeatureOpen: true,
    };
    set((state) => ({
      features: [...state.features, feature],
      baseFeatureActive: true,
      statusMessage: 'Base Feature open — direct edits inside will not trigger parametric recompute',
    }));
  },
  finishBaseFeature: () => set((state) => ({
    baseFeatureActive: false,
    // Mark the open container as closed
    features: state.features.map((f) =>
      f.isBaseFeatureContainer && f.baseFeatureOpen ? { ...f, baseFeatureOpen: false } : f,
    ),
    statusMessage: 'Base Feature closed',
  })),

  // MM4 — Timeline feature groups
  featureGroups: [],
  createFeatureGroup: (name, featureIds) => {
    const groupId = crypto.randomUUID();
    set((state) => ({
      featureGroups: [...state.featureGroups, { id: groupId, name, collapsed: false }],
      features: state.features.map((f) =>
        featureIds.includes(f.id) ? { ...f, groupId } : f,
      ),
      statusMessage: `Group "${name}" created`,
    }));
  },
  renameFeatureGroup: (groupId, name) => set((state) => ({
    featureGroups: state.featureGroups.map((g) => g.id === groupId ? { ...g, name } : g),
    statusMessage: `Group renamed to "${name}"`,
  })),
  deleteFeatureGroup: (groupId) => set((state) => ({
    featureGroups: state.featureGroups.filter((g) => g.id !== groupId),
    features: state.features.map((f) => f.groupId === groupId ? { ...f, groupId: undefined } : f),
    statusMessage: 'Group deleted',
  })),
  moveFeatureToGroup: (featureId, groupId) => set((state) => ({
    features: state.features.map((f) =>
      f.id === featureId ? { ...f, groupId: groupId ?? undefined } : f,
    ),
  })),

  toggleFeatureGroup: (groupId) => set((state) => ({
    featureGroups: state.featureGroups.map((g) =>
      g.id === groupId ? { ...g, collapsed: !g.collapsed } : g,
    ),
  })),
  // CORR-17: nest a group inside another
  nestGroupInGroup: (childGroupId, parentGroupId) => set((state) => ({
    featureGroups: state.featureGroups.map((g) =>
      g.id === childGroupId ? { ...g, parentGroupId: parentGroupId ?? undefined } : g,
    ),
  })),
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
    const { features } = get();
    const feature = features.find((f) => f.id === featureId);
    if (!feature?.mesh) {
      get().setStatusMessage('Mesh Reduce: selected feature has no mesh');
      return;
    }
    // Build a new simplified mesh rather than mutating the existing one in-place.
    // Mutating geometry on a Zustand-owned object bypasses set() and leaves
    // React unaware of the change. Instead we clone, simplify, then replace
    // the feature in state via set().
    const applyToMesh = async (m: THREE.Mesh): Promise<THREE.Mesh> => {
      const newGeom = await GeometryEngine.simplifyGeometry(m.geometry, reductionPercent);
      const clone = new THREE.Mesh(newGeom, m.material);
      clone.castShadow = m.castShadow;
      clone.receiveShadow = m.receiveShadow;
      Object.assign(clone.userData, m.userData);
      return clone;
    };
    const featureMesh = feature.mesh as THREE.Object3D;
    // Re-validate the feature/mesh AFTER the await — by the time the simplify
    // promise resolves, the user could have deleted the feature, replaced its
    // mesh, or kicked off another reduce. Without this guard the post-await
    // set() would write the new mesh into whatever feature row currently has
    // the matching id, and dispose a mesh that's already been replaced.
    const stillValid = (currentMesh: THREE.Object3D | null | undefined): boolean => {
      const live = get().features.find((f) => f.id === featureId);
      return !!live && live.mesh === currentMesh;
    };
    const onErr = (err: unknown) => {
      get().setStatusMessage(`Mesh Reduce failed: ${(err as Error)?.message ?? 'unknown error'}`);
    };
    if (featureMesh instanceof THREE.Mesh) {
      applyToMesh(featureMesh).then((newMesh) => {
        if (!stillValid(featureMesh)) {
          // Stale — drop the freshly built mesh so we don't leak it
          newMesh.geometry.dispose();
          return;
        }
        const oldMesh = feature.mesh;
        set((state) => ({
          features: state.features.map((f) =>
            f.id === featureId ? { ...f, mesh: newMesh } : f,
          ),
        }));
        // Dispose old geometry AFTER removing from state
        if (oldMesh instanceof THREE.Mesh) oldMesh.geometry.dispose();
        get().setStatusMessage(`Mesh reduced by ${reductionPercent}%`);
      }).catch(onErr);
    } else if (featureMesh instanceof THREE.Group) {
      const meshes: THREE.Mesh[] = [];
      featureMesh.traverse((child) => {
        if (child instanceof THREE.Mesh) meshes.push(child);
      });
      Promise.all(meshes.map(applyToMesh)).then((newMeshes) => {
        if (!stillValid(featureMesh)) {
          // Stale — drop all freshly built meshes' geometries
          for (const m of newMeshes) m.geometry.dispose();
          return;
        }
        const oldGroup = feature.mesh;
        const newGroup = new THREE.Group();
        newMeshes.forEach((m) => newGroup.add(m));
        set((state) => ({
          features: state.features.map((f) =>
            f.id === featureId ? { ...f, mesh: newGroup as unknown as THREE.Mesh } : f,
          ),
        }));
        // Dispose old geometries AFTER removal
        if (oldGroup instanceof THREE.Group) {
          oldGroup.traverse((child) => {
            if (child instanceof THREE.Mesh) child.geometry.dispose();
          });
        }
        get().setStatusMessage(`Mesh reduced by ${reductionPercent}%`);
      }).catch(onErr);
    } else {
      get().setStatusMessage('Mesh Reduce: feature is not simplifiable');
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
    // Mutating mesh.geometry in place doesn't notify Zustand subscribers — replace
    // the features array reference so the timeline / re-renderers see the change.
    set((state) => ({
      features: state.features.map((f) => f.id === featureId ? { ...f } : f),
    }));
    get().setStatusMessage('Normals reversed');
  },
  // UTL1 — Show All / Hide
  showAllFeatures: () => set((state) => ({
    features: state.features.map((f) => ({ ...f, visible: true })),
    statusMessage: 'All features shown',
  })),
  hideFeature: (id) => set((state) => ({
    features: state.features.map((f) => f.id === id ? { ...f, visible: false } : f),
    statusMessage: 'Feature hidden',
  })),

  // MSH8 — commitReverseNormal: clone geometry with flipped normals
  commitReverseNormal: (featureId) => {
    const { features } = get();
    const feature = features.find((f) => f.id === featureId);
    if (!feature?.mesh) {
      get().setStatusMessage('Reverse Normal: no mesh on selected feature');
      return;
    }
    const srcMesh = feature.mesh as THREE.Mesh;
    if (!(srcMesh instanceof THREE.Mesh)) {
      get().setStatusMessage('Reverse Normal: feature is not a mesh');
      return;
    }
    const newMesh = GeometryEngine.reverseMeshNormals(srcMesh);
    newMesh.castShadow = true;
    newMesh.receiveShadow = true;
    // Dispose the previous geometry — reverseMeshNormals returns a fresh
    // mesh with cloned geometry, so the source's BufferGeometry is now orphan.
    const oldMesh = feature.mesh;
    set((state) => ({
      features: state.features.map((f) => f.id === featureId ? { ...f, mesh: newMesh } : f),
      statusMessage: 'Mesh normals reversed',
    }));
    if (oldMesh instanceof THREE.Mesh) oldMesh.geometry.dispose();
  },

  // MSH7 — commitMeshCombine: merge all listed feature meshes into one
  commitMeshCombine: (featureIds) => {
    const { features } = get();
    const meshes: THREE.Mesh[] = [];
    for (const fid of featureIds) {
      const f = features.find((x) => x.id === fid);
      if (f?.mesh instanceof THREE.Mesh) meshes.push(f.mesh as THREE.Mesh);
    }
    if (meshes.length < 2) {
      get().setStatusMessage('Mesh Combine: need at least 2 mesh features');
      return;
    }
    const combined = GeometryEngine.combineMeshes(meshes);
    combined.castShadow = true;
    combined.receiveShadow = true;
    const n = features.filter((f) => f.name.startsWith('Mesh Combine')).length + 1;
    const newFeature: Feature = {
      id: crypto.randomUUID(),
      name: `Mesh Combine ${n}`,
      type: 'import',
      params: { featureKind: 'mesh-combine', sourceIds: featureIds.join(',') },
      visible: true,
      suppressed: false,
      timestamp: Date.now(),
      mesh: combined,
      bodyKind: 'mesh',
    };
    set((state) => ({
      features: [...state.features, newFeature],
      statusMessage: 'Meshes combined',
    }));
  },

  // MSH11 — commitMeshTransform: apply translate/rotate/scale to a mesh
  commitMeshTransform: (featureId, params) => {
    const { features } = get();
    const feature = features.find((f) => f.id === featureId);
    if (!feature?.mesh) {
      get().setStatusMessage('Mesh Transform: no mesh on selected feature');
      return;
    }
    const srcMesh = feature.mesh as THREE.Mesh;
    if (!(srcMesh instanceof THREE.Mesh)) {
      get().setStatusMessage('Mesh Transform: feature is not a mesh');
      return;
    }
    // Validate inputs before mutating — scale=0 collapses the mesh permanently
    // and there's no rollback path. NaN/Infinity rotations propagate into
    // the geometry and corrupt every downstream raycast.
    const finite = (v: number) => Number.isFinite(v);
    if (!finite(params.tx) || !finite(params.ty) || !finite(params.tz) ||
        !finite(params.rx) || !finite(params.ry) || !finite(params.rz) ||
        !finite(params.scale) || params.scale === 0) {
      get().setStatusMessage('Mesh Transform: invalid params (translate/rotate must be finite, scale != 0)');
      return;
    }
    get().pushUndo();
    const newMesh = GeometryEngine.transformMesh(srcMesh, params);
    newMesh.castShadow = true;
    newMesh.receiveShadow = true;
    const oldMesh = feature.mesh;
    set((state) => ({
      features: state.features.map((f) => f.id === featureId ? { ...f, mesh: newMesh } : f),
      statusMessage: 'Mesh transformed',
    }));
    // Defer disposal so undo can still reference the old geometry.
    // setTimeout(0) ensures the set() completes and state is stable first.
    if (oldMesh instanceof THREE.Mesh) {
      const geo = oldMesh.geometry;
      setTimeout(() => geo.dispose(), 0);
    }
  },

  // SLD13 — commitScale: scale a feature mesh by sx/sy/sz
  commitScale: (featureId, sx, sy, sz) => {
    const { features } = get();
    const feature = features.find((f) => f.id === featureId);
    if (!feature?.mesh) {
      get().setStatusMessage('Scale: no mesh on selected feature');
      return;
    }
    const srcMesh = feature.mesh as THREE.Mesh;
    if (!(srcMesh instanceof THREE.Mesh)) {
      get().setStatusMessage('Scale: feature is not a mesh');
      return;
    }
    // Validate before mutating — any zero axis flattens the mesh permanently.
    if (!Number.isFinite(sx) || !Number.isFinite(sy) || !Number.isFinite(sz) ||
        sx === 0 || sy === 0 || sz === 0) {
      get().setStatusMessage('Scale: factors must be finite and non-zero');
      return;
    }
    get().pushUndo();
    const newMesh = GeometryEngine.scaleMesh(srcMesh, sx, sy, sz);
    newMesh.castShadow = true;
    newMesh.receiveShadow = true;
    set((state) => ({
      features: state.features.map((f) => f.id === featureId ? { ...f, mesh: newMesh } : f),
      statusMessage: `Scaled ${sx}×${sy}×${sz}`,
    }));
  },

  // SLD12 — commitCombine: boolean op on two feature meshes
  commitCombine: (targetFeatureId, toolFeatureId, operation, keepTool) => {
    const { features } = get();
    const targetFeature = features.find((f) => f.id === targetFeatureId);
    const toolFeature = features.find((f) => f.id === toolFeatureId);
    if (!targetFeature?.mesh || !(targetFeature.mesh instanceof THREE.Mesh)) {
      get().setStatusMessage('Combine: target has no mesh');
      return;
    }
    if (!toolFeature?.mesh || !(toolFeature.mesh instanceof THREE.Mesh)) {
      get().setStatusMessage('Combine: tool has no mesh');
      return;
    }
    get().pushUndo();
    const tgtMesh = targetFeature.mesh as THREE.Mesh;
    const toolMesh = toolFeature.mesh as THREE.Mesh;
    let resultGeom: THREE.BufferGeometry;
    // CSG can throw on degenerate / non-manifold inputs. Catch + report so
    // the user gets a status message instead of a silent broken state, and
    // the partially-built result (if any) doesn't end up in the scene.
    try {
      if (operation === 'join') {
        resultGeom = GeometryEngine.csgUnion(tgtMesh.geometry, toolMesh.geometry);
      } else if (operation === 'cut') {
        resultGeom = GeometryEngine.csgSubtract(tgtMesh.geometry, toolMesh.geometry);
      } else {
        resultGeom = GeometryEngine.csgIntersect(tgtMesh.geometry, toolMesh.geometry);
      }
    } catch (err) {
      get().setStatusMessage(`Combine (${operation}) failed: ${(err as Error)?.message ?? 'unknown CSG error'}`);
      return;
    }
    const newMesh = new THREE.Mesh(resultGeom, tgtMesh.material);
    newMesh.castShadow = true;
    newMesh.receiveShadow = true;
    set((state) => {
      let updated = state.features.map((f) =>
        f.id === targetFeatureId ? { ...f, mesh: newMesh } : f
      );
      if (!keepTool) {
        updated = updated.filter((f) => f.id !== toolFeatureId);
      }
      return { features: updated, statusMessage: `Combine (${operation}) applied` };
    });
  },

  // SLD17 — commitMirrorFeature: mirror a feature's mesh across a plane
  commitMirrorFeature: (featureId, plane) => {
    const { features } = get();
    const feature = features.find((f) => f.id === featureId);
    if (!feature?.mesh) {
      get().setStatusMessage('Mirror Feature: no mesh on selected feature');
      return;
    }
    const srcMesh = feature.mesh as THREE.Mesh;
    if (!(srcMesh instanceof THREE.Mesh)) {
      get().setStatusMessage('Mirror Feature: feature is not a mesh');
      return;
    }
    get().pushUndo();
    const mirrored = GeometryEngine.mirrorMesh(srcMesh, plane);
    mirrored.castShadow = true;
    mirrored.receiveShadow = true;
    const n = features.filter((f) => f.name.startsWith('Mirror Feature')).length + 1;
    const newFeature: Feature = {
      id: crypto.randomUUID(),
      name: `Mirror Feature ${n}`,
      type: 'mirror',
      params: { featureKind: 'mirror-feature', sourceId: featureId, plane },
      visible: true,
      suppressed: false,
      timestamp: Date.now(),
      mesh: mirrored,
      bodyKind: feature.bodyKind,
    };
    set((state) => ({
      features: [...state.features, newFeature],
      statusMessage: `Feature mirrored on ${plane} plane`,
    }));
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

  // D204 — Window Selection
  windowSelecting: false,
  windowSelectStart: null,
  windowSelectEnd: null,
  setWindowSelectStart: (p) => set({ windowSelecting: true, windowSelectStart: p, windowSelectEnd: p }),
  setWindowSelectEnd: (p) => set({ windowSelectEnd: p }),
  clearWindowSelect: () => set({ windowSelecting: false, windowSelectStart: null, windowSelectEnd: null }),

  // D205 — Lasso Selection
  lassoSelecting: false,
  lassoPoints: [],
  setLassoSelecting: (v) => set({ lassoSelecting: v }),
  setLassoPoints: (pts) => set({ lassoPoints: pts }),
  clearLasso: () => set({ lassoSelecting: false, lassoPoints: [] }),


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
    // Clamp at 3 — FormBodies renderer caps subdivision at 3 for performance;
    // higher levels would be silently ignored and confuse the user.
    formBodies: state.formBodies.map((b) =>
      b.id !== id ? b : { ...b, subdivisionLevel: Math.max(1, Math.min(3, level)) }
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
  // NAV-24: per-type object snap toggles (all on by default)
  objectSnapEnabled: true,
  setObjectSnapEnabled: (v) => set({ objectSnapEnabled: v }),
  snapToEndpoint: true,
  setSnapToEndpoint: (v) => set({ snapToEndpoint: v }),
  snapToMidpoint: true,
  setSnapToMidpoint: (v) => set({ snapToMidpoint: v }),
  snapToCenter: true,
  setSnapToCenter: (v) => set({ snapToCenter: v }),
  snapToIntersection: true,
  setSnapToIntersection: (v) => set({ snapToIntersection: v }),
  snapToPerpendicular: true,
  setSnapToPerpendicular: (v) => set({ snapToPerpendicular: v }),
  snapToTangent: true,
  setSnapToTangent: (v) => set({ snapToTangent: v }),
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

  // SK-A2: Sketch Pattern on Path
  sketchPathPatternCount: 4,
  sketchPathPatternPathEntityId: '',
  sketchPathPatternAlignment: 'tangent' as 'tangent' | 'fixed',
  setSketchPathPattern: (params) => set((state) => ({
    sketchPathPatternCount: params.count ?? state.sketchPathPatternCount,
    sketchPathPatternPathEntityId: params.pathEntityId ?? state.sketchPathPatternPathEntityId,
    sketchPathPatternAlignment: params.alignment ?? state.sketchPathPatternAlignment,
  })),
  commitSketchPathPattern: () => {
    const { activeSketch, sketchPathPatternCount: cnt,
            sketchPathPatternPathEntityId: pathId,
            sketchPathPatternAlignment: alignment } = get();
    if (!activeSketch) return;
    // Find the path entity by id
    const pathEnt = activeSketch.entities.find((e) => e.id === pathId);
    if (!pathEnt || pathEnt.points.length < 2) {
      set({ statusMessage: 'Pattern on Path: select a path curve with at least 2 points' });
      return;
    }
    // Build a polyline of cumulative arc lengths along the path
    const pts = pathEnt.points;
    const segLengths: number[] = [];
    let total = 0;
    for (let i = 1; i < pts.length; i++) {
      const dx = pts[i].x - pts[i-1].x, dy = pts[i].y - pts[i-1].y, dz = pts[i].z - pts[i-1].z;
      const len = Math.sqrt(dx*dx + dy*dy + dz*dz);
      segLengths.push(len);
      total += len;
    }
    if (total < 0.001) {
      set({ statusMessage: 'Pattern on Path: path has zero length' });
      return;
    }
    // Sample `cnt` equidistant points along the path
    const samplePt = (frac: number): { x: number; y: number; z: number; tx: number; ty: number; tz: number } => {
      const target = frac * total;
      let acc = 0;
      for (let i = 0; i < segLengths.length; i++) {
        const segEnd = acc + segLengths[i];
        if (target <= segEnd + 1e-9) {
          const t = segLengths[i] > 0 ? (target - acc) / segLengths[i] : 0;
          const p0 = pts[i], p1 = pts[i+1];
          const tx = p1.x - p0.x, ty = p1.y - p0.y, tz = p1.z - p0.z;
          const tLen = Math.sqrt(tx*tx + ty*ty + tz*tz) || 1;
          return {
            x: p0.x + tx * t, y: p0.y + ty * t, z: p0.z + tz * t,
            tx: tx/tLen, ty: ty/tLen, tz: tz/tLen,
          };
        }
        acc = segEnd;
      }
      const last = pts[pts.length - 1];
      const prev = pts[pts.length - 2];
      const tx = last.x - prev.x, ty = last.y - prev.y, tz = last.z - prev.z;
      const tLen = Math.sqrt(tx*tx + ty*ty + tz*tz) || 1;
      return { x: last.x, y: last.y, z: last.z, tx: tx/tLen, ty: ty/tLen, tz: tz/tLen };
    };
    // The origin of the pattern is at the path start (frac=0)
    const origin = samplePt(0);
    // Entities to pattern = all non-path entities
    const sourceEnts = activeSketch.entities.filter((e) => e.id !== pathId);
    if (sourceEnts.length === 0) {
      set({ statusMessage: 'Pattern on Path: no entities to pattern (path entity only)' });
      return;
    }
    const copies: SketchEntity[] = [];
    for (let i = 1; i < cnt; i++) {
      const sp = samplePt(i / (cnt - 1));
      const dx = sp.x - origin.x, dy = sp.y - origin.y, dz = sp.z - origin.z;
      for (const ent of sourceEnts) {
        const newEnt: SketchEntity = {
          ...ent,
          id: crypto.randomUUID(),
          points: ent.points.map((p) => ({ ...p, id: crypto.randomUUID(), x: p.x + dx, y: p.y + dy, z: p.z + dz })),
        };
        if (alignment === 'tangent') {
          // Rotate entities in sketch plane to align with path tangent (2D rotation)
          const { t1, t2 } = GeometryEngine.getSketchAxes(activeSketch);
          // Origin tangent direction projected into sketch plane
          const otx = origin.tx * t1.x + origin.ty * t1.y + origin.tz * t1.z;
          const oty = origin.tx * t2.x + origin.ty * t2.y + origin.tz * t2.z;
          const oAngle = Math.atan2(oty, otx);
          const stx = sp.tx * t1.x + sp.ty * t1.y + sp.tz * t1.z;
          const sty = sp.tx * t2.x + sp.ty * t2.y + sp.tz * t2.z;
          const sAngle = Math.atan2(sty, stx);
          const dAngle = sAngle - oAngle;
          const cosA = Math.cos(dAngle), sinA = Math.sin(dAngle);
          // Pivot = position of the entity centroid after translation
          let px = 0, py = 0, pz = 0, pc = 0;
          for (const p of newEnt.points) { px += p.x; py += p.y; pz += p.z; pc++; }
          if (pc > 0) { px /= pc; py /= pc; pz /= pc; }
          newEnt.points = newEnt.points.map((p) => {
            const lx = (p.x - px) * t1.x + (p.y - py) * t1.y + (p.z - pz) * t1.z;
            const ly = (p.x - px) * t2.x + (p.y - py) * t2.y + (p.z - pz) * t2.z;
            const rx = lx * cosA - ly * sinA;
            const ry = lx * sinA + ly * cosA;
            return { ...p, id: crypto.randomUUID(), x: px + t1.x*rx + t2.x*ry, y: py + t1.y*rx + t2.y*ry, z: pz + t1.z*rx + t2.z*ry };
          });
        }
        copies.push(newEnt);
      }
    }
    set({
      activeSketch: { ...activeSketch, entities: [...activeSketch.entities, ...copies] },
      statusMessage: `Pattern on Path: ${cnt} instances (${copies.length} new entities added)`,
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

  // D50: AutoConstrain — detect and record geometric constraints on the active sketch
  autoConstrainSketch: () => {
    const { activeSketch } = get();
    if (!activeSketch) return;

    const TOL = 0.5;       // mm tolerance for proximity / length equality
    const ANGLE_TOL = 0.01; // radians tolerance for direction comparisons

    const newConstraints: SketchConstraint[] = [];

    const lines = activeSketch.entities.filter(
      (e) => (e.type === 'line' || e.type === 'construction-line' || e.type === 'centerline') && e.points.length >= 2
    );

    // Horizontal / Vertical
    for (const e of lines) {
      const p0 = e.points[0];
      const p1 = e.points[e.points.length - 1];
      const dx = p1.x - p0.x;
      const dy = p1.y - p0.y;
      const dz = p1.z - p0.z;

      if (Math.abs(dy) < TOL && Math.abs(dz) < TOL) {
        const alreadyHas = activeSketch.constraints.some(
          (c) => c.type === 'horizontal' && c.entityIds.includes(e.id)
        );
        if (!alreadyHas) {
          newConstraints.push({ id: crypto.randomUUID(), type: 'horizontal', entityIds: [e.id] });
        }
      }

      if (Math.abs(dx) < TOL && Math.abs(dz) < TOL) {
        const alreadyHas = activeSketch.constraints.some(
          (c) => c.type === 'vertical' && c.entityIds.includes(e.id)
        );
        if (!alreadyHas) {
          newConstraints.push({ id: crypto.randomUUID(), type: 'vertical', entityIds: [e.id] });
        }
      }
    }

    // Coincident: pairs of endpoints within TOL
    const allPoints = activeSketch.entities.flatMap((e) =>
      e.points.map((p, idx) => ({ entityId: e.id, pointIndex: idx, x: p.x, y: p.y, z: p.z }))
    );
    for (let i = 0; i < allPoints.length; i++) {
      for (let j = i + 1; j < allPoints.length; j++) {
        const a = allPoints[i];
        const b = allPoints[j];
        if (a.entityId === b.entityId) continue;
        const dist = Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
        if (dist < TOL) {
          const alreadyHas = activeSketch.constraints.some(
            (c) =>
              c.type === 'coincident' &&
              c.entityIds.includes(a.entityId) &&
              c.entityIds.includes(b.entityId)
          );
          if (!alreadyHas) {
            newConstraints.push({
              id: crypto.randomUUID(),
              type: 'coincident',
              entityIds: [a.entityId, b.entityId],
              pointIndices: [a.pointIndex, b.pointIndex],
            });
          }
        }
      }
    }

    // Parallel: pairs of lines with same direction (within ANGLE_TOL)
    for (let i = 0; i < lines.length; i++) {
      for (let j = i + 1; j < lines.length; j++) {
        const ea = lines[i], eb = lines[j];
        const a0 = ea.points[0], a1 = ea.points[ea.points.length - 1];
        const b0 = eb.points[0], b1 = eb.points[eb.points.length - 1];
        const da = { x: a1.x - a0.x, y: a1.y - a0.y, z: a1.z - a0.z };
        const db = { x: b1.x - b0.x, y: b1.y - b0.y, z: b1.z - b0.z };
        const lenA = Math.sqrt(da.x ** 2 + da.y ** 2 + da.z ** 2);
        const lenB = Math.sqrt(db.x ** 2 + db.y ** 2 + db.z ** 2);
        if (lenA < 0.001 || lenB < 0.001) continue;
        const dot = Math.abs((da.x * db.x + da.y * db.y + da.z * db.z) / (lenA * lenB));
        if (dot > 1 - ANGLE_TOL) {
          const alreadyHas = activeSketch.constraints.some(
            (c) => c.type === 'parallel' && c.entityIds.includes(ea.id) && c.entityIds.includes(eb.id)
          );
          if (!alreadyHas) {
            newConstraints.push({ id: crypto.randomUUID(), type: 'parallel', entityIds: [ea.id, eb.id] });
          }
        }
      }
    }

    // Equal length: pairs of lines with same length (within TOL)
    const lineLengths = lines.map((e) => {
      const p0 = e.points[0], p1 = e.points[e.points.length - 1];
      return Math.sqrt((p1.x - p0.x) ** 2 + (p1.y - p0.y) ** 2 + (p1.z - p0.z) ** 2);
    });
    for (let i = 0; i < lines.length; i++) {
      for (let j = i + 1; j < lines.length; j++) {
        if (Math.abs(lineLengths[i] - lineLengths[j]) < TOL) {
          const alreadyHas = activeSketch.constraints.some(
            (c) => c.type === 'equal' && c.entityIds.includes(lines[i].id) && c.entityIds.includes(lines[j].id)
          );
          if (!alreadyHas) {
            newConstraints.push({ id: crypto.randomUUID(), type: 'equal', entityIds: [lines[i].id, lines[j].id] });
          }
        }
      }
    }

    if (newConstraints.length === 0) {
      get().setStatusMessage('AutoConstrain: no new constraints detected');
      return;
    }

    set((s) => ({
      activeSketch: s.activeSketch
        ? { ...s.activeSketch, constraints: [...s.activeSketch.constraints, ...newConstraints] }
        : null,
    }));
    get().setStatusMessage(`AutoConstrain: applied ${newConstraints.length} constraint${newConstraints.length === 1 ? '' : 's'}`);
  },

  // D27: Solve constraints on the active sketch using Newton-Raphson
  sketchComputeDeferred: false,
  setSketchComputeDeferred: (v) => set({ sketchComputeDeferred: v }),

  solveSketch: () => {
    const { activeSketch } = get();
    if (!activeSketch) return;

    // PLANE-AWARE SOLVE: SketchPoints are stored in WORLD 3D coords. The 2D
    // solver expects plane-local UV coords. Without projecting, an XZ/YZ/custom
    // sketch would feed (x, y=0) — silently mangling geometry on solve.
    // Round trip: project 3D → 2D, solve, unproject 2D → 3D.
    const { t1, t2 } = GeometryEngine.getSketchAxes(activeSketch);
    const origin = activeSketch.planeOrigin;
    const projectedEntities = activeSketch.entities.map((e) => ({
      ...e,
      points: e.points.map((pt) => {
        const dx = pt.x - origin.x, dy = pt.y - origin.y, dz = pt.z - origin.z;
        const u = dx * t1.x + dy * t1.y + dz * t1.z;
        const v = dx * t2.x + dy * t2.y + dz * t2.z;
        return { ...pt, x: u, y: v, z: 0 };
      }),
    }));

    const result = solveConstraints(projectedEntities, activeSketch.constraints ?? []);
    if (!result.solved) {
      set((s) => ({
        activeSketch: s.activeSketch ? { ...s.activeSketch, overConstrained: true } : null,
        statusMessage: `Over-constrained sketch (residual ${result.residual.toFixed(3)}) after ${result.iterations} iterations`,
      }));
      return;
    }

    // Apply solved positions back to entities — UNPROJECT 2D UV → 3D world.
    const updatedEntities = activeSketch.entities.map((e) => {
      const updated = { ...e, points: e.points.map((pt, pi) => {
        const solvedPt = result.updatedPoints.get(`${e.id}-p${pi}`);
        if (!solvedPt) return pt;
        // Unproject (u, v) back to world via origin + u*t1 + v*t2
        return {
          ...pt,
          x: origin.x + solvedPt.x * t1.x + solvedPt.y * t2.x,
          y: origin.y + solvedPt.x * t1.y + solvedPt.y * t2.y,
          z: origin.z + solvedPt.x * t1.z + solvedPt.y * t2.z,
        };
      }) };
      return updated;
    });

    set((s) => ({
      activeSketch: s.activeSketch ? { ...s.activeSketch, entities: updatedEntities, overConstrained: false } : null,
      statusMessage: `Constraints solved (${result.iterations} iteration${result.iterations === 1 ? '' : 's'})`,
    }));
  },

  // D52: Constraint application state
  constraintSelection: [],
  setConstraintSelection: (ids) => set({ constraintSelection: ids }),
  addToConstraintSelection: (id) => set((s) => ({ constraintSelection: [...s.constraintSelection, id] })),
  clearConstraintSelection: () => set({ constraintSelection: [] }),
  // SK-A9: offset constraint distance (user edits in SketchPalette before clicking entities)
  constraintOffsetValue: 10,
  setConstraintOffsetValue: (v) => set({ constraintOffsetValue: Math.max(0.001, v) }),
  // SK-A1: surface constraint pending surface pick
  constraintSurfacePlane: null,
  setConstraintSurfacePlane: (plane) => set({ constraintSurfacePlane: plane }),

  // D52: Add a single constraint to the active sketch
  addSketchConstraint: (constraint) => {
    const { activeSketch } = get();
    if (!activeSketch) return;
    const exists = (activeSketch.constraints ?? []).some(
      c => c.type === constraint.type &&
        c.entityIds.join(',') === constraint.entityIds.join(',')
    );
    if (exists) return;
    get().pushUndo();
    // Write to activeSketch (the sketch being edited), not to the
    // completed sketches array. While editing, the sketch lives in
    // activeSketch, not in sketches[].
    set({
      activeSketch: {
        ...activeSketch,
        constraints: [...(activeSketch.constraints ?? []), constraint],
      },
      statusMessage: `${constraint.type} constraint applied`,
    });
    // CORR-7: skip auto-solve when compute is deferred
    if (!get().sketchComputeDeferred) get().solveSketch();
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
  setShowSketchProfile: (show) => set((s) => ({
    showSketchProfile: show,
    activeSketch: s.activeSketch ? { ...s.activeSketch, areProfilesShown: show } : null,
  })),

  // Slice (D54)
  sliceEnabled: false,
  setSliceEnabled: (enabled) => set({ sliceEnabled: enabled }),

  // D58: 3D Sketch mode
  sketch3DMode: false,
  setSketch3DMode: (v) => set({ sketch3DMode: v }),
  toggleSketch3DMode: () => set((s) => ({ sketch3DMode: !s.sketch3DMode })),
  // S7: active draw plane for multi-plane 3D sketch
  sketch3DActivePlane: null,
  setSketch3DActivePlane: (plane) => set({ sketch3DActivePlane: plane }),

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
  setShowSketchPoints: (v) => set((s) => ({
    showSketchPoints: v,
    activeSketch: s.activeSketch ? { ...s.activeSketch, arePointsShown: v } : null,
  })),
  showSketchDimensions: true,
  setShowSketchDimensions: (v) => set((s) => ({
    showSketchDimensions: v,
    activeSketch: s.activeSketch ? { ...s.activeSketch, areDimensionsShown: v } : null,
  })),
  showSketchConstraints: true,
  setShowSketchConstraints: (v) => set((s) => ({
    showSketchConstraints: v,
    activeSketch: s.activeSketch ? { ...s.activeSketch, areConstraintsShown: v } : null,
  })),
  showProjectedGeometries: true,
  setShowProjectedGeometries: (v) => set({ showProjectedGeometries: v }),
  showConstructionGeometries: true,
  setShowConstructionGeometries: (v) => set({ showConstructionGeometries: v }),

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
  showEnvironment: false,
  setShowEnvironment: (show) => set({ showEnvironment: show }),
  showShadows: true,
  setShowShadows: (show) => set({ showShadows: show }),
  showReflections: true,
  setShowReflections: (show) => set({ showReflections: show }),
  showGroundPlane: true,
  setShowGroundPlane: (show) => set({ showGroundPlane: show }),
  groundPlaneOffset: 0,
  setGroundPlaneOffset: (v) => set({ groundPlaneOffset: v }),
  shadowSoftness: 2,
  setShadowSoftness: (v) => set({ shadowSoftness: v }),
  ambientOcclusionEnabled: false,
  setAmbientOcclusionEnabled: (enabled) => set({ ambientOcclusionEnabled: enabled }),
  environmentPreset: 'studio',
  setEnvironmentPreset: (preset) => set({ environmentPreset: preset }),

  // NAV-23: Object Visibility
  entityVisSketchBodies: true,
  entityVisConstruction: true,
  entityVisOrigins: true,
  entityVisJoints: true,
  setEntityVisSketchBodies: (v) => set({ entityVisSketchBodies: v }),
  setEntityVisConstruction: (v) => set({ entityVisConstruction: v }),
  setEntityVisOrigins: (v) => set({ entityVisOrigins: v }),
  setEntityVisJoints: (v) => set({ entityVisJoints: v }),

  cameraProjection: 'perspective',
  setCameraProjection: (p) => set({ cameraProjection: p }),

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
  setExtrudeDistance2: (distance) => set({ extrudeDistance2: distance }),
  setExtrudeDirection: (d) => set({ extrudeDirection: d }),
  setExtrudeOperation: (o) => set({ extrudeOperation: o }),
  // Thin extrude (D66)
  setExtrudeThinEnabled: (v) => set({ extrudeThinEnabled: v }),
  setExtrudeThinThickness: (t) => set({ extrudeThinThickness: Math.max(0.01, t) }),
  setExtrudeThinSide: (s) => set({ extrudeThinSide: s }),
  // EX-7/EX-8 per-side
  setExtrudeThinSide2: (s) => set({ extrudeThinSide2: s }),
  setExtrudeThinThickness2: (t) => set({ extrudeThinThickness2: Math.max(0.01, t) }),
  // D67 / CORR-8 start options
  setExtrudeStartType: (t) => set({ extrudeStartType: t }),
  setExtrudeStartOffset: (v) => set({ extrudeStartOffset: v }),
  setExtrudeStartEntityId: (id) => set({ extrudeStartEntityId: id }),
  // EX-4: From-Entity face data
  setExtrudeStartFace: (normal, centroid) => set({
    extrudeStartEntityId: centroid.join(','),
    extrudeStartFaceNormal: normal,
    extrudeStartFaceCentroid: centroid,
    statusMessage: 'Start face selected — set extent distance, then OK',
  }),
  clearExtrudeStartFace: () => set({
    extrudeStartEntityId: null,
    extrudeStartFaceNormal: null,
    extrudeStartFaceCentroid: null,
  }),
  // D68 extent types (EX-3: to-object added)
  setExtrudeExtentType: (t) => set({ extrudeExtentType: t }),
  setExtrudeExtentType2: (t) => set({ extrudeExtentType2: t }),
  // EX-3: To-Object face data
  setExtrudeToEntityFace: (id, normal, centroid) => set({
    extrudeToEntityFaceId: id,
    extrudeToEntityFaceNormal: normal,
    extrudeToEntityFaceCentroid: centroid,
    statusMessage: 'To-object face selected — OK to commit',
  }),
  clearExtrudeToEntityFace: () => set({
    extrudeToEntityFaceId: null,
    extrudeToEntityFaceNormal: null,
    extrudeToEntityFaceCentroid: null,
    extrudeToObjectFlipDirection: false,
  }),
  // EX-12
  setExtrudeToObjectFlipDirection: (v) => set({ extrudeToObjectFlipDirection: v }),
  // D69 taper angle
  setExtrudeTaperAngle: (a) => set({ extrudeTaperAngle: a }),
  // EX-6 taper angle side 2
  setExtrudeTaperAngle2: (a) => set({ extrudeTaperAngle2: a }),
  // EX-5 symmetric full-length
  setExtrudeSymmetricFullLength: (v) => set({ extrudeSymmetricFullLength: v }),
  // D102 body kind
  setExtrudeBodyKind: (k) => set({ extrudeBodyKind: k }),
  // EX-9 / CORR-14
  setExtrudeParticipantBodyIds: (ids) => set({ extrudeParticipantBodyIds: ids }),
  setExtrudeConfinedFaceIds: (ids) => set({ extrudeConfinedFaceIds: ids }),
  setExtrudeCreationOccurrence: (id) => set({ extrudeCreationOccurrence: id }),
  setExtrudeTargetBaseFeature: (id) => set({ extrudeTargetBaseFeature: id }),
  startExtrudeTool: () => {
    // Clean up orphaned Press Pull profiles from previous sessions
    const { sketches, features } = get();
    const usedSketchIds = new Set(features.map((f) => f.sketchId).filter(Boolean));
    const cleanedSketches = sketches.filter(
      (s) => !s.name.startsWith('Press Pull Profile') || usedSketchIds.has(s.id),
    );
    set({
      activeTool: 'extrude',
      ...EXTRUDE_DEFAULTS,
      sketches: cleanedSketches,
      extrudeSelectedSketchId: null,
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
    // Press-pull defaults to Join (adding material to the existing body).
    // The user can switch to Cut or New Body in the panel dropdown.
    set({
      sketches: [...sketches, sketch],
      extrudeSelectedSketchId: sketch.id,
      extrudeSelectedSketchIds: [sketch.id],
      extrudeDirection: 'positive',
      extrudeOperation: 'join',
      statusMessage: 'Press-pull profile selected — drag arrow or set distance, then OK',
    });
  },
  // EX-11: add a planar face as an additional profile while sketch(es) already selected.
  // Creates a Press Pull Profile sketch from the face boundary and appends it to the
  // current selection — does NOT reset EXTRUDE_DEFAULTS (unlike startExtrudeFromFace).
  addFaceToExtrude: (boundary, normal, centroid) => {
    if (boundary.length < 3) {
      set({ statusMessage: 'Cannot add face — boundary too small' });
      return;
    }
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
    const { sketches, extrudeSelectedSketchIds } = get();
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
    const newIds = [...extrudeSelectedSketchIds, sketch.id];
    set({
      sketches: [...sketches, sketch],
      extrudeSelectedSketchId: sketch.id,
      extrudeSelectedSketchIds: newIds,
      statusMessage: `${newIds.length} profiles selected — drag arrow or set distance, then OK`,
    });
  },
  loadExtrudeForEdit: (featureId) => {
    const { features } = get();
    const feature = features.find((f) => f.id === featureId);
    if (!feature || feature.type !== 'extrude') return;
    const p = feature.params;
    const sketchId = feature.sketchId ?? null;
    set({
      activeTool: 'extrude',
      editingFeatureId: featureId,
      extrudeSelectedSketchId: sketchId,
      extrudeSelectedSketchIds: sketchId ? [sketchId] : [],
      extrudeDistance: typeof p.distance === 'number' ? p.distance : 10,
      extrudeDistance2: typeof p.distance2 === 'number' ? p.distance2 : 10,
      extrudeDirection: (p.direction as ExtrudeDirection) ?? 'positive',
      extrudeOperation: (p.operation as ExtrudeOperation) ?? 'new-body',
      extrudeThinEnabled: !!p.thin,
      extrudeThinThickness: typeof p.thinThickness === 'number' ? p.thinThickness : 2,
      extrudeThinSide: (p.thinSide as 'side1' | 'side2' | 'center') ?? 'side1',
      extrudeThinSide2: (p.thinSide2 as 'side1' | 'side2' | 'center') ?? 'side1',
      extrudeThinThickness2: typeof p.thinThickness2 === 'number' ? p.thinThickness2 : 2,
      extrudeStartType: (p.startType as 'profile' | 'offset' | 'entity') ?? 'profile',
      extrudeStartOffset: typeof p.startOffset === 'number' ? p.startOffset : 0,
      extrudeStartEntityId: (p.startEntityId as string | null) ?? null,
      extrudeExtentType: (p.extentType as 'distance' | 'all' | 'to-object') ?? 'distance',
      extrudeExtentType2: (p.extentType2 as 'distance' | 'all' | 'to-object') ?? 'distance',
      extrudeToEntityFaceId: (p.toEntityFaceId as string | null) ?? null,
      extrudeToEntityFaceNormal: (p.toEntityFaceNormal as [number, number, number] | null) ?? null,
      extrudeToEntityFaceCentroid: (p.toEntityFaceCentroid as [number, number, number] | null) ?? null,
      extrudeToObjectFlipDirection: !!(p.toObjectFlipDirection),
      extrudeStartFaceNormal: (p.startFaceNormal as [number, number, number] | null) ?? null,
      extrudeStartFaceCentroid: (p.startFaceCentroid as [number, number, number] | null) ?? null,
      extrudeTaperAngle: typeof p.taperAngle === 'number' ? p.taperAngle : 0,
      extrudeTaperAngle2: typeof p.taperAngle2 === 'number' ? p.taperAngle2 : 0,
      extrudeSymmetricFullLength: false,
      extrudeBodyKind: (feature.bodyKind === 'surface' ? 'surface' : 'solid') as 'solid' | 'surface',
      extrudeParticipantBodyIds: Array.isArray(p.participantBodyIds) ? (p.participantBodyIds as unknown as string[]) : [],
      extrudeConfinedFaceIds: Array.isArray(p.confinedFaceIds) ? (p.confinedFaceIds as unknown as string[]) : [],
      extrudeCreationOccurrence: typeof p.creationOccurrence === 'string' ? p.creationOccurrence : null,
      extrudeTargetBaseFeature: typeof p.targetBaseFeature === 'string' ? p.targetBaseFeature : null,
      statusMessage: `Edit extrude: "${feature.name}"`,
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
      extrudeSelectedSketchId, extrudeSelectedSketchIds, extrudeDistance, extrudeDistance2, extrudeDirection,
      extrudeOperation, extrudeThinEnabled, extrudeThinThickness, extrudeThinSide,
      extrudeThinSide2, extrudeThinThickness2,
      extrudeStartType, extrudeStartOffset, extrudeStartEntityId, extrudeExtentType, extrudeTaperAngle, extrudeTaperAngle2,
      extrudeBodyKind, extrudeSymmetricFullLength, extrudeParticipantBodyIds,
      extrudeConfinedFaceIds,
      extrudeExtentType2,
      extrudeToEntityFaceId, extrudeToEntityFaceNormal,
      extrudeStartFaceCentroid, extrudeStartFaceNormal,
      extrudeCreationOccurrence,
      extrudeTargetBaseFeature,
      editingFeatureId,
      sketches, features, units,
    } = get();
    // EX-13: edit mode — identify the feature being replaced
    const editingExtrude = editingFeatureId
      ? features.find((f) => f.id === editingFeatureId && f.type === 'extrude') ?? null
      : null;
    const editingIndex = editingExtrude ? features.findIndex((f) => f.id === editingFeatureId) : -1;
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
          return { sourceSketch, sketchForOp: sourceSketch, selectionId: id, profileIndex: undefined as number | undefined };
        }
        const parsed = Number(rawIndex);
        if (!Number.isFinite(parsed)) return null;
        const profileSketch = GeometryEngine.createProfileSketch(sourceSketch, parsed);
        if (!profileSketch) return null;
        return { sourceSketch, sketchForOp: profileSketch, selectionId: id, profileIndex: parsed };
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
    get().pushUndo();
    // EX-3: for to-object extent, derive distance from profile plane → face centroid projection
    const { extrudeToEntityFaceCentroid, extrudeToObjectFlipDirection } = get();
    const computeToObjectDistance = (profileSketch: Sketch): number => {
      if (!extrudeToEntityFaceCentroid) return Math.abs(extrudeDistance);
      const target = new THREE.Vector3(...extrudeToEntityFaceCentroid);
      const origin = profileSketch.planeOrigin.clone();
      // EX-4: if From-Entity start is set, use that face centroid as origin
      if (extrudeStartFaceCentroid) origin.set(...extrudeStartFaceCentroid);
      const n = extrudeToEntityFaceNormal
        ? new THREE.Vector3(...extrudeToEntityFaceNormal)
        : profileSketch.planeNormal.clone().normalize();
      // EX-12: directionHint — flip the sign so the extrude goes the other way
      const raw = target.clone().sub(origin).dot(n);
      const d = extrudeToObjectFlipDirection ? -raw : raw;
      return Math.max(0.01, Math.abs(d));
    };
    // Use absolute distance — negative just means the user dragged in reverse
    const absDistance = extrudeExtentType === 'all'
      ? 10000
      : extrudeExtentType === 'to-object'
        ? computeToObjectDistance(
            (selectedProfiles[0]?.sketchForOp) ?? (selectedProfiles[0]?.sourceSketch)
          )
        : Math.abs(extrudeDistance);
    // EX-10: side 2 uses its own independent extent type
    const absDistance2 = extrudeExtentType2 === 'all'
      ? 10000
      : extrudeExtentType2 === 'to-object'
        ? computeToObjectDistance(
            (selectedProfiles[0]?.sketchForOp) ?? (selectedProfiles[0]?.sourceSketch)
          )
        : Math.abs(extrudeDistance2);
    // Direction follows the sign of the distance (two-sides never flips)
    const finalDirection = extrudeDirection === 'two-sides' ? 'two-sides' : (extrudeDistance < 0 ? 'negative' : extrudeDirection);
    // Operation is set explicitly by the user in the panel (new-body, join, cut)
    const finalOperation = extrudeOperation;

    // EX-13: in edit mode, remove the old feature first (new one inserts at same position)
    const nextFeatures = editingExtrude
      ? features.filter((f) => f.id !== editingFeatureId)
      : [...features];
    let createdCount = 0;
    let firstCreatedSketchName: string | null = null;

    for (const selected of selectedProfiles) {
      const { sourceSketch, sketchForOp, profileIndex } = selected;
      const isClosedProfile = GeometryEngine.isSketchClosedProfile(sketchForOp);
      const resolvedBodyKind: 'solid' | 'surface' = (!isClosedProfile || extrudeBodyKind === 'surface') ? 'surface' : 'solid';

      // Generate mesh: surface → thin → standard solid (taper is rebuilt by
      // ExtrudedBodies via buildExtrudeFeatureMesh, so no stored mesh).
      let featureMesh: THREE.Mesh | undefined;
      if (resolvedBodyKind === 'surface') {
        featureMesh = GeometryEngine.extrudeSketchSurface(sketchForOp, absDistance) ?? undefined;
      } else if (extrudeThinEnabled) {
        featureMesh = GeometryEngine.extrudeThinSketch(sketchForOp, absDistance, extrudeThinThickness, extrudeThinSide) ?? undefined;
      } else {
        featureMesh = GeometryEngine.extrudeSketch(sketchForOp, absDistance) ?? undefined;
      }

      // Apply start offset to thin/surface stored meshes (standard solid +
      // taper get the offset applied during the CSG rebuild instead).
      if (featureMesh && extrudeStartType === 'offset' && Math.abs(extrudeStartOffset) > 0.001) {
        const n = GeometryEngine.getSketchExtrudeNormal(sketchForOp);
        featureMesh.position.addScaledVector(n, extrudeStartOffset);
      }

      // Standard solid extrudes (with or without taper/offset) are rebuilt by
      // the ExtrudedBodies CSG pipeline so they participate in join/cut. Only
      // thin and surface extrudes need a stored mesh.
      const needsStoredMesh = resolvedBodyKind === 'surface' || extrudeThinEnabled;

      // ── Fusion 360 parity: auto-promote 'join' → 'new-body' when detached ──
      // If the user chose 'join' but the proposed geometry doesn't intersect any
      // existing solid body (e.g. an offset extrusion floating in space), Fusion
      // 360 automatically creates a new body. We replicate that here by doing a
      // cheap bounding-box check against all currently committed solid extrudes.
      let effectiveOperation = finalOperation;
      if (finalOperation === 'join' && resolvedBodyKind === 'solid' && !extrudeThinEnabled) {
        const existingSolids = nextFeatures.filter(
          (f) => f.type === 'extrude' && !f.suppressed && f.visible &&
                 f.bodyKind !== 'surface' &&
                 (f.params.operation === 'new-body' || f.params.operation === 'join'),
        );
        if (existingSolids.length === 0) {
          // No solid bodies yet — this must be the first one
          effectiveOperation = 'new-body';
        } else {
          // Build bounding box of the proposed new extrusion
          const proposedMesh = GeometryEngine.buildExtrudeFeatureMesh(
            sketchForOp, absDistance, finalDirection, extrudeTaperAngle,
            extrudeStartType === 'offset' ? extrudeStartOffset : 0,
            absDistance2,
            extrudeTaperAngle2,
          );
          if (proposedMesh) {
            proposedMesh.updateMatrixWorld(true);
            const proposedBox = new THREE.Box3().setFromObject(proposedMesh);
            proposedMesh.geometry.dispose();
            let intersectsAny = false;
            for (const ef of existingSolids) {
              const efSk = sketches.find((s) => s.id === ef.sketchId);
              if (!efSk) continue;
              const efPI = ef.params.profileIndex as number | undefined;
              const efSketchForOp = efPI !== undefined
                ? GeometryEngine.createProfileSketch(efSk, efPI)
                : efSk;
              if (!efSketchForOp) continue;
              const efMesh = GeometryEngine.buildExtrudeFeatureMesh(
                efSketchForOp,
                (ef.params.distance as number) ?? 10,
                ((ef.params.direction as string) || 'positive') as 'positive' | 'negative' | 'symmetric' | 'two-sides',
                (ef.params.taperAngle as number) ?? 0,
                (ef.params.startType as string) === 'offset' ? ((ef.params.startOffset as number) ?? 0) : 0,
                (ef.params.distance2 as number) ?? (ef.params.distance as number) ?? 10,
              );
              if (!efMesh) continue;
              efMesh.updateMatrixWorld(true);
              const efBox = new THREE.Box3().setFromObject(efMesh);
              efMesh.geometry.dispose();
              if (proposedBox.intersectsBox(efBox)) {
                intersectsAny = true;
                break;
              }
            }
            if (!intersectsAny) effectiveOperation = 'new-body';
          }
        }
      }

      const featureId = crypto.randomUUID();
      let componentId: string | undefined;
      let bodyId: string | undefined;
      if (effectiveOperation === 'new-body') {
        const componentStore = useComponentStore.getState();
        componentId = componentStore.activeComponentId ?? componentStore.rootComponentId;
        const bodyCount = Object.keys(componentStore.bodies).length + 1;
        const bodyLabel = `${resolvedBodyKind === 'surface' ? 'Surface' : 'Body'} ${bodyCount}`;
        const createdBodyId = componentStore.addBody(componentId, bodyLabel);
        if (createdBodyId) {
          bodyId = createdBodyId;
          componentStore.addFeatureToBody(createdBodyId, featureId);
          // Only store mesh on body for thin/taper/surface — standard solid
          // extrudes are rendered by the CSG pipeline in ExtrudedBodies.
          if (needsStoredMesh && featureMesh) componentStore.setBodyMesh(createdBodyId, featureMesh);
        }
      } else if (effectiveOperation === 'new-component') {
        const componentStore = useComponentStore.getState();
        const parentId = componentStore.activeComponentId ?? componentStore.rootComponentId;
        const newCompId = componentStore.addComponent(parentId, 'Component ' + (Object.keys(componentStore.components ?? {}).length + 1));
        const createdBodyId = componentStore.addBody(newCompId, 'Body 1');
        componentId = newCompId;
        bodyId = createdBodyId;
        if (createdBodyId) {
          componentStore.addFeatureToBody(createdBodyId, featureId);
          if (needsStoredMesh && featureMesh) componentStore.setBodyMesh(createdBodyId, featureMesh);
        }
      }

      const feature: Feature = {
        id: featureId,
        name: `${extrudeThinEnabled ? 'Thin ' : ''}${effectiveOperation === 'cut' ? 'Cut' : 'Extrude'} ${features.filter(f => f.type === 'extrude').length + createdCount + 1}`,
        type: 'extrude',
        sketchId: sourceSketch.id,
        bodyId,
        componentId,
        params: {
          distance: finalDirection === 'symmetric'
            ? (extrudeSymmetricFullLength ? absDistance / 2 : absDistance)
            : absDistance,
          distanceExpr: String(absDistance),
          ...(finalDirection === 'two-sides' ? { distance2: absDistance2 } : {}),
          direction: finalDirection,
          operation: effectiveOperation,
          thin: extrudeThinEnabled,
          thinThickness: extrudeThinThickness,
          thinSide: extrudeThinSide,
          // EX-7/EX-8: per-side thin values (relevant only when direction=two-sides)
          thinSide2: extrudeThinSide2,
          thinThickness2: extrudeThinThickness2,
          startType: extrudeStartType,
          startOffset: extrudeStartOffset,
          ...(extrudeStartType === 'entity' ? { startEntityId: extrudeStartEntityId } : {}),
          // EX-4: From-Entity face data
          ...(extrudeStartFaceCentroid ? { startFaceCentroid: extrudeStartFaceCentroid, startFaceNormal: extrudeStartFaceNormal } : {}),
          // EX-9: participant bodies (empty array = all bodies)
          ...(extrudeParticipantBodyIds.length > 0 ? { participantBodyIds: extrudeParticipantBodyIds } : {}),
          // SDK-12: confined faces (empty = no confinement)
          ...(extrudeConfinedFaceIds.length > 0 ? { confinedFaceIds: extrudeConfinedFaceIds } : {}),
          // EX-15: occurrence context the profile was created in
          ...(extrudeCreationOccurrence ? { creationOccurrence: extrudeCreationOccurrence } : {}),
          // EX-16: target base feature container for direct-edit mode
          ...(extrudeTargetBaseFeature ? { targetBaseFeature: extrudeTargetBaseFeature } : {}),
          extentType: extrudeExtentType,
          // EX-3/EX-12: save to-object face data + flip for edit round-trip
          ...(extrudeExtentType === 'to-object' && extrudeToEntityFaceCentroid
            ? { toEntityFaceId: extrudeToEntityFaceId, toEntityFaceNormal: extrudeToEntityFaceNormal, toEntityFaceCentroid: extrudeToEntityFaceCentroid, toObjectFlipDirection: extrudeToObjectFlipDirection }
            : {}),
          ...(finalDirection === 'two-sides' ? { extentType2: extrudeExtentType2 } : {}),
          taperAngle: extrudeTaperAngle,
          ...(finalDirection === 'two-sides' ? { taperAngle2: extrudeTaperAngle2 } : {}),
          profileIndex,
        },
        visible: true,
        suppressed: false,
        timestamp: Date.now(),
        // Standard solid extrudes (no thin, no taper) must NOT store a mesh —
        // ExtrudedBodies.tsx CSG pipeline rebuilds them from sketch + params
        // via buildExtrudeFeatureMesh and applies csgSubtract/csgUnion.
        // Only thin/taper/surface extrudes store a mesh (can't be rebuilt
        // from just sketch + distance + direction).
        mesh: needsStoredMesh ? featureMesh : undefined,
        bodyKind: resolvedBodyKind,
        // EX-16: when targeting a base feature, exclude from parametric timeline
        ...(extrudeTargetBaseFeature ? { suppressTimeline: true } : {}),
        // EX-17: stable synthetic face IDs — start, end, and one side-face per sketch edge
        startFaceIds: [`${featureId}_start_0`],
        endFaceIds: [`${featureId}_end_0`],
        sideFaceIds: sketchForOp.entities.map((_, ei) => `${featureId}_side_${ei}`),
      };

      // Dispose the mesh if we're not storing it to avoid GPU leak
      if (!needsStoredMesh && featureMesh) {
        featureMesh.geometry.dispose();
      }

      // EX-13: edit mode inserts at the old feature's index; create mode appends
      if (editingExtrude && editingIndex >= 0) {
        nextFeatures.splice(editingIndex, 0, feature);
      } else {
        nextFeatures.push(feature);
      }
      createdCount += 1;
      if (!firstCreatedSketchName) firstCreatedSketchName = sourceSketch.name;
    }

    const actionVerb = editingExtrude ? 'Updated' : (finalOperation === 'cut' ? 'Cut' : 'Extruded');
    set({
      features: nextFeatures,
      activeTool: 'select',
      editingFeatureId: null,
      ...EXTRUDE_DEFAULTS,
      statusMessage:
        createdCount > 1
          ? `${actionVerb} ${createdCount} profiles${extrudeExtentType === 'all' ? ' (All)' : ` by ${absDistance}${units}`}`
          : `${actionVerb} ${firstCreatedSketchName ?? 'profile'}${extrudeExtentType === 'all' ? ' (All)' : ` by ${absDistance}${units}`}`,
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
  // CORR-10
  setRevolveIsProjectAxis: (v) => set({ revolveIsProjectAxis: v }),
  // Face mode
  setRevolveProfileMode: (m) => set({ revolveProfileMode: m }),
  startRevolveFromFace: (boundary, normal) => {
    if (boundary.length < 3) return;
    const flat = boundary.flatMap((v) => [v.x, v.y, v.z]);
    set({
      revolveFaceBoundary: flat,
      revolveFaceNormal: [normal.x, normal.y, normal.z],
      statusMessage: 'Face selected — set axis and angle, then click OK',
    });
  },
  startRevolveTool: () => {
    set({
      activeTool: 'revolve',
      ...REVOLVE_DEFAULTS,
      statusMessage: 'Revolve — pick a sketch profile or use Face mode',
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
    const { revolveProfileMode, revolveSelectedSketchId, revolveFaceBoundary, revolveAxis, revolveAngle, revolveDirection, revolveAngle2, revolveBodyKind, revolveIsProjectAxis, sketches, features, units } = get();

    // ── Face mode ──────────────────────────────────────────────────────────
    if (revolveProfileMode === 'face') {
      if (!revolveFaceBoundary || revolveFaceBoundary.length < 9) {
        set({ statusMessage: 'Click a face in the viewport first' });
        return;
      }
      const primaryAngle = revolveDirection === 'symmetric' ? revolveAngle / 2 : revolveAngle;
      if (Math.abs(primaryAngle) < 0.5) {
        set({ statusMessage: 'Angle must be greater than 0' });
        return;
      }
      const feature: Feature = {
        id: crypto.randomUUID(),
        name: `${revolveBodyKind === 'surface' ? 'Surface ' : ''}Revolve ${features.filter((f) => f.type === 'revolve').length + 1}`,
        type: 'revolve',
        params: {
          angle: revolveAngle,
          axis: revolveAxis,
          direction: revolveDirection,
          angle2: revolveAngle2,
          faceRevolve: true,
          faceBoundary: revolveFaceBoundary,
          isProjectAxis: revolveIsProjectAxis,
        },
        visible: true,
        suppressed: false,
        timestamp: Date.now(),
        bodyKind: revolveBodyKind === 'surface' ? 'surface' : 'solid',
      };
      const angleDesc = revolveDirection === 'symmetric' ? `±${revolveAngle / 2}°` : `${revolveAngle}°`;
      get().pushUndo();
      set({
        features: [...features, feature],
        activeTool: 'select',
        ...REVOLVE_DEFAULTS,
        statusMessage: `Revolved face by ${angleDesc} around ${revolveAxis} (${units})`,
      });
      return;
    }

    // ── Sketch mode ────────────────────────────────────────────────────────
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
    // S5: if centerline axis, find centerline entity in sketch and extract axis
    let resolvedAxisKey = revolveAxis as string;
    let centerlineAxisDirection: [number, number, number] | undefined;
    let centerlineAxisOrigin: [number, number, number] | undefined;
    if (revolveAxis === 'centerline') {
      const clEntity = sketch.entities.find((e) => e.type === 'centerline' && e.points.length >= 2);
      if (!clEntity) {
        set({ statusMessage: 'Spun Profile: no centerline found in sketch — add a centerline entity first' });
        return;
      }
      const p0 = clEntity.points[0];
      const p1 = clEntity.points[clEntity.points.length - 1];
      const dir = new THREE.Vector3(p1.x - p0.x, p1.y - p0.y, p1.z - p0.z).normalize();
      centerlineAxisDirection = [dir.x, dir.y, dir.z];
      centerlineAxisOrigin = [p0.x, p0.y, p0.z];
      // Map to nearest standard axis for LatheGeometry orientation fallback
      const ax = Math.abs(dir.x), ay = Math.abs(dir.y), az = Math.abs(dir.z);
      resolvedAxisKey = ax >= ay && ax >= az ? 'X' : ay >= ax && ay >= az ? 'Y' : 'Z';
    }
    get().pushUndo();
    const feature: Feature = {
      id: crypto.randomUUID(),
      name: `${revolveBodyKind === 'surface' ? 'Surface ' : ''}Revolve ${features.filter((f) => f.type === 'revolve').length + 1}`,
      type: 'revolve',
      sketchId: revolveSelectedSketchId,
      params: {
        angle: revolveAngle,
        axis: resolvedAxisKey,
        ...(centerlineAxisDirection ? { useCenterline: true, axisDirection: centerlineAxisDirection, axisOrigin: centerlineAxisOrigin } : {}),
        direction: revolveDirection,
        angle2: revolveAngle2,
        isProjectAxis: revolveIsProjectAxis,
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
      statusMessage: `Revolved ${sketch.name} by ${angleDesc} around ${revolveAxis === 'centerline' ? 'sketch centerline' : revolveAxis} (${units})`,
    });
  },

  // ─── Sweep tool (D30 / D104) ───────────────────────────────────────────
  sweepProfileSketchId: null,
  setSweepProfileSketchId: (id) => set({ sweepProfileSketchId: id }),
  sweepPathSketchId: null,
  setSweepPathSketchId: (id) => set({ sweepPathSketchId: id }),
  sweepBodyKind: 'solid',
  setSweepBodyKind: (k) => set({ sweepBodyKind: k }),
  // D71 sweep upgrades
  sweepOrientation: 'perpendicular' as 'perpendicular' | 'parallel' | 'default',
  sweepProfileScaling: 'none' as 'none' | 'scale-to-path' | 'scale-to-rail',
  sweepTwistAngle: 0,
  sweepTaperAngle: 0,
  sweepGuideRailId: null,
  sweepOperation: 'new-body' as 'new-body' | 'join' | 'cut',
  sweepDistance: 'entire' as 'entire' | 'distance',
  // SDK-5: path parametric start/end (0–1 fraction)
  sweepDistanceOne: 0,
  sweepDistanceTwo: 1,
  setSweepOrientation: (v) => set({ sweepOrientation: v }),
  setSweepProfileScaling: (v) => set({ sweepProfileScaling: v }),
  setSweepTwistAngle: (v) => set({ sweepTwistAngle: v }),
  setSweepTaperAngle: (v) => set({ sweepTaperAngle: v }),
  setSweepGuideRailId: (v) => set({ sweepGuideRailId: v }),
  setSweepOperation: (v) => set({ sweepOperation: v }),
  setSweepDistance: (v) => set({ sweepDistance: v }),
  setSweepDistanceOne: (v) => set({ sweepDistanceOne: Math.max(0, Math.min(1, v)) }),
  setSweepDistanceTwo: (v) => set({ sweepDistanceTwo: Math.max(0, Math.min(1, v)) }),
  startSweepTool: () => {
    const extrudable = get().sketches.filter((s) => s.entities.length > 0);
    if (extrudable.length < 2) {
      set({ statusMessage: 'Sweep requires at least 2 sketches — a profile and a path' });
      return;
    }
    set({ activeTool: 'sweep', sweepProfileSketchId: null, sweepPathSketchId: null, statusMessage: 'Sweep — pick a profile sketch, then a path sketch in the panel' });
  },
  cancelSweepTool: () => set({ activeTool: 'select', sweepProfileSketchId: null, sweepPathSketchId: null, sweepOrientation: 'perpendicular', sweepTwistAngle: 0, sweepTaperAngle: 0, sweepGuideRailId: null, sweepDistance: 'entire', sweepDistanceOne: 0, sweepDistanceTwo: 1, statusMessage: 'Sweep cancelled' }),
  commitSweep: () => {
    const { sweepProfileSketchId, sweepPathSketchId, sweepBodyKind, sweepDistance, sweepDistanceOne, sweepDistanceTwo, sweepOrientation, sweepProfileScaling, sweepTwistAngle, sweepTaperAngle, sweepGuideRailId, sweepOperation, sketches, features, units } = get();
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
    get().pushUndo();
    const mesh = GeometryEngine.sweepSketchInternal(profileSketch, pathSketch, sweepBodyKind === 'surface');
    const feature: Feature = {
      id: crypto.randomUUID(),
      name: `${sweepBodyKind === 'surface' ? 'Surface ' : ''}Sweep ${features.filter((f) => f.type === 'sweep').length + 1}`,
      type: 'sweep',
      sketchId: sweepProfileSketchId,
      params: {
        pathSketchId: sweepPathSketchId,
        orientation: sweepOrientation,
        profileScaling: sweepProfileScaling,
        twistAngle: sweepTwistAngle,
        taperAngle: sweepTaperAngle,
        guideRailId: sweepGuideRailId,
        operation: sweepOperation,
        distance: sweepDistance,
        ...(sweepDistance === 'distance' ? { distanceOne: sweepDistanceOne, distanceTwo: sweepDistanceTwo } : {}),
      },
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
  // D72 loft upgrades
  loftClosed: false,
  loftTangentEdgesMerged: false,
  loftStartCondition: 'free' as const,
  loftEndCondition: 'free' as const,
  loftRailSketchId: null,
  setLoftClosed: (v) => set({ loftClosed: v }),
  setLoftTangentEdgesMerged: (v) => set({ loftTangentEdgesMerged: v }),
  setLoftStartCondition: (v) => set({ loftStartCondition: v }),
  setLoftEndCondition: (v) => set({ loftEndCondition: v }),
  setLoftRailSketchId: (v) => set({ loftRailSketchId: v }),
  startLoftTool: () => {
    const extrudable = get().sketches.filter((s) => s.entities.length > 0);
    if (extrudable.length < 2) {
      set({ statusMessage: 'Loft requires at least 2 profile sketches' });
      return;
    }
    set({ activeTool: 'loft', loftProfileSketchIds: ['', ''], statusMessage: 'Loft — select 2+ profile sketches in the panel, then OK' });
  },
  cancelLoftTool: () => set({ activeTool: 'select', loftProfileSketchIds: [], loftClosed: false, loftTangentEdgesMerged: false, loftStartCondition: 'free', loftEndCondition: 'free', loftRailSketchId: null, statusMessage: 'Loft cancelled' }),
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
    get().pushUndo();
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
    get().pushUndo();
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

  // D6 Fillet edge selection
  filletEdgeIds: [],
  addFilletEdge: (id) => set((state) => ({
    filletEdgeIds: state.filletEdgeIds.includes(id) ? state.filletEdgeIds : [...state.filletEdgeIds, id],
  })),
  removeFilletEdge: (id) => set((state) => ({ filletEdgeIds: state.filletEdgeIds.filter((e) => e !== id) })),
  clearFilletEdges: () => set({ filletEdgeIds: [] }),

  // D7 Chamfer edge selection
  chamferEdgeIds: [],
  addChamferEdge: (id) => set((state) => ({
    chamferEdgeIds: state.chamferEdgeIds.includes(id) ? state.chamferEdgeIds : [...state.chamferEdgeIds, id],
  })),
  removeChamferEdge: (id) => set((state) => ({ chamferEdgeIds: state.chamferEdgeIds.filter((e) => e !== id) })),
  clearChamferEdges: () => set({ chamferEdgeIds: [] }),

  activeDialog: null,
  setActiveDialog: (dialog) => set((state) => ({
    activeDialog: dialog,
    // D186: closing the dialog also clears editing state so the next one opens fresh
    editingFeatureId: dialog === null ? null : state.editingFeatureId,
    // Clear edge selections when closing fillet/chamfer dialogs
    filletEdgeIds: dialog === 'fillet' ? [] : state.filletEdgeIds,
    chamferEdgeIds: dialog === 'chamfer' ? [] : state.chamferEdgeIds,
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
  selectionFilter: { bodies: true, faces: true, edges: true, vertices: true, sketches: true, construction: true },
  setSelectionFilter: (f) => set((state) => ({ selectionFilter: { ...state.selectionFilter, ...f } })),

  // D207 — Sketch Grid / Snap settings
  sketchGridEnabled: true,
  sketchSnapEnabled: true,
  setSketchGridEnabled: (v) => set({ sketchGridEnabled: v }),
  setSketchSnapEnabled: (v) => set({ sketchSnapEnabled: v }),

  cameraHomeCounter: 0,
  triggerCameraHome: () => set((state) => ({ cameraHomeCounter: state.cameraHomeCounter + 1 })),
  cameraNavMode: null,
  setCameraNavMode: (mode) => set({ cameraNavMode: mode }),
  // NAV-19
  viewportLayout: '1',
  setViewportLayout: (layout) => set({ viewportLayout: layout }),
  zoomToFitCounter: 0,
  triggerZoomToFit: () => set((state) => ({ zoomToFitCounter: state.zoomToFitCounter + 1 })),
  zoomWindowTrigger: null,
  triggerZoomWindow: (rect) => set({ zoomWindowTrigger: rect }),
  clearZoomWindow: () => set({ zoomWindowTrigger: null }),

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

  // A5 — delegates to componentStore.setComponentGrounded so callers reaching
  // for the cadStore facade still get a working ground/unground action.
  // Previously this was a void-stub that silently did nothing.
  groundComponent: (id, grounded) => {
    useComponentStore.getState().setComponentGrounded(id, grounded);
  },

  // A9 — Component Pattern
  createComponentPattern: (sourceId, type, params) => {
    const componentStore = useComponentStore.getState();
    const { components, bodies } = componentStore;
    const source = components[sourceId];
    if (!source) return;

    const axisVec = (a: 'X' | 'Y' | 'Z'): THREE.Vector3 =>
      a === 'X' ? new THREE.Vector3(1, 0, 0) : a === 'Y' ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);

    const n = type === 'linear' ? params.count : params.circularCount;
    const parentId = source.parentId ?? componentStore.rootComponentId;

    for (let i = 1; i < n; i++) {
      let offsetMatrix: THREE.Matrix4;
      if (type === 'linear') {
        const dir = axisVec(params.axis).multiplyScalar(params.spacing * i);
        offsetMatrix = new THREE.Matrix4().makeTranslation(dir.x, dir.y, dir.z);
      } else {
        const angle = ((Math.PI * 2) / n) * i;
        offsetMatrix = new THREE.Matrix4().makeRotationAxis(axisVec(params.circularAxis), angle);
      }

      // Create new child component for this copy
      const newCompId = componentStore.addComponent(parentId, `${source.name} (${i + 1})`);

      // Clone each body from the source into the new component
      for (const bodyId of source.bodyIds) {
        const srcBody = bodies[bodyId];
        if (!srcBody || !srcBody.mesh) continue;
        const srcMesh = srcBody.mesh as THREE.Mesh;
        const clonedMesh = srcMesh.clone();
        clonedMesh.applyMatrix4(offsetMatrix);
        clonedMesh.userData.pickable = true;

        const newBodyId = componentStore.addBody(newCompId, `${srcBody.name} (${i + 1})`);
        componentStore.setBodyMesh(newBodyId, clonedMesh as THREE.Mesh);
      }
    }

    const feature: Feature = {
      id: crypto.randomUUID(),
      name: `Component Pattern (${type}, ×${n})`,
      type: 'linear-pattern',
      params: { sourceComponentId: sourceId, patternType: type, ...params },
      visible: true,
      suppressed: false,
      timestamp: Date.now(),
    };

    get().addFeature(feature);
    get().setStatusMessage(`Component pattern: ${n - 1} cop${n - 1 === 1 ? 'y' : 'ies'} created`);
  },

  // ─── D12: Sketch Text ─────────────────────────────────────────────────────
  sketchTextContent: 'Text',
  sketchTextHeight: 5,
  sketchTextFont: 'default',
  sketchTextBold: false,
  sketchTextItalic: false,
  setSketchTextContent: (v) => set({ sketchTextContent: v }),
  setSketchTextHeight: (v) => set({ sketchTextHeight: v }),
  setSketchTextFont: (v) => set({ sketchTextFont: v }),
  setSketchTextBold: (v) => set({ sketchTextBold: v }),
  setSketchTextItalic: (v) => set({ sketchTextItalic: v }),
  startSketchTextTool: () => {
    const { activeSketch } = get();
    if (!activeSketch) {
      set({ statusMessage: 'Open a sketch first before using Sketch Text' });
      return;
    }
    set({ activeTool: 'sketch-text', statusMessage: 'Sketch Text — click on the sketch to place text' });
  },
  commitSketchTextEntities: (segments) => {
    const { activeSketch } = get();
    if (!activeSketch) return;
    const newEntities = segments.map((seg) => ({
      id: crypto.randomUUID(),
      type: 'line' as const,
      points: [
        { id: crypto.randomUUID(), x: seg.x1, y: seg.y1, z: seg.z1 },
        { id: crypto.randomUUID(), x: seg.x2, y: seg.y2, z: seg.z2 },
      ],
    }));
    set({
      activeSketch: {
        ...activeSketch,
        entities: [...activeSketch.entities, ...newEntities],
      },
      activeTool: 'select',
      statusMessage: 'Text placed',
    });
  },
  cancelSketchTextTool: () => set({ activeTool: 'select', statusMessage: 'Sketch Text cancelled' }),

  // ─── D28: Dimension tool ──────────────────────────────────────────────────
  activeDimensionType: 'linear',
  dimensionOffset: 10,
  dimensionDrivenMode: false,
  dimensionOrientation: 'auto',
  dimensionToleranceMode: 'none',
  dimensionToleranceUpper: 0.1,
  dimensionToleranceLower: 0.1,
  pendingDimensionEntityIds: [],
  setActiveDimensionType: (t) => set({ activeDimensionType: t }),
  setDimensionOffset: (v) => set({ dimensionOffset: v }),
  setDimensionDrivenMode: (v) => set({ dimensionDrivenMode: v }),
  setDimensionOrientation: (v) => set({ dimensionOrientation: v }),
  setDimensionToleranceMode: (v) => set({ dimensionToleranceMode: v }),
  setDimensionToleranceUpper: (v) => set({ dimensionToleranceUpper: v }),
  setDimensionToleranceLower: (v) => set({ dimensionToleranceLower: v }),
  startDimensionTool: () => {
    const { activeSketch } = get();
    if (!activeSketch) {
      set({ statusMessage: 'Open a sketch first before using the Dimension tool' });
      return;
    }
    set({ activeTool: 'dimension', pendingDimensionEntityIds: [], statusMessage: 'Dimension — click entities to measure' });
  },
  cancelDimensionTool: () => set({ activeTool: 'select', pendingDimensionEntityIds: [], statusMessage: 'Dimension tool cancelled' }),
  addPendingDimensionEntity: (id) => set((state) => ({
    pendingDimensionEntityIds: state.pendingDimensionEntityIds.includes(id)
      ? state.pendingDimensionEntityIds
      : [...state.pendingDimensionEntityIds, id],
  })),
  addSketchDimension: (dim) => {
    const { activeSketch } = get();
    if (!activeSketch) return;
    if ((activeSketch.dimensions ?? []).some((d) => d.id === dim.id)) return;
    get().pushUndo();
    set({
      sketches: get().sketches.map((s) =>
        s.id === activeSketch.id
          ? { ...s, dimensions: [...(s.dimensions ?? []), dim] }
          : s
      ),
    });
    // CORR-7: skip auto-solve when compute is deferred
    if (!get().sketchComputeDeferred) get().solveSketch();
  },
  removeDimension: (dimId) => {
    const { activeSketch } = get();
    if (!activeSketch) return;
    set({
      sketches: get().sketches.map((s) =>
        s.id === activeSketch.id
          ? { ...s, dimensions: (s.dimensions ?? []).filter((d) => d.id !== dimId) }
          : s
      ),
    });
  },

  // ─── S10: Spline post-commit handle editing ───────────────────────────────
  editingSplineEntityId: null,
  hoveredSplinePointIndex: null,
  draggingSplinePointIndex: null,
  setEditingSplineEntityId: (id) => set({ editingSplineEntityId: id }),
  setHoveredSplinePointIndex: (i) => set({ hoveredSplinePointIndex: i }),
  setDraggingSplinePointIndex: (i) => set({ draggingSplinePointIndex: i }),
  updateSplineControlPoint: (entityId, pointIndex, x, y, z) => {
    const { activeSketch } = get();
    if (!activeSketch) return;
    const updatedEntities = activeSketch.entities.map((e) => {
      if (e.id !== entityId) return e;
      const updatedPoints = e.points.map((pt, i) => {
        if (i !== pointIndex) return pt;
        return { ...pt, x, y, z };
      });
      return { ...e, points: updatedPoints };
    });
    set({ activeSketch: { ...activeSketch, entities: updatedEntities } });
  },

  // ─── D45: Project / Include live-link toggle ──────────────────────────────
  projectLiveLink: true,
  setProjectLiveLink: (v) => set({ projectLiveLink: v }),
  cancelSketchProjectTool: () => set({ activeTool: 'select', statusMessage: 'Project cancelled' }),

  // S3 — Intersection Curve
  startSketchIntersectTool: () => set({
    activeTool: 'sketch-intersect',
    statusMessage: 'Click a solid face to create intersection curve with sketch plane',
  }),
  cancelSketchIntersectTool: () => set({
    activeTool: 'select',
    statusMessage: 'Intersection curve cancelled',
  }),

  // D46 — Project to Surface
  startSketchProjectSurfaceTool: () => set({
    activeTool: 'sketch-project-surface',
    statusMessage: 'Click a body face to project all sketch curves onto it',
  }),
  cancelSketchProjectSurfaceTool: () => set({
    activeTool: 'select',
    statusMessage: 'Project to surface cancelled',
  }),

  // ── CONSTRUCTION GEOMETRY (D175–D180) ──
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

  // ── D171 Replace Face ────────────────────────────────────────────────────
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

  // ── D123 Direct Edit ────────────────────────────────────────────────────
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

  // ── D137 Texture Extrude ────────────────────────────────────────────────
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

  // ── D192 Decal ───────────────────────────────────────────────────────────
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
    const { decalFaceId, features, setActiveDialog } = get();
    const n = features.filter((f) => f.type === 'decal').length + 1;
    const feature: Feature = {
      id: crypto.randomUUID(),
      name: `Decal ${n}`,
      type: 'decal',
      params: { ...params, faceId: params.faceId ?? decalFaceId ?? '' },
      visible: true,
      suppressed: false,
      timestamp: Date.now(),
    };
    get().addFeature(feature);
    setActiveDialog(null);
    set({ decalFaceId: null, decalFaceNormal: null, decalFaceCentroid: null });
  },

  // ── D193 Attached Canvas ─────────────────────────────────────────────────
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

  // ── D185 Split Face ──────────────────────────────────────────────────────
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

  // ── Hole face placement ──────────────────────────────────────────────────
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

  // ── SOL-I2: Shell face removal selection ────────────────────────────────
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

  // ── SOL-I7: Shell individual face thickness overrides ────────────────────
  shellFaceThicknesses: {},
  setShellFaceThickness: (faceId, thickness) => set((state) => ({
    shellFaceThicknesses: { ...state.shellFaceThicknesses, [faceId]: thickness },
  })),
  clearShellFaceThicknesses: () => set({ shellFaceThicknesses: {} }),

  // ── SOL-I3: Draft parting line face picker ───────────────────────────────
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

  // ── SOL-I5: Remove Face face picker ─────────────────────────────────────
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

  // ── CTX-8: Mesh export trigger ───────────────────────────────────────────
  exportBodyId: null,
  exportBodyFormat: null,
  triggerBodyExport: (bodyId, format) => set({ exportBodyId: bodyId, exportBodyFormat: format }),
  clearBodyExport: () => set({ exportBodyId: null, exportBodyFormat: null }),

  // ── D183 Bounding Solid ──────────────────────────────────────────────────
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

  // ── A11 — Joint Origins ────────────────────────────────────────────────
  jointOrigins: [],
  showJointOriginDialog: false,
  jointOriginPickedPoint: null,
  openJointOriginDialog: () => set({ activeDialog: 'joint-origin', showJointOriginDialog: true, jointOriginPickedPoint: null }),
  closeJointOriginDialog: () => set({ activeDialog: null, showJointOriginDialog: false, jointOriginPickedPoint: null }),
  setJointOriginPoint: (p) => set({ jointOriginPickedPoint: p }),
  commitJointOrigin: (params) => {
    const { jointOrigins, jointOriginPickedPoint } = get();
    const n = jointOrigins.length + 1;
    const record: JointOriginRecord = {
      id: crypto.randomUUID(),
      name: params.name || `Joint Origin ${n}`,
      componentId: params.componentId,
      position: jointOriginPickedPoint ?? [0, 0, 0],
      normal: [0, 1, 0],
    };
    set({ jointOrigins: [...jointOrigins, record], activeDialog: null, showJointOriginDialog: false, jointOriginPickedPoint: null });
  },

  // ── D196 — Interference ─────────────────────────────────────────────────
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
        results.push({ bodyAName: fA.name, bodyBName: fB.name, hasInterference, intersectionCurveCount });
      }
    }
    set({ interferenceResults: results });
  },

  // ── A22 — Mirror Component ────────────────────────────────────────────────
  showMirrorComponentDialog: false,
  openMirrorComponentDialog: () => set({ activeDialog: 'mirror-component', showMirrorComponentDialog: true }),
  closeMirrorComponentDialog: () => set({ activeDialog: null, showMirrorComponentDialog: false }),

  // ── A23 — Duplicate With Joints ──────────────────────────────────────────
  showDuplicateWithJointsDialog: false,
  duplicateWithJointsTargetId: null,
  openDuplicateWithJointsDialog: (componentId) => set({ activeDialog: 'duplicate-with-joints', showDuplicateWithJointsDialog: true, duplicateWithJointsTargetId: componentId }),
  closeDuplicateWithJointsDialog: () => set({ activeDialog: null, showDuplicateWithJointsDialog: false, duplicateWithJointsTargetId: null }),

  // ── A26 — Bill of Materials ───────────────────────────────────────────────
  showBOMDialog: false,
  openBOMDialog: () => set({ activeDialog: 'bom', showBOMDialog: true }),
  closeBOMDialog: () => set({ activeDialog: null, showBOMDialog: false }),
  getBOMEntries: () => {
    const componentStore = useComponentStore.getState();
    const { components, bodies } = componentStore;

    // Count instances by name
    const nameCounts: Record<string, number> = {};
    for (const comp of Object.values(components)) {
      if (comp.parentId === null) continue; // skip root
      nameCounts[comp.name] = (nameCounts[comp.name] ?? 0) + 1;
    }

    // Track which names we've already added to avoid double-counting
    const seenNames = new Set<string>();
    const entries: import('../components/dialogs/assembly/BOMDialog').BOMEntry[] = [];
    let partNumber = 1;

    for (const comp of Object.values(components)) {
      if (comp.parentId === null) continue; // skip root
      if (seenNames.has(comp.name)) continue;
      seenNames.add(comp.name);

      // Material — use the first body's material name, if any
      let material = '\u2014';
      if (comp.bodyIds.length > 0) {
        const firstBody = bodies[comp.bodyIds[0]];
        if (firstBody?.material?.name) material = firstBody.material.name;
      }

      // Estimated mass from bounding box volume * 1.0 g/cm³
      let estimatedMass = '\u2014';
      for (const bodyId of comp.bodyIds) {
        const body = bodies[bodyId];
        if (!body?.mesh) continue;
        const box = new THREE.Box3().setFromObject(body.mesh);
        const size = new THREE.Vector3();
        box.getSize(size);
        // size is in mm, volume in mm³, convert to cm³ (*0.001), density 1 g/cm³
        const volumeCm3 = (size.x * size.y * size.z) * 0.001;
        const massG = volumeCm3 * 1.0;
        estimatedMass = `${massG.toFixed(1)} g`;
        break;
      }

      entries.push({
        partNumber,
        name: comp.name,
        quantity: nameCounts[comp.name] ?? 1,
        material,
        estimatedMass,
        description: '',
      });
      partNumber++;
    }

    return entries.sort((a, b) => a.partNumber - b.partNumber);
  },

  // ── A12 — Contact Sets ────────────────────────────────────────────────────
  contactSets: [],
  showContactSetsDialog: false,
  openContactSetsDialog: () => set({ activeDialog: 'contact-sets', showContactSetsDialog: true }),
  closeContactSetsDialog: () => set({ activeDialog: null, showContactSetsDialog: false }),
  addContactSet: (comp1Id, comp2Id) => {
    const { contactSets } = get();
    const componentStore = useComponentStore.getState();
    const comp1 = componentStore.components[comp1Id];
    const comp2 = componentStore.components[comp2Id];
    const name = `Contact ${comp1?.name ?? comp1Id}–${comp2?.name ?? comp2Id}`;
    const entry: ContactSetEntry = {
      id: crypto.randomUUID(),
      name,
      component1Id: comp1Id,
      component2Id: comp2Id,
      enabled: true,
    };
    set({ contactSets: [...contactSets, entry] });
  },
  toggleContactSet: (id) => set((state) => ({
    contactSets: state.contactSets.map((cs) => cs.id === id ? { ...cs, enabled: !cs.enabled } : cs),
  })),
  removeContactSet: (id) => set((state) => ({
    contactSets: state.contactSets.filter((cs) => cs.id !== id),
  })),
  enableAllContactSets: () => set((state) => ({
    contactSets: state.contactSets.map((cs) => ({ ...cs, enabled: true })),
  })),
  disableAllContactSets: () => set((state) => ({
    contactSets: state.contactSets.map((cs) => ({ ...cs, enabled: false })),
  })),

  // ── A13 — Insert Component ────────────────────────────────────────────────
  showInsertComponentDialog: false,
  openInsertComponentDialog: () => set({ activeDialog: 'insert-component', showInsertComponentDialog: true }),
  closeInsertComponentDialog: () => set({ activeDialog: null, showInsertComponentDialog: false }),
  commitInsertComponent: (params) => {
    const { features } = get();
    const n = features.filter((f) => f.type === 'import').length + 1;
    const componentStore = useComponentStore.getState();
    const rootId = componentStore.rootComponentId;
    componentStore.addComponent(rootId, params.name);
    const feature: Feature = {
      id: crypto.randomUUID(),
      name: params.name || `Inserted Component ${n}`,
      type: 'import',
      params: { sourceUrl: params.sourceUrl, scale: params.scale, posX: params.position[0], posY: params.position[1], posZ: params.position[2] },
      visible: true,
      suppressed: false,
      timestamp: Date.now(),
    };
    get().addFeature(feature);
    set({ activeDialog: null, showInsertComponentDialog: false });
    get().setStatusMessage(`Inserted component: ${params.name} (mesh loading deferred)`);
  },

// ── D197–D203 Surface & Body Analysis Overlays ──────────────────────────
  activeAnalysis: null,
  setActiveAnalysis: (a) => set((s) => ({
    activeAnalysis: s.activeAnalysis === a ? null : a,
  })),
  analysisParams: {
    direction: 'y',
    frequency: 8,
    minAngle: 15,
    uCount: 5,
    vCount: 5,
    minRadius: 1.0,
    combScale: 1.0,
  },
  setAnalysisParams: (p) => set((s) => ({
    analysisParams: { ...s.analysisParams, ...p },
  })),

  // ── SFC7 — Fill Surface ──────────────────────────────────────────────────
  showFillDialog: false,
  fillBoundaryEdgeIds: [],
  fillBoundaryEdgeData: [],
  openFillDialog: () => set({ activeDialog: 'fill', showFillDialog: true, fillBoundaryEdgeIds: [], fillBoundaryEdgeData: [] }),
  addFillBoundaryEdge: (id, a, b) => set((s) => {
    if (s.fillBoundaryEdgeIds.includes(id)) return s;
    const data = a && b
      ? [...s.fillBoundaryEdgeData, { id, a, b }]
      : s.fillBoundaryEdgeData;
    return {
      fillBoundaryEdgeIds: [...s.fillBoundaryEdgeIds, id],
      fillBoundaryEdgeData: data,
    };
  }),
  closeFillDialog: () => set({ activeDialog: null, showFillDialog: false, fillBoundaryEdgeIds: [], fillBoundaryEdgeData: [] }),
  commitFill: (params) => {
    get().pushUndo();
    const { features, fillBoundaryEdgeData } = get();
    const n = features.filter((f) => f.params?.featureKind === 'fill').length + 1;

    // Assemble a single boundary loop by chaining edges that share endpoints.
    // Greedy walk: start at the first edge, then repeatedly find an edge whose
    // 'a' or 'b' endpoint matches the current chain tail (within tolerance).
    const TOL = 1e-4;
    const eq = (p: [number, number, number], q: [number, number, number]) =>
      Math.abs(p[0] - q[0]) < TOL && Math.abs(p[1] - q[1]) < TOL && Math.abs(p[2] - q[2]) < TOL;
    const buildLoop = (edges: Array<{ id: string; a: [number, number, number]; b: [number, number, number] }>): THREE.Vector3[] => {
      if (edges.length === 0) return [];
      const remaining = [...edges];
      const first = remaining.shift()!;
      const chain: [number, number, number][] = [first.a, first.b];
      while (remaining.length > 0) {
        const tail = chain[chain.length - 1];
        const idx = remaining.findIndex((e) => eq(e.a, tail) || eq(e.b, tail));
        if (idx < 0) break; // chain broken — return what we have
        const next = remaining.splice(idx, 1)[0];
        chain.push(eq(next.a, tail) ? next.b : next.a);
      }
      return chain.map(([x, y, z]) => new THREE.Vector3(x, y, z));
    };

    const loop = buildLoop(fillBoundaryEdgeData);
    // Fall back to placeholder ONLY when no real edge data was captured —
    // then at least there's something visible to anchor the dialog flow.
    const FALLBACK_LOOP: THREE.Vector3[] = [
      new THREE.Vector3(-5, 0, -5),
      new THREE.Vector3( 5, 0, -5),
      new THREE.Vector3( 5, 0,  5),
      new THREE.Vector3(-5, 0,  5),
    ];
    const boundaryPoints: THREE.Vector3[][] = [loop.length >= 3 ? loop : FALLBACK_LOOP];
    const continuity = params.continuityPerEdge;
    const geom = GeometryEngine.fillSurface(
      boundaryPoints,
      continuity.length > 0 ? continuity : ['G0'],
    );
    const mat = new THREE.MeshPhysicalMaterial({ color: 0x8899aa, metalness: 0.3, roughness: 0.4, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    const feature: Feature = {
      id: crypto.randomUUID(),
      name: `Fill ${n}`,
      type: 'thicken',
      params: { featureKind: 'fill', boundaryEdgeCount: params.boundaryEdgeCount, continuityPerEdge: params.continuityPerEdge.map((s) => ({ G0: 0, G1: 1, G2: 2 }[s] ?? 0)), operation: params.operation },
      mesh,
      visible: true,
      suppressed: false,
      timestamp: Date.now(),
      bodyKind: 'surface',
    };
    get().addFeature(feature);
    set({ activeDialog: null, showFillDialog: false, fillBoundaryEdgeIds: [], fillBoundaryEdgeData: [] });
    get().setStatusMessage(`Fill ${n} created`);
  },

  // ── SFC8 — Offset Curve to Surface ──────────────────────────────────────
  showOffsetCurveDialog: false,
  openOffsetCurveDialog: () => set({ activeDialog: 'offset-curve', showOffsetCurveDialog: true }),
  closeOffsetCurveDialog: () => set({ activeDialog: null, showOffsetCurveDialog: false }),
  commitOffsetCurve: (params) => {
    const { sketches, features } = get();
    const n = features.filter((f) => f.params?.featureKind === 'offset-curve').length + 1;

    let geom: THREE.BufferGeometry;
    const sketch = params.sketchId ? sketches.find((s) => s.id === params.sketchId) : null;
    if (sketch && sketch.entities.length > 0) {
      // Flatten first entity's points to world-space Vector3 array
      const entity = sketch.entities[0];
      const pts = entity.points.map((p) => new THREE.Vector3(p.x, p.y, p.z));
      const normal = sketch.planeNormal.clone().normalize();
      const dir = params.direction === 'flip' ? normal.clone().negate() : normal;
      geom = GeometryEngine.offsetCurveToSurface(pts, params.distance, dir);
    } else {
      // Fallback strip
      const fallbackPts = [
        new THREE.Vector3(-5, 0, 0),
        new THREE.Vector3( 5, 0, 0),
      ];
      geom = GeometryEngine.offsetCurveToSurface(fallbackPts, params.distance, new THREE.Vector3(0, 1, 0));
    }

    const mat = new THREE.MeshPhysicalMaterial({ color: 0x8899aa, metalness: 0.3, roughness: 0.4, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    const feature: Feature = {
      id: crypto.randomUUID(),
      name: `Offset Curve ${n}`,
      type: 'sweep',
      sketchId: params.sketchId ?? undefined,
      params: { featureKind: 'offset-curve', distance: params.distance, direction: params.direction },
      mesh,
      visible: true,
      suppressed: false,
      timestamp: Date.now(),
      bodyKind: 'surface',
    };
    get().addFeature(feature);
    set({ activeDialog: null, showOffsetCurveDialog: false });
    get().setStatusMessage(`Offset Curve ${n} created`);
  },

  // ── SFC16 — Surface Merge ────────────────────────────────────────────────
  showSurfaceMergeDialog: false,
  surfaceMergeFace1Id: null,
  surfaceMergeFace2Id: null,
  openSurfaceMergeDialog: () => set({ activeDialog: 'surface-merge', showSurfaceMergeDialog: true, surfaceMergeFace1Id: null, surfaceMergeFace2Id: null }),
  setSurfaceMergeFace1: (id) => set({ surfaceMergeFace1Id: id }),
  setSurfaceMergeFace2: (id) => set({ surfaceMergeFace2Id: id }),
  closeSurfaceMergeDialog: () => set({ activeDialog: null, showSurfaceMergeDialog: false, surfaceMergeFace1Id: null, surfaceMergeFace2Id: null }),
  commitSurfaceMerge: (params) => {
    const { features } = get();
    const n = features.filter((f) => f.params?.featureKind === 'surface-merge').length + 1;

    // Attempt geometry merge if both face meshes are available
    let mesh: Feature['mesh'] | undefined;
    const allFeatures = features;
    const findMeshByFaceId = (faceId: string): THREE.Mesh | null => {
      for (const f of allFeatures) {
        if (f.mesh && (f.mesh as THREE.Object3D).userData?.faceId === faceId) {
          return f.mesh as THREE.Mesh;
        }
      }
      return null;
    };
    const meshA = params.face1Id ? findMeshByFaceId(params.face1Id) : null;
    const meshB = params.face2Id ? findMeshByFaceId(params.face2Id) : null;
    if (meshA && meshB) {
      const mergedGeom = GeometryEngine.mergeSurfaces(meshA, meshB);
      const mat = new THREE.MeshPhysicalMaterial({ color: 0x8899aa, metalness: 0.3, roughness: 0.4, side: THREE.DoubleSide });
      mesh = new THREE.Mesh(mergedGeom, mat);
      (mesh as THREE.Mesh).castShadow = true;
      (mesh as THREE.Mesh).receiveShadow = true;
    }

    const feature: Feature = {
      id: crypto.randomUUID(),
      name: `Surface Merge ${n}`,
      type: 'thicken',
      params: { featureKind: 'surface-merge', face1Id: params.face1Id ?? '', face2Id: params.face2Id ?? '' },
      mesh,
      visible: true,
      suppressed: false,
      timestamp: Date.now(),
      bodyKind: 'surface',
    };
    get().addFeature(feature);
    set({ activeDialog: null, showSurfaceMergeDialog: false, surfaceMergeFace1Id: null, surfaceMergeFace2Id: null });
    get().setStatusMessage(`Surface Merge ${n} created`);
  },

  // ── SFC18 — Delete Face ──────────────────────────────────────────────────
  showDeleteFaceDialog: false,
  deleteFaceIds: [],
  openDeleteFaceDialog: () => set({ activeDialog: 'delete-face', showDeleteFaceDialog: true, deleteFaceIds: [] }),
  addDeleteFace: (id) => set((s) => ({
    deleteFaceIds: s.deleteFaceIds.includes(id) ? s.deleteFaceIds : [...s.deleteFaceIds, id],
  })),
  clearDeleteFaces: () => set({ deleteFaceIds: [] }),
  closeDeleteFaceDialog: () => set({ activeDialog: null, showDeleteFaceDialog: false, deleteFaceIds: [] }),
  commitDeleteFace: (params) => {
    const { features } = get();
    const n = features.filter((f) => f.params?.featureKind === 'delete-face').length + 1;
    const faceIds = params.faceIds.length > 0 ? params.faceIds : get().deleteFaceIds;
    const feature: Feature = {
      id: crypto.randomUUID(),
      name: `Delete Face ${n}`,
      type: 'thicken',
      params: { featureKind: 'delete-face', faceIds: faceIds.join(','), healMode: params.healMode },
      visible: true,
      suppressed: false,
      timestamp: Date.now(),
      bodyKind: 'surface',
    };
    get().addFeature(feature);
    set({ activeDialog: null, showDeleteFaceDialog: false, deleteFaceIds: [] });
    get().setStatusMessage(`Delete Face ${n}: ${faceIds.length} face${faceIds.length !== 1 ? 's' : ''} removed`);
  },

  // ── SFC10 — Surface Trim ──────────────────────────────────────────────────
  commitSurfaceTrim: (params) => {
    const { features } = get();
    const n = features.filter((f) => f.params?.featureKind === 'surface-trim').length + 1;

    const sourceMesh = features.find((f) => f.id === params.sourceFeatureId)?.mesh as THREE.Mesh | undefined;
    const trimmerMesh = features.find((f) => f.id === params.trimmerFeatureId)?.mesh as THREE.Mesh | undefined;

    let mesh: Feature['mesh'] | undefined;
    if (sourceMesh && (sourceMesh as THREE.Mesh).isMesh && trimmerMesh && (trimmerMesh as THREE.Mesh).isMesh) {
      const trimmedGeo = GeometryEngine.trimSurface(sourceMesh, trimmerMesh, params.keepSide);
      const mat = new THREE.MeshPhysicalMaterial({
        color: 0x3b82f6, metalness: 0.0, roughness: 0.5,
        transparent: true, opacity: 0.6, side: THREE.DoubleSide,
      });
      const trimMesh = new THREE.Mesh(trimmedGeo, mat);
      trimMesh.castShadow = true;
      trimMesh.receiveShadow = true;
      mesh = trimMesh;
    }

    const feature: Feature = {
      id: crypto.randomUUID(),
      name: `Surface Trim ${n}`,
      type: 'split-body',
      params: {
        featureKind: 'surface-trim',
        sourceFeatureId: params.sourceFeatureId,
        trimmerFeatureId: params.trimmerFeatureId,
        keepSide: params.keepSide,
      },
      mesh,
      visible: true,
      suppressed: false,
      timestamp: Date.now(),
      bodyKind: 'surface',
    };
    get().addFeature(feature);
    get().setStatusMessage(`Surface Trim ${n}: keep ${params.keepSide}`);
  },

  // ── SFC14 — Surface Split ─────────────────────────────────────────────────
  commitSurfaceSplit: (params) => {
    const { features } = get();
    const n = features.filter((f) => f.params?.featureKind === 'surface-split').length + 1;

    const sourceMesh = features.find((f) => f.id === params.sourceFeatureId)?.mesh as THREE.Mesh | undefined;
    const splitterMesh = features.find((f) => f.id === params.splitterFeatureId)?.mesh as THREE.Mesh | undefined;

    const newFeatures: Feature[] = [];

    if (sourceMesh && (sourceMesh as THREE.Mesh).isMesh && splitterMesh && (splitterMesh as THREE.Mesh).isMesh) {
      const geos = GeometryEngine.splitSurface(sourceMesh, splitterMesh);
      const colors = [0x3b82f6, 0x10b981];

      geos.forEach((geo, idx) => {
        if (geo.attributes.position && (geo.attributes.position as THREE.BufferAttribute).count === 0) return;
        const mat = new THREE.MeshPhysicalMaterial({
          color: colors[idx] ?? 0x3b82f6, metalness: 0.0, roughness: 0.5,
          transparent: true, opacity: 0.6, side: THREE.DoubleSide,
        });
        const halfMesh = new THREE.Mesh(geo, mat);
        halfMesh.castShadow = true;
        halfMesh.receiveShadow = true;

        newFeatures.push({
          id: crypto.randomUUID(),
          name: `Surface Split ${n}${geos.length > 1 ? `-${idx + 1}` : ''}`,
          type: 'split-body',
          params: {
            featureKind: 'surface-split',
            sourceFeatureId: params.sourceFeatureId,
            splitterFeatureId: params.splitterFeatureId,
            halfIndex: idx,
          },
          mesh: halfMesh,
          visible: true,
          suppressed: false,
          timestamp: Date.now(),
          bodyKind: 'surface',
        });
      });
    }

    if (newFeatures.length === 0) {
      // Fallback placeholder if no mesh found
      newFeatures.push({
        id: crypto.randomUUID(),
        name: `Surface Split ${n}`,
        type: 'split-body',
        params: {
          featureKind: 'surface-split',
          sourceFeatureId: params.sourceFeatureId,
          splitterFeatureId: params.splitterFeatureId,
        },
        visible: true,
        suppressed: false,
        timestamp: Date.now(),
        bodyKind: 'surface',
      });
    }

    // Hide original surface
    const nextFeatures = features.map((f) =>
      f.id === params.sourceFeatureId ? { ...f, visible: false } : f,
    );

    set({ features: [...nextFeatures, ...newFeatures] });
    get().setStatusMessage(`Surface Split ${n}: split into ${newFeatures.length} part${newFeatures.length !== 1 ? 's' : ''}`);
  },

  // ── SFC15 — Untrim ────────────────────────────────────────────────────────
  commitUntrim: (params) => {
    const { features } = get();
    const n = features.filter((f) => f.params?.featureKind === 'untrim').length + 1;

    const sourceMesh = features.find((f) => f.id === params.sourceFeatureId)?.mesh as THREE.Mesh | undefined;

    let mesh: Feature['mesh'] | undefined;
    if (sourceMesh && (sourceMesh as THREE.Mesh).isMesh) {
      const untrimmedGeo = GeometryEngine.untrimSurface(sourceMesh, params.expandFactor);
      const mat = new THREE.MeshPhysicalMaterial({
        color: 0x8899aa, metalness: 0.0, roughness: 0.5,
        transparent: true, opacity: 0.6, side: THREE.DoubleSide,
      });
      const untrimMesh = new THREE.Mesh(untrimmedGeo, mat);
      untrimMesh.castShadow = true;
      untrimMesh.receiveShadow = true;
      mesh = untrimMesh;
    }

    const feature: Feature = {
      id: crypto.randomUUID(),
      name: `Untrim ${n}`,
      type: 'sweep',
      params: {
        featureKind: 'untrim',
        sourceFeatureId: params.sourceFeatureId,
        expandFactor: params.expandFactor,
      },
      mesh,
      visible: true,
      suppressed: false,
      timestamp: Date.now(),
      bodyKind: 'surface',
    };
    get().addFeature(feature);
    get().setStatusMessage(`Untrim ${n}: expanded ${params.expandFactor}×`);
  },

  // ── SFC9 — Offset Surface ────────────────────────────────────────────────
  commitOffsetSurface: (params) => {
    const { features } = get();
    const n = features.filter((f) => f.params?.featureKind === 'offset-surface').length + 1;

    // Find the most recent surface body mesh to use as source
    const sourceMesh = [...features].reverse().find(
      (f) => f.mesh && (f.mesh as THREE.Mesh).isMesh && f.bodyKind === 'surface',
    )?.mesh as THREE.Mesh | undefined;

    let mesh: Feature['mesh'] | undefined;
    if (sourceMesh) {
      const dist =
        params.direction === 'inward'  ? -Math.abs(params.offsetDistance)
        : params.direction === 'outward' ?  Math.abs(params.offsetDistance)
        : Math.abs(params.offsetDistance); // 'both' — use positive; two bodies would need two calls
      const offsetGeo = GeometryEngine.offsetSurface(sourceMesh, dist);
      const mat = new THREE.MeshPhysicalMaterial({ color: 0x8899aa, metalness: 0.3, roughness: 0.4, side: THREE.DoubleSide });
      mesh = new THREE.Mesh(offsetGeo, mat);
      (mesh as THREE.Mesh).castShadow = true;
      (mesh as THREE.Mesh).receiveShadow = true;
    }

    const feature: Feature = {
      id: crypto.randomUUID(),
      name: `Offset Surface ${n}`,
      type: 'thicken',
      params: { featureKind: 'offset-surface', ...params },
      mesh,
      visible: true,
      suppressed: false,
      timestamp: Date.now(),
      bodyKind: 'surface',
    };
    get().addFeature(feature);
    get().setStatusMessage(`Offset Surface ${n}: ${params.offsetDistance}mm ${params.direction}`);
  },

  // ── SFC11 — Surface Extend ───────────────────────────────────────────────
  commitSurfaceExtend: (params) => {
    const { features } = get();
    const n = features.filter((f) => f.params?.featureKind === 'extend-surface').length + 1;

    const sourceMesh = [...features].reverse().find(
      (f) => f.mesh && (f.mesh as THREE.Mesh).isMesh && f.bodyKind === 'surface',
    )?.mesh as THREE.Mesh | undefined;

    // Map dialog extensionType to GeometryEngine mode
    const modeMap: Record<string, 'natural' | 'tangent' | 'perpendicular'> = {
      natural:    'natural',
      linear:     'tangent',
      curvature:  'natural',
    };
    const mode = modeMap[params.extensionType] ?? 'natural';

    let mesh: Feature['mesh'] | undefined;
    if (sourceMesh) {
      const extGeo = GeometryEngine.extendSurface(sourceMesh, params.extendDistance, mode);
      const mat = new THREE.MeshPhysicalMaterial({ color: 0x8899aa, metalness: 0.3, roughness: 0.4, side: THREE.DoubleSide });
      mesh = new THREE.Mesh(extGeo, mat);
      (mesh as THREE.Mesh).castShadow = true;
      (mesh as THREE.Mesh).receiveShadow = true;
    }

    const feature: Feature = {
      id: crypto.randomUUID(),
      name: `Surface Extend ${n}`,
      type: 'sweep',
      params: { featureKind: 'extend-surface', ...params },
      mesh,
      visible: true,
      suppressed: false,
      timestamp: Date.now(),
      bodyKind: 'surface',
    };
    get().addFeature(feature);
    get().setStatusMessage(`Surface Extend ${n}: ${params.extendDistance}mm ${params.extensionType}`);
  },

  // ── SFC12 — Stitch ───────────────────────────────────────────────────────
  commitStitch: (params) => {
    const { features } = get();
    const n = features.filter((f) => f.params?.featureKind === 'stitch').length + 1;

    // Collect source meshes by feature ID (fall back to most-recent surface bodies)
    let sourceMeshes: THREE.Mesh[];
    if (params.sourceFeatureIds.length > 0) {
      sourceMeshes = params.sourceFeatureIds
        .map((id) => features.find((f) => f.id === id)?.mesh as THREE.Mesh | undefined)
        .filter((m): m is THREE.Mesh => !!m && (m as THREE.Mesh).isMesh);
    } else {
      // Fallback: use all surface body meshes
      sourceMeshes = features
        .filter((f) => f.mesh && (f.mesh as THREE.Mesh).isMesh && f.bodyKind === 'surface')
        .map((f) => f.mesh as THREE.Mesh);
    }

    let mesh: Feature['mesh'] | undefined;
    let isSolid = false;

    if (sourceMeshes.length > 0) {
      const result = GeometryEngine.stitchSurfaces(sourceMeshes, params.tolerance);
      isSolid = result.isSolid;
      const mat = isSolid
        ? new THREE.MeshPhysicalMaterial({ color: 0x8899aa, metalness: 0.3, roughness: 0.4, side: THREE.DoubleSide })
        : new THREE.MeshPhysicalMaterial({ color: 0x3b82f6, metalness: 0.0, roughness: 0.5, transparent: true, opacity: 0.45, side: THREE.DoubleSide });
      const newMesh = new THREE.Mesh(result.geometry, mat);
      newMesh.castShadow = true;
      newMesh.receiveShadow = true;
      mesh = newMesh;
    }

    const feature: Feature = {
      id: crypto.randomUUID(),
      name: `Stitch ${n}`,
      type: 'thicken',
      params: {
        featureKind: 'stitch',
        tolerance: params.tolerance,
        closeOpenEdges: params.closeOpenEdges,
        keepOriginal: params.keepOriginal,
        sourceFeatureIds: params.sourceFeatureIds.join(','),
        isSolid: isSolid ? 1 : 0,
      },
      mesh,
      visible: true,
      suppressed: false,
      timestamp: Date.now(),
      bodyKind: isSolid ? 'solid' : 'surface',
    };

    // Hide source bodies unless keepOriginal is set
    const nextFeatures = params.keepOriginal
      ? features
      : features.map((f) =>
          params.sourceFeatureIds.includes(f.id) ? { ...f, visible: false } : f,
        );

    set({ features: [...nextFeatures, feature] });
    get().setStatusMessage(`Stitch ${n}: ${isSolid ? 'closed solid' : 'surface quilt'} from ${sourceMeshes.length} bodies`);
  },

  // ── SFC13 — Unstitch ─────────────────────────────────────────────────────
  commitUnstitch: (params) => {
    const { features } = get();
    const n = features.filter((f) => f.params?.featureKind === 'unstitch').length + 1;

    const sourceMesh = features.find((f) => f.id === params.sourceFeatureId)?.mesh as THREE.Mesh | undefined;

    const newFeatures: Feature[] = [];

    if (sourceMesh && (sourceMesh as THREE.Mesh).isMesh) {
      const geos = GeometryEngine.unstitchSurface(sourceMesh);

      geos.forEach((geo, idx) => {
        const mat = new THREE.MeshPhysicalMaterial({
          color: 0x3b82f6, metalness: 0.0, roughness: 0.5,
          transparent: true, opacity: 0.45, side: THREE.DoubleSide,
        });
        const faceMesh = new THREE.Mesh(geo, mat);
        faceMesh.castShadow = true;
        faceMesh.receiveShadow = true;

        newFeatures.push({
          id: crypto.randomUUID(),
          name: `Surface Face ${n}${geos.length > 1 ? `-${idx + 1}` : ''}`,
          type: 'split-body',
          params: {
            featureKind: 'unstitch',
            sourceFeatureId: params.sourceFeatureId,
            faceIndex: idx,
            keepOriginal: params.keepOriginal ? 1 : 0,
          },
          mesh: faceMesh,
          visible: true,
          suppressed: false,
          timestamp: Date.now(),
          bodyKind: 'surface',
        });
      });
    } else {
      // No mesh found — create a placeholder feature so the record exists
      newFeatures.push({
        id: crypto.randomUUID(),
        name: `Unstitch ${n}`,
        type: 'split-body',
        params: {
          featureKind: 'unstitch',
          sourceFeatureId: params.sourceFeatureId,
          keepOriginal: params.keepOriginal ? 1 : 0,
        },
        visible: true,
        suppressed: false,
        timestamp: Date.now(),
        bodyKind: 'surface',
      });
    }

    // Hide the original stitched body unless keepOriginal is set
    const nextFeatures = params.keepOriginal
      ? features
      : features.map((f) =>
          f.id === params.sourceFeatureId ? { ...f, visible: false } : f,
        );

    set({ features: [...nextFeatures, ...newFeatures] });
    get().setStatusMessage(`Unstitch ${n}: separated into ${newFeatures.length} face${newFeatures.length !== 1 ? 's' : ''}`);
  },

  // ── SFC17 — Thicken ──────────────────────────────────────────────────────
  commitThicken: (params) => {
    const { features } = get();
    const n = features.filter((f) => f.params?.featureKind === 'thicken-solid').length + 1;

    const sourceMesh = [...features].reverse().find(
      (f) => f.mesh && (f.mesh as THREE.Mesh).isMesh && f.bodyKind === 'surface',
    )?.mesh as THREE.Mesh | undefined;

    let mesh: Feature['mesh'] | undefined;
    if (sourceMesh) {
      const thickGeo = GeometryEngine.thickenSurface(sourceMesh, params.thickness, params.direction);
      const mat = new THREE.MeshPhysicalMaterial({ color: 0x8899aa, metalness: 0.3, roughness: 0.4, side: THREE.DoubleSide });
      mesh = new THREE.Mesh(thickGeo, mat);
      (mesh as THREE.Mesh).castShadow = true;
      (mesh as THREE.Mesh).receiveShadow = true;
    }

    const feature: Feature = {
      id: crypto.randomUUID(),
      name: `Thicken (${params.thickness}mm, ${params.direction})`,
      type: 'thicken',
      params: { featureKind: 'thicken-solid', ...params },
      mesh,
      visible: true,
      suppressed: false,
      timestamp: Date.now(),
      bodyKind: 'solid',
    };
    get().addFeature(feature);
    get().setStatusMessage(`Thicken ${n}: ${params.thickness}mm ${params.direction}`);
  },

  // ── SFC22 — Surface Primitives ───────────────────────────────────────────
  showSurfacePrimitivesDialog: false,
  openSurfacePrimitivesDialog: () => set({ activeDialog: 'surface-primitives', showSurfacePrimitivesDialog: true }),
  closeSurfacePrimitivesDialog: () => set({ activeDialog: null, showSurfacePrimitivesDialog: false }),
  commitSurfacePrimitive: (params) => {
    const { features } = get();
    const n = features.filter((f) => f.params?.featureKind === 'surface-primitive').length + 1;

    const geom = GeometryEngine.createSurfacePrimitive(params.type, {
      width: params.width ?? 10,
      height: params.height ?? 10,
      depth: params.depth ?? 10,
      radius: params.radius ?? 5,
      height2: params.height2 ?? 10,
      tube: params.tube ?? 2,
    });
    const mat = new THREE.MeshPhysicalMaterial({ color: 0x8899aa, metalness: 0.3, roughness: 0.4, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    const feature: Feature = {
      id: crypto.randomUUID(),
      name: `Surface ${params.type.charAt(0).toUpperCase() + params.type.slice(1)} ${n}`,
      type: 'primitive',
      params: { featureKind: 'surface-primitive', ...params },
      mesh,
      visible: true,
      suppressed: false,
      timestamp: Date.now(),
      bodyKind: 'surface',
    };
    get().addFeature(feature);
    set({ activeDialog: null, showSurfacePrimitivesDialog: false });
    get().setStatusMessage(`Surface ${params.type} primitive created`);
  },

  // ── MM1 — Design history mode ───────────────────────────────────────────
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
    const snapshot = _snapshotState(state);
    const next = [...state.undoStack, snapshot];
    set({ undoStack: next.length > 50 ? next.slice(next.length - 50) : next, redoStack: [] });
  },

  undo: () => {
    const state = get();
    if (state.undoStack.length === 0) return;
    const currentSnapshot = _snapshotState(state);
    const stack = [...state.undoStack];
    const snapshot = stack.pop()!;
    try {
      const parsed = JSON.parse(snapshot) as {
        features: Feature[];
        sketches: Array<Sketch & { planeNormal: [number, number, number] | null; planeOrigin: [number, number, number] | null }>;
        featureGroups: FeatureGroup[];
      };
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
      set({
        undoStack: stack,
        redoStack: [...state.redoStack, currentSnapshot],
        features: parsed.features.map((f) => {
          const restored = deserializeFeature(f as Feature);
          const live = liveMeshById.get(restored.id);
          return live ? { ...restored, mesh: live } : restored;
        }),
        sketches: parsed.sketches.map((s) => deserializeSketch(s as unknown as Sketch)),
        featureGroups: parsed.featureGroups,
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
    const currentSnapshot = _snapshotState(state);
    const stack = [...state.redoStack];
    const snapshot = stack.pop()!;
    try {
      const parsed = JSON.parse(snapshot) as {
        features: Feature[];
        sketches: Array<Sketch & { planeNormal: [number, number, number] | null; planeOrigin: [number, number, number] | null }>;
        featureGroups: FeatureGroup[];
      };
      if (!parsed || !Array.isArray(parsed.features)) {
        throw new Error('Invalid snapshot: missing features array');
      }
      if (!Array.isArray(parsed.sketches)) {
        throw new Error('Invalid snapshot: missing sketches array');
      }
      const liveMeshById = new Map<string, Feature['mesh']>();
      for (const f of state.features) if (f.mesh) liveMeshById.set(f.id, f.mesh);
      set({
        redoStack: stack,
        undoStack: [...state.undoStack, currentSnapshot],
        features: parsed.features.map((f) => {
          const restored = deserializeFeature(f as Feature);
          const live = liveMeshById.get(restored.id);
          return live ? { ...restored, mesh: live } : restored;
        }),
        sketches: parsed.sketches.map((s) => deserializeSketch(s as unknown as Sketch)),
        featureGroups: parsed.featureGroups,
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
  saveToFile: () => {
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
    const json = JSON.stringify(saveObj, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'design.dzn';
    a.click();
    URL.revokeObjectURL(url);
    get().setStatusMessage('Design saved to file');
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
  commitRibFromDialog: (sketchId, thickness, height) => {
    const { features, sketches } = get();
    const sketch = sketches.find((s) => s.id === sketchId);
    if (!sketch) { get().setStatusMessage('Rib: sketch not found'); return; }
    get().pushUndo();
    const pts: THREE.Vector3[] = [];
    for (const e of sketch.entities) {
      if (e.type === 'line' && e.points.length >= 2) {
        const p0 = e.points[0];
        const p1 = e.points[e.points.length - 1];
        pts.push(new THREE.Vector3(p0.x, p0.y, p0.z));
        pts.push(new THREE.Vector3(p1.x, p1.y, p1.z));
      }
    }
    const normal = sketch.planeNormal?.clone() ?? new THREE.Vector3(0, 1, 0);
    const ribMesh = pts.length >= 2 ? GeometryEngine.createRib(pts, thickness, height, normal) : undefined;
    const n = features.filter((f) => f.type === 'rib').length + 1;
    const feature: Feature = {
      id: crypto.randomUUID(),
      name: `Rib ${n}`,
      type: 'rib',
      sketchId,
      params: { thickness, height },
      mesh: ribMesh,
      visible: true,
      suppressed: false,
      timestamp: Date.now(),
    };
    set({ features: [...features, feature] });
    get().setStatusMessage(`Rib ${n} created: ${thickness}mm thick`);
  },

  // ── SLD2 — Web ───────────────────────────────────────────────────────────
  commitWeb: (sketchId, thickness, height) => {
    const { features, sketches } = get();
    const sketch = sketches.find((s) => s.id === sketchId);
    if (!sketch) { get().setStatusMessage('Web: sketch not found'); return; }
    get().pushUndo();
    const entityPoints: THREE.Vector3[][] = [];
    for (const e of sketch.entities) {
      if (e.type === 'line' && e.points.length >= 2) {
        const p0 = e.points[0];
        const p1 = e.points[e.points.length - 1];
        entityPoints.push([
          new THREE.Vector3(p0.x, p0.y, p0.z),
          new THREE.Vector3(p1.x, p1.y, p1.z),
        ]);
      }
    }
    const normal = sketch.planeNormal?.clone() ?? new THREE.Vector3(0, 1, 0);
    const webMesh = entityPoints.length > 0 ? GeometryEngine.createWeb(entityPoints, thickness, height, normal) : undefined;
    const n = features.filter((f) => f.type === 'rib' && f.params?.webStyle === 'perpendicular').length + 1;
    const feature: Feature = {
      id: crypto.randomUUID(),
      name: `Web ${n}`,
      type: 'rib',
      sketchId,
      params: { thickness, height, webStyle: 'perpendicular' },
      mesh: webMesh,
      visible: true,
      suppressed: false,
      timestamp: Date.now(),
    };
    set({ features: [...features, feature] });
    get().setStatusMessage(`Web ${n} created: ${thickness}mm thick`);
  },

  // ── SLD4 — Rest ──────────────────────────────────────────────────────────
  commitRest: (params) => {
    const { features } = get();
    const restMesh = GeometryEngine.createRest(
      params.centerX, params.centerY, params.centerZ,
      params.normalX, params.normalY, params.normalZ,
      params.width, params.depth, params.thickness,
    );
    const n = features.filter((f) => f.params?.restStyle === 'rest').length + 1;
    const feature: Feature = {
      id: crypto.randomUUID(),
      name: `Rest ${n}`,
      type: 'rib',
      params: { ...params, restStyle: 'rest' },
      mesh: restMesh,
      visible: true,
      suppressed: false,
      timestamp: Date.now(),
    };
    set({ features: [...features, feature] });
    get().setStatusMessage(`Rest ${n} created`);
  },

  // ── SLD5 — Thread (cosmetic helix) ───────────────────────────────────────
  commitThread: (featureId, radius, pitch, length) => {
    const { features } = get();
    // Guard against degenerate inputs — pitch=0 spins forever in
    // createCosmeticThread (the helix step depends on `length / pitch` turns),
    // and non-finite/zero radius+length silently produce empty / NaN geometry.
    if (!Number.isFinite(radius) || !Number.isFinite(pitch) || !Number.isFinite(length)
        || radius <= 0 || pitch <= 0 || length <= 0) {
      get().setStatusMessage(`Thread: radius / pitch / length must all be positive finite numbers`);
      return;
    }
    get().pushUndo();
    const helixGeom = GeometryEngine.createCosmeticThread(radius, pitch, length);
    const lineMesh = new THREE.Line(helixGeom, new THREE.LineBasicMaterial({ color: 0x888888 }));
    // Find existing feature and attach helix as overlay (new feature referencing it)
    const n = features.filter((f) => f.type === 'thread').length + 1;
    const feature: Feature = {
      id: crypto.randomUUID(),
      name: `Thread ${n} (cosmetic)`,
      type: 'thread',
      params: { featureId, radius, pitch, length, threadType: 'cosmetic' },
      mesh: lineMesh as unknown as THREE.Mesh,
      visible: true,
      suppressed: false,
      timestamp: Date.now(),
    };
    set({ features: [...features, feature] });
    get().setStatusMessage(`Thread ${n}: cosmetic helix (r=${radius}, p=${pitch}, L=${length})`);
  },

  // ── SLD9 — Pattern on Path ───────────────────────────────────────────────
  commitPatternOnPath: (featureId, sketchId, count) => {
    const { features, sketches } = get();
    const srcFeature = features.find((f) => f.id === featureId);
    const sketch = sketches.find((s) => s.id === sketchId);
    if (!srcFeature || !sketch) {
      get().setStatusMessage('Pattern on Path: feature or sketch not found');
      return;
    }
    const srcMesh = srcFeature.mesh as THREE.Mesh | undefined;
    if (!srcMesh?.isMesh) {
      get().setStatusMessage('Pattern on Path: feature has no mesh');
      return;
    }
    get().pushUndo();
    const pathPoints: THREE.Vector3[] = [];
    for (const e of sketch.entities) {
      if (e.type === 'line' && e.points.length >= 2) {
        const p0 = e.points[0];
        const p1 = e.points[e.points.length - 1];
        if (pathPoints.length === 0) pathPoints.push(new THREE.Vector3(p0.x, p0.y, p0.z));
        pathPoints.push(new THREE.Vector3(p1.x, p1.y, p1.z));
      }
    }
    const copies = GeometryEngine.patternOnPath(srcMesh, pathPoints, count);
    const newFeatures: Feature[] = copies.map((copyMesh, idx) => ({
      id: crypto.randomUUID(),
      name: `${srcFeature.name} Path[${idx + 1}]`,
      type: 'circular-pattern' as Feature['type'],
      params: { patternOnPath: true, sourceFeatureId: featureId, sketchId, count, instanceIndex: idx },
      mesh: copyMesh,
      visible: true,
      suppressed: false,
      timestamp: Date.now(),
    }));
    set({ features: [...features, ...newFeatures] });
    get().setStatusMessage(`Pattern on Path: ${copies.length} copies`);
  },

  // ── MSH1 — Remesh ────────────────────────────────────────────────────────
  commitRemesh: (featureId, mode, iterations) => {
    iterations = Math.min(Math.max(1, Math.round(iterations)), 10);
    const { features } = get();
    const srcFeature = features.find((f) => f.id === featureId);
    const srcMesh = srcFeature?.mesh as THREE.Mesh | undefined;
    if (!srcFeature || !srcMesh?.isMesh) {
      get().setStatusMessage('Remesh: feature not found or has no mesh');
      return;
    }
    get().pushUndo();
    const remeshed = GeometryEngine.remesh(srcMesh, mode, iterations);
    remeshed.castShadow = true;
    remeshed.receiveShadow = true;
    const nextFeatures = features.map((f) =>
      f.id === featureId ? { ...f, mesh: remeshed, params: { ...f.params, isRemesh: true, mode, iterations } } : f,
    );
    set({ features: nextFeatures });
    get().setStatusMessage(`Remesh (${mode}, ${iterations} iter) applied`);
  },

  // ── SLD10 — Shell ────────────────────────────────────────────────────────
  commitShell: (featureId, thickness, direction) => {
    const { features } = get();
    const srcFeature = features.find((f) => f.id === featureId);
    const srcMesh = srcFeature?.mesh as THREE.Mesh | undefined;
    if (!srcFeature || !srcMesh?.isMesh) {
      get().setStatusMessage('Shell: no mesh found for selected feature');
      return;
    }
    if (!Number.isFinite(thickness) || thickness <= 0) {
      get().setStatusMessage('Shell: thickness must be a positive finite number');
      return;
    }
    get().pushUndo();
    const result = GeometryEngine.shellMesh(srcMesh, thickness, direction);
    result.castShadow = true;
    result.receiveShadow = true;
    const nextFeatures = features.map((f) =>
      f.id === featureId
        ? { ...f, mesh: result, params: { ...f.params, thickness, direction, featureKind: 'shell' } }
        : f,
    );
    set({ features: nextFeatures });
    get().setStatusMessage(`Shell (${direction}, ${thickness}mm) applied`);
  },

  // ── SLD11 — Draft ────────────────────────────────────────────────────────
  commitDraft: (featureId, pullAxisDir, draftAngle, fixedPlaneY) => {
    const { features } = get();
    const srcFeature = features.find((f) => f.id === featureId);
    const srcMesh = srcFeature?.mesh as THREE.Mesh | undefined;
    if (!srcFeature || !srcMesh?.isMesh) {
      get().setStatusMessage('Draft: no mesh found for selected feature');
      return;
    }
    // 90° collapses the geometry; >=90° produces a degenerate mesh.
    if (!Number.isFinite(draftAngle) || Math.abs(draftAngle) >= 90) {
      get().setStatusMessage('Draft: angle must be finite and within (-90°, 90°)');
      return;
    }
    get().pushUndo();
    const result = GeometryEngine.draftMesh(srcMesh, pullAxisDir, draftAngle, fixedPlaneY);
    result.castShadow = true;
    result.receiveShadow = true;
    const nextFeatures = features.map((f) =>
      f.id === featureId
        ? { ...f, mesh: result, params: { ...f.params, draftAngle, fixedPlaneY, featureKind: 'draft' } }
        : f,
    );
    set({ features: nextFeatures });
    get().setStatusMessage(`Draft (${draftAngle}°) applied`);
  },

  // ── SLD14 — Offset Face ──────────────────────────────────────────────────
  commitOffsetFace: (featureId, distance) => {
    const { features } = get();
    const srcFeature = features.find((f) => f.id === featureId);
    const srcMesh = srcFeature?.mesh as THREE.Mesh | undefined;
    if (!srcFeature || !srcMesh?.isMesh) {
      get().setStatusMessage('Offset Face: no mesh found for selected feature');
      return;
    }
    if (!Number.isFinite(distance)) {
      get().setStatusMessage('Offset Face: distance must be a finite number');
      return;
    }
    get().pushUndo();
    const offsetGeom = GeometryEngine.offsetSurface(srcMesh, distance);
    const mat = srcMesh.material as THREE.Material;
    const result = new THREE.Mesh(offsetGeom, mat);
    result.castShadow = true;
    result.receiveShadow = true;
    result.userData = { ...srcMesh.userData };
    const nextFeatures = features.map((f) =>
      f.id === featureId
        ? { ...f, mesh: result, params: { ...f.params, offsetDistance: distance, featureKind: 'offset-face' } }
        : f,
    );
    set({ features: nextFeatures });
    get().setStatusMessage(`Offset Face (${distance > 0 ? '+' : ''}${distance}mm) applied`);
  },

  // ── SLD16 — Remove Face ──────────────────────────────────────────────────
  commitRemoveFace: (featureId, faceNormal, faceCentroid) => {
    const { features } = get();
    const srcFeature = features.find((f) => f.id === featureId);
    const srcMesh = srcFeature?.mesh as THREE.Mesh | undefined;
    if (!srcFeature || !srcMesh?.isMesh) {
      get().setStatusMessage('Remove Face: no mesh found for selected feature');
      return;
    }
    const result = GeometryEngine.removeFaceAndHeal(srcMesh, faceNormal, faceCentroid);
    result.castShadow = true;
    result.receiveShadow = true;
    const nextFeatures = features.map((f) =>
      f.id === featureId
        ? { ...f, mesh: result, params: { ...f.params, featureKind: 'remove-face' } }
        : f,
    );
    set({ features: nextFeatures });
    get().setStatusMessage('Remove Face: face removed and healed');
  },

  // ── SLD3 — Emboss ────────────────────────────────────────────────────────
  commitEmboss: (sketchId, depth, style) => {
    const { sketches, features } = get();
    const sketch = sketches.find((s) => s.id === sketchId);
    if (!sketch) {
      get().setStatusMessage('Emboss: sketch not found');
      return;
    }
    const extrudeDepth = style === 'deboss' ? -Math.abs(depth) : Math.abs(depth);
    const mesh = GeometryEngine.extrudeSketch(sketch, extrudeDepth);
    if (!mesh) {
      get().setStatusMessage('Emboss: could not extrude sketch profile');
      return;
    }
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const n = features.filter((f) => f.params?.featureKind === 'emboss').length + 1;
    const feature: Feature = {
      id: crypto.randomUUID(),
      name: `Emboss ${n} (${style}, ${depth}mm)`,
      type: 'emboss',
      params: { featureKind: 'emboss', sketchId, depth, style, embossStyle: 'emboss' },
      mesh,
      visible: true,
      suppressed: false,
      timestamp: Date.now(),
    };
    get().addFeature(feature);
    get().setStatusMessage(`Emboss ${n}: ${style} ${depth}mm`);
  },

  // ── SLD6 — Boundary Fill ─────────────────────────────────────────────────
  commitBoundaryFill: (toolFeatureIds, operation) => {
    const { features } = get();
    const toolMeshes = toolFeatureIds
      .map((id) => features.find((f) => f.id === id)?.mesh as THREE.Mesh | undefined)
      .filter((m): m is THREE.Mesh => !!m?.isMesh);
    if (toolMeshes.length === 0) {
      get().setStatusMessage('Boundary Fill: no valid tool bodies selected');
      return;
    }
    get().pushUndo();
    // Compute combined bounding box
    const box = new THREE.Box3();
    for (const m of toolMeshes) {
      box.expandByObject(m);
    }
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);
    const fillGeom = new THREE.BoxGeometry(size.x, size.y, size.z);
    const fillMesh = new THREE.Mesh(
      fillGeom,
      new THREE.MeshPhysicalMaterial({ color: 0x3b82f6, metalness: 0.1, roughness: 0.4 }),
    );
    fillMesh.position.copy(center);
    fillMesh.castShadow = true;
    fillMesh.receiveShadow = true;
    const n = features.filter((f) => f.params?.featureKind === 'boundary-fill').length + 1;
    const feature: Feature = {
      id: crypto.randomUUID(),
      name: `Boundary Fill ${n}`,
      type: 'boundary-fill',
      params: { featureKind: 'boundary-fill', toolFeatureIds: toolFeatureIds.join(','), operation, isBoundaryFill: true },
      mesh: fillMesh,
      visible: true,
      suppressed: false,
      timestamp: Date.now(),
    };
    get().addFeature(feature);
    get().setStatusMessage(`Boundary Fill ${n} (${operation}): bounding box fill created`);
  },

  // ── SLD15 — Silhouette Split ─────────────────────────────────────────────
  commitSilhouetteSplit: (featureId, planeNormal, planeOffset) => {
    const { features } = get();
    const srcFeature = features.find((f) => f.id === featureId);
    const srcMesh = srcFeature?.mesh as THREE.Mesh | undefined;
    if (!srcFeature || !srcMesh?.isMesh) {
      get().setStatusMessage('Split Body: no mesh found for selected feature');
      return;
    }
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
    // Hide original, add both halves
    const nextFeatures = features.map((f) =>
      f.id === featureId ? { ...f, visible: false } : f,
    );
    set({ features: [...nextFeatures, featureA, featureB] });
    get().setStatusMessage(`Split Body ${n}: split into two parts`);
  },

  // ── MSH4 — Erase and Fill ────────────────────────────────────────────────
  commitEraseAndFill: (featureId, faceNormal, faceCentroid) => {
    const { features } = get();
    const srcFeature = features.find((f) => f.id === featureId);
    const srcMesh = srcFeature?.mesh as THREE.Mesh | undefined;
    if (!srcFeature || !srcMesh?.isMesh) {
      get().setStatusMessage('Erase And Fill: no mesh found for selected feature');
      return;
    }
    const result = GeometryEngine.removeFaceAndHeal(srcMesh, faceNormal, faceCentroid);
    result.castShadow = true;
    result.receiveShadow = true;
    const nextFeatures = features.map((f) =>
      f.id === featureId
        ? { ...f, mesh: result, params: { ...f.params, featureKind: 'erase-and-fill' } }
        : f,
    );
    set({ features: nextFeatures });
    get().setStatusMessage('Erase And Fill: face removed and healed');
  },

  // ── MSH6 — Mesh Shell ────────────────────────────────────────────────────
  commitMeshShell: (featureId, thickness, direction) => {
    const { features } = get();
    const srcFeature = features.find((f) => f.id === featureId);
    const srcMesh = srcFeature?.mesh as THREE.Mesh | undefined;
    if (!srcFeature || !srcMesh?.isMesh) {
      get().setStatusMessage('Mesh Shell: no mesh found for selected feature');
      return;
    }
    const result = GeometryEngine.shellMesh(srcMesh, thickness, direction);
    result.castShadow = true;
    result.receiveShadow = true;
    const nextFeatures = features.map((f) =>
      f.id === featureId
        ? { ...f, mesh: result, params: { ...f.params, featureKind: 'mesh-shell', thickness, direction } }
        : f,
    );
    set({ features: nextFeatures });
    get().setStatusMessage(`Mesh Shell: ${thickness}mm ${direction} applied`);
  },

  // ── MSH9 — Mesh Align ────────────────────────────────────────────────────
  commitMeshAlign: (sourceFeatureId, targetFeatureId) => {
    const { features } = get();
    const srcFeature = features.find((f) => f.id === sourceFeatureId);
    const tgtFeature = features.find((f) => f.id === targetFeatureId);
    const srcMesh = srcFeature?.mesh as THREE.Mesh | undefined;
    const tgtMesh = tgtFeature?.mesh as THREE.Mesh | undefined;
    if (!srcFeature || !srcMesh?.isMesh || !tgtFeature || !tgtMesh?.isMesh) {
      get().setStatusMessage('Mesh Align: source or target mesh not found');
      return;
    }
    const result = GeometryEngine.alignMeshToCentroid(srcMesh, tgtMesh);
    result.castShadow = true;
    result.receiveShadow = true;
    const nextFeatures = features.map((f) =>
      f.id === sourceFeatureId
        ? { ...f, mesh: result, params: { ...f.params, featureKind: 'mesh-align', targetFeatureId } }
        : f,
    );
    set({ features: nextFeatures });
    get().setStatusMessage(`Mesh Align: "${srcFeature.name}" aligned to "${tgtFeature.name}"`);
  },

  // ── MSH12 — Convert Mesh to BRep ─────────────────────────────────────────
  commitConvertMeshToBRep: (featureId, mode) => {
    const { features } = get();
    const srcFeature = features.find((f) => f.id === featureId);
    const srcMesh = srcFeature?.mesh as THREE.Mesh | undefined;
    if (!srcFeature || !srcMesh?.isMesh) {
      get().setStatusMessage('Convert to BRep: no mesh found for selected feature');
      return;
    }
    let resultMesh: THREE.Mesh = srcMesh;
    if (mode === 'prismatic') {
      resultMesh = GeometryEngine.makeClosedMesh(srcMesh);
    }
    resultMesh.castShadow = true;
    resultMesh.receiveShadow = true;
    const nextFeatures = features.map((f) =>
      f.id === featureId
        ? {
            ...f,
            mesh: resultMesh,
            type: 'extrude' as Feature['type'],
            bodyKind: 'solid' as Feature['bodyKind'],
            params: { ...f.params, featureKind: 'convert-mesh-to-brep', convertMode: mode },
          }
        : f,
    );
    set({ features: nextFeatures });
    get().setStatusMessage(`Convert to BRep (${mode}): "${srcFeature.name}" is now a solid body`);
  },

}),
{
  name: 'dzign3d-cad',
  storage: idbStorage as unknown as PersistStorage<unknown>,
  version: 3,
  migrate: (persistedState: unknown) => {
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

  // Rebuild componentStore bodies from rehydrated features so the Browser
  // tree shows Bodies after a page refresh. componentStore is not persisted.
  onRehydrateStorage: () => (state) => {
    if (!state) return;
    const componentStore = useComponentStore.getState();
    const existingBodyIds = new Set(Object.keys(componentStore.bodies));
    for (const feature of state.features) {
      if (feature.type !== 'extrude') continue;
      const op = (feature.params?.operation as string) ?? 'new-body';
      if (op !== 'new-body') continue;
      // Skip if a body already exists for this feature
      if (feature.bodyId && existingBodyIds.has(feature.bodyId)) continue;
      const parentId = componentStore.activeComponentId ?? componentStore.rootComponentId;
      const bodyLabel = (feature.bodyKind === 'surface' ? 'Surface' : 'Body') + ' ' + (Object.keys(componentStore.bodies).length + 1);
      const bodyId = componentStore.addBody(parentId, bodyLabel);
      if (bodyId) {
        componentStore.addFeatureToBody(bodyId, feature.id);
      }
    }
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
    viewportLayout: state.viewportLayout,
    ambientOcclusionEnabled: state.ambientOcclusionEnabled,
    dimensionToleranceMode: state.dimensionToleranceMode,
    dimensionToleranceUpper: state.dimensionToleranceUpper,
    dimensionToleranceLower: state.dimensionToleranceLower,
    // Model data
    sketches: state.sketches,
    features: state.features.map((f) => serializeFeature(f) as Feature),
    parameters: state.parameters,
    frozenFormVertices: state.frozenFormVertices,
    featureGroups: state.featureGroups,
    canvasReferences: state.canvasReferences,
    jointOrigins: state.jointOrigins,
    formBodies: state.formBodies,
  }),

}));
