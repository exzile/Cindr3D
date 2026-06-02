import * as THREE from "three";
import type {
  AlignGeomPick,
  DimensionToolType,
  Parameter,
  SketchDimension,
} from "../../../types/cad";
import type {
  ExtrudeDirection,
  ExtrudeOperation,
} from "../../../types/cad-extrude.types";

export interface CADModelingState {
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
  startExtrudeFromFace: (
    boundary: THREE.Vector3[],
    normal: THREE.Vector3,
    centroid: THREE.Vector3,
  ) => void;
  /** EX-13: load an existing extrude feature into the panel for editing. */
  loadExtrudeForEdit: (featureId: string) => void;
  cancelExtrudeTool: () => void;
  commitExtrude: () => void;
  // Thin extrude (D66)
  extrudeThinEnabled: boolean;
  setExtrudeThinEnabled: (v: boolean) => void;
  extrudeThinThickness: number;
  setExtrudeThinThickness: (t: number) => void;
  extrudeThinSide: "side1" | "side2" | "center";
  setExtrudeThinSide: (s: "side1" | "side2" | "center") => void;
  // EX-7: independent wall location per side for two-sided thin extrude
  extrudeThinSide2: "side1" | "side2" | "center";
  setExtrudeThinSide2: (s: "side1" | "side2" | "center") => void;
  // EX-8: independent thickness per side for two-sided thin extrude
  extrudeThinThickness2: number;
  setExtrudeThinThickness2: (t: number) => void;
  // Extrude start options (D67 / CORR-8)
  extrudeStartType: "profile" | "offset" | "entity";
  setExtrudeStartType: (t: "profile" | "offset" | "entity") => void;
  extrudeStartOffset: number;
  setExtrudeStartOffset: (v: number) => void;
  // CORR-8: EntityStartDefinition — face/plane ID to start from
  extrudeStartEntityId: string | null;
  setExtrudeStartEntityId: (id: string | null) => void;
  /** EX-4: face normal + centroid for From-Entity start (picked via viewport) */
  extrudeStartFaceNormal: [number, number, number] | null;
  extrudeStartFaceCentroid: [number, number, number] | null;
  setExtrudeStartFace: (
    normal: [number, number, number],
    centroid: [number, number, number],
  ) => void;
  clearExtrudeStartFace: () => void;
  // Extrude extent types (D68) — EX-3: added 'to-object', EX-F1: added 'to-next'
  extrudeExtentType: "distance" | "all" | "to-object" | "to-next";
  setExtrudeExtentType: (
    t: "distance" | "all" | "to-object" | "to-next",
  ) => void;
  // EX-10: independent extent type for side 2 when direction=two-sides
  extrudeExtentType2: "distance" | "all" | "to-object" | "to-next";
  setExtrudeExtentType2: (
    t: "distance" | "all" | "to-object" | "to-next",
  ) => void;
  /** EX-3: face data for To-Object terminus (picked via viewport) */
  extrudeToEntityFaceId: string | null;
  extrudeToEntityFaceNormal: [number, number, number] | null;
  extrudeToEntityFaceCentroid: [number, number, number] | null;
  setExtrudeToEntityFace: (
    id: string,
    normal: [number, number, number],
    centroid: [number, number, number],
  ) => void;
  clearExtrudeToEntityFace: () => void;
  /** EX-12: directionHint — flip the "to-object" direction when the face is behind the profile */
  extrudeToObjectFlipDirection: boolean;
  setExtrudeToObjectFlipDirection: (v: boolean) => void;
  /** EX-11: add a planar face as an additional profile while a sketch is already selected */
  addFaceToExtrude: (
    boundary: THREE.Vector3[],
    normal: THREE.Vector3,
    centroid: THREE.Vector3,
  ) => void;
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
  extrudeBodyKind: "solid" | "surface";
  setExtrudeBodyKind: (k: "solid" | "surface") => void;
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
  revolveAxis: "X" | "Y" | "Z" | "centerline";
  setRevolveAxis: (a: "X" | "Y" | "Z" | "centerline") => void;
  revolveAngle: number;
  setRevolveAngle: (angle: number) => void;
  // Revolve direction modes (D70)
  revolveDirection: "one-side" | "symmetric" | "two-sides";
  setRevolveDirection: (d: "one-side" | "symmetric" | "two-sides") => void;
  revolveAngle2: number;
  setRevolveAngle2: (a: number) => void;
  // Revolve body kind (D103)
  revolveBodyKind: "solid" | "surface";
  setRevolveBodyKind: (k: "solid" | "surface") => void;
  revolveOperation: "new-body" | "join" | "cut" | "intersect" | "new-component";
  setRevolveOperation: (
    op: "new-body" | "join" | "cut" | "intersect" | "new-component",
  ) => void;
  revolveIsProjectAxis: boolean;
  setRevolveIsProjectAxis: (v: boolean) => void;
  // SURF-CREATE-7: to-object extent
  revolveExtentType: "angle" | "to-object";
  setRevolveExtentType: (t: "angle" | "to-object") => void;
  revolveToEntityFaceCentroid: [number, number, number] | null;
  revolveToEntityFaceNormal: [number, number, number] | null;
  setRevolveToEntityFace: (centroid: [number, number, number], normal: [number, number, number]) => void;
  clearRevolveToEntityFace: () => void;
  revolveProfileMode: "sketch" | "face";
  setRevolveProfileMode: (m: "sketch" | "face") => void;
  revolveFaceBoundary: number[] | null;
  revolveFaceNormal: [number, number, number] | null;
  clearRevolveFace: () => void;
  startRevolveFromFace: (
    boundary: THREE.Vector3[],
    normal: THREE.Vector3,
  ) => void;
  startRevolveTool: () => void;
  cancelRevolveTool: () => void;
  commitRevolve: () => void;

