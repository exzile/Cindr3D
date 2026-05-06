import * as THREE from 'three';
import type {
  Feature,
  FeatureGroup,
  FormCage,
  FormElementType,
  FormSelection,
  Sketch,
  SketchConstraint,
  SketchEntity,
  SketchPlane,
  Tool,
  ViewMode,
} from '../../../types/cad';
import type { ParametricParameterValue } from '../../../parametric';

export interface DesignConfiguration {
  id: string;
  name: string;
  featureSuppression: Record<string, boolean>;
  parametricParameters: Record<string, Record<string, ParametricParameterValue>>;
  updatedAt: number;
}

export interface CADCoreState {
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
  updateFeatureParams: (id: string, params: Feature['params']) => void;
  /** D189: Move a feature to a new position in the timeline. */
  reorderFeature: (id: string, newIndex: number) => void;
  /** D190: Rollback index — features at index >= this are skipped when rendering. */
  rollbackIndex: number;
  setRollbackIndex: (index: number) => void;
  selectedFeatureId: string | null;
  setSelectedFeatureId: (id: string | null) => void;

  // Phase 16.2 - design configurations / variants
  designConfigurations: DesignConfiguration[];
  activeDesignConfigurationId: string;
  createDesignConfiguration: (name?: string) => void;
  switchDesignConfiguration: (id: string) => void;
  renameDesignConfiguration: (id: string, name: string) => void;
  removeDesignConfiguration: (id: string) => void;
  captureDesignConfiguration: (id?: string) => void;
  exportDesignConfigurations: () => void;

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
}
