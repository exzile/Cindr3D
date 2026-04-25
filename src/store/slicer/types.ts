import type * as THREE from 'three';
import type {
  MaterialProfile,
  PlateObject,
  PrintProfile,
  PrinterProfile,
  SliceProgress,
  SliceResult,
} from '../../types/slicer';
import type { PrintabilityReport } from '../../engine/PrintabilityCheck';

export interface SlicerStore {
  printerProfiles: PrinterProfile[];
  materialProfiles: MaterialProfile[];
  printProfiles: PrintProfile[];
  activePrinterProfileId: string;
  activeMaterialProfileId: string;
  activePrintProfileId: string;
  printerLastMaterial: Record<string, string>;
  printerLastPrint: Record<string, string>;
  plateObjects: PlateObject[];
  selectedPlateObjectId: string | null;
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
  previewColorMode: 'type' | 'speed' | 'flow' | 'width' | 'layer-time';
  previewHiddenTypes: string[];
  previewColorSchemeOpen: boolean;
  previewSimEnabled: boolean;
  previewSimPlaying: boolean;
  previewSimSpeed: number;
  previewSimTime: number;
  printabilityReport: PrintabilityReport | null;
  printabilityHighlight: boolean;
  settingsPanel: 'printer' | 'material' | 'print' | null;
  transformMode: 'move' | 'scale' | 'rotate' | 'mirror' | 'settings';
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
  addToPlate: (featureId: string, name: string, geometry: THREE.BufferGeometry | null | unknown) => void;
  removeFromPlate: (id: string) => void;
  selectPlateObject: (id: string | null) => void;
  updatePlateObject: (id: string, updates: Partial<PlateObject>) => void;
  autoArrange: () => void;
  clearPlate: () => void;
  importFileToPlate: (file: File) => Promise<void>;
  startSlice: () => void;
  cancelSlice: () => void;
  setSliceProgress: (progress: SliceProgress) => void;
  setPreviewMode: (mode: 'model' | 'preview') => void;
  setPreviewLayer: (layer: number) => void;
  setPreviewLayerStart: (layer: number) => void;
  setPreviewLayerRange: (start: number, end: number) => void;
  setPreviewShowTravel: (show: boolean) => void;
  setPreviewShowRetractions: (show: boolean) => void;
  setPreviewSectionEnabled: (on: boolean) => void;
  setPreviewSectionZ: (z: number) => void;
  setPreviewColorMode: (mode: 'type' | 'speed' | 'flow' | 'width' | 'layer-time') => void;
  togglePreviewType: (type: string) => void;
  setPreviewColorSchemeOpen: (open: boolean) => void;
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
}
