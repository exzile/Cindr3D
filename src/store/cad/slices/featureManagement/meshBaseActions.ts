import * as THREE from "three";
import type { Feature } from "../../../../types/cad";
import { GeometryEngine } from "../../../../engine/GeometryEngine";
import type { CADSliceContext } from "../../sliceContext";
import type { CADState } from "../../state";
import { errorMessage } from "../../../../utils/errorHandling";
import { BODY_MATERIAL } from "../../../../components/viewport/scene/bodyMaterial";
import {
  detachTessellationFromMesh,
  disposeMeshDeferred,
  disposeMeshesDeferred,
} from "../../../../engine/occ/picking";

export function createMeshBaseActions({
  set,
  get,
}: CADSliceContext): Partial<CADState> {
  return {
    // D119 Tessellate
    tessellateFeature: (featureId) => {
      const { features } = get();
      const feature = features.find((f) => f.id === featureId);
      if (!feature?.mesh) {
        get().setStatusMessage("No mesh found on selected feature");
        return;
      }
      const geom = GeometryEngine.extractMeshGeometry(
        feature.mesh as THREE.Mesh | THREE.Group,
      );
      if (!geom) {
        get().setStatusMessage("No mesh found on selected feature");
        return;
      }
      const newMesh = new THREE.Mesh(geom, BODY_MATERIAL);
      newMesh.castShadow = true;
      newMesh.receiveShadow = true;
      const n =
        features.filter((f) => f.params.kind === "tessellate").length + 1;
      const newFeature: Feature = {
        id: crypto.randomUUID(),
        name: `Tessellate ${n}`,
        type: "primitive",
        params: { kind: "tessellate" },
        visible: true,
        suppressed: false,
        timestamp: Date.now(),
        mesh: newMesh,
        bodyKind: "mesh",
      };
      set((state) => ({
        features: [...state.features, newFeature],
        statusMessage: "Feature tessellated as mesh body",
      }));
    },
    // D125 Mesh Reduce
    reduceMesh: (featureId, reductionPercent) => {
      const { features } = get();
      const feature = features.find((f) => f.id === featureId);
      if (!feature?.mesh) {
        get().setStatusMessage("Mesh Reduce: selected feature has no mesh");
        return;
      }
      // Build a new simplified mesh rather than mutating the existing one in-place.
      // Mutating geometry on a Zustand-owned object bypasses set() and leaves
      // React unaware of the change. Instead we clone, simplify, then replace
      // the feature in state via set().
      const applyToMesh = async (m: THREE.Mesh): Promise<THREE.Mesh> => {
        const newGeom = await GeometryEngine.simplifyGeometry(
          m.geometry,
          reductionPercent,
        );
        const clone = new THREE.Mesh(newGeom, m.material);
        clone.castShadow = m.castShadow;
        clone.receiveShadow = m.receiveShadow;
        Object.assign(clone.userData, m.userData);
        detachTessellationFromMesh(clone);
        return clone;
      };
      const featureMesh = feature.mesh as THREE.Object3D;
      // Re-validate the feature/mesh AFTER the await — by the time the simplify
      // promise resolves, the user could have deleted the feature, replaced its
      // mesh, or kicked off another reduce. Without this guard the post-await
      // set() would write the new mesh into whatever feature row currently has
      // the matching id, and dispose a mesh that's already been replaced.
      const stillValid = (
        currentMesh: THREE.Object3D | null | undefined,
      ): boolean => {
        const live = get().features.find((f) => f.id === featureId);
        return !!live && live.mesh === currentMesh;
      };
      const onErr = (err: unknown) => {
        get().setStatusMessage(
          `Mesh Reduce failed: ${errorMessage(err, "unknown error")}`,
        );
      };
      if (featureMesh instanceof THREE.Mesh) {
        applyToMesh(featureMesh)
          .then((newMesh) => {
            if (!stillValid(featureMesh)) {
              // Stale — drop the freshly built mesh so we don't leak it
              newMesh.geometry.dispose();
              return;
            }
            const oldMesh = feature.mesh;
            set((state) => ({
              features: state.features.map((f) =>
                f.id === featureId ? { ...f, mesh: newMesh } : f,
              ),
            }));
            // Dispose old geometry AFTER removing from state
            if (oldMesh instanceof THREE.Mesh) disposeMeshDeferred(oldMesh);
            get().setStatusMessage(`Mesh reduced by ${reductionPercent}%`);
          })
          .catch(onErr);
      } else if (featureMesh instanceof THREE.Group) {
        const meshes: THREE.Mesh[] = [];
        featureMesh.traverse((child) => {
          if (child instanceof THREE.Mesh) meshes.push(child);
        });
        Promise.all(meshes.map(applyToMesh))
          .then((newMeshes) => {
            if (!stillValid(featureMesh)) {
              // Stale — drop all freshly built meshes' geometries
              for (const m of newMeshes) m.geometry.dispose();
              return;
            }
            const oldGroup = feature.mesh;
            const newGroup = new THREE.Group();
            newMeshes.forEach((m) => newGroup.add(m));
            set((state) => ({
              features: state.features.map((f) =>
                f.id === featureId
                  ? { ...f, mesh: newGroup }
                  : f,
              ),
            }));
            // Dispose old geometries AFTER removal
            if (oldGroup instanceof THREE.Group) {
              const oldMeshes: THREE.Mesh[] = [];
              oldGroup.traverse((child) => {
                if (child instanceof THREE.Mesh) oldMeshes.push(child);
              });
              disposeMeshesDeferred(oldMeshes);
            }
            get().setStatusMessage(`Mesh reduced by ${reductionPercent}%`);
          })
          .catch(onErr);
      } else {
        get().setStatusMessage("Mesh Reduce: feature is not simplifiable");
      }
    },
    // D115 Reverse Normals
    reverseNormals: (featureId) => {
      const { features } = get();
      const feature = features.find((f) => f.id === featureId);
      if (!feature?.mesh) {
        get().setStatusMessage("Reverse Normal: selected feature has no mesh");
        return;
      }
      const featureMesh = feature.mesh as THREE.Object3D;
      if (featureMesh instanceof THREE.Mesh) {
        GeometryEngine.reverseNormals(featureMesh.geometry);
        detachTessellationFromMesh(featureMesh);
      } else if (featureMesh instanceof THREE.Group) {
        featureMesh.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            GeometryEngine.reverseNormals(child.geometry);
            detachTessellationFromMesh(child);
          }
        });
      }
      // Mutating mesh.geometry in place doesn't notify Zustand subscribers — replace
      // the features array reference so the timeline / re-renderers see the change.
      set((state) => ({
        features: state.features.map((f) =>
          f.id === featureId ? { ...f } : f,
        ),
      }));
      get().setStatusMessage("Normals reversed");
    },
    // UTL1 — Show All / Hide
    showAllFeatures: () =>
      set((state) => ({
        features: state.features.map((f) => ({ ...f, visible: true })),
        statusMessage: "All features shown",
      })),
    hideFeature: (id) =>
      set((state) => ({
        features: state.features.map((f) =>
          f.id === id ? { ...f, visible: false } : f,
        ),
        statusMessage: "Feature hidden",
      })),

    // MSH8 — commitReverseNormal: clone geometry with flipped normals
    commitReverseNormal: (featureId) => {
      const { features } = get();
      const feature = features.find((f) => f.id === featureId);
      if (!feature?.mesh) {
        get().setStatusMessage("Reverse Normal: no mesh on selected feature");
        return;
      }
      const srcMesh = feature.mesh as THREE.Mesh;
      if (!(srcMesh instanceof THREE.Mesh)) {
        get().setStatusMessage("Reverse Normal: feature is not a mesh");
        return;
      }
      const newMesh = GeometryEngine.reverseMeshNormals(srcMesh);
      newMesh.castShadow = true;
      newMesh.receiveShadow = true;
      detachTessellationFromMesh(newMesh);
      // Dispose the previous geometry — reverseMeshNormals returns a fresh
      // mesh with cloned geometry, so the source's BufferGeometry is now orphan.
      const oldMesh = feature.mesh;
      set((state) => ({
        features: state.features.map((f) =>
          f.id === featureId ? { ...f, mesh: newMesh } : f,
        ),
        statusMessage: "Mesh normals reversed",
      }));
      if (oldMesh instanceof THREE.Mesh) disposeMeshDeferred(oldMesh);
    },

    toggleFeatureVisibility: (id) =>
      set((state) => ({
        features: state.features.map((f) =>
          f.id === id ? { ...f, visible: !f.visible } : f,
        ),
      })),
    toggleFeatureSuppressed: (id) =>
      set((state) => {
        const features = state.features.map((f) =>
          f.id === id ? { ...f, suppressed: !f.suppressed } : f,
        );
        const target = features.find((feature) => feature.id === id);
        return {
          features,
          designConfigurations: state.designConfigurations.map(
            (configuration) =>
              configuration.id === state.activeDesignConfigurationId && target
                ? {
                    ...configuration,
                    featureSuppression: {
                      ...configuration.featureSuppression,
                      [id]: !!target.suppressed,
                    },
                    updatedAt: Date.now(),
                  }
                : configuration,
          ),
        };
      }),
  };
}
