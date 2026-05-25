import * as THREE from "three";
import type {
  Body,
  Component,
  Feature,
  FeatureGroup,
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
import { detachTessellationFromMesh } from "../../../../engine/occ/picking";
import { restoreOccSnapshot, type OccBodySnapshot } from "../../../../engine/occ/occSnapshot";
import type { DesignConfiguration } from "../../state/coreState";
import { bodyGeometryCache } from "../../../meshRegistry";
import { useComponentStore } from "../../../componentStore";

type HistorySketch = Sketch & {
  planeNormal: [number, number, number] | null;
  planeOrigin: [number, number, number] | null;
};

type HistorySnapshot = {
  features: Feature[];
  sketches: HistorySketch[];
  activeSketch?: HistorySketch | null;
  featureGroups: FeatureGroup[];
  designConfigurations?: DesignConfiguration[];
  activeDesignConfigurationId?: string;
  componentStore?: {
    rootComponentId: string;
    activeComponentId: string | null;
    selectedBodyId: string | null;
    components: Record<
      string,
      Component & { transform: number[] | { elements?: number[] } }
    >;
    bodies: Record<string, Body>;
  };
};

const restoreComponentStoreSnapshot = (
  snapshot: HistorySnapshot["componentStore"],
) => {
  if (!snapshot) return;

  // Dispose GPU geometry for bodies that exist now but are absent from the
  // incoming snapshot (e.g. bodies created by copyBody / pasteBody that are
  // being rolled back). The snapshot restores mesh: null so the live
  // BufferGeometry would otherwise become unreachable without being freed.
  const currentBodies = useComponentStore.getState().bodies;
  const snapshotBodyIds = new Set(Object.keys(snapshot.bodies));
  for (const [id, body] of Object.entries(currentBodies)) {
    if (!snapshotBodyIds.has(id) && body.mesh) {
      if (body.mesh instanceof THREE.Mesh) {
        body.mesh.geometry?.dispose();
        detachTessellationFromMesh(body.mesh);
      } else if (body.mesh instanceof THREE.Group) {
        body.mesh.traverse((child) => {
          if (child instanceof THREE.Mesh) { child.geometry?.dispose(); detachTessellationFromMesh(child); }
        });
      }
      // Also evict the OCC body if one was registered for this mesh.
      const brepBodyId =
        body.mesh instanceof THREE.Mesh
          ? (body.mesh.userData["brepBodyId"] as string | undefined)
          : undefined;
      if (brepBodyId) globalBRepBodyRegistry.delete(brepBodyId);
    }
  }

  useComponentStore.setState({
    rootComponentId: snapshot.rootComponentId,
    activeComponentId: snapshot.activeComponentId ?? snapshot.rootComponentId,
    selectedBodyId: snapshot.selectedBodyId,
    components: Object.fromEntries(
      Object.entries(snapshot.components).map(([id, component]) => {
        const rawTransform = component.transform;
        const transformArray = Array.isArray(rawTransform)
          ? rawTransform
          : rawTransform?.elements;
        return [
          id,
          {
            ...component,
            transform: Array.isArray(transformArray)
              ? new THREE.Matrix4().fromArray(transformArray)
              : new THREE.Matrix4(),
          },
        ];
      }),
    ),
    bodies: Object.fromEntries(
      Object.entries(snapshot.bodies).map(([id, body]) => [
        id,
        { ...body, mesh: null },
      ]),
    ),
  });
};

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
