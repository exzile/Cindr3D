import type {
  ConstructionAxis,
  ConstructionPlane,
  ConstructionPoint,
  ContactSetEntry,
  InterferenceResult,
  JointOriginRecord,
} from '../../../types/cad';
import type { InsertComponentParams } from '../../../components/dialogs/assembly/InsertComponentDialog';
import type { DirectEditParams } from '../../../components/dialogs/solid/DirectEditDialog';
import type { TextureExtrudeParams } from '../../../components/dialogs/solid/TextureExtrudeDialog';

export interface CADWorkflowState {
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
  commitDecal: (params: import('../../../components/dialogs/insert/DecalDialog').DecalParams) => void;

  // ── D193 Attached Canvas ─────────────────────────────────────────────────
  attachedCanvasId: string | null;
  openAttachedCanvasDialog: (canvasId?: string) => void;
  closeAttachedCanvasDialog: () => void;
  updateCanvas: (id: string, changes: Partial<{ dataUrl: string; plane: string; offsetX: number; offsetY: number; scale: number; opacity: number }>) => void;

  // ── D182 Lip/Groove edge picker ──────────────────────────────────────────
  lipGrooveEdgeId: string | null;
  setLipGrooveEdge: (id: string | null) => void;

  // ── D183 Snap-Fit face picker ────────────────────────────────────────────
  snapFitFaceId: string | null;
  setSnapFitFace: (id: string | null) => void;

  // ── D185 Split Face ──────────────────────────────────────────────────────
  splitFaceId: string | null;
  openSplitFaceDialog: () => void;
  setSplitFace: (id: string) => void;
  closeSplitFaceDialog: () => void;
  commitSplitFace: (params: import('../../../components/dialogs/solid/SplitFaceDialog').SplitFaceParams) => void;

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

  // ── SOL-F2: Draft pull direction face picker ─────────────────────────────
  draftPullFaceId: string | null;
  draftPullFaceNormal: [number, number, number] | null;
  draftPullFaceCentroid: [number, number, number] | null;
  draftPullFacePickActive: boolean;
  setDraftPullFace: (
    id: string,
    normal: [number, number, number],
    centroid: [number, number, number],
  ) => void;
  clearDraftPullFace: () => void;
  setDraftPullFacePickActive: (v: boolean) => void;

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
  commitBoundingSolid: (params: import('../../../components/dialogs/solid/BoundingSolidDialog').BoundingSolidParams) => void;

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

  // ── A-F1: Joint dialog geometry snap ────────────────────────────────────
  jointDialogPickedOrigin: [number, number, number] | null;
  jointDialogPickMode: boolean;
  setJointDialogPickedOrigin(p: [number, number, number] | null): void;
  setJointDialogPickMode(v: boolean): void;

  // ── D196 — Interference ─────────────────────────────────────────────────
  showInterferenceDialog: boolean;
  interferenceResults: InterferenceResult[];
  openInterferenceDialog(): void;
  closeInterferenceDialog(): void;
  computeInterference(): void;
  /** CSG-intersect every interfering solid pair into new interference bodies. */
  commitInterferenceBodies(): void;

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
  getBOMEntries(): import('../../../components/dialogs/assembly/BOMDialog').BOMEntry[];

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
}
