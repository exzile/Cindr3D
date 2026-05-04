import * as THREE from 'three';
import type { PersistStorage } from 'zustand/middleware';
import type { PlateObject } from '../../types/slicer';
import {
  DEFAULT_MATERIAL_PROFILES,
  DEFAULT_PRINT_PROFILES,
  DEFAULT_PRINTER_PROFILES,
} from '../../types/slicer';
import { deserializeGeom, idbStorage, serializeGeom, type SerializedGeom } from './persistence';
import type { SlicerStore } from './types';

export const slicerPersistConfig = {
  name: 'cindr3d-slicer-plate',
  storage: idbStorage as unknown as PersistStorage<SlicerStore, unknown>,
  // Bump whenever a default-profile field changes value or new
  // sanity-clamps land in `onRehydrateStorage`. Zustand compares the
  // persisted version against this number and runs the legacy-state
  // pass before `onRehydrateStorage` fires, so users with stale
  // localStorage get migrated even if `onRehydrateStorage` somehow
  // doesn't pick them up. The actual migration logic lives in the
  // hydrate hook below — `migrate` just hands the data through (we
  // don't strip fields, we clamp them).
  version: 5,
  migrate: (persisted: unknown) => persisted,
  partialize: ((state) => ({
    printerProfiles: state.printerProfiles,
    materialProfiles: state.materialProfiles,
    printProfiles: state.printProfiles,
    activePrinterProfileId: state.activePrinterProfileId,
    activeMaterialProfileId: state.activeMaterialProfileId,
    activePrintProfileId: state.activePrintProfileId,
    printerLastMaterial: state.printerLastMaterial,
    printerLastPrint: state.printerLastPrint,
    plateObjects: state.plateObjects.map((obj) => ({
      ...obj,
      geometry: serializeGeom(obj.geometry),
    })),
    selectedPlateObjectId: state.selectedPlateObjectId,
    transformMode: state.transformMode,
  }) as unknown as SlicerStore) as (state: SlicerStore) => SlicerStore,
  onRehydrateStorage: () => (state?: SlicerStore) => {
    if (!state) return;
    if (state.plateObjects) {
      state.plateObjects = state.plateObjects.map((obj) => ({
        ...obj,
        geometry: obj.geometry && !(obj.geometry instanceof THREE.BufferGeometry)
          ? deserializeGeom(obj.geometry as unknown as SerializedGeom)
          : obj.geometry,
      })) as PlateObject[];
    }
    if (!state.printerProfiles?.length) state.printerProfiles = DEFAULT_PRINTER_PROFILES;
    if (!state.materialProfiles?.length) state.materialProfiles = DEFAULT_MATERIAL_PROFILES;
    if (!state.printProfiles?.length) state.printProfiles = DEFAULT_PRINT_PROFILES;

    // Backfill new default fields onto persisted profiles. When we add
    // a field to DEFAULT_PRINT_PROFILES (e.g. `connectInfillLines`),
    // existing IndexedDB profiles don't have it — reading them yields
    // `undefined`, which the slicer treats as off-by-default. The user
    // never sees the new behaviour without manually re-creating the
    // profile. Walk every persisted profile that matches a default by
    // ID and copy in any missing keys from the default, leaving
    // user-edited values intact. Bump `version` above whenever you
    // ship a new default field that should propagate this way.
    const defaultsById = new Map(DEFAULT_PRINT_PROFILES.map((d) => [d.id, d]));
    for (const profile of state.printProfiles) {
      const def = defaultsById.get(profile.id);
      if (!def) continue;
      const p = profile as unknown as Record<string, unknown>;
      const d = def as unknown as Record<string, unknown>;
      for (const key of Object.keys(d)) {
        if (p[key] === undefined) p[key] = d[key];
      }
    }

    // Promote persisted copies of the stock profile from the old
    // 0.45mm-ish defaults to Orca's Generic RRF geometry defaults. This
    // only touches values that are still exactly on known old defaults;
    // custom user edits stay custom.
    const ORCA_RRF_GEOMETRY_DEFAULT_KEYS = [
      'wallLineWidth',
      'topLayers',
      'infillOverlap',
      'lineWidth',
      'outerWallLineWidth',
      'innerWallLineWidth',
      'topBottomLineWidth',
      'topSurfaceSkinLineWidth',
      'initialLayerLineWidthFactor',
      'skinOverlapPercent',
      'slicingClosingRadius',
    ] as const;
    const ORCA_RRF_STALE_VALUES: Record<string, readonly unknown[]> = {
      wallLineWidth: [0.45],
      topLayers: [5],
      infillOverlap: [15],
      lineWidth: [0.45],
      outerWallLineWidth: [0.45],
      innerWallLineWidth: [undefined],
      topBottomLineWidth: [0.45],
      topSurfaceSkinLineWidth: [undefined],
      initialLayerLineWidthFactor: [100, 111.111],
      skinOverlapPercent: [0, 23],
      slicingClosingRadius: [0, undefined],
    };
    for (const profile of state.printProfiles) {
      const isStockStandard = profile.id === 'standard-quality'
        || profile.name === 'Standard Quality (0.2mm)';
      if (!isStockStandard) continue;
      const def = defaultsById.get('standard-quality');
      if (!def) continue;
      const p = profile as unknown as Record<string, unknown>;
      const d = def as unknown as Record<string, unknown>;
      for (const key of ORCA_RRF_GEOMETRY_DEFAULT_KEYS) {
        const staleValues = ORCA_RRF_STALE_VALUES[key];
        if (staleValues.some((value) => p[key] === value)) p[key] = d[key];
      }
    }

    // Sanity clamp: a number of fields we now ship enabled-by-default
    // were previously zero in older profile schemas. Persisted-as-zero
    // values survive the undefined-only backfill above, leaving the
    // visible behaviour broken (skin doesn't meet walls, infill doesn't
    // connect, etc.). Promote stuck-at-zero values to the OrcaSlicer-
    // matching defaults so users on stale profiles get the right look
    // without manually re-creating their profile.
    const ZERO_TO_DEFAULT_KEYS = ['skinOverlapPercent'] as const;
    for (const profile of state.printProfiles) {
      const def = defaultsById.get(profile.id);
      if (!def) continue;
      const p = profile as unknown as Record<string, unknown>;
      const d = def as unknown as Record<string, unknown>;
      for (const key of ZERO_TO_DEFAULT_KEYS) {
        const v = p[key];
        const dv = d[key];
        if (typeof v === 'number' && v === 0 && typeof dv === 'number' && dv > 0) {
          p[key] = dv;
        }
      }
    }

    // First-layer flow sanity migration. Older builds shipped Cura-style
    // first-layer flow boosts in the 130-150% range; under our current
    // pipeline (which already accounts for first-layer extrusion via
    // a slightly thicker initial layer) those values produce visible
    // over-extrusion bulges on the bottom skin and walls. Cap the four
    // first-layer flow knobs at 120% (matches OrcaSlicer's recommended
    // ceiling); if the persisted value sits above that, snap it to 100%
    // (=no override). Leaves user-edited values in the safe 80-120%
    // range untouched.
    const FLOW_KEYS = [
      'initialLayerFlow',
      'initialLayerBottomFlow',
      'initialLayerOuterWallFlow',
      'initialLayerInnerWallFlow',
    ] as const;
    for (const profile of state.printProfiles) {
      const p = profile as unknown as Record<string, unknown>;
      for (const key of FLOW_KEYS) {
        const v = p[key];
        if (typeof v === 'number' && v > 120) {
          // 100 is a safer baseline than `undefined` because it leaves
          // the field present in the serialized profile (so the UI's
          // "first-layer flow override" toggle visibly reflects 100%
          // rather than blanking out and confusing the user).
          p[key] = 100;
        }
      }
    }

    const hasPrinter = state.printerProfiles.some((profile) => profile.id === state.activePrinterProfileId);
    const hasMaterial = state.materialProfiles.some((profile) => profile.id === state.activeMaterialProfileId);
    const hasPrint = state.printProfiles.some((profile) => profile.id === state.activePrintProfileId);
    if (!hasPrinter) state.activePrinterProfileId = state.printerProfiles[0]?.id ?? '';
    if (!hasMaterial) state.activeMaterialProfileId = state.materialProfiles[0]?.id ?? '';
    if (!hasPrint) state.activePrintProfileId = state.printProfiles[0]?.id ?? '';
  },
};
