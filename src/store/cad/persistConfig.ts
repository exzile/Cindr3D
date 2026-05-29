import type { PersistOptions, PersistStorage } from 'zustand/middleware';
import type { Feature, Sketch } from '../../types/cad';
import { useComponentStore } from '../componentStore';
import { deserializeFeature, deserializeSketch, idbStorage, serializeFeature } from './persistence';
import type { CADState } from './state';
import { PAGEHIDE_FLUSH_KEY } from '../../effects/cadStatePagehideFlush';

function rebuildExtrudeBodies(state: CADState) {
  const componentStore = useComponentStore.getState();

  // ── Prune orphaned bodies ─────────────────────────────────────────────────
  // A body is orphaned when its featureIds list has NO entry that matches an
  // existing cadStore feature.  This happens when commitExtrude's OCC path
  // previously failed after addBody() but before the feature was pushed to
  // cadStore -- leaving a persisted body with no matching feature.
  const allFeatureIds = new Set(state.features.map((f) => f.id));
  for (const [bodyId, body] of Object.entries(componentStore.bodies)) {
    const featureIds: string[] = (body as { featureIds?: string[] }).featureIds ?? [];
    const hasMatchingFeature = featureIds.some((fid) => allFeatureIds.has(fid));
    if (!hasMatchingFeature) {
      componentStore.removeBody(bodyId);
    }
  }

  // ── Rebuild missing bodies ────────────────────────────────────────────────
  // Re-read after pruning since removeBody mutates the store.
  const existingBodyIds = new Set(Object.keys(useComponentStore.getState().bodies));
  const indexedFeatureIds = new Set(
    Object.values(useComponentStore.getState().bodies).flatMap(
      (b) => (b as { featureIds?: string[] }).featureIds ?? [],
    ),
  );
  const createdThisRun = new Set<string>();

  for (const feature of state.features) {
    if (feature.type !== 'extrude') continue;
    const op = (feature.params?.operation as string) ?? 'new-body';
    if (op !== 'new-body') continue;
    if (feature.bodyId && (existingBodyIds.has(feature.bodyId) || createdThisRun.has(feature.bodyId))) continue;
    if (indexedFeatureIds.has(feature.id)) continue;

    const parentId = componentStore.activeComponentId ?? componentStore.rootComponentId;
    const bodyLabel =
      (feature.bodyKind === 'surface' ? 'Surface' : 'Body') +
      ' ' +
      (Object.keys(useComponentStore.getState().bodies).length + 1);
    const bodyId = componentStore.addBody(parentId, bodyLabel);
    if (bodyId) {
      componentStore.addFeatureToBody(bodyId, feature.id);
      createdThisRun.add(bodyId);
    }
  }
}

export function mergeActiveSketchForPersistence(sketches: Sketch[], activeSketch: Sketch | null): Sketch[] {
  if (!activeSketch) return sketches;
  const index = sketches.findIndex((sketch) => sketch.id === activeSketch.id);
  if (index < 0) return [...sketches, activeSketch];

  const next = [...sketches];
  next[index] = activeSketch;
  return next;
}

function shouldPersistActiveSketch(activeSketch: Sketch | null): activeSketch is Sketch {
  return !!activeSketch && (
    activeSketch.entities.length > 0 ||
    activeSketch.constraints.length > 0 ||
    activeSketch.dimensions.length > 0
  );
}

export function createCADPersistConfig(): PersistOptions<CADState, Partial<CADState>> {
  return {
    name: 'cindr3d-cad',
    storage: idbStorage as unknown as PersistStorage<unknown>,
    // Bump on every rehydration-time sanity-clamp expansion (see the
    // ARRAY_FIELDS list in onRehydrateStorage) so existing IndexedDB
    // blobs go through migrate again and pick up the latest defaults.
    version: 5,
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
        designConfigurations: state.designConfigurations ?? currentState.designConfigurations,
        activeDesignConfigurationId: state.activeDesignConfigurationId ?? currentState.activeDesignConfigurationId,
        historyEnabled: state.historyEnabled ?? currentState.historyEnabled,
        constructionPlanes: state.constructionPlanes ?? currentState.constructionPlanes,
        constructionAxes: state.constructionAxes ?? currentState.constructionAxes,
        constructionPoints: state.constructionPoints ?? currentState.constructionPoints,
        contactSets: state.contactSets ?? currentState.contactSets,
        selectionSets: state.selectionSets ?? currentState.selectionSets,
        activeSketch: state.activeSketch ? deserializeSketch(state.activeSketch as Sketch) : currentState.activeSketch,
        sketches: (state.sketches ?? currentState.sketches).map((s) => deserializeSketch(s as Sketch)),
        features: (state.features ?? currentState.features).map((f) => deserializeFeature(f as Feature)),
      };
    },
    onRehydrateStorage: () => (state: CADState | undefined) => {
      if (!state) return;

      // Guard against the IDB async-write race: if the user pressed Ctrl+Z then
      // immediately Ctrl+R, the IDB write may not have committed before the reload.
      // cadStatePagehideFlush.ts writes the true last-known feature IDs to
      // localStorage synchronously on pagehide.  Filter the IDB-loaded features
      // to only those present in the flush snapshot.
      try {
        const flush = localStorage.getItem(PAGEHIDE_FLUSH_KEY);
        if (flush) {
          const { featureIds } = JSON.parse(flush) as { featureIds: string[] };
          const allowed = new Set<string>(featureIds);
          state.features = state.features.filter((f) => allowed.has(f.id));
        }
      } catch {
        // Malformed flush or localStorage unavailable — proceed with IDB state.
      } finally {
        try { localStorage.removeItem(PAGEHIDE_FLUSH_KEY); } catch { /* ignore */ }
      }

      // Sanity-clamp array-typed fields that the merge step can leave
      // as `undefined` if a persisted blob explicitly stored undefined
      // (e.g. older code persisted these and Zustand's spread merge
      // overrode currentState's default). Each crash we've debugged
      // here was the same shape -- a `.length` or `.map` on undefined
      // -- so the cheapest durable fix is to guarantee these fields
      // are always arrays regardless of what storage produced.
      const ARRAY_FIELDS: Array<keyof CADState> = [
        'extrudeSelectedSketchIds',
        'features',
        'sketches',
        'designConfigurations',
        'constructionPlanes',
        'constructionAxes',
        'constructionPoints',
        'contactSets',
        'selectionSets',
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
      historyEnabled: state.historyEnabled,
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
      activeSketch: shouldPersistActiveSketch(state.activeSketch) ? state.activeSketch : null,
      sketches: mergeActiveSketchForPersistence(
        state.sketches,
        shouldPersistActiveSketch(state.activeSketch) ? state.activeSketch : null,
      ),
      features: state.features.map((f: Feature) => serializeFeature(f) as Feature),
      designConfigurations: state.designConfigurations,
      activeDesignConfigurationId: state.activeDesignConfigurationId,
      parameters: state.parameters,
      constructionPlanes: state.constructionPlanes,
      constructionAxes: state.constructionAxes,
      constructionPoints: state.constructionPoints,
      contactSets: state.contactSets,
      selectionSets: state.selectionSets,
      frozenFormVertices: state.frozenFormVertices,
      featureGroups: state.featureGroups,
      canvasReferences: state.canvasReferences,
      jointOrigins: state.jointOrigins,
      formBodies: state.formBodies,
    }),
  } as unknown as PersistOptions<CADState, Partial<CADState>>;
}