  // Sweep tool (D30)
  sweepProfileSketchId: string | null;
  setSweepProfileSketchId: (id: string | null) => void;
  sweepPathSketchId: string | null;
  setSweepPathSketchId: (id: string | null) => void;
  // D104 surface sweep
  sweepBodyKind: "solid" | "surface";
  setSweepBodyKind: (k: "solid" | "surface") => void;
  // D71 sweep upgrades
  sweepOrientation: "perpendicular" | "frenet" | "horizontal" | "vertical";
  sweepProfileScaling: "none" | "scale-to-path" | "scale-to-rail";
  sweepTwistAngle: number;
  sweepTaperAngle: number;
  sweepGuideRailId: string | null;
  sweepIsDirectionFlipped: boolean;
  sweepOperation: "new-body" | "join" | "cut" | "intersect" | "new-component";
  sweepDistance: "entire" | "distance";
  sweepDistanceOne: number;
  sweepDistanceTwo: number;
  setSweepIsDirectionFlipped: (v: boolean) => void;
  setSweepDistanceOne: (v: number) => void;
  setSweepDistanceTwo: (v: number) => void;
  setSweepOrientation: (v: "perpendicular" | "frenet" | "horizontal" | "vertical") => void;
  setSweepProfileScaling: (
    v: "none" | "scale-to-path" | "scale-to-rail",
  ) => void; // SDK-4
  setSweepTwistAngle: (v: number) => void;
  setSweepTaperAngle: (v: number) => void;
  setSweepGuideRailId: (v: string | null) => void;
  setSweepOperation: (
    v: "new-body" | "join" | "cut" | "intersect" | "new-component",
  ) => void;
  setSweepDistance: (v: "entire" | "distance") => void;
  startSweepTool: () => void;
  cancelSweepTool: () => void;
  commitSweep: () => void;

