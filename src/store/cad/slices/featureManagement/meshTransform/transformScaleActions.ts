import * as THREE from "three";
import { GeometryEngine } from "../../../../../engine/GeometryEngine";
import { globalBRepBodyRegistry } from "../../../../../engine/occ/globalRegistry";
import { getOccSync } from "../../../../../engine/occ/loader";
import { disposeMeshDeferred } from "../../../../../engine/occ/picking";
import { occScaleWithInstance } from "../../../../../engine/occ/ops/scale";
import { createRegisteredOccMesh } from "../../../../../engine/occ/registeredMesh";
import { errorMessage } from "../../../../../utils/errorHandling";
import type { CADSliceContext } from "../../../sliceContext";
import type { CADState } from "../../../state";
import { recomputeBooleanDependents } from "../featureBooleanUtils";

export function createTransformScaleActions({ set, get }: CADSliceContext): Partial<CADState> {
  return {
    commitMeshTransform: (featureId, params) => {
      const { features } = get();
      const feature = features.find((f) => f.id === featureId);
      if (!feature?.mesh) {
        get().setStatusMessage("Mesh Transform: no mesh on selected feature");
        return;
      }
      const srcMesh = feature.mesh as THREE.Mesh;
      if (!(srcMesh instanceof THREE.Mesh)) {
        get().setStatusMessage("Mesh Transform: feature is not a mesh");
        return;
      }
      const finite = (v: number) => Number.isFinite(v);
      if (
        !finite(params.tx) ||
        !finite(params.ty) ||
        !finite(params.tz) ||
        !finite(params.rx) ||
        !finite(params.ry) ||
        !finite(params.rz) ||
        !finite(params.scale) ||
        params.scale === 0
      ) {
        get().setStatusMessage(
          "Mesh Transform: invalid params (translate/rotate must be finite, scale != 0)",
        );
        return;
      }
      get().pushUndo();
      const newMesh = GeometryEngine.transformMesh(srcMesh, params);
      newMesh.castShadow = true;
      newMesh.receiveShadow = true;
      const oldMesh = feature.mesh;
      set((state) => ({
        features: state.features.map((f) =>
          f.id === featureId ? { ...f, mesh: newMesh } : f,
        ),
        statusMessage: "Mesh transformed",
      }));
      if (oldMesh instanceof THREE.Mesh) disposeMeshDeferred(oldMesh as THREE.Mesh);
    },

    commitScale: (featureId, sx, sy, sz) => {
      const { features } = get();
      const feature = features.find((f) => f.id === featureId);
      if (!feature?.mesh) {
        get().setStatusMessage("Scale: no mesh on selected feature");
        return;
      }
      const srcMesh = feature.mesh as THREE.Mesh;
      if (!(srcMesh instanceof THREE.Mesh)) {
        get().setStatusMessage("Scale: feature is not a mesh");
        return;
      }
      if (
        !Number.isFinite(sx) ||
        !Number.isFinite(sy) ||
        !Number.isFinite(sz) ||
        sx === 0 ||
        sy === 0 ||
        sz === 0
      ) {
        get().setStatusMessage("Scale: factors must be finite and non-zero");
        return;
      }
      const scaleOccBodyId = srcMesh.userData['brepBodyId'] as string | undefined;
      if (scaleOccBodyId) {
        const occ = getOccSync();
        const scaleBody = occ ? globalBRepBodyRegistry.get(scaleOccBodyId) : undefined;
        if (occ && scaleBody) {
          const scaleFactor = (sx === sy && sy === sz)
            ? sx
            : { x: sx, y: sy, z: sz };
          const newFeatureId = featureId;
          const scaleResult = occScaleWithInstance(occ.oc, scaleBody, new THREE.Vector3(0, 0, 0), scaleFactor, { sourceFeatureId: newFeatureId });
          if (scaleResult) {
            let scaledMesh: THREE.Mesh;
            try {
              scaleResult.sourceFeatureId = newFeatureId;
              scaledMesh = createRegisteredOccMesh(occ.oc, scaleResult, srcMesh.material, newFeatureId);
            } catch (err) {
              get().setStatusMessage(`Scale (OCC) failed: ${errorMessage(err, "unknown error")}`);
              return;
            }
            get().pushUndo();
            set((state) => ({
              features: recomputeBooleanDependents(
                state.features.map((f) => f.id === featureId ? { ...f, mesh: scaledMesh } : f),
                [featureId],
              ),
              statusMessage: `Scaled (OCC) ${sx}x${sy}x${sz}`,
            }));
            disposeMeshDeferred(srcMesh);
            return;
          }
        }
      }

      get().pushUndo();
      const newMesh = GeometryEngine.scaleMesh(srcMesh, sx, sy, sz);
      newMesh.castShadow = true;
      newMesh.receiveShadow = true;
      set((state) => {
        const features = state.features.map((f) =>
          f.id === featureId ? { ...f, mesh: newMesh } : f,
        );
        return {
          features: recomputeBooleanDependents(features, [featureId]),
          statusMessage: `Scaled ${sx}x${sy}x${sz}`,
        };
      });
      disposeMeshDeferred(srcMesh);
    },
  };
}
