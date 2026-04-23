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
  name: 'dzign3d-slicer-plate',
  storage: idbStorage as unknown as PersistStorage<SlicerStore, unknown>,
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

    const hasPrinter = state.printerProfiles.some((profile) => profile.id === state.activePrinterProfileId);
    const hasMaterial = state.materialProfiles.some((profile) => profile.id === state.activeMaterialProfileId);
    const hasPrint = state.printProfiles.some((profile) => profile.id === state.activePrintProfileId);
    if (!hasPrinter) state.activePrinterProfileId = state.printerProfiles[0]?.id ?? '';
    if (!hasMaterial) state.activeMaterialProfileId = state.materialProfiles[0]?.id ?? '';
    if (!hasPrint) state.activePrintProfileId = state.printProfiles[0]?.id ?? '';
  },
};
