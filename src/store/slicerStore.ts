import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { PersistStorage } from 'zustand/middleware';
import * as THREE from 'three';
import type {
  PrinterProfile, MaterialProfile, PrintProfile, PlateObject,
  SliceProgress, SliceResult,
} from '../types/slicer';
import {
  DEFAULT_PRINTER_PROFILES, DEFAULT_MATERIAL_PROFILES, DEFAULT_PRINT_PROFILES,
} from '../types/slicer';
import { normalizeRotationDegreesToRadians, normalizeScale } from '../utils/slicerTransforms';
import { usePrinterStore } from './printerStore';


interface SlicerStore {
  // Profiles
  printerProfiles: PrinterProfile[];
  materialProfiles: MaterialProfile[];
  printProfiles: PrintProfile[];

  // Active selections
  activePrinterProfileId: string;
  activeMaterialProfileId: string;
  activePrintProfileId: string;

  // Per-printer last-used profile IDs (so switching printers restores context)
  printerLastMaterial: Record<string, string>;
  printerLastPrint: Record<string, string>;

  // Plate objects (models on build plate)
  plateObjects: PlateObject[];
  selectedPlateObjectId: string | null;

  // Slice state
  sliceProgress: SliceProgress;
  sliceResult: SliceResult | null;

  // Preview state
  previewMode: 'model' | 'preview';
  previewLayer: number;            // end layer (inclusive) — highest visible layer
  previewLayerStart: number;       // start layer (inclusive) — lowest visible layer
  previewLayerMax: number;
  previewShowTravel: boolean;
  previewShowRetractions: boolean;
  previewColorMode: 'type' | 'speed' | 'flow';
  previewHiddenTypes: string[];
  previewColorSchemeOpen: boolean;

  // Simulation (nozzle playback) state
  previewSimEnabled: boolean;      // show the virtual nozzle marker
  previewSimPlaying: boolean;
  previewSimSpeed: number;         // multiplier (1x, 2x, 5x, 10x, 25x)
  previewSimTime: number;          // seconds advanced through the toolpath

  // Printability analysis
  printabilityReport: import('../engine/PrintabilityCheck').PrintabilityReport | null;
  printabilityHighlight: boolean;

  // UI state
  settingsPanel: 'printer' | 'material' | 'print' | null;
  transformMode: 'move' | 'scale' | 'rotate' | 'mirror' | 'settings';

  // Getters (computed)
  getActivePrinterProfile: () => PrinterProfile;
  getActiveMaterialProfile: () => MaterialProfile;
  getActivePrintProfile: () => PrintProfile;

  // Profile management
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

  // Plate management
  addToPlate: (featureId: string, name: string, geometry: THREE.BufferGeometry | null | unknown) => void;
  removeFromPlate: (id: string) => void;
  selectPlateObject: (id: string | null) => void;
  updatePlateObject: (id: string, updates: Partial<PlateObject>) => void;
  autoArrange: () => void;
  clearPlate: () => void;
  importFileToPlate: (file: File) => Promise<void>;

  // Slicing
  startSlice: () => void;
  cancelSlice: () => void;
  setSliceProgress: (progress: SliceProgress) => void;

  // Preview
  setPreviewMode: (mode: 'model' | 'preview') => void;
  setPreviewLayer: (layer: number) => void;
  setPreviewLayerStart: (layer: number) => void;
  setPreviewLayerRange: (start: number, end: number) => void;
  setPreviewShowTravel: (show: boolean) => void;
  setPreviewShowRetractions: (show: boolean) => void;
  setPreviewColorMode: (mode: 'type' | 'speed' | 'flow') => void;
  togglePreviewType: (type: string) => void;
  setPreviewColorSchemeOpen: (open: boolean) => void;

  // Simulation
  setPreviewSimEnabled: (on: boolean) => void;
  setPreviewSimPlaying: (playing: boolean) => void;
  setPreviewSimSpeed: (speed: number) => void;
  setPreviewSimTime: (t: number) => void;
  advancePreviewSimTime: (deltaSeconds: number) => void;
  resetPreviewSim: () => void;

  // Printability
  runPrintabilityCheck: () => void;
  clearPrintabilityReport: () => void;
  setPrintabilityHighlight: (on: boolean) => void;

  // Export
  downloadGCode: () => void;
  sendToPrinter: () => Promise<void>;

  // UI
  setSettingsPanel: (panel: 'printer' | 'material' | 'print' | null) => void;
  setTransformMode: (mode: 'move' | 'scale' | 'rotate' | 'mirror' | 'settings') => void;
}

