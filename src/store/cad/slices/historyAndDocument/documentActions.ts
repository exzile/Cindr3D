import type { Feature, FeatureGroup, Sketch } from "../../../../types/cad";
import type { CADSliceContext } from "../../sliceContext";
import type { CADState } from "../../state";
import {
  deserializeFeature,
  deserializeSketch,
  serializeFeature,
} from "../../persistence";
import { globalBRepBodyRegistry } from "../../../../engine/occ/globalRegistry";
import { clearFeatureEvaluationCache } from "../../../../engine/occ/featureEvaluator";
import { bodyGeometryCache, bodyIdGeometryCache } from "../../../meshRegistry";
import * as THREE from "three";

const disposeFeatureObjectGeometry = (mesh: Feature["mesh"] | undefined) => {
  if (!mesh) return;
  const disposeMaterial = (
    material: THREE.Material | THREE.Material[] | null | undefined,
  ) => {
    if (!material) return;
    const materials = Array.isArray(material) ? material : [material];
    for (const entry of materials) {
      if (entry.userData?.shared) continue;
      entry.dispose();
    }
  };
  const object = mesh as unknown as THREE.Object3D;
  if (object instanceof THREE.Mesh) {
    object.geometry?.dispose();
    disposeMaterial(object.material);
    return;
  }
  if (object instanceof THREE.Group) {
    object.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry?.dispose();
        disposeMaterial(child.material);
      }
    });
  }
};

export function createDocumentActions({ set, get }: CADSliceContext): Partial<CADState> {
  return {
    // ── UTL2 — Save / Load ───────────────────────────────────────────────────
    newDocument: () => {
      // Dispose stored feature meshes before clearing state.
      for (const f of get().features) disposeFeatureObjectGeometry(f.mesh);
      for (const geo of bodyGeometryCache.values()) geo.dispose();
      bodyGeometryCache.clear();
      for (const geo of bodyIdGeometryCache.values()) geo.dispose();
      bodyIdGeometryCache.clear();
      // Dispose all OCC WASM bodies and clear the evaluator cache so none
      // of the prior document's shapes linger on the C++ heap.
      globalBRepBodyRegistry.clear();
      clearFeatureEvaluationCache();
      set({
        // Geometry content
        features: [],
        sketches: [],
        featureGroups: [],
        constructionPlanes: [],
        constructionAxes: [],
        constructionPoints: [],
        jointOrigins: [],
        contactSets: [],
        canvasReferences: [],
        parameters: [],
        // History
        undoStack: [],
        redoStack: [],
        // Selection / active state
        selectedEntityIds: [],
        selectedFeatureId: null,
        activeSketch: null,
        activeTool: "select",
        activeDialog: null,
        dialogPayload: null,
        sketchPlaneSelecting: false,
        rollbackIndex: -1,
        statusMessage: "New document",
      });
    },

    getDesignJSON: () => {
      const state = get();
      const saveObj = {
        version: 1,
        features: state.features.map((f) => serializeFeature(f)),
        sketches: state.sketches.map((s) => ({
          ...s,
          planeNormal: s.planeNormal
            ? [s.planeNormal.x, s.planeNormal.y, s.planeNormal.z]
            : null,
          planeOrigin: s.planeOrigin
            ? [s.planeOrigin.x, s.planeOrigin.y, s.planeOrigin.z]
            : null,
        })),
        featureGroups: state.featureGroups,
        historyEnabled: state.historyEnabled,
      };
      return JSON.stringify(saveObj, null, 2);
    },

    saveToFile: (filename = "design.dznd") => {
      const json = get().getDesignJSON();
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const safeName = filename.endsWith(".dznd")
        ? filename
        : `${filename}.dznd`;
      a.download = safeName;
      a.click();
      URL.revokeObjectURL(url);
      get().setStatusMessage(`Design saved: ${safeName}`);
    },

    loadFromFile: (json: string) => {
      // Dispose stored feature meshes before replacing the document.
      for (const f of get().features) disposeFeatureObjectGeometry(f.mesh);
      for (const geo of bodyGeometryCache.values()) geo.dispose();
      bodyGeometryCache.clear();
      for (const geo of bodyIdGeometryCache.values()) geo.dispose();
      bodyIdGeometryCache.clear();
      try {
        const parsed = JSON.parse(json) as {
          version: number;
          features: Feature[];
          sketches: Array<
            Sketch & {
              planeNormal: [number, number, number] | null;
              planeOrigin: [number, number, number] | null;
            }
          >;
          featureGroups: FeatureGroup[];
          historyEnabled?: boolean;
        };
        if (!parsed || !Array.isArray(parsed.features)) {
          throw new Error("Invalid snapshot: missing features array");
        }
        if (!Array.isArray(parsed.sketches)) {
          throw new Error("Invalid snapshot: missing sketches array");
        }
        set({
          features: (parsed.features ?? []).map((f) => deserializeFeature(f)),
          sketches: (parsed.sketches ?? []).map((s) =>
            deserializeSketch(s as unknown as Sketch),
          ),
          featureGroups: parsed.featureGroups ?? [],
          historyEnabled: parsed.historyEnabled ?? true,
          statusMessage: "Design loaded from file",
        });
      } catch {
        get().setStatusMessage("Load failed: invalid file format");
      }
    },
  };
}
