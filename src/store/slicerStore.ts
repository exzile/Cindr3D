import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import * as THREE from 'three';
import type {
  PrinterProfile, MaterialProfile, PrintProfile,
  SliceProgress,
} from '../types/slicer';
import {
  DEFAULT_PRINTER_PROFILES, DEFAULT_MATERIAL_PROFILES, DEFAULT_PRINT_PROFILES,
} from '../types/slicer';
import { createProfilePatchForKey, getProfileValue } from '../utils/profileDiff';
import { normalizeRotationDegreesToRadians, normalizeScale } from '../utils/slicerTransforms';
import { createPreviewActions } from './slicer/actions/preview';
import { slicerPersistConfig } from './slicer/persistConfig';
import { createPlateActions } from './slicer/plateActions';
import type { ProfileSnapshot, ProfileSnapshotKind, ProfileSnapshotProfile, SlicerStore } from './slicer/types';
import { getActiveSliceRequestId, getCurrentSlicerWorker, getSlicerWorker, isWorkerBusy, nextSliceRequestId, resetSlicerWorker, setWorkerBusy } from './slicer/worker';
import type { PaintedZSeamHint } from '../types/slicer/profiles/print';

export type { SlicerStore } from './slicer/types';

const MAX_PROFILE_SNAPSHOTS_PER_PROFILE = 25;

function transformPaintedZSeamHints(overrides: Record<string, unknown> | undefined, transform: THREE.Matrix4): Record<string, unknown> | undefined {
  const rawHints = overrides?.zSeamPaintHints;
  if (!Array.isArray(rawHints)) return overrides;
  const transformedHints = rawHints.map((hint): unknown => {
    if (!hint || typeof hint !== 'object') return hint;
    const seamHint = hint as PaintedZSeamHint;
    if (seamHint.coordinateSpace !== 'object') return seamHint;
    const point = new THREE.Vector3(seamHint.x, seamHint.y, seamHint.z ?? 0).applyMatrix4(transform);
    return {
      ...seamHint,
      x: point.x,
      y: point.y,
      z: point.z,
      coordinateSpace: 'world',
    };
  });
  return { ...overrides, zSeamPaintHints: transformedHints };
}

function cloneProfile<T extends ProfileSnapshotProfile>(profile: T): T {
  if (typeof structuredClone === 'function') return structuredClone(profile);
  return JSON.parse(JSON.stringify(profile)) as T;
}

function createProfileSnapshot<T extends ProfileSnapshotProfile>(
  kind: ProfileSnapshotKind,
  profile: T,
): ProfileSnapshot {
  const idSuffix = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return {
    id: `${kind}-${profile.id}-${idSuffix}`,
    kind,
    profileId: profile.id,
    profileName: profile.name,
    createdAt: Date.now(),
    profile: cloneProfile(profile),
  };
}

function appendProfileSnapshot(
  snapshots: ProfileSnapshot[],
  snapshot: ProfileSnapshot,
): ProfileSnapshot[] {
  const matching = snapshots
    .filter((entry) => entry.kind === snapshot.kind && entry.profileId === snapshot.profileId)
    .concat(snapshot)
    .slice(-MAX_PROFILE_SNAPSHOTS_PER_PROFILE);
  const unrelated = snapshots.filter(
    (entry) => entry.kind !== snapshot.kind || entry.profileId !== snapshot.profileId,
  );
  return [...unrelated, ...matching];
}

