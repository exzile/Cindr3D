import type { PersistOptions, PersistStorage } from 'zustand/middleware';
import type { Feature, Sketch } from '../../types/cad';
import { useComponentStore } from '../componentStore';
import { deserializeFeature, deserializeSketch, idbStorage, serializeFeature } from './persistence';
import type { CADState } from './state';

function rebuildExtrudeBodies(state: CADState) {
  const componentStore = useComponentStore.getState();
  const existingBodyIds = new Set(Object.keys(componentStore.bodies));
  const createdThisRun = new Set<string>();

  for (const feature of state.features) {
    if (feature.type !== 'extrude') continue;
    const op = (feature.params?.operation as string) ?? 'new-body';
    if (op !== 'new-body') continue;
    if (feature.bodyId && (existingBodyIds.has(feature.bodyId) || createdThisRun.has(feature.bodyId))) continue;

    const parentId = componentStore.activeComponentId ?? componentStore.rootComponentId;
    const bodyLabel =
      (feature.bodyKind === 'surface' ? 'Surface' : 'Body') +
      ' ' +
      (Object.keys(componentStore.bodies).length + 1);
    const bodyId = componentStore.addBody(parentId, bodyLabel);
    if (bodyId) {
      componentStore.addFeatureToBody(bodyId, feature.id);
      createdThisRun.add(bodyId);
    }
  }
}

export function createCADPersistConfig(): PersistOptions<CADState, Partial<CADState>> {
  return {
    name: 'cindr3d-cad',
    storage: idbStorage as unknown as PersistStorage<unknown>,
    // Bump on every rehydration-time sanity-clamp expansion (see the
    // ARRAY_FIELDS list in onRehydrateStorage) so existing IndexedDB
    // blobs go through migrate again and pick up the latest defaults.
    version: 4,
    migrate: (persistedState: unknown) => {
      const state = (persistedState ?? {}) as Partial<CADState>;
      return {
        ...state,
        sketches: (state.sketches ?? []).map((s) => deserializeSketch(s as Sketch)),
        features: (state.features ?? []).map((f) => deserializeFeature(f as Feature)),
      } as CADState;
    },
    merge: (persistedState: unknown, currentState: CADState): CADState => {
      const state = (persistedState ?? {}) as Partial<CADState>;
      return {
        ...currentState,
        ...state,
        activeSketch: state.activeSketch ? deserializeSketch(state.activeSketch as Sketch) : currentState.activeSketch,
        sketches: (state.sketches ?? currentState.sketches).map((s) => deserializeSketch(s as Sketch)),
        features: (state.features ?? currentState.features).map((f) => deserializeFeature(f as Feature)),
      };
    },
    onRehydrateStorage: () => (state: CADState | undefined) => {
      if (!state) return;

      // Sanity-clamp array-typed fields that the merge step can leave
      // as `undefined` if a persisted blob explicitly stored undefined
      // (e.g. older code persisted these and Zustand's spread merge
      // overrode currentState's default). Each crash we've debugged
      // here was the same shape — a `.length` or `.map` on undefined
      // — so the cheapest durable fix is to guarantee these fields
      // are always arrays regardless of what storage produced.
      const ARRAY_FIELDS: Array<keyof CADState> = [
        'extrudeSelectedSketchIds',
        'features',
        'sketches',
      ];
      const s = state as unknown as Record<string, unknown>;
      for (const key of ARRAY_FIELDS) {
        if (!Array.isArray(s[key as string])) {
          s[key as string] = [];
        }
      }

      const compPersist = (useComponentStore as unknown as {
        persist?: {
          hasHydrated: () => boolean;
          onFinishHydration: (cb: () => void) => (() => void) | void;
        };
      }).persist;

      if (compPersist && !compPersist.hasHydrated()) {
        compPersist.onFinishHydration(() => rebuildExtrudeBodies(state));
      } else {
        rebuildExtrudeBodies(state);
      }
    },
    partialize: (state: CADState) => ({
      gridSize: state.gridSize,
      snapEnabled: state.snapEnabled,
      gridVisible: state.gridVisible,
      sketchPolygonSides: state.sketchPolygonSides,
      sketchFilletRadius: state.sketchFilletRadius,
      units: state.units,
      visualStyle: state.visualStyle,
      showEnvironment: state.showEnvironment,
      showShadows: state.showShadows,
      showGroundPlane: state.showGroundPlane,
      showComponentColors: state.showComponentColors,
      viewportLayout: state.viewportLayout,
      ambientOcclusionEnabled: state.ambientOcclusionEnabled,
      dimensionToleranceMode: state.dimensionToleranceMode,
      dimensionToleranceUpper: state.dimensionToleranceUpper,
      dimensionToleranceLower: state.dimensionToleranceLower,
      sketches: state.sketches,
      features: state.features.map((f: Feature) => serializeFeature(f) as Feature),
      parameters: state.parameters,
      frozenFormVertices: state.frozenFormVertices,
      featureGroups: state.featureGroups,
      canvasReferences: state.canvasReferences,
      jointOrigins: state.jointOrigins,
      formBodies: state.formBodies,
    }),
  } as unknown as PersistOptions<CADState, Partial<CADState>>;
}
