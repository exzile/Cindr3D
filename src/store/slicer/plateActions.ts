import * as THREE from 'three';
import type { StoreApi } from 'zustand';
import type { ModifierMeshRole, PlateObject } from '../../types/slicer';
import { isBufferGeometry } from './persistence';
import type { SlicerStore } from '../slicerStore';

const PLATE_HISTORY_LIMIT = 30;

type PlateActionSlice = Pick<
  SlicerStore,
  | 'addToPlate'
  | 'addPaintedModifierMesh'
  | 'removeFromPlate'
  | 'selectPlateObject'
  | 'togglePlateObjectInSelection'
  | 'selectPlateObjectRange'
  | 'clearPlateSelection'
  | 'getSelectedIds'
  | 'updatePlateObject'
  | 'duplicatePlateObject'
  | 'duplicateSelectedPlateObjects'
  | 'layFlatPlateObject'
  | 'layFlatByFace'
  | 'autoOrientPlateObject'
  | 'dropToBedPlateObject'
  | 'centerPlateObject'
  | 'scaleToHeight'
  | 'reorderPlateObjects'
  | 'resolveOverlapForObject'
  | 'hollowPlateObject'
  | 'cutPlateObjectByPlane'
  | 'removeSelectedPlateObjects'
  | 'undoPlate'
  | 'redoPlate'
  | 'pushPlateHistory'
  | 'exportPlateJson'
  | 'importPlateJson'
  | 'autoArrange'
  | 'clearPlate'
  | 'importFileToPlate'
>;

function bboxFromGeometry(geometry: unknown): { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } } {
  const bbox = new THREE.Box3();
  if (isBufferGeometry(geometry)) {
    geometry.computeBoundingBox();
    if (geometry.boundingBox) bbox.copy(geometry.boundingBox);
  }
  const empty = !isFinite(bbox.min.x) || !isFinite(bbox.max.x);
  return empty
    ? { min: { x: 0, y: 0, z: 0 }, max: { x: 10, y: 10, z: 10 } }
    : { min: { x: bbox.min.x, y: bbox.min.y, z: bbox.min.z }, max: { x: bbox.max.x, y: bbox.max.y, z: bbox.max.z } };
}

const MODIFIER_PAINT_COLORS: Record<Exclude<ModifierMeshRole, 'normal'>, string> = {
  cutting_mesh: '#ff6b6b',
  infill_mesh: '#4dabf7',
  support_mesh: '#51cf66',
  anti_overhang_mesh: '#ffd43b',
};

function modifierRoleLabel(role: Exclude<ModifierMeshRole, 'normal'>): string {
  switch (role) {
    case 'cutting_mesh': return 'Cutting';
    case 'infill_mesh': return 'Infill';
    case 'support_mesh': return 'Support';
    case 'anti_overhang_mesh': return 'Support blocker';
  }
}

function createPaintBrushGeometry(radiusMm: number, heightMm: number): THREE.BufferGeometry {
  const radius = Math.max(0.5, Math.min(100, radiusMm));
  const height = Math.max(0.2, Math.min(500, heightMm));
  const geometry = new THREE.CylinderGeometry(radius, radius, height, 32, 1, false);
  geometry.rotateX(Math.PI / 2);
  geometry.computeBoundingBox();
  return geometry;
}

