import type * as THREE from 'three';
import type {
  MaterialProfile,
  PlateObject,
  PrintProfile,
  PrinterProfile,
  SliceProgress,
  SliceResult,
  ModifierMeshRole,
  ModifierMeshSettings,
} from '../../types/slicer';
import type { PreviewColorMode } from '../../types/slicer-preview.types';
import type { PrintabilityReport } from '../../engine/PrintabilityCheck';
import type { ArrangeBedMesh } from '../../utils/bedMeshArrange';

export type ProfileSnapshotKind = 'printer' | 'material' | 'print';

export type ProfileSnapshotProfile = PrinterProfile | MaterialProfile | PrintProfile;

export interface ProfileSnapshot {
  id: string;
  kind: ProfileSnapshotKind;
  profileId: string;
  profileName: string;
  createdAt: number;
  profile: ProfileSnapshotProfile;
}

export interface SlicerStore {
  printerProfiles: PrinterProfile[];
  materialProfiles: MaterialProfile[];
  printProfiles: PrintProfile[];
  profileSnapshots: ProfileSnapshot[];
  activePrinterProfileId: string;
  activeMaterialProfileId: string;
  activePrintProfileId: string;
  printerLastMaterial: Record<string, string>;
  printerLastPrint: Record<string, string>;
  plateObjects: PlateObject[];
  selectedPlateObjectId: string | null;
  /** Additional selected ids (multi-select). Anchor is `selectedPlateObjectId`. */
  additionalSelectedIds: string[];
  /** Undo/redo history of plateObjects snapshots. */
  plateHistory: PlateObject[][];
  plateFuture: PlateObject[][];
  activeBedMesh: ArrangeBedMesh | null;
  sliceProgress: SliceProgress;
  sliceResult: SliceResult | null;
  previewMode: 'model' | 'preview';
  previewLayer: number;
  previewLayerStart: number;
  previewLayerMax: number;
  previewShowTravel: boolean;
  previewShowRetractions: boolean;
  previewSectionEnabled: boolean;
  previewSectionZ: number;
  previewColorMode: PreviewColorMode;
  previewRenderMode: 'solid' | 'wireframe';
  previewHiddenTypes: string[];
  previewColorSchemeOpen: boolean;
  previewGCodeOpen: boolean;
  previewSimEnabled: boolean;
  previewSimPlaying: boolean;
  previewSimSpeed: number;
  previewSimTime: number;
  printabilityReport: PrintabilityReport | null;
  printabilityHighlight: boolean;
  settingsPanel: 'printer' | 'material' | 'print' | null;
  transformMode: 'move' | 'scale' | 'rotate' | 'mirror' | 'settings';
  /** Transient viewport "pick mode" for tools that capture a click on the
   *  3D scene (lay-flat-by-face, measurement, painting). 'none' when idle. */
  viewportPickMode: 'none' | 'lay-flat' | 'measure' | 'seam-paint' | 'modifier-paint';
  /** Accumulator for the measurement tool — populated as the user clicks.
   *  Reset whenever pick mode leaves 'measure'. */
  measurePoints: Array<{ x: number; y: number; z: number }>;
  getActivePrinterProfile: () => PrinterProfile;
  getActiveMaterialProfile: () => MaterialProfile;
  getActivePrintProfile: () => PrintProfile;
  setActivePrinterProfile: (id: string) => void;
  setActiveMaterialProfile: (id: string) => void;
  setActivePrintProfile: (id: string) => void;
  addPrinterProfile: (profile: PrinterProfile) => void;
  updatePrinterProfile: (id: string, updates: Partial<PrinterProfile>) => void;
  deletePrinterProfile: (id: string) => void;
  createPrinterWithDefaults: (name: string) => void;
  addMaterialProfile: (profile: MaterialProfile) => void;
  updateMaterialProfile: (id: string, updates: Partial<MaterialProfile>) => void;
  deleteMaterialProfile: (id: string) => void;
  addPrintProfile: (profile: PrintProfile) => void;
  updatePrintProfile: (id: string, updates: Partial<PrintProfile>) => void;
  deletePrintProfile: (id: string) => void;
  restoreProfileSnapshot: (snapshotId: string) => void;
  restoreProfileSnapshotKey: (snapshotId: string, keyPath: string) => void;
  addToPlate: (featureId: string, name: string, geometry: THREE.BufferGeometry | null | unknown) => void;
  addPaintedModifierMesh: (
    role: Exclude<ModifierMeshRole, 'normal'>,
    point: { x: number; y: number; z: number },
    radiusMm: number,
    heightMm: number,
    settings?: ModifierMeshSettings,
    source?: { objectId: string; localPoint: { x: number; y: number; z: number } },
  ) => void;
  removeFromPlate: (id: string) => void;
  selectPlateObject: (id: string | null) => void;
  togglePlateObjectInSelection: (id: string) => void;
  selectPlateObjectRange: (anchorId: string | null, targetId: string) => void;
  clearPlateSelection: () => void;
  getSelectedIds: () => string[];
  updatePlateObject: (id: string, updates: Partial<PlateObject>) => void;
  duplicatePlateObject: (id: string) => void;
  duplicateSelectedPlateObjects: () => void;
  layFlatPlateObject: (id: string) => void;
  layFlatByFace: (id: string, localFaceNormal: { x: number; y: number; z: number }) => void;
  autoOrientPlateObject: (id: string) => void;
  dropToBedPlateObject: (id: string) => void;
  centerPlateObject: (id: string) => void;
  scaleToHeight: (id: string, targetHeight: number) => void;
  reorderPlateObjects: (orderedIds: string[]) => void;
  resolveOverlapForObject: (id: string) => void;
  hollowPlateObject: (id: string, wallThicknessMm: number) => Promise<void>;
  cutPlateObjectByPlane: (
    id: string,
    planePoint: { x: number; y: number; z: number },
    planeNormal: { x: number; y: number; z: number },
  ) => Promise<void>;
  removeSelectedPlateObjects: () => void;
  undoPlate: () => void;
  redoPlate: () => void;
  pushPlateHistory: () => void;
  exportPlateJson: () => string;
  importPlateJson: (json: string) => void;
  autoArrange: () => void;
  setActiveBedMesh: (mesh: ArrangeBedMesh | null) => void;
  clearPlate: () => void;
  importFileToPlate: (file: File) => Promise<string | null>;
  startSlice: () => void;
  cancelSlice: () => void;
  /** Terminate and respawn the slicer worker. Use to recover from a
   *  hung worker or a stale-cache situation in dev. */
  reloadSlicerWorker: () => void;
  setSliceProgress: (progress: SliceProgress) => void;
  setPreviewMode: (mode: 'model' | 'preview') => void;
  setPreviewLayer: (layer: number) => void;
  setPreviewLayerStart: (layer: number) => void;
  setPreviewLayerRange: (start: number, end: number) => void;
  setPreviewShowTravel: (show: boolean) => void;
  setPreviewShowRetractions: (show: boolean) => void;
  setPreviewSectionEnabled: (on: boolean) => void;
  setPreviewSectionZ: (z: number) => void;
  setPreviewColorMode: (mode: PreviewColorMode) => void;
  setPreviewRenderMode: (mode: 'solid' | 'wireframe') => void;
  togglePreviewType: (type: string) => void;
  setPreviewColorSchemeOpen: (open: boolean) => void;
  setPreviewGCodeOpen: (open: boolean) => void;
  setPreviewSimEnabled: (on: boolean) => void;
  setPreviewSimPlaying: (playing: boolean) => void;
  setPreviewSimSpeed: (speed: number) => void;
  setPreviewSimTime: (t: number) => void;
  advancePreviewSimTime: (deltaSeconds: number) => void;
  resetPreviewSim: () => void;
  runPrintabilityCheck: () => void;
  clearPrintabilityReport: () => void;
  setPrintabilityHighlight: (on: boolean) => void;
  downloadGCode: () => void;
  sendToPrinter: () => Promise<void>;
  setSettingsPanel: (panel: 'printer' | 'material' | 'print' | null) => void;
  setTransformMode: (mode: 'move' | 'scale' | 'rotate' | 'mirror' | 'settings') => void;
  setViewportPickMode: (mode: 'none' | 'lay-flat' | 'measure' | 'seam-paint' | 'modifier-paint') => void;
  pushMeasurePoint: (point: { x: number; y: number; z: number }) => void;
  clearMeasurePoints: () => void;
}
