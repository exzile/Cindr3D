import * as THREE from "three";
import type {
  Feature,
  Sketch,
} from "../../../../types/cad";
import {
  deserializeFeature,
  deserializeSketch,
} from "../../persistence";
import { snapshotCADState } from "../../historyUtils";
import type { CADSliceContext } from "../../sliceContext";
import type { CADState } from "../../state";
import { globalBRepBodyRegistry } from "../../../../engine/occ/globalRegistry";
import { restoreOccSnapshot, type OccBodySnapshot } from "../../../../engine/occ/occSnapshot";
import { bodyGeometryCache } from "../../../meshRegistry";
import {
  restoreComponentStoreSnapshot,
  type HistorySnapshot,
} from "./historyRestoreHelpers";

export function createHistoryActions({ set, get }: CADSliceContext): Partial<CADState> {
  return {
    historyEnabled: true,
    toggleHistoryMode: () => {
      const next = !get().historyEnabled;
      set({
        historyEnabled: next,
        statusMessage: next
          ? "Parametric mode — design history recording resumed"
          : "Direct Modeling mode — design history not captured",
      });
    },

    // ── MM2 — Undo / Redo ────────────────────────────────────────────────────
    undoStack: [],
    redoStack: [],

    pushUndo: () => {
      const state = get();
      const snapshot = snapshotCADState(state);
      const next = [...state.undoStack, snapshot];
      set({
        undoStack: next.length > 50 ? next.slice(next.length - 50) : next,
        redoStack: [],
      });
    },

    undo: () => {
      const state = get();
      if (state.undoStack.length === 0) return;
      const currentSnapshot = snapshotCADState(state);
      const stack = [...state.undoStack];
      const snapshot = stack.pop()!;
      try {
        const parsed = JSON.parse(snapshot) as HistorySnapshot;
        if (!parsed || !Array.isArray(parsed.features)) {
          throw new Error("Invalid snapshot: missing features array");
        }
        if (!Array.isArray(parsed.sketches)) {
          throw new Error("Invalid snapshot: missing sketches array");
        }
        // Carry over the live mesh from the current state when the same feature
        // id is being restored. Parametric features (extrude/revolve) rebuild
        // from sketch+params downstream, but mesh-op / import features have NO
        // source data — without this lookup, undo permanently destroys their
        // geometry. Map lookup keeps undo→redo round-trips loss-free as long as
        // the original mesh is still alive somewhere in the live state.
        const liveMeshById = new Map<string, Feature["mesh"]>();
        for (const f of state.features) {
          if (!f.mesh) continue;
          liveMeshById.set(f.id, f.mesh);
        }
        const restoredSketches = parsed.sketches.map((s) =>
          deserializeSketch(s as unknown as Sketch),
        );
        const restoredActiveSketch = parsed.activeSketch
          ? deserializeSketch(parsed.activeSketch as unknown as Sketch)
          : null;
        restoreComponentStoreSnapshot(parsed.componentStore);
        // Evict src-geo cache and collect mesh geometries for features removed by undo.
        const restoredIds = new Set(parsed.features.map((f: Feature) => f.id));
        const undoRemovedGeos: THREE.BufferGeometry[] = [];
        for (const f of state.features) {
          if (restoredIds.has(f.id)) continue;
          if (f.mesh instanceof THREE.Mesh) {
            const geo = (f.mesh as THREE.Mesh).geometry;
            if (geo) undoRemovedGeos.push(geo);
          }
          // Also evict the cloned geometry stored in the persistent cache so the
          // slicer doesn't serve stale data when the viewport is unmounted.
          const cachedGeo = bodyGeometryCache.get(f.id);
          if (cachedGeo) { undoRemovedGeos.push(cachedGeo); bodyGeometryCache.delete(f.id); }
        }
        set({
          undoStack: stack,
          redoStack: [...state.redoStack, currentSnapshot],
          features: parsed.features.map((f) => {
            const restored = deserializeFeature(f as Feature);
            const live = liveMeshById.get(restored.id);
            // Only reuse a live mesh if its geometry is still valid (not disposed).
            if (
              live instanceof THREE.Mesh &&
              (live as THREE.Mesh).geometry?.attributes?.position
            ) {
              return { ...restored, mesh: live };
            }
            return restored;
          }),
          sketches: restoredSketches,
          activeSketch: restoredActiveSketch,
          featureGroups: parsed.featureGroups,
          designConfigurations:
            parsed.designConfigurations ?? state.designConfigurations,
          activeDesignConfigurationId:
            parsed.activeDesignConfigurationId ??
            state.activeDesignConfigurationId,
          parameters: (parsed.parameters as CADState['parameters'] | undefined) ?? state.parameters,
          constructionPlanes:
            (parsed.constructionPlanes as CADState['constructionPlanes'] | undefined) ?? state.constructionPlanes,
          constructionAxes:
            (parsed.constructionAxes as CADState['constructionAxes'] | undefined) ?? state.constructionAxes,
          constructionPoints:
            (parsed.constructionPoints as CADState['constructionPoints'] | undefined) ?? state.constructionPoints,
          jointOrigins:
            (parsed.jointOrigins as CADState['jointOrigins'] | undefined) ?? state.jointOrigins,
          contactSets:
            (parsed.contactSets as CADState['contactSets'] | undefined) ?? state.contactSets,
          selectionSets:
            (parsed.selectionSets as CADState['selectionSets'] | undefined) ?? state.selectionSets,
          canvasReferences:
            (parsed.canvasReferences as CADState['canvasReferences'] | undefined) ?? state.canvasReferences,
          formBodies:
            (parsed.formBodies as CADState['formBodies'] | undefined) ?? state.formBodies,
          frozenFormVertices: parsed.frozenFormVertices ?? state.frozenFormVertices,
          units: parsed.units === 'in' || parsed.units === 'mm' ? parsed.units : state.units,
          statusMessage: "Undo",
        });
        // OCC-7.3: restore BRepBodies from STEP snapshot if present, then
        // reconnect any feature meshes that lost their brepBodyId during
        // deserialization (live-mesh reuse at lines 189-200 covers most cases;
        // this handles the remainder where the deserialized mesh was used).
        if (Array.isArray((parsed as Record<string, unknown>).occBodies)) {
          void restoreOccSnapshot(
            (parsed as Record<string, unknown>).occBodies as OccBodySnapshot[],
          ).then(() => {
            for (const f of get().features) {
              const mesh = f.mesh as THREE.Mesh | undefined;
              if (!mesh?.isMesh || mesh.userData['brepBodyId']) continue;
              const bodies = globalBRepBodyRegistry.getByFeature(f.id);
              if (bodies.length > 0) mesh.userData['brepBodyId'] = bodies[0].id;
            }
          });
        }
        // Defer-dispose removed geometries after R3F has a cycle to unmount old meshes.
        if (undoRemovedGeos.length > 0)
          setTimeout(() => {
            for (const g of undoRemovedGeos) g.dispose();
          }, 0);
      } catch {
        // Malformed snapshot — POP it so the next undo doesn't hit the same
        // broken entry forever. Without `set({ undoStack: stack })` the failed
        // pop above is undone for the next call.
        set({
          undoStack: stack,
          statusMessage: "Undo: corrupted snapshot skipped",
        });
      }
    },

    redo: () => {
      const state = get();
      if (state.redoStack.length === 0) return;
      const currentSnapshot = snapshotCADState(state);
      const stack = [...state.redoStack];
      const snapshot = stack.pop()!;
      try {
        const parsed = JSON.parse(snapshot) as HistorySnapshot;
        if (!parsed || !Array.isArray(parsed.features)) {
          throw new Error("Invalid snapshot: missing features array");
        }
        if (!Array.isArray(parsed.sketches)) {
          throw new Error("Invalid snapshot: missing sketches array");
        }
        const liveMeshById = new Map<string, Feature["mesh"]>();
        for (const f of state.features) {
          if (!f.mesh) continue;
          liveMeshById.set(f.id, f.mesh);
        }
        const restoredSketches = parsed.sketches.map((s) =>
          deserializeSketch(s as unknown as Sketch),
        );
        const restoredActiveSketch = parsed.activeSketch
          ? deserializeSketch(parsed.activeSketch as unknown as Sketch)
          : null;
        restoreComponentStoreSnapshot(parsed.componentStore);
        // Evict src-geo cache and collect mesh geometries for features removed by redo.
        const restoredIdsRedo = new Set(
          parsed.features.map((f: Feature) => f.id),
        );
        const redoRemovedGeos: THREE.BufferGeometry[] = [];
        for (const f of state.features) {
          if (restoredIdsRedo.has(f.id)) continue;
          if (f.mesh instanceof THREE.Mesh) {
            const geo = (f.mesh as THREE.Mesh).geometry;
            if (geo) redoRemovedGeos.push(geo);
          }
          // Evict persistent geometry cache clones for features that vanish after redo.
          const cachedGeo = bodyGeometryCache.get(f.id);
          if (cachedGeo) { redoRemovedGeos.push(cachedGeo); bodyGeometryCache.delete(f.id); }
        }
        set({
          redoStack: stack,
          undoStack: [...state.undoStack, currentSnapshot],
          features: parsed.features.map((f) => {
            const restored = deserializeFeature(f as Feature);
            const live = liveMeshById.get(restored.id);
            if (
              live instanceof THREE.Mesh &&
              (live as THREE.Mesh).geometry?.attributes?.position
            ) {
              return { ...restored, mesh: live };
            }
            return restored;
          }),
          sketches: restoredSketches,
          activeSketch: restoredActiveSketch,
          featureGroups: parsed.featureGroups,
          designConfigurations:
            parsed.designConfigurations ?? state.designConfigurations,
          activeDesignConfigurationId:
            parsed.activeDesignConfigurationId ??
            state.activeDesignConfigurationId,
          parameters: (parsed.parameters as CADState['parameters'] | undefined) ?? state.parameters,
          constructionPlanes:
            (parsed.constructionPlanes as CADState['constructionPlanes'] | undefined) ?? state.constructionPlanes,
          constructionAxes:
            (parsed.constructionAxes as CADState['constructionAxes'] | undefined) ?? state.constructionAxes,
          constructionPoints:
            (parsed.constructionPoints as CADState['constructionPoints'] | undefined) ?? state.constructionPoints,
          jointOrigins:
            (parsed.jointOrigins as CADState['jointOrigins'] | undefined) ?? state.jointOrigins,
          contactSets:
            (parsed.contactSets as CADState['contactSets'] | undefined) ?? state.contactSets,
          selectionSets:
            (parsed.selectionSets as CADState['selectionSets'] | undefined) ?? state.selectionSets,
          canvasReferences:
            (parsed.canvasReferences as CADState['canvasReferences'] | undefined) ?? state.canvasReferences,
          formBodies:
            (parsed.formBodies as CADState['formBodies'] | undefined) ?? state.formBodies,
          frozenFormVertices: parsed.frozenFormVertices ?? state.frozenFormVertices,
          units: parsed.units === 'in' || parsed.units === 'mm' ? parsed.units : state.units,
          statusMessage: "Redo",
        });
        // OCC-7.3 redo: restore BRepBodies from the redo snapshot + reconnect meshes.
        if (Array.isArray((parsed as Record<string, unknown>).occBodies)) {
          void restoreOccSnapshot(
            (parsed as Record<string, unknown>).occBodies as OccBodySnapshot[],
          ).then(() => {
            for (const f of get().features) {
              const mesh = f.mesh as THREE.Mesh | undefined;
              if (!mesh?.isMesh || mesh.userData['brepBodyId']) continue;
              const bodies = globalBRepBodyRegistry.getByFeature(f.id);
              if (bodies.length > 0) mesh.userData['brepBodyId'] = bodies[0].id;
            }
          });
        }
        if (redoRemovedGeos.length > 0)
          setTimeout(() => {
            for (const g of redoRemovedGeos) g.dispose();
          }, 0);
      } catch {
        // Malformed snapshot — pop it so the user can keep redoing past it.
        set({
          redoStack: stack,
          statusMessage: "Redo: corrupted snapshot skipped",
        });
      }
    },
  };
}