export function createPlateActions({
  set,
  get,
}: {
  set: StoreApi<SlicerStore>['setState'];
  get: StoreApi<SlicerStore>['getState'];
}): PlateActionSlice {
  const pushHistory = () => set((state) => ({
    plateHistory: [...state.plateHistory.slice(-PLATE_HISTORY_LIMIT + 1), state.plateObjects],
    plateFuture: [],
  }));

  return {
  pushPlateHistory: pushHistory,

  addToPlate: (featureId, name, geometry) => {
    pushHistory();
    const safeBbox = bboxFromGeometry(geometry);

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
      additionalSelectedIds: [],
    }));

    get().autoArrange();
    // Run printability check so the warning panel populates without the
    // user having to click the explicit "Check printability" button.
    void Promise.resolve().then(() => get().runPrintabilityCheck());
  },

  addPaintedModifierMesh: (role, point, radiusMm, heightMm, settings) => {
    pushHistory();
    const geometry = createPaintBrushGeometry(radiusMm, heightMm);
    const safeBbox = bboxFromGeometry(geometry);
    const plateObject: PlateObject = {
      id: crypto.randomUUID(),
      featureId: 'modifier-paint',
      name: `${modifierRoleLabel(role)} paint`,
      geometry,
      position: { x: point.x, y: point.y, z: point.z },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      color: MODIFIER_PAINT_COLORS[role],
      boundingBox: safeBbox,
      modifierMeshRole: role,
      modifierMeshSettings: settings,
    };

    set((state) => ({
      plateObjects: [...state.plateObjects, plateObject],
      selectedPlateObjectId: plateObject.id,
      additionalSelectedIds: [],
      sliceResult: null,
      previewMode: 'model',
    }));
  },

  removeFromPlate: (id) => {
    pushHistory();
    set((state) => ({
      plateObjects: state.plateObjects.filter((o) => o.id !== id),
      selectedPlateObjectId: state.selectedPlateObjectId === id ? null : state.selectedPlateObjectId,
      additionalSelectedIds: state.additionalSelectedIds.filter((x) => x !== id),
      sliceResult: null,
      previewMode: 'model',
      previewLayer: 0,
      previewLayerStart: 0,
      previewLayerMax: 0,
      previewSimEnabled: false,
      previewSimPlaying: false,
      previewSimTime: 0,
    }));
  },

  selectPlateObject: (id) => set({ selectedPlateObjectId: id, additionalSelectedIds: [] }),

  togglePlateObjectInSelection: (id) => set((state) => {
    if (state.selectedPlateObjectId === null) {
      return { selectedPlateObjectId: id, additionalSelectedIds: [] };
    }
    if (state.selectedPlateObjectId === id) {
      // Demote the anchor — pick the first additional as the new anchor.
      const [next, ...rest] = state.additionalSelectedIds;
      return { selectedPlateObjectId: next ?? null, additionalSelectedIds: rest };
    }
    if (state.additionalSelectedIds.includes(id)) {
      return { additionalSelectedIds: state.additionalSelectedIds.filter((x) => x !== id) };
    }
    return { additionalSelectedIds: [...state.additionalSelectedIds, id] };
  }),

  selectPlateObjectRange: (anchorId, targetId) => set((state) => {
    const ids = state.plateObjects.map((o) => o.id);
    const anchor = anchorId ?? state.selectedPlateObjectId ?? targetId;
    const a = ids.indexOf(anchor);
    const b = ids.indexOf(targetId);
    if (a < 0 || b < 0) return { selectedPlateObjectId: targetId, additionalSelectedIds: [] };
    const [lo, hi] = a <= b ? [a, b] : [b, a];
    const span = ids.slice(lo, hi + 1);
    return {
      selectedPlateObjectId: anchor,
      additionalSelectedIds: span.filter((x) => x !== anchor),
    };
  }),

  clearPlateSelection: () => set({ selectedPlateObjectId: null, additionalSelectedIds: [] }),

  getSelectedIds: () => {
    const { selectedPlateObjectId, additionalSelectedIds } = get();
    return selectedPlateObjectId
      ? [selectedPlateObjectId, ...additionalSelectedIds]
      : [];
  },

  updatePlateObject: (id, updates) => {
    pushHistory();
    set((state) => ({
      plateObjects: state.plateObjects.map((o) =>
        o.id === id ? { ...o, ...updates } : o,
      ),
    }));
  },

  duplicatePlateObject: (id) => {
    const orig = get().plateObjects.find((o) => o.id === id);
    if (!orig) return;
    pushHistory();
    const copy: PlateObject = {
      ...orig,
      id: crypto.randomUUID(),
      name: `${orig.name} copy`,
      // Offset the copy slightly so it doesn't sit on top of the original.
      position: {
        x: orig.position.x + 10,
        y: orig.position.y + 10,
        z: orig.position.z,
      },
    };
    set((state) => ({
      plateObjects: [...state.plateObjects, copy],
      selectedPlateObjectId: copy.id,
      additionalSelectedIds: [],
    }));
  },

  duplicateSelectedPlateObjects: () => {
    const ids = get().getSelectedIds();
    if (ids.length === 0) return;
    pushHistory();
    const all = get().plateObjects;
    const copies: PlateObject[] = [];
    for (const id of ids) {
      const orig = all.find((o) => o.id === id);
      if (!orig) continue;
      copies.push({
        ...orig,
        id: crypto.randomUUID(),
        name: `${orig.name} copy`,
        position: {
          x: orig.position.x + 10,
          y: orig.position.y + 10,
          z: orig.position.z,
        },
      });
    }
    if (copies.length === 0) return;
    set((state) => ({
      plateObjects: [...state.plateObjects, ...copies],
      selectedPlateObjectId: copies[0].id,
      additionalSelectedIds: copies.slice(1).map((c) => c.id),
    }));
  },

  layFlatPlateObject: (id) => {
    const obj = get().plateObjects.find((o) => o.id === id);
    if (!obj) return;
    // Heuristic lay-flat: rotate so the smallest bounding-box dimension is
    // along Z (parts naturally sit on their largest face). Doesn't pick the
    // exact face the user wants, but gets common shapes upright.
    const dx = obj.boundingBox.max.x - obj.boundingBox.min.x;
    const dy = obj.boundingBox.max.y - obj.boundingBox.min.y;
    const dz = obj.boundingBox.max.z - obj.boundingBox.min.z;
    const minDim = Math.min(dx, dy, dz);
    let rotation = { x: 0, y: 0, z: 0 };
    if (minDim === dx) rotation = { x: 0, y: 90, z: 0 };
    else if (minDim === dy) rotation = { x: 90, y: 0, z: 0 };
    // else (minDim === dz) — already flat, leave rotation zero.
    pushHistory();
    set((state) => ({
      plateObjects: state.plateObjects.map((o) =>
        o.id === id ? { ...o, rotation } : o,
      ),
    }));
    // Drop to bed in the new orientation.
    get().dropToBedPlateObject(id);
  },

  dropToBedPlateObject: (id) => {
    const obj = get().plateObjects.find((o) => o.id === id);
    if (!obj) return;
    // Compute the world-space min-Z by transforming the bounding box's 8
    // corners and taking the smallest. Position.z is then offset so that
    // min-Z lands on z=0.
    const sx = (obj.scale?.x ?? 1) * (obj.mirrorX ? -1 : 1);
    const sy = (obj.scale?.y ?? 1) * (obj.mirrorY ? -1 : 1);
    const sz = (obj.scale?.z ?? 1) * (obj.mirrorZ ? -1 : 1);
    const rx = ((obj.rotation?.x ?? 0) * Math.PI) / 180;
    const ry = ((obj.rotation?.y ?? 0) * Math.PI) / 180;
    const rz = ((obj.rotation?.z ?? 0) * Math.PI) / 180;
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(0, 0, 0),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
      new THREE.Vector3(sx, sy, sz),
    );
    const corners = [
      [obj.boundingBox.min.x, obj.boundingBox.min.y, obj.boundingBox.min.z],
      [obj.boundingBox.max.x, obj.boundingBox.min.y, obj.boundingBox.min.z],
      [obj.boundingBox.min.x, obj.boundingBox.max.y, obj.boundingBox.min.z],
      [obj.boundingBox.max.x, obj.boundingBox.max.y, obj.boundingBox.min.z],
      [obj.boundingBox.min.x, obj.boundingBox.min.y, obj.boundingBox.max.z],
      [obj.boundingBox.max.x, obj.boundingBox.min.y, obj.boundingBox.max.z],
      [obj.boundingBox.min.x, obj.boundingBox.max.y, obj.boundingBox.max.z],
      [obj.boundingBox.max.x, obj.boundingBox.max.y, obj.boundingBox.max.z],
    ];
    let minZ = Infinity;
    const v = new THREE.Vector3();
    for (const [x, y, z] of corners) {
      v.set(x, y, z).applyMatrix4(m);
      if (v.z < minZ) minZ = v.z;
    }
    if (!isFinite(minZ)) return;
    pushHistory();
    set((state) => ({
      plateObjects: state.plateObjects.map((o) =>
        o.id === id ? { ...o, position: { ...o.position, z: -minZ } } : o,
      ),
    }));
  },

  centerPlateObject: (id) => {
    const obj = get().plateObjects.find((o) => o.id === id);
    if (!obj) return;
    const bv = get().getActivePrinterProfile()?.buildVolume ?? { x: 220, y: 220, z: 250 };
    const sx = obj.scale?.x ?? 1;
    const sy = obj.scale?.y ?? 1;
    const w = (obj.boundingBox.max.x - obj.boundingBox.min.x) * sx;
    const d = (obj.boundingBox.max.y - obj.boundingBox.min.y) * sy;
    pushHistory();
    set((state) => ({
      plateObjects: state.plateObjects.map((o) =>
        o.id === id
          ? {
              ...o,
              position: {
                x: bv.x / 2 - obj.boundingBox.min.x * sx - w / 2,
                y: bv.y / 2 - obj.boundingBox.min.y * sy - d / 2,
                z: o.position.z,
              },
            }
          : o,
      ),
    }));
  },

  removeSelectedPlateObjects: () => {
    const ids = get().getSelectedIds();
    if (ids.length === 0) return;
    pushHistory();
    set((state) => ({
      plateObjects: state.plateObjects.filter((o) => !ids.includes(o.id)),
      selectedPlateObjectId: null,
      additionalSelectedIds: [],
      sliceResult: null,
      previewMode: 'model',
    }));
  },

  undoPlate: () => set((state) => {
    if (state.plateHistory.length === 0) return state;
    const prev = state.plateHistory[state.plateHistory.length - 1];
    return {
      plateObjects: prev,
      plateHistory: state.plateHistory.slice(0, -1),
      plateFuture: [...state.plateFuture, state.plateObjects],
    };
  }),

  redoPlate: () => set((state) => {
    if (state.plateFuture.length === 0) return state;
    const next = state.plateFuture[state.plateFuture.length - 1];
    return {
      plateObjects: next,
      plateFuture: state.plateFuture.slice(0, -1),
      plateHistory: [...state.plateHistory, state.plateObjects],
    };
  }),

  exportPlateJson: () => {
    const state = get();
    // Lightweight plate snapshot: transform + per-object metadata + the raw
    // geometry (positions/index) so the round-trip works without needing the
    // CAD source. NaN/Infinity are filtered to keep the JSON valid.
    const plate = state.plateObjects.map((obj) => {
      const geo = obj.geometry as THREE.BufferGeometry | undefined;
      const pos = geo?.getAttribute('position');
      const idx = geo?.getIndex();
      return {
        ...obj,
        geometry: pos
          ? {
              positions: Array.from(pos.array as Float32Array),
              index: idx ? Array.from(idx.array as Uint32Array | Uint16Array) : null,
            }
          : null,
      };
    });
    return JSON.stringify({
      version: 1,
      activePrinterProfileId: state.activePrinterProfileId,
      activeMaterialProfileId: state.activeMaterialProfileId,
      activePrintProfileId: state.activePrintProfileId,
      plate,
    });
  },

  importPlateJson: (json) => {
    let data: {
      version?: number;
      activePrinterProfileId?: string;
      activeMaterialProfileId?: string;
      activePrintProfileId?: string;
      plate?: Array<Record<string, unknown> & {
        geometry?: { positions: number[]; index: number[] | null } | null;
      }>;
    };
    try {
      data = JSON.parse(json);
    } catch {
      throw new Error('Invalid plate file (not JSON)');
    }
    if (!data || typeof data !== 'object' || !Array.isArray(data.plate)) {
      throw new Error('Invalid plate file');
    }
    pushHistory();
    const restored: PlateObject[] = data.plate.map((raw) => {
      const g = raw.geometry;
      let geometry: THREE.BufferGeometry | undefined;
      if (g && Array.isArray(g.positions) && g.positions.length > 0) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(g.positions), 3));
        if (g.index) geo.setIndex(new THREE.BufferAttribute(new Uint32Array(g.index), 1));
        geo.computeBoundingBox();
        geo.computeVertexNormals();
        geometry = geo;
      }
      return {
        ...(raw as unknown as PlateObject),
        id: crypto.randomUUID(),
        geometry,
      } as PlateObject;
    });
    set({
      plateObjects: restored,
      selectedPlateObjectId: restored[0]?.id ?? null,
      additionalSelectedIds: [],
      sliceResult: null,
      previewMode: 'model',
    });
  },

  layFlatByFace: (id, localFaceNormal) => {
    void (async () => {
      const { rotationForFaceDown } = await import('../../engine/plateGeometryOps');
      const obj = get().plateObjects.find((o) => o.id === id);
      if (!obj) return;
      const n = new THREE.Vector3(localFaceNormal.x, localFaceNormal.y, localFaceNormal.z);
      // The picked normal is in the mesh's local space, but we apply it on
      // top of the existing rotation. Bake the existing rotation into the
      // normal so the new rotation acts as an absolute orientation.
      const rx = ((obj.rotation?.x ?? 0) * Math.PI) / 180;
      const ry = ((obj.rotation?.y ?? 0) * Math.PI) / 180;
      const rz = ((obj.rotation?.z ?? 0) * Math.PI) / 180;
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz));
      const worldNormal = n.clone().applyQuaternion(q);
      const rot = rotationForFaceDown(worldNormal);
      pushHistory();
      set((state) => ({
        plateObjects: state.plateObjects.map((o) =>
          o.id === id ? { ...o, rotation: rot } : o,
        ),
      }));
      get().dropToBedPlateObject(id);
    })();
  },

  autoOrientPlateObject: (id) => {
    void (async () => {
      const { autoOrient } = await import('../../engine/plateGeometryOps');
      const obj = get().plateObjects.find((o) => o.id === id);
      if (!obj || !(obj.geometry instanceof THREE.BufferGeometry)) return;
      const rot = autoOrient(obj.geometry);
      pushHistory();
      set((state) => ({
        plateObjects: state.plateObjects.map((o) =>
          o.id === id ? { ...o, rotation: rot } : o,
        ),
      }));
      get().dropToBedPlateObject(id);
    })();
  },

  scaleToHeight: (id, targetHeight) => {
    const obj = get().plateObjects.find((o) => o.id === id);
    if (!obj || targetHeight <= 0) return;
    const dz = obj.boundingBox.max.z - obj.boundingBox.min.z;
    if (dz <= 0) return;
    const ratio = targetHeight / (dz * (obj.scale?.z ?? 1));
    pushHistory();
    set((state) => ({
      plateObjects: state.plateObjects.map((o) => {
        if (o.id !== id) return o;
        const sx = (o.scale?.x ?? 1) * ratio;
        const sy = (o.scale?.y ?? 1) * ratio;
        const sz = (o.scale?.z ?? 1) * ratio;
        return { ...o, scale: { x: sx, y: sy, z: sz } };
      }),
    }));
    get().dropToBedPlateObject(id);
  },

  reorderPlateObjects: (orderedIds) => {
    pushHistory();
    set((state) => {
      const byId = new Map(state.plateObjects.map((o) => [o.id, o]));
      const reordered = orderedIds
        .map((id) => byId.get(id))
        .filter((o): o is PlateObject => !!o);
      // Append any objects not in the ordered list (defensive against caller drift).
      for (const o of state.plateObjects) {
        if (!orderedIds.includes(o.id)) reordered.push(o);
      }
      return { plateObjects: reordered };
    });
  },

  resolveOverlapForObject: (id) => {
    // Greedy nudge: repeatedly translate the object along the +X axis until
    // its world AABB no longer overlaps any other plate object. Quick and
    // deterministic; falls back to a 50-iteration cap to avoid infinite
    // loops if the bed is fully packed.
    const compileAabb = (o: PlateObject) => {
      const sx = (o.scale?.x ?? 1) * (o.mirrorX ? -1 : 1);
      const sy = (o.scale?.y ?? 1) * (o.mirrorY ? -1 : 1);
      const sz = (o.scale?.z ?? 1) * (o.mirrorZ ? -1 : 1);
      const rx = ((o.rotation?.x ?? 0) * Math.PI) / 180;
      const ry = ((o.rotation?.y ?? 0) * Math.PI) / 180;
      const rz = ((o.rotation?.z ?? 0) * Math.PI) / 180;
      const m = new THREE.Matrix4().compose(
        new THREE.Vector3(o.position.x, o.position.y, o.position.z),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
        new THREE.Vector3(sx, sy, sz),
      );
      const corners = [
        [o.boundingBox.min.x, o.boundingBox.min.y, o.boundingBox.min.z],
        [o.boundingBox.max.x, o.boundingBox.min.y, o.boundingBox.min.z],
        [o.boundingBox.min.x, o.boundingBox.max.y, o.boundingBox.min.z],
        [o.boundingBox.max.x, o.boundingBox.max.y, o.boundingBox.min.z],
        [o.boundingBox.min.x, o.boundingBox.min.y, o.boundingBox.max.z],
        [o.boundingBox.max.x, o.boundingBox.min.y, o.boundingBox.max.z],
        [o.boundingBox.min.x, o.boundingBox.max.y, o.boundingBox.max.z],
        [o.boundingBox.max.x, o.boundingBox.max.y, o.boundingBox.max.z],
      ];
      const v = new THREE.Vector3();
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const [x, y, z] of corners) {
        v.set(x, y, z).applyMatrix4(m);
        if (v.x < minX) minX = v.x;
        if (v.y < minY) minY = v.y;
        if (v.x > maxX) maxX = v.x;
        if (v.y > maxY) maxY = v.y;
      }
      return { minX, minY, maxX, maxY };
    };

    const all = get().plateObjects;
    const target = all.find((o) => o.id === id);
    if (!target) return;
    let dx = 0;
    const step = 5; // mm
    for (let i = 0; i < 50; i++) {
      const moved = { ...target, position: { ...target.position, x: target.position.x + dx } };
      const a = compileAabb(moved);
      const conflict = all.some((o) => {
        if (o.id === id || o.hidden) return false;
        const b = compileAabb(o);
        return a.minX < b.maxX && a.maxX > b.minX
          && a.minY < b.maxY && a.maxY > b.minY;
      });
      if (!conflict) break;
      dx += step;
    }
    if (dx === 0) return;
    pushHistory();
    set((state) => ({
      plateObjects: state.plateObjects.map((o) =>
        o.id === id ? { ...o, position: { ...o.position, x: o.position.x + dx } } : o,
      ),
    }));
  },

  hollowPlateObject: async (id, wallThicknessMm) => {
    const { hollowMesh } = await import('../../engine/plateGeometryOps');
    const obj = get().plateObjects.find((o) => o.id === id);
    if (!obj || !(obj.geometry instanceof THREE.BufferGeometry)) return;
    const out = hollowMesh(obj.geometry, wallThicknessMm);
    if (!out) {
      console.warn('Hollow produced empty result');
      return;
    }
    pushHistory();
    set((state) => ({
      plateObjects: state.plateObjects.map((o) =>
        o.id === id
          ? {
              ...o,
              geometry: out,
              boundingBox: out.boundingBox
                ? {
                    min: { x: out.boundingBox.min.x, y: out.boundingBox.min.y, z: out.boundingBox.min.z },
                    max: { x: out.boundingBox.max.x, y: out.boundingBox.max.y, z: out.boundingBox.max.z },
                  }
                : o.boundingBox,
            }
          : o,
      ),
    }));
  },

  cutPlateObjectByPlane: async (id, planePoint, planeNormal) => {
    const { cutMeshByPlane } = await import('../../engine/plateGeometryOps');
    const obj = get().plateObjects.find((o) => o.id === id);
    if (!obj || !(obj.geometry instanceof THREE.BufferGeometry)) return;
    const result = cutMeshByPlane(
      obj.geometry,
      new THREE.Vector3(planePoint.x, planePoint.y, planePoint.z),
      new THREE.Vector3(planeNormal.x, planeNormal.y, planeNormal.z),
    );
    if (!result.positive && !result.negative) return;
    pushHistory();
    set((state) => {
      const without = state.plateObjects.filter((o) => o.id !== id);
      const halves: PlateObject[] = [];
      const baseName = obj.name;
      const buildHalf = (geo: THREE.BufferGeometry, suffix: string): PlateObject => {
        const bb = geo.boundingBox;
        return {
          ...obj,
          id: crypto.randomUUID(),
          name: `${baseName} ${suffix}`,
          geometry: geo,
          boundingBox: bb
            ? { min: { x: bb.min.x, y: bb.min.y, z: bb.min.z }, max: { x: bb.max.x, y: bb.max.y, z: bb.max.z } }
            : obj.boundingBox,
          // Offset the second half so the user can see them apart.
          position:
            suffix === '(2)'
              ? { x: obj.position.x + 20, y: obj.position.y, z: obj.position.z }
              : obj.position,
        };
      };
      if (result.positive) halves.push(buildHalf(result.positive, '(1)'));
      if (result.negative) halves.push(buildHalf(result.negative, '(2)'));
      return {
        plateObjects: [...without, ...halves],
        selectedPlateObjectId: halves[0]?.id ?? null,
        additionalSelectedIds: halves.slice(1).map((h) => h.id),
      };
    });
  },

  autoArrange: () => {
    void (async () => {
      const { packRectangles } = await import('../../engine/binPacker');
      const { scoreBedMeshPlacement } = await import('../../utils/bedMeshArrange');
      const { plateObjects, getActivePrinterProfile, activeBedMesh } = get();
      if (plateObjects.length === 0) return;

      const printer = getActivePrinterProfile();
      const bedW = printer?.buildVolume?.x ?? 220;
      const bedD = printer?.buildVolume?.y ?? 220;

      const inputs = plateObjects
        .filter((o) => !o.locked)
        .map((o) => {
          const sx = o.scale?.x ?? 1;
          const sy = o.scale?.y ?? 1;
          const w = (o.boundingBox.max.x - o.boundingBox.min.x) * sx;
          const d = (o.boundingBox.max.y - o.boundingBox.min.y) * sy;
          return {
            id: o.id,
            w: isFinite(w) && w > 0 ? w : 50,
            h: isFinite(d) && d > 0 ? d : 50,
            fallback: { x: o.position.x, y: o.position.y },
          };
        });

      const placements = packRectangles(bedW, bedD, inputs, 4, {
        scorePlacement: activeBedMesh
          ? (candidate) => scoreBedMeshPlacement(activeBedMesh, candidate)
          : undefined,
      });
      const placementById = new Map(placements.map((p) => [p.id, p]));

      pushHistory();
      const arranged = plateObjects.map((o) => {
        const p = placementById.get(o.id);
        if (!p) return o;
        const sx = o.scale?.x ?? 1;
        const sy = o.scale?.y ?? 1;
        const sz = o.scale?.z ?? 1;
        const minX = (o.boundingBox.min.x ?? 0) * sx;
        const minY = (o.boundingBox.min.y ?? 0) * sy;
        const minZ = (o.boundingBox.min.z ?? 0) * sz;
        // The rotated case (90°) implies the bin packer wants the object turned,
        // but rotating the mesh changes its slicing — out of scope for the
        // arrange action. Treat `rotated:true` as a hint we ignore.
        return {
          ...o,
          position: {
            x: p.x - minX,
            y: p.y - minY,
            z: isFinite(minZ) ? -minZ : 0,
          },
        };
      });

      set({ plateObjects: arranged });
    })();
  },

  clearPlate: () => {
    pushHistory();
    set({
      plateObjects: [],
      selectedPlateObjectId: null,
      additionalSelectedIds: [],
      sliceResult: null,
      previewMode: 'model',
      previewLayer: 0,
      previewLayerStart: 0,
      previewLayerMax: 0,
      previewSimEnabled: false,
      previewSimPlaying: false,
      previewSimTime: 0,
    });
  },

  importFileToPlate: async (file: File) => {
    try {
      const lower = file.name.toLowerCase();
      if (lower.endsWith('.dzign-plate.json') || lower.endsWith('.plate.json')) {
        const text = await file.text();
        get().importPlateJson(text);
        return get().selectedPlateObjectId;
      }
      const { FileImporter } = await import('../../engine/FileImporter');
      const group = await FileImporter.importFile(file);

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

      pushHistory();
      set((state) => ({
        plateObjects: [...state.plateObjects, plateObject],
        selectedPlateObjectId: plateObject.id,
        additionalSelectedIds: [],
      }));

      get().autoArrange();
      void Promise.resolve().then(() => get().runPrintabilityCheck());
      return plateObject.id;
    } catch (err) {
      console.error('File import failed:', err);
      throw err;
    }
  },
  };
}
