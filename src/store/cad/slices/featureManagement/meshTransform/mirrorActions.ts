import * as THREE from "three";
import { GeometryEngine } from "../../../../../engine/GeometryEngine";
import { globalBRepBodyRegistry } from "../../../../../engine/occ/globalRegistry";
import { getOccSync } from "../../../../../engine/occ/loader";
import { occMirrorWithInstance, type OccMirrorPlane } from "../../../../../engine/occ/ops/mirror";
import { createRegisteredOccMesh } from "../../../../../engine/occ/registeredMesh";
import { errorMessage } from "../../../../../utils/errorHandling";
import type { Feature } from "../../../../../types/cad";
import type { CADSliceContext } from "../../sliceContext";
import type { CADState } from "../../state";

function mirrorPlaneFromString(plane: string): OccMirrorPlane {
  const origin = new THREE.Vector3(0, 0, 0);
  if (plane === 'XY') return { origin, normal: new THREE.Vector3(0, 0, 1) };
  if (plane === 'XZ') return { origin, normal: new THREE.Vector3(0, 1, 0) };
  return { origin, normal: new THREE.Vector3(1, 0, 0) };
}

export function createMirrorActions({ set, get }: CADSliceContext): Partial<CADState> {
  return {
    commitMirrorFeature: (featureId, plane) => {
      const { features } = get();
      const feature = features.find((f) => f.id === featureId);
      if (!feature?.mesh) {
        get().setStatusMessage("Mirror Feature: no mesh on selected feature");
        return;
      }
      const srcMesh = feature.mesh as THREE.Mesh;
      if (!(srcMesh instanceof THREE.Mesh)) {
        get().setStatusMessage("Mirror Feature: feature is not a mesh");
        return;
      }
      const occBodyId = srcMesh.userData['brepBodyId'] as string | undefined;
      if (occBodyId) {
        const occ = getOccSync();
        const srcBody = occ ? globalBRepBodyRegistry.get(occBodyId) : undefined;
        if (occ && srcBody) {
          const newFeatureId = crypto.randomUUID();
          const occResult = occMirrorWithInstance(occ.oc, srcBody, mirrorPlaneFromString(plane), { sourceFeatureId: newFeatureId });
          if (occResult) {
            let occMirroredMesh: THREE.Mesh;
            try {
              occResult.sourceFeatureId = newFeatureId;
              occMirroredMesh = createRegisteredOccMesh(occ.oc, occResult, srcMesh.material, newFeatureId);
            } catch (err) {
              get().setStatusMessage(`Mirror Feature failed: ${errorMessage(err, "unknown error")}`);
              return;
            }
            const nOcc = features.filter((f) => f.name.startsWith('Mirror Feature')).length + 1;
            const occMirrorFeature: Feature = {
              id: newFeatureId,
              name: `Mirror Feature ${nOcc}`,
              type: 'mirror',
              params: { featureKind: 'mirror-feature', sourceId: featureId, plane },
              visible: true,
              suppressed: false,
              timestamp: Date.now(),
              mesh: occMirroredMesh,
              bodyKind: feature.bodyKind,
            };
            get().pushUndo();
            set((state) => ({
              features: [...state.features, occMirrorFeature],
              statusMessage: `Feature mirrored on ${plane} plane (OCC)`,
            }));
            return;
          }
        }
      }

      get().pushUndo();
      const mirrored = GeometryEngine.mirrorMesh(srcMesh, plane);
      mirrored.castShadow = true;
      mirrored.receiveShadow = true;
      const n =
        features.filter((f) => f.name.startsWith("Mirror Feature")).length + 1;
      const newFeature: Feature = {
        id: crypto.randomUUID(),
        name: `Mirror Feature ${n}`,
        type: "mirror",
        params: { featureKind: "mirror-feature", sourceId: featureId, plane },
        visible: true,
        suppressed: false,
        timestamp: Date.now(),
        mesh: mirrored,
        bodyKind: feature.bodyKind,
      };
      set((state) => ({
        features: [...state.features, newFeature],
        statusMessage: `Feature mirrored on ${plane} plane`,
      }));
    },
  };
}