  // Loft tool (D31 / D105)
  loftProfileSketchIds: string[];
  setLoftProfileSketchIds: (ids: string[]) => void;
  loftBodyKind: "solid" | "surface";
  setLoftBodyKind: (k: "solid" | "surface") => void;
  // D72 loft upgrades
  loftClosed: boolean;
  loftTangentEdgesMerged: boolean;
  loftStartCondition: "free" | "tangent";
  loftEndCondition: "free" | "tangent";
  loftRailSketchIds: string[];
  setLoftRailSketchIds: (ids: string[]) => void;
  /** @deprecated kept for serialization compat — use loftRailSketchIds */
  loftRailSketchId: string | null;
  loftOperation: "new-body" | "join" | "cut" | "intersect" | "new-component";
  setLoftClosed: (v: boolean) => void;
  setLoftTangentEdgesMerged: (v: boolean) => void; // SDK-8
  setLoftStartCondition: (v: "free" | "tangent" | "curvature") => void;
  setLoftEndCondition: (v: "free" | "tangent" | "curvature") => void;
  setLoftRailSketchId: (v: string | null) => void;
  setLoftOperation: (
    v: "new-body" | "join" | "cut" | "intersect" | "new-component",
  ) => void;
  startLoftTool: () => void;
  cancelLoftTool: () => void;
  commitLoft: () => void;

  // Patch tool (D106)
  patchSelectedSketchId: string | null;
  patchContinuity: 'G0' | 'G1' | 'G2';
  setPatchContinuity: (v: 'G0' | 'G1' | 'G2') => void;
  setPatchSelectedSketchId: (id: string | null) => void;
  startPatchTool: () => void;
  cancelPatchTool: () => void;
  commitPatch: () => void;

  // Ruled Surface tool (D107)
  ruledMode: "two-curves" | "extend-edge";
  setRuledMode: (mode: "two-curves" | "extend-edge") => void;
  ruledSketchAId: string | null;
  setRuledSketchAId: (id: string | null) => void;
  ruledSketchBId: string | null;
  setRuledSketchBId: (id: string | null) => void;
  ruledAlignmentMode: "direction" | "tangent" | "normal";
  setRuledAlignmentMode: (mode: "direction" | "tangent" | "normal") => void;
  ruledAlignmentDistance: number;
  setRuledAlignmentDistance: (distance: number) => void;
  // Extend-edge mode (SURF-CREATE-5)
  ruledExtendDistance: number;
  setRuledExtendDistance: (d: number) => void;
  ruledExtendAxis: "X" | "Y" | "Z";
  setRuledExtendAxis: (a: "X" | "Y" | "Z") => void;
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
  ribDirection: "normal" | "flip" | "symmetric";
  setRibDirection: (d: "normal" | "flip" | "symmetric") => void;
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
  commitMeshTransform: (
    featureId: string,
    params: {
      tx: number;
      ty: number;
      tz: number;
      rx: number;
      ry: number;
      rz: number;
      scale: number;
    },
  ) => void;

  // SLD13 — Scale (commit). refPoint selects the scale center: 'centroid' (default,
  // scales the body in place about its bounding-box center) or 'origin' (world origin).
  commitScale: (featureId: string, sx: number, sy: number, sz: number, refPoint?: 'centroid' | 'origin') => void;

  // 3D edge fillet (commit) — rounds edges in filletEdgeIds on the target body.
  // featureId: non-destructive path — store result on the fillet feature node.
  // filletParams: extended params (mode, chordLength, startRadius, endRadius, propagate).
  commitFillet: (
    radius: number,
    segments: number,
    featureId?: string,
    filletParams?: Record<string, unknown>,
  ) => void;

  // 3D edge chamfer (commit) — bevels edges in chamferEdgeIds. distance is the
  // face-1 / live setback; distance2 (optional) is the face-2 setback.
  commitChamfer: (
    distance: number,
    distance2?: number,
    featureId?: string,
    chamferParams?: Record<string, unknown>,
  ) => void;

  // Replay an existing OCC fillet/chamfer feature — used on edit.
  replayEdgeModificationFeature: (featureId: string) => void;

  // Align tool — geometry-pair picking + transform commit
  alignPickStage: "idle" | "source" | "target";
  alignPickKind: "face" | "edge" | "vertex";
  alignSource: AlignGeomPick | null;
  alignTarget: AlignGeomPick | null;
  setAlignPickStage: (stage: "idle" | "source" | "target") => void;
  setAlignPickKind: (kind: "face" | "edge" | "vertex") => void;
  setAlignSource: (pick: AlignGeomPick | null) => void;
  setAlignTarget: (pick: AlignGeomPick | null) => void;
  resetAlign: () => void;
  commitAlign: (opts: {
    moveType: "align" | "translate" | "rotate";
    flip: boolean;
    allowRotation: boolean;
  }) => void;