// =============================================================================
// Geometry serialization — THREE.BufferGeometry <-> plain JSON-safe object
// =============================================================================
// Only position and index are serialized — normals are recomputed on load,
// and UVs are not used by the slicer. This avoids 2–3× large Array.from
// copies that caused GC pauses and near-OOM on big meshes.
//
// partialize() runs on every zustand state update, so we cache the result in
// a WeakMap keyed on the geometry object. Array.from is only called once per
// geometry; subsequent calls are O(1) map lookups. The WeakMap entry is
// automatically collected when the geometry is GC'd.
const MAX_PERSIST_VERTS = 500_000;
const geomSerializeCache = new WeakMap<THREE.BufferGeometry, SerializedGeom | null>();

interface SerializedGeom {
  position: number[];
  index?: number[];
}

function serializeGeom(geom: THREE.BufferGeometry | null | undefined): SerializedGeom | null {
  if (!geom?.attributes?.position) return null;
  if (geomSerializeCache.has(geom)) return geomSerializeCache.get(geom)!;
  const posArray = geom.attributes.position.array as Float32Array;
  if (posArray.length / 3 > MAX_PERSIST_VERTS) {
    geomSerializeCache.set(geom, null);
    return null;
  }
  try {
    const out: SerializedGeom = {
      position: Array.from(posArray),
    };
    if (geom.index) out.index = Array.from(geom.index.array as Uint16Array | Uint32Array);
    geomSerializeCache.set(geom, out);
    return out;
  } catch {
    geomSerializeCache.set(geom, null);
    return null;
  }
}

function isBufferGeometry(geometry: unknown): geometry is THREE.BufferGeometry {
  if (geometry instanceof THREE.BufferGeometry) return true;
  return !!geometry &&
    typeof geometry === 'object' &&
    (geometry as { isBufferGeometry?: boolean }).isBufferGeometry === true;
}

function deserializeGeom(data: SerializedGeom): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(data.position, 3));
  if (data.index) g.setIndex(new THREE.BufferAttribute(new Uint32Array(data.index), 1));
  g.computeVertexNormals();
  g.computeBoundingBox();
  return g;
}

// =============================================================================
// IndexedDB storage adapter (no 5 MB limit — handles large geometry arrays)
// =============================================================================
function openSlicerDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('dzign3d-slicer', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

const idbStorage = {
  getItem: async (name: string): Promise<string | null> => {
    try {
      const db = await openSlicerDB();
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
      const db = await openSlicerDB();
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
      const db = await openSlicerDB();
      // Wait for the delete transaction to commit before closing the db —
      // synchronous close after .delete() can abort the tx so the value
      // silently persists.
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').delete(name);
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror    = () => { db.close(); reject(tx.error); };
      });
    } catch { /* ignore */ }
  },
};

// =============================================================================
// Persistent Web Worker — created once, reused across slice operations
// =============================================================================

// Lazily created on the first startSlice call.
let slicerWorker: Worker | null = null;
let activeSliceRequestId = 0;

function getSlicerWorker(onMessage: (e: MessageEvent) => void): Worker {
  if (!slicerWorker) {
    slicerWorker = new Worker(
      new URL('../workers/SlicerWorker.ts', import.meta.url),
      { type: 'module' },
    );
  }
  // Re-attach the handler each time so the latest `set` closure is captured.
  slicerWorker.onmessage = onMessage;
  return slicerWorker;
}

// Kept so cancelSlice can forward the signal to the worker.
let workerBusy = false;

