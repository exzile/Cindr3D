import * as THREE from 'three';

export interface CADAnalysisState {
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
  setAnalysisParams: (p: Partial<CADAnalysisState['analysisParams']>) => void;

  // ── SFC7 — Fill Surface ──────────────────────────────────────────────────
  showFillDialog: boolean;
  fillBoundaryEdgeIds: string[];
  /** Per-edge endpoint data captured at pick time so commitFill can assemble a real boundary loop. */
  fillBoundaryEdgeData: Array<{ id: string; a: [number, number, number]; b: [number, number, number] }>;
  openFillDialog(): void;
  addFillBoundaryEdge(id: string, a?: [number, number, number], b?: [number, number, number]): void;
  closeFillDialog(): void;
  commitFill(params: import('../../../components/dialogs/surface/FillDialog').FillParams): void;

  // ── SFC8 — Offset Curve to Surface ──────────────────────────────────────
  showOffsetCurveDialog: boolean;
  openOffsetCurveDialog(): void;
  closeOffsetCurveDialog(): void;
  commitOffsetCurve(params: import('../../../components/dialogs/surface/OffsetCurveDialog').OffsetCurveParams): void;

  // ── SFC16 — Surface Merge (face-picker) ──────────────────────────────────
  showSurfaceMergeDialog: boolean;
  surfaceMergeFace1Id: string | null;
  surfaceMergeFace2Id: string | null;
  openSurfaceMergeDialog(): void;
  setSurfaceMergeFace1(id: string): void;
  setSurfaceMergeFace2(id: string): void;
  closeSurfaceMergeDialog(): void;
  commitSurfaceMerge(params: import('../../../components/dialogs/surface/SurfaceMergeDialog').SurfaceMergeParams): void;

  // ── SFC18 — Delete Face ──────────────────────────────────────────────────
  showDeleteFaceDialog: boolean;
  deleteFaceIds: string[];
  /** Per-picked-face data the commit needs (which body + face plane). */
  deleteFacePicks: { featureId: string; normal: [number, number, number]; centroid: [number, number, number] }[];
  openDeleteFaceDialog(): void;
  addDeleteFace(id: string): void;
  addDeleteFacePick(featureId: string, normal: [number, number, number], centroid: [number, number, number]): void;
  clearDeleteFaces(): void;
  closeDeleteFaceDialog(): void;
  commitDeleteFace(params: import('../../../components/dialogs/surface/DeleteFaceDialog').DeleteFaceParams): void;

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
  commitSurfacePrimitive(params: import('../../../components/dialogs/surface/SurfacePrimitivesDialog').SurfacePrimitiveParams): void;

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
  newDocument(): void;
  getDesignJSON(): string;
  saveToFile(filename?: string): void;
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