  // SLD12 — Combine / Boolean (commit)
  commitCombine: (
    targetFeatureId: string,
    toolFeatureId: string | string[],
    operation: "join" | "cut" | "intersect",
    keepTool: boolean,
    /** Place result in a new component instead of on the existing target body. Mirrors Fusion isNewComponent. */
    isNewComponent?: boolean,
  ) => void;
  recommitCombine: (
    featureId: string,
    params: {
      operation: "join" | "cut" | "intersect";
      keepTools: boolean;
      targetId: string;
      toolId: string;
      toolIds?: string[];
      isNewComponent?: boolean;
    },
  ) => void;

  // SLD17 — Mirror feature (commit)
  commitMirrorFeature: (featureId: string, plane: "XY" | "XZ" | "YZ") => void;

  // OCC-22.1 — Move/Copy body (commit)
  commitMoveBody: (featureId: string, params: {
    dx: number; dy: number; dz: number;
    rx: number; ry: number; rz: number;
    copy: boolean;
  }) => void;

  // D6 Fillet edge selection + live radius (synced with FilletGizmo drag)
  filletEdgeIds: string[];
  addFilletEdge: (id: string) => void;
  removeFilletEdge: (id: string) => void;
  clearFilletEdges: () => void;
  filletLiveRadius: number;
  setFilletLiveRadius: (r: number) => void;

  // D6b Full-round fillet face picker (center face + two side faces)
  filletFullRoundCenterFaceId: string | null;
  filletFullRoundCenterOccBodyId: string | null;
  filletFullRoundCenterOccFaceId: number | null;
  filletFullRoundSide1FaceId: string | null;
  filletFullRoundSide1OccFaceId: number | null;
  filletFullRoundSide2FaceId: string | null;
  filletFullRoundSide2OccFaceId: number | null;
  filletFullRoundPickSlot: 'center' | 'side1' | 'side2' | null;
  setFilletFullRoundFace: (
    slot: 'center' | 'side1' | 'side2',
    faceId: string | null,
    occBodyId: string | null,
    occFaceId: number | null,
  ) => void;
  clearFilletFullRoundFaces: () => void;
  setFilletFullRoundPickSlot: (slot: 'center' | 'side1' | 'side2' | null) => void;

  // D7 Chamfer edge selection + live distance (synced with ChamferGizmo drag)
  chamferEdgeIds: string[];
  addChamferEdge: (id: string) => void;
  removeChamferEdge: (id: string) => void;
  clearChamferEdges: () => void;
  chamferLiveDistance: number;
  setChamferLiveDistance: (d: number) => void;

  /**
   * Fusion-style live validity preview for fillet/chamfer. When the OCC dry-run
   * of the *current* value cannot be solved (e.g. the chamfer runs into an
   * adjacent fillet at this size), the selected edge(s) flash bright red in the
   * viewport and a toast explains why — before the user clicks OK. Transient:
   * never persisted, cleared when the dialog closes or the value becomes valid.
   */
  edgeModInvalidPreview: { edgeIds: string[]; message: string } | null;
  setEdgeModInvalidPreview: (
    v: { edgeIds: string[]; message: string } | null,
  ) => void;
  /**
   * Non-committing OCC dry-run of a fillet/chamfer at the given value. Runs the
   * full apply pipeline (all fallbacks + correctness guards) but disposes the
   * result instead of installing it, so the dialog can warn before the user
   * clicks OK. Returns `ok: false` with an actionable message when OCC cannot
   * solve the operation at this value. Skips face-picker modes (full-round /
   * rule-fillet) and unsupported three-face chamfer (returns ok: true).
   */
  probeEdgeModification: (args: {
    tool: "Fillet" | "Chamfer";
    edgeIds: string[];
    radius?: number;
    distance?: number;
    distance2?: number;
    angle?: number;
    propagate?: boolean;
    filletParams?: Record<string, unknown>;
  }) => { ok: boolean; message?: string };

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
  units: "mm" | "cm" | "in";
  setUnits: (units: "mm" | "cm" | "in") => void;
  // D39/D206 Selection Filter — multi-toggle object
  selectionFilter: {
    bodies: boolean;
    faces: boolean;
    edges: boolean;
    vertices: boolean;
    sketches: boolean;
    construction: boolean;
  };
  setSelectionFilter: (f: Partial<CADModelingState["selectionFilter"]>) => void;

