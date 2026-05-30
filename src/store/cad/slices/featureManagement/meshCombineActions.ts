import * as THREE from "three";
import type { Feature } from "../../../../types/cad";
import { GeometryEngine } from "../../../../engine/GeometryEngine";
import type { CADSliceContext } from "../../sliceContext";
import type { CADState } from "../../state";

export function createMeshCombineActions({ set, get }: CADSliceContext): Partial<CADState> {
  return {
    commitMeshCombine: (featureIds) => {
      const { features } = get();
      const meshes: THREE.Mesh[] = [];
      for (const fid of featureIds) {
        const f = features.find((x) => x.id === fid);
        if (f?.mesh instanceof THREE.Mesh) meshes.push(f.mesh as THREE.Mesh);
      }
      if (meshes.length < 2) {
        get().setStatusMessage("Mesh Combine: need at least 2 mesh features");
        return;
      }
      const combined = GeometryEngine.combineMeshes(meshes);
      combined.castShadow = true;
      combined.receiveShadow = true;
      const n =
        features.filter((f) => f.name.startsWith("Mesh Combine")).length + 1;
      const newFeature: Feature = {
        id: crypto.randomUUID(),
        name: `Mesh Combine ${n}`,
        type: "import",
        params: {
          featureKind: "mesh-combine",
          sourceIds: featureIds.join(","),
        },
        visible: true,
        suppressed: false,
        timestamp: Date.now(),
        mesh: combined,
        bodyKind: "mesh",
      };
      set((state) => ({
        features: [...state.features, newFeature],
        statusMessage: "Meshes combined",
      }));
    },
  };
}
