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

const STORAGE_KEY = 'dzign3d-slicer-profiles';

interface SavedSelections {
  activePrinterProfileId: string;
  activeMaterialProfileId: string;
  activePrintProfileId: string;
}

function loadSavedSelections(): SavedSelections | null {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      return JSON.parse(saved);
    }
  } catch {
    // Invalid saved data, use defaults
  }
  return null;
}

function saveSelections(selections: SavedSelections): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(selections));
  } catch {
    // Storage unavailable
  }
}

interface SlicerStore {
  // Profiles
  printerProfiles: PrinterProfile[];
  materialProfiles: MaterialProfile[];
  printProfiles: PrintProfile[];

  // Active selections
  activePrinterProfileId: string;
  activeMaterialProfileId: string;
  activePrintProfileId: string;

  // Plate objects (models on build plate)
  plateObjects: PlateObject[];
  selectedPlateObjectId: string | null;

  // Slice state
  sliceProgress: SliceProgress;
  sliceResult: SliceResult | null;

  // Preview state
  previewMode: 'model' | 'preview';
  previewLayer: number;
  previewLayerMax: number;
  previewShowTravel: boolean;
  previewShowRetractions: boolean;
  previewColorMode: 'type' | 'speed' | 'flow';

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
  setPreviewShowTravel: (show: boolean) => void;
  setPreviewShowRetractions: (show: boolean) => void;
  setPreviewColorMode: (mode: 'type' | 'speed' | 'flow') => void;

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
interface SerializedGeom {
  position: number[];
  normal?: number[];
  uv?: number[];
  index?: number[];
}

function serializeGeom(geom: THREE.BufferGeometry | null | undefined): SerializedGeom | null {
  if (!geom?.attributes?.position) return null;
  try {
    const out: SerializedGeom = {
      position: Array.from(geom.attributes.position.array as Float32Array),
    };
    if (geom.attributes.normal) out.normal = Array.from(geom.attributes.normal.array as Float32Array);
    if (geom.attributes.uv)     out.uv     = Array.from(geom.attributes.uv.array as Float32Array);
    if (geom.index)              out.index  = Array.from(geom.index.array as Uint16Array | Uint32Array);
    return out;
  } catch { return null; }
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
  if (data.normal) g.setAttribute('normal', new THREE.Float32BufferAttribute(data.normal, 3));
  if (data.uv)     g.setAttribute('uv',     new THREE.Float32BufferAttribute(data.uv, 2));
  if (data.index)  g.setIndex(new THREE.BufferAttribute(new Uint32Array(data.index), 1));
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

const savedSelections = loadSavedSelections();

export const useSlicerStore = create<SlicerStore>()(persist((set, get) => ({
  // Profiles
  printerProfiles: DEFAULT_PRINTER_PROFILES,
  materialProfiles: DEFAULT_MATERIAL_PROFILES,
  printProfiles: DEFAULT_PRINT_PROFILES,

  // Active selections (restore from localStorage or default to first)
  activePrinterProfileId: savedSelections?.activePrinterProfileId ?? DEFAULT_PRINTER_PROFILES[0]?.id ?? '',
  activeMaterialProfileId: savedSelections?.activeMaterialProfileId ?? DEFAULT_MATERIAL_PROFILES[0]?.id ?? '',
  activePrintProfileId: savedSelections?.activePrintProfileId ?? DEFAULT_PRINT_PROFILES[0]?.id ?? '',

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
  previewLayerMax: 0,
  previewShowTravel: false,
  previewShowRetractions: true,
  previewColorMode: 'type',

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
    set({ activePrinterProfileId: id });
    const state = get();
    saveSelections({
      activePrinterProfileId: id,
      activeMaterialProfileId: state.activeMaterialProfileId,
      activePrintProfileId: state.activePrintProfileId,
    });
  },

  setActiveMaterialProfile: (id) => {
    set({ activeMaterialProfileId: id });
    const state = get();
    saveSelections({
      activePrinterProfileId: state.activePrinterProfileId,
      activeMaterialProfileId: id,
      activePrintProfileId: state.activePrintProfileId,
    });
  },

  setActivePrintProfile: (id) => {
    set({ activePrintProfileId: id });
    const state = get();
    saveSelections({
      activePrinterProfileId: state.activePrinterProfileId,
      activeMaterialProfileId: state.activeMaterialProfileId,
      activePrintProfileId: id,
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
    const newState: Partial<SlicerStore> = { printerProfiles: filtered };
    // If we deleted the active profile, select the first remaining
    if (state.activePrinterProfileId === id && filtered.length > 0) {
      newState.activePrinterProfileId = filtered[0].id;
    }
    return newState;
  }),

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
    previewLayerMax: 0,
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
    const geometryData: {
      positions: Float32Array;
      index: Uint32Array | null;
      transformElements: Float32Array;
    }[] = [];

    for (const obj of state.plateObjects) {
      if (!obj.geometry) continue;
      const geo = obj.geometry as THREE.BufferGeometry;
      const posAttr = geo.getAttribute('position');
      if (!posAttr) continue;

      const pos = (obj.position as { x: number; y: number; z?: number });
      const rot = normalizeRotationDegreesToRadians((obj as { rotation?: unknown }).rotation);
      const scl = normalizeScale((obj as { scale?: unknown }).scale);
      const transform = new THREE.Matrix4().compose(
        new THREE.Vector3(pos.x, pos.y, pos.z ?? 0),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(rot.x, rot.y, rot.z)),
        new THREE.Vector3(scl.x, scl.y, scl.z),
      );

      const indexAttr = geo.getIndex();
      geometryData.push({
        positions: new Float32Array(posAttr.array),
        index: indexAttr ? new Uint32Array(indexAttr.array) : null,
        transformElements: new Float32Array(transform.elements),
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

    set({
      sliceProgress: {
        stage: 'preparing', percent: 0, currentLayer: 0, totalLayers: 0,
        message: 'Sending geometry to slicer...',
      },
      sliceResult: null,
    });
    workerBusy = true;

    const worker = getSlicerWorker((e: MessageEvent) => {
      const { type } = e.data;
      if (type === 'progress') {
        set({ sliceProgress: e.data.progress as SliceProgress });
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
          previewLayerMax: result.layerCount - 1,
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
      { type: 'slice', payload: { geometryData, printerProfile, materialProfile, printProfile } },
      transferables,
    );
  },

  cancelSlice: () => {
    if (workerBusy && slicerWorker) {
      slicerWorker.postMessage({ type: 'cancel' });
      workerBusy = false;
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
  setPreviewLayer: (layer) => set({ previewLayer: layer }),
  setPreviewShowTravel: (show) => set({ previewShowTravel: show }),
  setPreviewShowRetractions: (show) => set({ previewShowRetractions: show }),
  setPreviewColorMode: (mode) => set({ previewColorMode: mode }),

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

  // Only persist plate-related state — not ephemeral slice/preview/progress state
  partialize: ((state) => ({
    plateObjects: state.plateObjects.map((obj) => ({
      ...obj,
      // Serialize THREE.BufferGeometry to a plain JSON-safe object
      geometry: serializeGeom(obj.geometry),
    })),
    selectedPlateObjectId: state.selectedPlateObjectId,
    transformMode: state.transformMode,
  }) as unknown as SlicerStore) as (state: SlicerStore) => SlicerStore,

  // After loading from IDB, reconstruct BufferGeometry objects
  onRehydrateStorage: () => (state) => {
    if (!state?.plateObjects) return;
    state.plateObjects = state.plateObjects.map((obj) => ({
      ...obj,
      geometry: obj.geometry && !(obj.geometry instanceof THREE.BufferGeometry)
        ? deserializeGeom(obj.geometry as unknown as SerializedGeom)
        : obj.geometry,
    })) as PlateObject[];
  },
}));