  // D207 — Sketch Grid / Snap settings
  sketchGridEnabled: boolean;
  sketchSnapEnabled: boolean;
  setSketchGridEnabled: (v: boolean) => void;
  setSketchSnapEnabled: (v: boolean) => void;

  // Camera
  cameraHomeCounter: number;
  triggerCameraHome: () => void;
  cameraNavMode: "orbit" | "pan" | "zoom" | "zoom-window" | "look-at" | null;
  setCameraNavMode: (
    mode: "orbit" | "pan" | "zoom" | "zoom-window" | "look-at" | null,
  ) => void;
  // NAV-19: multi-viewport layout
  viewportLayout: "1" | "2h" | "2v" | "4";
  setViewportLayout: (layout: "1" | "2h" | "2v" | "4") => void;
  zoomToFitCounter: number;
  triggerZoomToFit: () => void;
  // NAV-5: Zoom Window
  zoomWindowTrigger: {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    vpW: number;
    vpH: number;
  } | null;
  triggerZoomWindow: (rect: {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    vpW: number;
    vpH: number;
  }) => void;
  clearZoomWindow: () => void;

  // Parameters
  parameters: Parameter[];
  addParameter: (
    name: string,
    expression: string,
    description?: string,
    group?: string,
  ) => void;
  updateParameter: (
    id: string,
    updates: Partial<
      Pick<Parameter, "name" | "expression" | "description" | "group">
    >,
  ) => void;
  removeParameter: (id: string) => void;
  evaluateExpression: (expr: string) => number | null;

  // A5 — ground/unground a component (stub; components array populated in A1)
  groundComponent: (id: string, grounded: boolean) => void;

  // D12 — Sketch Text tool
  sketchTextContent: string;
  sketchTextHeight: number;
  sketchTextFont: string;
  sketchTextBold: boolean;
  sketchTextItalic: boolean;
  sketchTextType: 'standard' | 'along-path';
  sketchTextCharSpacing: number;
  sketchTextFlipH: boolean;
  sketchTextFlipV: boolean;
  sketchTextHAlign: 'left' | 'center' | 'right';
  sketchTextVAlign: 'top' | 'middle' | 'bottom';
  setSketchTextContent: (v: string) => void;
  setSketchTextHeight: (v: number) => void;
  setSketchTextFont: (v: string) => void;
  setSketchTextBold: (v: boolean) => void;
  setSketchTextItalic: (v: boolean) => void;
  setSketchTextType: (v: 'standard' | 'along-path') => void;
  setSketchTextCharSpacing: (v: number) => void;
  setSketchTextFlipH: (v: boolean) => void;
  setSketchTextFlipV: (v: boolean) => void;
  setSketchTextHAlign: (v: 'left' | 'center' | 'right') => void;
  setSketchTextVAlign: (v: 'top' | 'middle' | 'bottom') => void;
  /** When set, the Text panel is editing an existing text group rather than placing a new one. */
  editingTextGroupId: string | null;
  startSketchTextTool: () => void;
  /** Load an existing text group's params into the panel and enter edit mode. */
  startSketchTextEdit: (groupId: string) => void;
  /** Regenerate the text group currently being edited from the panel params. */
  commitSketchTextEdit: () => void;
  /** Place text bent along the given sketch curve (Type = along-path). */
  commitTextAlongPath: (pathEntityId: string) => void;
  /** Commit text as closed glyph contours (each becomes one closed spline entity). */
  commitSketchTextEntities: (
    contours: Array<Array<{ x: number; y: number; z: number }>>,
    meta?: import('../../../types/cad').SketchTextMeta,
  ) => void;
  cancelSketchTextTool: () => void;