export const useSlicerStore = create<SlicerStore>()(persist((set, get) => ({
  // Profiles — rehydrated from IDB on load; defaults used only on fresh install
  printerProfiles: DEFAULT_PRINTER_PROFILES,
  materialProfiles: DEFAULT_MATERIAL_PROFILES,
  printProfiles: DEFAULT_PRINT_PROFILES,

  // Active selections — rehydrated from IDB; defaults used only on fresh install
  activePrinterProfileId: DEFAULT_PRINTER_PROFILES[0]?.id ?? '',
  activeMaterialProfileId: DEFAULT_MATERIAL_PROFILES[0]?.id ?? '',
  activePrintProfileId: DEFAULT_PRINT_PROFILES[0]?.id ?? '',

  printerLastMaterial: {},
  printerLastPrint: {},

  // Plate objects
  plateObjects: [],
  selectedPlateObjectId: null,

  // Slice state
  sliceProgress: {
    stage: 'idle',
    percent: 0,
    currentLayer: 0,
    totalLayers: 0,
    message: '',
  },
  sliceResult: null,

  // Preview state
  previewMode: 'model',
  previewLayer: 0,
  previewLayerStart: 0,
  previewLayerMax: 0,
  previewShowTravel: false,
  previewShowRetractions: true,
  previewColorMode: 'type',
  previewHiddenTypes: [],
  previewColorSchemeOpen: false,

  // Simulation
  previewSimEnabled: false,
  previewSimPlaying: false,
  previewSimSpeed: 5,
  previewSimTime: 0,

  // Printability
  printabilityReport: null,
  printabilityHighlight: true,

  // UI state
  settingsPanel: null,
  transformMode: 'move',

  // --- Getters ---

  getActivePrinterProfile: () => {
    const { printerProfiles, activePrinterProfileId } = get();
    return printerProfiles.find((p) => p.id === activePrinterProfileId) ?? printerProfiles[0];
  },

  getActiveMaterialProfile: () => {
    const { materialProfiles, activeMaterialProfileId } = get();
    return materialProfiles.find((p) => p.id === activeMaterialProfileId) ?? materialProfiles[0];
  },

  getActivePrintProfile: () => {
    const { printProfiles, activePrintProfileId } = get();
    return printProfiles.find((p) => p.id === activePrintProfileId) ?? printProfiles[0];
  },

  // --- Profile management ---

  setActivePrinterProfile: (id) => {
    const state = get();
    // Restore this printer's last-used material and print profiles
    const printerMaterials = state.materialProfiles.filter(
      (m) => (m.printerId ?? DEFAULT_PRINTER_PROFILES[0]?.id) === id,
    );
    const printerPrints = state.printProfiles.filter(
      (p) => (p.printerId ?? DEFAULT_PRINTER_PROFILES[0]?.id) === id,
    );
    const materialId = state.printerLastMaterial[id] ?? printerMaterials[0]?.id ?? state.activeMaterialProfileId;
    const printId = state.printerLastPrint[id] ?? printerPrints[0]?.id ?? state.activePrintProfileId;
    set({ activePrinterProfileId: id, activeMaterialProfileId: materialId, activePrintProfileId: printId });
  },

  setActiveMaterialProfile: (id) => {
    const state = get();
    set({
      activeMaterialProfileId: id,
      printerLastMaterial: { ...state.printerLastMaterial, [state.activePrinterProfileId]: id },
    });
  },

  setActivePrintProfile: (id) => {
    const state = get();
    set({
      activePrintProfileId: id,
      printerLastPrint: { ...state.printerLastPrint, [state.activePrinterProfileId]: id },
    });
  },

  addPrinterProfile: (profile) => set((state) => ({
    printerProfiles: [...state.printerProfiles, profile],
  })),

  updatePrinterProfile: (id, updates) => set((state) => ({
    printerProfiles: state.printerProfiles.map((p) =>
      p.id === id ? { ...p, ...updates } : p
    ),
  })),

  deletePrinterProfile: (id) => set((state) => {
    const filtered = state.printerProfiles.filter((p) => p.id !== id);
    const newState: Partial<SlicerStore> = {
      printerProfiles: filtered,
      materialProfiles: state.materialProfiles.filter((m) => m.printerId !== id),
      printProfiles: state.printProfiles.filter((p) => p.printerId !== id),
    };
    if (state.activePrinterProfileId === id && filtered.length > 0) {
      newState.activePrinterProfileId = filtered[0].id;
    }
    return newState;
  }),

  createPrinterWithDefaults: (name) => {
    const printerId = `printer-${Date.now()}`;
    const materialId = `${printerId}-pla`;
    const printId = `${printerId}-standard`;
    const defaultPrint = DEFAULT_PRINT_PROFILES[0];
    const newPrinter: PrinterProfile = {
      id: printerId,
      name,
      buildVolume: { x: 220, y: 220, z: 250 },
      nozzleDiameter: 0.4,
      nozzleCount: 1,
      filamentDiameter: 1.75,
      hasHeatedBed: true,
      hasHeatedChamber: false,
      maxNozzleTemp: 280,
      maxBedTemp: 110,
      maxSpeed: 200,
      maxAcceleration: 2000,
      originCenter: false,
      gcodeFlavorType: 'marlin',
      startGCode: 'G28 ; Home all axes\nG29 ; Bed leveling\n',
      endGCode: 'M104 S0 ; Turn off hotend\nM140 S0 ; Turn off bed\nG28 X0 ; Park\n',
    };
    const newMaterial: MaterialProfile = {
      id: materialId,
      printerId,
      name: 'PLA',
      type: 'PLA',
      color: '#4fc3f7',
      nozzleTemp: 210,
      nozzleTempFirstLayer: 215,
      bedTemp: 60,
      bedTempFirstLayer: 65,
      chamberTemp: 0,
      fanSpeedMin: 100,
      fanSpeedMax: 100,
      fanDisableFirstLayers: 1,
      retractionDistance: 0.8,
      retractionSpeed: 45,
      retractionZHop: 0,
      flowRate: 1.0,
      density: 1.24,
      costPerKg: 20,
    };
    const newPrint: PrintProfile = { ...defaultPrint, id: printId, printerId, name: 'Standard Quality' };
    set((state) => ({
      printerProfiles: [...state.printerProfiles, newPrinter],
      materialProfiles: [...state.materialProfiles, newMaterial],
      printProfiles: [...state.printProfiles, newPrint],
      activePrinterProfileId: printerId,
      activeMaterialProfileId: materialId,
      activePrintProfileId: printId,
      printerLastMaterial: { ...state.printerLastMaterial, [printerId]: materialId },
      printerLastPrint: { ...state.printerLastPrint, [printerId]: printId },
    }));
  },

  addMaterialProfile: (profile) => set((state) => ({
    materialProfiles: [...state.materialProfiles, profile],
  })),

  updateMaterialProfile: (id, updates) => set((state) => ({
    materialProfiles: state.materialProfiles.map((p) =>
      p.id === id ? { ...p, ...updates } : p
    ),
  })),

  deleteMaterialProfile: (id) => set((state) => {
    const filtered = state.materialProfiles.filter((p) => p.id !== id);
    const newState: Partial<SlicerStore> = { materialProfiles: filtered };
    if (state.activeMaterialProfileId === id && filtered.length > 0) {
      newState.activeMaterialProfileId = filtered[0].id;
    }
    return newState;
  }),

  addPrintProfile: (profile) => set((state) => ({
    printProfiles: [...state.printProfiles, profile],
  })),

  updatePrintProfile: (id, updates) => set((state) => ({
    printProfiles: state.printProfiles.map((p) =>
      p.id === id ? { ...p, ...updates } : p
    ),
  })),

  deletePrintProfile: (id) => set((state) => {
    const filtered = state.printProfiles.filter((p) => p.id !== id);
    const newState: Partial<SlicerStore> = { printProfiles: filtered };
    if (state.activePrintProfileId === id && filtered.length > 0) {
      newState.activePrintProfileId = filtered[0].id;
    }
    return newState;
  }),

  // --- Plate management ---

  addToPlate: (featureId, name, geometry) => {
    // Compute bounding box from Three.js BufferGeometry
    const bbox = new THREE.Box3();
    if (isBufferGeometry(geometry)) {
      geometry.computeBoundingBox();
      if (geometry.boundingBox) {
        bbox.copy(geometry.boundingBox);
      }
    }

    // Guard: if bbox is still the empty default (Infinity / -Infinity) because
    // no geometry was provided, fall back to a neutral 10×10×10 placeholder so
    // BoxGeometry never receives Infinity/NaN args and loses the WebGL context.
    const isEmptyBbox = !isFinite(bbox.min.x) || !isFinite(bbox.max.x);
    const safeBbox = isEmptyBbox
      ? { min: { x: 0, y: 0, z: 0 }, max: { x: 10, y: 10, z: 10 } }
      : { min: { x: bbox.min.x, y: bbox.min.y, z: bbox.min.z }, max: { x: bbox.max.x, y: bbox.max.y, z: bbox.max.z } };

    const plateObject: PlateObject = {
      id: crypto.randomUUID(),
      featureId,
      name,
      geometry,
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      boundingBox: safeBbox,
    };

    set((state) => ({
      plateObjects: [...state.plateObjects, plateObject],
      selectedPlateObjectId: plateObject.id,
    }));

    // Auto-arrange after adding
    get().autoArrange();
  },

  removeFromPlate: (id) => set((state) => ({
    plateObjects: state.plateObjects.filter((o) => o.id !== id),
    selectedPlateObjectId: state.selectedPlateObjectId === id ? null : state.selectedPlateObjectId,
    // Invalidate slice result — it was computed for the old object set
    sliceResult: null,
    previewMode: 'model' as const,
    previewLayer: 0,
    previewLayerStart: 0,
    previewLayerMax: 0,
    previewSimEnabled: false,
    previewSimPlaying: false,
    previewSimTime: 0,
  })),

  selectPlateObject: (id) => set({ selectedPlateObjectId: id }),

  updatePlateObject: (id, updates) => set((state) => ({
    plateObjects: state.plateObjects.map((o) =>
      o.id === id ? { ...o, ...updates } : o
    ),
  })),

  autoArrange: () => {
    const { plateObjects, getActivePrinterProfile } = get();
    if (plateObjects.length === 0) return;

    const printer = getActivePrinterProfile();
    const bedWidth = printer?.buildVolume?.x ?? 220;
    const bedDepth = printer?.buildVolume?.y ?? 220;
    const spacing = 10; // mm gap between objects

    // ── Pass 1: compute scaled object dimensions and a grid layout ──────────
    // Grid cells are in local layout space (origin at top-left).
    // We will center the whole arrangement on the bed afterwards.

    type Cell = {
      obj: typeof plateObjects[0];
      gridX: number;  // left edge in layout space
      gridY: number;  // top  edge in layout space
      w: number;      // scaled width  (X)
      d: number;      // scaled depth  (Y)
      minX: number;   // geometry local bbox min (possibly scaled)
      minY: number;
      minZ: number;
    };

    const cells: Cell[] = [];
    let curX = 0;
    let curY = 0;
    let rowH = 0;
    let layoutW = 0;
    let layoutD = 0;

    for (const obj of plateObjects) {
      const sx = (obj.scale?.x ?? 1);
      const sy = (obj.scale?.y ?? 1);
      const sz = (obj.scale?.z ?? 1);

      const rawW = (obj.boundingBox.max.x - obj.boundingBox.min.x) * sx;
      const rawD = (obj.boundingBox.max.y - obj.boundingBox.min.y) * sy;
      const w = isFinite(rawW) && rawW > 0 ? rawW : 50;
      const d = isFinite(rawD) && rawD > 0 ? rawD : 50;

      const minX = isFinite(obj.boundingBox.min.x) ? obj.boundingBox.min.x * sx : 0;
      const minY = isFinite(obj.boundingBox.min.y) ? obj.boundingBox.min.y * sy : 0;
      const minZ = isFinite(obj.boundingBox.min.z) ? obj.boundingBox.min.z * sz : 0;

      // Wrap to next row if this object doesn't fit
      if (cells.length > 0 && curX + w > bedWidth) {
        layoutW = Math.max(layoutW, curX - spacing);
        curX = 0;
        curY += rowH + spacing;
        rowH = 0;
      }

      cells.push({ obj, gridX: curX, gridY: curY, w, d, minX, minY, minZ });

      curX += w + spacing;
      rowH = Math.max(rowH, d);
      layoutW = Math.max(layoutW, curX - spacing);
      layoutD = curY + rowH;
    }

    // ── Pass 2: center arrangement on bed ────────────────────────────────────
    const offsetX = (bedWidth  - layoutW) / 2;
    const offsetY = (bedDepth - layoutD) / 2;

    const arranged = cells.map(({ obj, gridX, gridY, minX, minY, minZ }) => ({
      ...obj,
      position: {
        x: offsetX + gridX - minX,
        y: offsetY + gridY - minY,
        z: -minZ, // lift bottom face to z = 0
      },
    }));

    set({ plateObjects: arranged });
  },

  clearPlate: () => set({
    plateObjects: [],
    selectedPlateObjectId: null,
    sliceResult: null,
    previewMode: 'model',
    previewLayer: 0,
    previewLayerStart: 0,
    previewLayerMax: 0,
    previewSimEnabled: false,
    previewSimPlaying: false,
    previewSimTime: 0,
  }),

  importFileToPlate: async (file: File) => {
    try {
      const { FileImporter } = await import('../engine/FileImporter');
      const group = await FileImporter.importFile(file);

      // Extract first mesh geometry from group
      let geometry: THREE.BufferGeometry | null = null;
      group.traverse((child) => {
        if (geometry) return;
        if ((child as THREE.Mesh).isMesh) {
          geometry = (child as THREE.Mesh).geometry as THREE.BufferGeometry;
        }
      });

      if (!geometry) {
        throw new Error('No mesh geometry found in file');
      }

      const geom = geometry as THREE.BufferGeometry;
      geom.computeBoundingBox();
      const bbox = geom.boundingBox ?? new THREE.Box3();
      const size = new THREE.Vector3();
      bbox.getSize(size);

      const plateObject = {
        id: crypto.randomUUID(),
        name: file.name.replace(/\.[^.]+$/, ''),
        geometry: geom,
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        boundingBox: {
          min: { x: bbox.min.x, y: bbox.min.y, z: bbox.min.z },
          max: { x: bbox.max.x, y: bbox.max.y, z: bbox.max.z },
        },
      };

      set((state) => ({
        plateObjects: [...state.plateObjects, plateObject],
        selectedPlateObjectId: plateObject.id,
      }));

      get().autoArrange();
    } catch (err) {
      console.error('File import failed:', err);
      throw err;
    }
  },

  // --- Slicing ---

  startSlice: () => {
    const state = get();
    if (state.plateObjects.length === 0) return;
    if (workerBusy) return; // re-entrancy guard

    const printerProfile = state.getActivePrinterProfile();
    const materialProfile = state.getActiveMaterialProfile();
    const printProfile = state.getActivePrintProfile();

    // Serialize geometry data on the main thread (THREE.BufferGeometry can't
    // cross the worker boundary directly). Typed arrays are copied, not
    // transferred, so the original geometries remain intact for rendering.
    // Per-object overrides ride alongside each geometry so the worker can
    // partition the plate into groups that share an effective profile.
    const geometryData: {
      positions: Float32Array;
      index: Uint32Array | null;
      transformElements: Float32Array;
      overrides?: Record<string, unknown>;
      objectName?: string;
    }[] = [];

    for (const obj of state.plateObjects) {
      if (!obj.geometry) continue;
      const geo = obj.geometry as THREE.BufferGeometry;
      const posAttr = geo.getAttribute('position');
      if (!posAttr) continue;

      const pos = (obj.position as { x: number; y: number; z?: number });
      const rot = normalizeRotationDegreesToRadians((obj as { rotation?: unknown }).rotation);
      const rawScl = normalizeScale((obj as { scale?: unknown }).scale);
      // Mirror flags bake into the scale so the slicer worker receives the
      // already-flipped geometry. An odd number of mirrors inverts the
      // transform's determinant, which in turn inverts triangle winding —
      // we fix that below so the slicer still sees outward-pointing normals.
      const mir = obj as { mirrorX?: boolean; mirrorY?: boolean; mirrorZ?: boolean };
      const mirrorCount = (mir.mirrorX ? 1 : 0) + (mir.mirrorY ? 1 : 0) + (mir.mirrorZ ? 1 : 0);
      const windingFlipped = mirrorCount % 2 === 1;
      const scl = {
        x: rawScl.x * (mir.mirrorX ? -1 : 1),
        y: rawScl.y * (mir.mirrorY ? -1 : 1),
        z: rawScl.z * (mir.mirrorZ ? -1 : 1),
      };
      const transform = new THREE.Matrix4().compose(
        new THREE.Vector3(pos.x, pos.y, pos.z ?? 0),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(rot.x, rot.y, rot.z)),
        new THREE.Vector3(scl.x, scl.y, scl.z),
      );

      const indexAttr = geo.getIndex();

      // Triangle winding fix: swap every other pair of vertex indices so the
      // triangle normal ends up pointing outward again after the mirror.
      // For indexed geometry we rebuild the index buffer; for non-indexed
      // geometry we swap positions (v1, v2) for each triangle directly.
      let positionsForWorker: Float32Array;
      let indexForWorker: Uint32Array | null;
      if (windingFlipped) {
        if (indexAttr) {
          positionsForWorker = new Float32Array(posAttr.array);
          const src = indexAttr.array as ArrayLike<number>;
          const dst = new Uint32Array(indexAttr.count);
          for (let t = 0; t < indexAttr.count; t += 3) {
            dst[t]     = src[t];
            dst[t + 1] = src[t + 2];
            dst[t + 2] = src[t + 1];
          }
          indexForWorker = dst;
        } else {
          // Non-indexed: copy positions and swap the 2nd / 3rd vertex of
          // every triangle in-place in the copy.
          const src = posAttr.array as ArrayLike<number>;
          const out = new Float32Array(src.length);
          for (let t = 0; t < posAttr.count; t += 3) {
            const base = t * 3;
            // v0 unchanged
            out[base + 0] = src[base + 0];
            out[base + 1] = src[base + 1];
            out[base + 2] = src[base + 2];
            // v1 <- original v2
            out[base + 3] = src[base + 6];
            out[base + 4] = src[base + 7];
            out[base + 5] = src[base + 8];
            // v2 <- original v1
            out[base + 6] = src[base + 3];
            out[base + 7] = src[base + 4];
            out[base + 8] = src[base + 5];
          }
          positionsForWorker = out;
          indexForWorker = null;
        }
      } else {
        positionsForWorker = new Float32Array(posAttr.array);
        indexForWorker = indexAttr ? new Uint32Array(indexAttr.array) : null;
      }

      const per = (obj as { perObjectSettings?: Record<string, unknown> }).perObjectSettings;
      const filteredOverrides = per && Object.keys(per).length > 0
        // Drop undefined entries — those represent "inherit global" and should
        // not override the profile.
        ? Object.fromEntries(Object.entries(per).filter(([, v]) => v !== undefined))
        : undefined;
      geometryData.push({
        positions: positionsForWorker,
        index: indexForWorker,
        transformElements: new Float32Array(transform.elements),
        overrides: filteredOverrides && Object.keys(filteredOverrides).length > 0 ? filteredOverrides : undefined,
        objectName: obj.name,
      });
    }

    if (geometryData.length === 0) {
      set({
        sliceProgress: {
          stage: 'error', percent: 0, currentLayer: 0, totalLayers: 0,
          message: 'No objects with geometry on the build plate.',
        },
      });
      return;
    }

    const requestId = ++activeSliceRequestId;

    set({
      sliceProgress: {
        stage: 'preparing', percent: 0, currentLayer: 0, totalLayers: 0,
        message: 'Sending geometry to slicer...',
      },
      sliceResult: null,
    });
    workerBusy = true;

    const worker = getSlicerWorker((e: MessageEvent) => {
      const { type, requestId: messageRequestId } = e.data as { type?: string; requestId?: number };
      if (messageRequestId !== requestId || requestId !== activeSliceRequestId) return;
      if (type === 'progress') {
        set({ sliceProgress: e.data.progress as SliceProgress });
      } else if (type === 'cancelled') {
        workerBusy = false;
      } else if (type === 'complete') {
        workerBusy = false;
        const result = e.data.result;
        set({
          sliceResult: result,
          sliceProgress: {
            stage: 'complete', percent: 100,
            currentLayer: result.layerCount, totalLayers: result.layerCount,
            message: `Slicing complete — ${result.layerCount} layers`,
          },
          previewMode: 'preview',
          previewLayer: result.layerCount - 1,
          previewLayerStart: 0,
          previewLayerMax: result.layerCount - 1,
          previewSimTime: 0,
          previewSimPlaying: false,
        });
      } else if (type === 'error') {
        workerBusy = false;
        set({
          sliceProgress: {
            stage: 'error', percent: 0, currentLayer: 0, totalLayers: 0,
            message: `Slicing failed: ${e.data.message}`,
          },
        });
      }
    });

    // Transfer typed arrays so the worker receives them without copying.
    const transferables: Transferable[] = geometryData.flatMap((g) => {
      const list: Transferable[] = [g.positions.buffer, g.transformElements.buffer];
      if (g.index) list.push(g.index.buffer);
      return list;
    });

    worker.postMessage(
      {
        type: 'slice',
        requestId,
        payload: { geometryData, printerProfile, materialProfile, printProfile },
      },
      transferables,
    );
  },

  cancelSlice: () => {
    const requestId = activeSliceRequestId;
    if (workerBusy && slicerWorker) {
      slicerWorker.postMessage({ type: 'cancel', requestId });
    }
    set({
      sliceProgress: {
        stage: 'idle', percent: 0, currentLayer: 0, totalLayers: 0,
        message: 'Slicing cancelled',
      },
    });
  },

  setSliceProgress: (progress) => set({ sliceProgress: progress }),

  // --- Preview ---

  setPreviewMode: (mode) => set({ previewMode: mode }),
  setPreviewLayer: (layer) => set((s) => ({
    previewLayer: Math.max(s.previewLayerStart, Math.min(layer, s.previewLayerMax)),
  })),
  setPreviewLayerStart: (layer) => set((s) => ({
    previewLayerStart: Math.max(0, Math.min(layer, s.previewLayer)),
  })),
  setPreviewLayerRange: (start, end) => set((s) => {
    const clampedStart = Math.max(0, Math.min(start, s.previewLayerMax));
    const clampedEnd = Math.max(clampedStart, Math.min(end, s.previewLayerMax));
    return { previewLayerStart: clampedStart, previewLayer: clampedEnd };
  }),
  setPreviewShowTravel: (show) => set({ previewShowTravel: show }),
  setPreviewShowRetractions: (show) => set({ previewShowRetractions: show }),
  setPreviewColorMode: (mode) => set({ previewColorMode: mode }),
  togglePreviewType: (type) => set((s) => ({
    previewHiddenTypes: s.previewHiddenTypes.includes(type)
      ? s.previewHiddenTypes.filter((t) => t !== type)
      : [...s.previewHiddenTypes, type],
  })),
  setPreviewColorSchemeOpen: (open) => set({ previewColorSchemeOpen: open }),

  // --- Simulation ---

  setPreviewSimEnabled: (on) => set((s) => ({
    previewSimEnabled: on,
    // Auto-pause when simulation is disabled.
    previewSimPlaying: on ? s.previewSimPlaying : false,
  })),
  setPreviewSimPlaying: (playing) => set({ previewSimPlaying: playing }),
  setPreviewSimSpeed: (speed) => set({ previewSimSpeed: Math.max(0.1, speed) }),
  setPreviewSimTime: (t) => set((s) => {
    const total = s.sliceResult?.printTime ?? 0;
    return { previewSimTime: Math.max(0, total > 0 ? Math.min(t, total) : t) };
  }),
  advancePreviewSimTime: (delta) => set((s) => {
    const total = s.sliceResult?.printTime ?? 0;
    let next = s.previewSimTime + delta;
    let playing = s.previewSimPlaying;
    if (total > 0 && next >= total) { next = total; playing = false; }
    return { previewSimTime: next, previewSimPlaying: playing };
  }),
  resetPreviewSim: () => set({ previewSimTime: 0, previewSimPlaying: false }),

  // --- Printability ---

  runPrintabilityCheck: async () => {
    const { checkPrintability } = await import('../engine/PrintabilityCheck');
    const s = get();
    const printer = s.getActivePrinterProfile();
    const print = s.getActivePrintProfile();
    if (!printer || !print) return;
    const report = checkPrintability(s.plateObjects, printer, print);
    set({ printabilityReport: report });
  },

  clearPrintabilityReport: () => set({ printabilityReport: null }),
  setPrintabilityHighlight: (on) => set({ printabilityHighlight: on }),

  // --- Export ---

  downloadGCode: () => {
    const { sliceResult } = get();
    if (!sliceResult?.gcode) return;

    const blob = new Blob([sliceResult.gcode], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'output.gcode';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },

  sendToPrinter: async () => {
    const { sliceResult } = get();
    if (!sliceResult?.gcode) return;

    const printerStore = usePrinterStore.getState();
    if (!printerStore.connected || !printerStore.service) {
      throw new Error('Printer not connected');
    }

    const filename = 'output.gcode';
    const blob = new Blob([sliceResult.gcode], { type: 'text/plain' });
    const file = new File([blob], filename, { type: 'text/plain' });

    await printerStore.uploadFile(file);
  },

  // --- UI ---

  setSettingsPanel: (panel) => set({ settingsPanel: panel }),
  setTransformMode: (mode) => set({ transformMode: mode }),
}),
{
  name: 'dzign3d-slicer-plate',
  storage: idbStorage as unknown as PersistStorage<SlicerStore, unknown>,

  partialize: ((state) => ({
    // Profiles — user-managed, must survive page reload
    printerProfiles: state.printerProfiles,
    materialProfiles: state.materialProfiles,
    printProfiles: state.printProfiles,

    // Active selections
    activePrinterProfileId: state.activePrinterProfileId,
    activeMaterialProfileId: state.activeMaterialProfileId,
    activePrintProfileId: state.activePrintProfileId,

    // Per-printer last-used profile memory
    printerLastMaterial: state.printerLastMaterial,
    printerLastPrint: state.printerLastPrint,

    // Plate objects (geometry serialized to plain JSON)
    plateObjects: state.plateObjects.map((obj) => ({
      ...obj,
      geometry: serializeGeom(obj.geometry),
    })),
    selectedPlateObjectId: state.selectedPlateObjectId,
    transformMode: state.transformMode,
  }) as unknown as SlicerStore) as (state: SlicerStore) => SlicerStore,

  onRehydrateStorage: () => (state) => {
    if (!state) return;

    // Restore plate geometry
    if (state.plateObjects) {
      state.plateObjects = state.plateObjects.map((obj) => ({
        ...obj,
        geometry: obj.geometry && !(obj.geometry instanceof THREE.BufferGeometry)
          ? deserializeGeom(obj.geometry as unknown as SerializedGeom)
          : obj.geometry,
      })) as PlateObject[];
    }

    // If IDB had no profiles (fresh install or cleared storage), fall back to
    // built-in defaults so the app is never left with an empty profile list.
    if (!state.printerProfiles?.length)  state.printerProfiles  = DEFAULT_PRINTER_PROFILES;
    if (!state.materialProfiles?.length) state.materialProfiles = DEFAULT_MATERIAL_PROFILES;
    if (!state.printProfiles?.length)    state.printProfiles    = DEFAULT_PRINT_PROFILES;

    // Ensure active IDs still point to existing profiles (they may have been
    // deleted in another session or the saved ID may predate a default-reset).
    const hasPrinter  = state.printerProfiles.some((p) => p.id === state.activePrinterProfileId);
    const hasMaterial = state.materialProfiles.some((m) => m.id === state.activeMaterialProfileId);
    const hasPrint    = state.printProfiles.some((p)    => p.id === state.activePrintProfileId);
    if (!hasPrinter)  state.activePrinterProfileId  = state.printerProfiles[0]?.id  ?? '';
    if (!hasMaterial) state.activeMaterialProfileId = state.materialProfiles[0]?.id ?? '';
    if (!hasPrint)    state.activePrintProfileId    = state.printProfiles[0]?.id    ?? '';
  },
}));