export const useSlicerStore = create<SlicerStore>()(persist((set, get) => ({
  // Profiles — rehydrated from IDB on load; defaults used only on fresh install
  printerProfiles: DEFAULT_PRINTER_PROFILES,
  materialProfiles: DEFAULT_MATERIAL_PROFILES,
  printProfiles: DEFAULT_PRINT_PROFILES,
  profileSnapshots: [],

  // Active selections — rehydrated from IDB; defaults used only on fresh install
  activePrinterProfileId: DEFAULT_PRINTER_PROFILES[0]?.id ?? '',
  activeMaterialProfileId: DEFAULT_MATERIAL_PROFILES[0]?.id ?? '',
  activePrintProfileId: DEFAULT_PRINT_PROFILES[0]?.id ?? '',

  printerLastMaterial: {},
  printerLastPrint: {},

  // Plate objects
  plateObjects: [],
  selectedPlateObjectId: null,
  additionalSelectedIds: [],
  plateHistory: [],
  plateFuture: [],
  activeBedMesh: null,

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
  // Off by default — retraction markers are mostly debug/noise on a
  // typical bottom-skin or dense-infill layer where every scanline-to-
  // scanline travel can trigger a retract. Cura/Orca preview viewers
  // also default this off; users opt in via the colour-scheme panel.
  previewShowRetractions: false,
  previewSectionEnabled: false,
  previewSectionZ: 250,
  previewColorMode: 'type',
  previewRenderMode: 'solid',
  previewHiddenTypes: [],
  previewColorSchemeOpen: false,
  previewGCodeOpen: false,

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
  viewportPickMode: 'none',
  measurePoints: [],

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

  updatePrinterProfile: (id, updates) => set((state) => {
    const currentProfile = state.printerProfiles.find((profile) => profile.id === id);
    return {
      printerProfiles: state.printerProfiles.map((p) =>
        p.id === id ? { ...p, ...updates } : p
      ),
      profileSnapshots: currentProfile
        ? appendProfileSnapshot(state.profileSnapshots, createProfileSnapshot('printer', currentProfile))
        : state.profileSnapshots,
    };
  }),

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

  updateMaterialProfile: (id, updates) => set((state) => {
    const currentProfile = state.materialProfiles.find((profile) => profile.id === id);
    return {
      materialProfiles: state.materialProfiles.map((p) =>
        p.id === id ? { ...p, ...updates } : p
      ),
      profileSnapshots: currentProfile
        ? appendProfileSnapshot(state.profileSnapshots, createProfileSnapshot('material', currentProfile))
        : state.profileSnapshots,
    };
  }),

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

  updatePrintProfile: (id, updates) => set((state) => {
    const currentProfile = state.printProfiles.find((profile) => profile.id === id);
    return {
      printProfiles: state.printProfiles.map((p) =>
        p.id === id ? { ...p, ...updates } : p
      ),
      profileSnapshots: currentProfile
        ? appendProfileSnapshot(state.profileSnapshots, createProfileSnapshot('print', currentProfile))
        : state.profileSnapshots,
    };
  }),

  deletePrintProfile: (id) => set((state) => {
    const filtered = state.printProfiles.filter((p) => p.id !== id);
    const newState: Partial<SlicerStore> = { printProfiles: filtered };
    if (state.activePrintProfileId === id && filtered.length > 0) {
      newState.activePrintProfileId = filtered[0].id;
    }
    return newState;
  }),

  restoreProfileSnapshot: (snapshotId) => set((state) => {
    const snapshot = state.profileSnapshots.find((entry) => entry.id === snapshotId);
    if (!snapshot) return {};
    if (snapshot.kind === 'printer') {
      const currentProfile = state.printerProfiles.find((profile) => profile.id === snapshot.profileId);
      return {
        printerProfiles: state.printerProfiles.map((profile) =>
          profile.id === snapshot.profileId ? cloneProfile(snapshot.profile as PrinterProfile) : profile
        ),
        profileSnapshots: currentProfile
          ? appendProfileSnapshot(state.profileSnapshots, createProfileSnapshot('printer', currentProfile))
          : state.profileSnapshots,
      };
    }
    if (snapshot.kind === 'material') {
      const currentProfile = state.materialProfiles.find((profile) => profile.id === snapshot.profileId);
      return {
        materialProfiles: state.materialProfiles.map((profile) =>
          profile.id === snapshot.profileId ? cloneProfile(snapshot.profile as MaterialProfile) : profile
        ),
        profileSnapshots: currentProfile
          ? appendProfileSnapshot(state.profileSnapshots, createProfileSnapshot('material', currentProfile))
          : state.profileSnapshots,
      };
    }
    const currentProfile = state.printProfiles.find((profile) => profile.id === snapshot.profileId);
    return {
      printProfiles: state.printProfiles.map((profile) =>
        profile.id === snapshot.profileId ? cloneProfile(snapshot.profile as PrintProfile) : profile
      ),
      profileSnapshots: currentProfile
        ? appendProfileSnapshot(state.profileSnapshots, createProfileSnapshot('print', currentProfile))
        : state.profileSnapshots,
    };
  }),

  restoreProfileSnapshotKey: (snapshotId, keyPath) => set((state) => {
    const snapshot = state.profileSnapshots.find((entry) => entry.id === snapshotId);
    if (!snapshot) return {};
    const value = getProfileValue(snapshot.profile, keyPath);
    if (snapshot.kind === 'printer') {
      const currentProfile = state.printerProfiles.find((profile) => profile.id === snapshot.profileId);
      if (!currentProfile) return {};
      const patch = createProfilePatchForKey(currentProfile, keyPath, value);
      return {
        printerProfiles: state.printerProfiles.map((profile) =>
          profile.id === snapshot.profileId ? { ...profile, ...patch } : profile
        ),
        profileSnapshots: appendProfileSnapshot(state.profileSnapshots, createProfileSnapshot('printer', currentProfile)),
      };
    }
    if (snapshot.kind === 'material') {
      const currentProfile = state.materialProfiles.find((profile) => profile.id === snapshot.profileId);
      if (!currentProfile) return {};
      const patch = createProfilePatchForKey(currentProfile, keyPath, value);
      return {
        materialProfiles: state.materialProfiles.map((profile) =>
          profile.id === snapshot.profileId ? { ...profile, ...patch } : profile
        ),
        profileSnapshots: appendProfileSnapshot(state.profileSnapshots, createProfileSnapshot('material', currentProfile)),
      };
    }
    const currentProfile = state.printProfiles.find((profile) => profile.id === snapshot.profileId);
    if (!currentProfile) return {};
    const patch = createProfilePatchForKey(currentProfile, keyPath, value);
    return {
      printProfiles: state.printProfiles.map((profile) =>
        profile.id === snapshot.profileId ? { ...profile, ...patch } : profile
      ),
      profileSnapshots: appendProfileSnapshot(state.profileSnapshots, createProfileSnapshot('print', currentProfile)),
    };
  }),

  // --- Plate management ---

  ...createPlateActions({ set, get }),

  setActiveBedMesh: (mesh) => set({ activeBedMesh: mesh }),

  // --- Slicing ---

  startSlice: () => {
    const state = get();
    if (state.plateObjects.length === 0) return;
    if (isWorkerBusy()) return; // re-entrancy guard

    const printerProfile = state.getActivePrinterProfile();
    const materialProfile = state.getActiveMaterialProfile();
    const printProfile = state.getActivePrintProfile();

    // Serialize geometry data on the main thread (THREE.BufferGeometry can't
    // cross the worker boundary directly). Typed arrays are copied, not
    // transferred, so the original geometries remain intact for rendering.
    // Per-object overrides ride alongside each geometry so the worker can
    // partition the plate into groups that share an effective profile.
    // Modifier meshes (cutting / infill / support / anti-overhang) carry
    // their `modifierMeshRole` / `modifierMeshSettings` through to the
    // worker, where the slicer applies their volume per-layer via 2D
    // boolean ops — no AABB heuristics here.
    const geometryData: {
      positions: Float32Array;
      index: Uint32Array | null;
      transformElements: Float32Array;
      overrides?: Record<string, unknown>;
      objectName?: string;
      modifierMeshRole?: typeof state.plateObjects[number]['modifierMeshRole'];
      modifierMeshSettings?: Record<string, unknown>;
    }[] = [];

    for (const obj of state.plateObjects) {
      if (obj.hidden) continue;
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
      let transform = new THREE.Matrix4().compose(
        new THREE.Vector3(pos.x, pos.y, pos.z ?? 0),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(rot.x, rot.y, rot.z)),
        new THREE.Vector3(scl.x, scl.y, scl.z),
      );
      if (obj.modifierMeshRole && obj.modifierMeshRole !== 'normal' && obj.modifierSourceObjectId && obj.modifierSourceLocalPoint) {
        const source = state.plateObjects.find((candidate) => candidate.id === obj.modifierSourceObjectId);
        if (source) {
          const sourcePos = (source.position as { x: number; y: number; z?: number });
          const sourceRot = normalizeRotationDegreesToRadians((source as { rotation?: unknown }).rotation);
          const sourceRawScale = normalizeScale((source as { scale?: unknown }).scale);
          const sourceMir = source as { mirrorX?: boolean; mirrorY?: boolean; mirrorZ?: boolean };
          const sourceScale = new THREE.Vector3(
            sourceRawScale.x * (sourceMir.mirrorX ? -1 : 1),
            sourceRawScale.y * (sourceMir.mirrorY ? -1 : 1),
            sourceRawScale.z * (sourceMir.mirrorZ ? -1 : 1),
          );
          const sourceMatrix = new THREE.Matrix4().compose(
            new THREE.Vector3(sourcePos.x, sourcePos.y, sourcePos.z ?? 0),
            new THREE.Quaternion().setFromEuler(new THREE.Euler(sourceRot.x, sourceRot.y, sourceRot.z)),
            sourceScale,
          );
          const anchoredPoint = new THREE.Vector3(
            obj.modifierSourceLocalPoint.x,
            obj.modifierSourceLocalPoint.y,
            obj.modifierSourceLocalPoint.z,
          ).applyMatrix4(sourceMatrix);
          transform = new THREE.Matrix4().compose(
            anchoredPoint,
            new THREE.Quaternion().setFromEuler(new THREE.Euler(sourceRot.x, sourceRot.y, sourceRot.z)),
            sourceScale,
          );
        }
      }

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

      const isModifier = !!obj.modifierMeshRole && obj.modifierMeshRole !== 'normal';
      // Per-object overrides apply only to printable meshes. Modifier
      // meshes carry their role-specific settings via `modifierMeshSettings`
      // instead — those are NOT profile-level overrides; they're consumed
      // when the slicer processes the modifier's volume per-layer.
      const per = (obj as { perObjectSettings?: Record<string, unknown> }).perObjectSettings;
      const filteredOverrides = !isModifier && per && Object.keys(per).length > 0
        // Drop undefined entries — those represent "inherit global" and should
        // not override the profile.
        ? Object.fromEntries(Object.entries(per).filter(([, v]) => v !== undefined))
        : undefined;
      const transformedOverrides = transformPaintedZSeamHints(filteredOverrides, transform);

      const modifierMeshSettings = isModifier && obj.modifierMeshSettings
        ? Object.fromEntries(Object.entries(obj.modifierMeshSettings).filter(([, v]) => v !== undefined))
        : undefined;

      geometryData.push({
        positions: positionsForWorker,
        index: indexForWorker,
        transformElements: new Float32Array(transform.elements),
        overrides: transformedOverrides && Object.keys(transformedOverrides).length > 0 ? transformedOverrides : undefined,
        objectName: obj.name,
        modifierMeshRole: obj.modifierMeshRole,
        modifierMeshSettings: modifierMeshSettings && Object.keys(modifierMeshSettings).length > 0 ? modifierMeshSettings : undefined,
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
    if (!geometryData.some((g) => !g.modifierMeshRole || g.modifierMeshRole === 'normal')) {
      set({
        sliceProgress: {
          stage: 'error', percent: 0, currentLayer: 0, totalLayers: 0,
          message: 'No printable meshes on the plate — modifier meshes need a printable to modify.',
        },
      });
      return;
    }

    const requestId = nextSliceRequestId();

    set({
      sliceProgress: {
        stage: 'preparing', percent: 0, currentLayer: 0, totalLayers: 0,
        message: 'Sending geometry to slicer...',
      },
      sliceResult: null,
    });
    setWorkerBusy(true);

    const worker = getSlicerWorker((e: MessageEvent) => {
      const { type, requestId: messageRequestId } = e.data as { type?: string; requestId?: number };
      if (messageRequestId !== requestId || requestId !== getActiveSliceRequestId()) return;
      if (type === 'progress') {
        set({ sliceProgress: e.data.progress as SliceProgress });
      } else if (type === 'cancelled') {
        setWorkerBusy(false);
      } else if (type === 'complete') {
        setWorkerBusy(false);
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
        setWorkerBusy(false);
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
    const requestId = getActiveSliceRequestId();
    const worker = getCurrentSlicerWorker();
    if (isWorkerBusy() && worker) {
      worker.postMessage({ type: 'cancel', requestId });
    }
    // Bump the active slice request id NOW so any in-flight messages
    // from the cancelled slice (progress updates, a `complete` posted
    // before the worker's `onmessage` got around to the cancel) are
    // discarded by the requestId guard in the message handler. Without
    // this, the worker's tail-end completion can race the cancel and
    // overwrite the UI back to "Slicing complete" / show the partially-
    // sliced result, making it look like cancel didn't work.
    nextSliceRequestId();
    setWorkerBusy(false);
    set({
      sliceProgress: {
        stage: 'idle', percent: 0, currentLayer: 0, totalLayers: 0,
        message: 'Slicing cancelled',
      },
    });
    // Belt-and-suspenders: if the worker is stuck in a tight sync loop
    // and our `cancel` message never gets processed, the user is owed
    // a working "next slice" anyway. Force-reset the worker so the next
    // `startSlice()` spawns a fresh one. The terminate also frees any
    // WASM memory held by the cancelled run.
    resetSlicerWorker();
  },

  /**
   * Force the slicer worker to be torn down and respawned on the next
   * slice. The store also clears the cached `sliceResult` so the
   * preview won't show stale geometry from the killed worker.
   *
   * Use cases:
   *   • Dev: a backstop in case the URL-mismatch + HMR auto-dispose in
   *     `worker.ts` ever miss an edge case (worker source change that
   *     somehow doesn't update Vite's URL hash).
   *   • Prod: lets users recover from a worker that hangs or appears
   *     to use stale state, without forcing a full page reload.
   */
  reloadSlicerWorker: () => {
    resetSlicerWorker();
    set({
      sliceResult: null,
      sliceProgress: {
        stage: 'idle', percent: 0, currentLayer: 0, totalLayers: 0,
        message: 'Slicer worker reloaded — slice again to regenerate moves',
      },
    });
  },

  setSliceProgress: (progress) => set({ sliceProgress: progress }),

  ...createPreviewActions({ set, get }),
}), slicerPersistConfig as Parameters<typeof persist<SlicerStore>>[1]));