  // D28 — Dimension tool
  activeDimensionType: DimensionToolType;
  dimensionOffset: number;
  /** SK-A3: when true, newly created dimensions are marked driven (reference) */
  dimensionDrivenMode: boolean;
  /** CORR-1: orientation for newly created linear/aligned dimensions */
  dimensionOrientation: "horizontal" | "vertical" | "auto";
  /** SK-A8: tolerance mode and values for newly created dimensions */
  dimensionToleranceMode: "none" | "symmetric" | "deviation";
  dimensionToleranceUpper: number;
  dimensionToleranceLower: number;
  pendingDimensionEntityIds: string[];
  dimensionHoverEntityId: string | null;
  /**
   * Transient Fusion-style ghost dimension that rubber-bands with the cursor
   * while a placement is pending. Never persisted (not in partialize).
   */
  dimensionPreview: SketchDimension | null;
  pendingNewDimensionId: string | null;
  // Dimension editor overlay (rendered in ViewportPanels, outside the WebGL canvas)
  sketchDimEditId: string | null;
  sketchDimEditIsNew: boolean;
  sketchDimEditValue: string;
  sketchDimEditScreenX: number;
  sketchDimEditScreenY: number;
  sketchDimEditTypeahead: Parameter[];
  openSketchDimEdit: (id: string, value: string, isNew: boolean) => void;
  updateSketchDimEditScreen: (x: number, y: number) => void;
  setSketchDimEditValue: (v: string) => void;
  setSketchDimEditTypeahead: (items: Parameter[]) => void;
  commitSketchDimEdit: (rawValue: string) => void;
  cancelSketchDimEdit: () => void;

  /**
   * Fusion-style over-constraint prompt. Transient: set when a non-driven
   * dimension would over-constrain the sketch (intercepted BEFORE any
   * mutation), cleared by the dialog's Create-driven / Cancel actions. Never
   * persisted (absent from persistConfig.partialize).
   */
  pendingOverConstraint: {
    dimension: SketchDimension;
    activeSketchId: string;
    mode: "add" | "edit";
    previousValue?: number;
  } | null;
  /** Resolve the prompt by committing the candidate as a driven (reference) dimension. */
  resolveOverConstraintAsDriven: () => void;
  /** Resolve the prompt by discarding (add) / reverting (edit) — no change persisted. */
  cancelOverConstraint: () => void;
  setActiveDimensionType: (t: DimensionToolType) => void;
  setDimensionOffset: (v: number) => void;
  setDimensionDrivenMode: (v: boolean) => void;
  setDimensionOrientation: (v: "horizontal" | "vertical" | "auto") => void;
  setDimensionToleranceMode: (v: "none" | "symmetric" | "deviation") => void;
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
    type: "linear" | "circular",
    params: {
      axis: "X" | "Y" | "Z";
      count: number;
      spacing: number;
      circularAxis: "X" | "Y" | "Z";
      circularCount: number;
    },
  ) => void;

  // S10 — Spline post-commit handle editing
  editingSplineEntityId: string | null;
  hoveredSplinePointIndex: number | null;
  sketchEditingArcId: string | null;
  setSketchEditingArcId: (id: string | null) => void;
  draggingSplinePointIndex: number | null;
  setEditingSplineEntityId: (id: string | null) => void;
  setHoveredSplinePointIndex: (i: number | null) => void;
  setDraggingSplinePointIndex: (i: number | null) => void;
  updateSplineControlPoint: (
    entityId: string,
    pointIndex: number,
    x: number,
    y: number,
    z: number,
  ) => void;
  /**
   * Move one point of any sketch entity to a new world position, then run the
   * constraint solver with that point pinned. Used by the entity-point drag
   * handles so dragging e.g. a rectangle corner keeps coincident corners welded
   * and horizontal/vertical edges aligned (Fusion-style).
   */
  dragSketchPoint: (
    entityId: string,
    pointIndex: number,
    x: number,
    y: number,
    z: number,
  ) => void;

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

  // D47 — Intersection Curve (mesh × mesh)
  startSketchIntersectionCurveTool: () => void;
  cancelSketchIntersectionCurveTool: () => void;

  // D48 — Spun Profile (revolve cross-section)
  startSketchSpunProfileTool: () => void;
  cancelSketchSpunProfileTool: () => void;
}
