import * as THREE from "three";
import type { CADSliceContext } from "../../sliceContext";
import type { CADState } from "../../state";
import { GeometryEngine } from "../../../../engine/GeometryEngine";
import { errorMessage } from "../../../../utils/errorHandling";
import { globalBRepBodyRegistry } from "../../../../engine/occ/globalRegistry";
import { occMirrorWithInstance, type OccMirrorPlane } from "../../../../engine/occ/ops/mirror";
import { occScaleWithInstance } from "../../../../engine/occ/ops/scale";
import { createRegisteredOccMesh } from "../../../../engine/occ/registeredMesh";
import { disposeMeshDeferred } from "../../../../engine/occ/picking";
import { recomputeBooleanDependents } from "./featureBooleanUtils";
import { getOccSync } from "../../../../engine/occ/loader";
import type { Feature } from "../../../../types/cad";

function mirrorPlaneFromString(plane: string): OccMirrorPlane {
  const origin = new THREE.Vector3(0, 0, 0);
  if (plane === 'XY') return { origin, normal: new THREE.Vector3(0, 0, 1) };
  if (plane === 'XZ') return { origin, normal: new THREE.Vector3(0, 1, 0) };
  return { origin, normal: new THREE.Vector3(1, 0, 0) }; // YZ
}

export function createMeshTransformActions({
  set,
  get,
}: CADSliceContext): Partial<CADState> {
  return {
    // MSH11 — commitMeshTransform: apply translate/rotate/scale to a mesh
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
      // Validate inputs before mutating — scale=0 collapses the mesh permanently
      // and there's no rollback path. NaN/Infinity rotations propagate into
      // the geometry and corrupt every downstream raycast.
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
      // Defer disposal so undo can still reference the old geometry.
      // setTimeout(0) ensures the set() completes and state is stable first.
      if (oldMesh instanceof THREE.Mesh) disposeMeshDeferred(oldMesh as THREE.Mesh);
    },

    // SLD13 — commitScale: scale a feature mesh by sx/sy/sz
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
      // Validate before mutating — any zero axis flattens the mesh permanently.
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
      // OCC path: use exact BRep scale when source has an OCC body
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
              statusMessage: `Scaled (OCC) ${sx}×${sy}×${sz}`,
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
          statusMessage: `Scaled ${sx}×${sy}×${sz}`,
        };
      });
      // Defer so the undo snapshot can still reference the old geometry if needed.
      disposeMeshDeferred(srcMesh);
    },

    // Align tool — geometry-pair picking state
    alignPickStage: "idle",
    alignPickKind: "face",
    alignSource: null,
    alignTarget: null,
    setAlignPickStage: (stage) => set({ alignPickStage: stage }),
    setAlignPickKind: (kind) => set({ alignPickKind: kind }),
    setAlignSource: (pick) => set({ alignSource: pick }),
    setAlignTarget: (pick) => set({ alignTarget: pick }),
    resetAlign: () =>
      set({ alignPickStage: "idle", alignSource: null, alignTarget: null }),

    // Align tool — compute rigid transform from picked source→target geometry
    // and apply it to the source body (primitive via params, else bake mesh).
    commitAlign: (opts) => {
      const { alignSource, alignTarget, features } = get();
      if (!alignSource || !alignTarget) {
        get().setStatusMessage(
          "Align: pick a source and a target geometry first",
        );
        return;
      }
      if (!alignSource.featureId) {
        get().setStatusMessage("Align: source must be on a body");
        return;
      }
      const feature = features.find((f) => f.id === alignSource.featureId);
      if (!feature) {
        get().setStatusMessage("Align: source body not found");
        return;
      }

      const srcPt = new THREE.Vector3(...alignSource.point);
      const tgtPt = new THREE.Vector3(...alignTarget.point);

      const wantRotation =
        opts.moveType === "rotate" ||
        (opts.moveType === "align" && opts.allowRotation);

      // Rotation aligning source direction → desired target direction.
      const rot = new THREE.Quaternion();
      if (wantRotation && alignSource.dir && alignTarget.dir) {
        const sDir = new THREE.Vector3(...alignSource.dir).normalize();
        let tDir = new THREE.Vector3(...alignTarget.dir).normalize();
        // Faces mate when normals oppose (flip = same dir). Edges align when
        // directions match (flip = reversed).
        const bothFaces =
          alignSource.kind === "face" && alignTarget.kind === "face";
        if (bothFaces ? !opts.flip : opts.flip) tDir = tDir.negate();
        if (sDir.lengthSq() > 1e-9 && tDir.lengthSq() > 1e-9) {
          rot.setFromUnitVectors(sDir, tDir);
        }
      }

      // World transform M applied to the source body:
      //  align     : T(tgt) · R · T(-src)   (rotate about src point, move to tgt)
      //  rotate    : T(src) · R · T(-src)   (rotate in place about src point)
      //  translate : T(tgt - src)           (pure translation, no rotation)
      const M = new THREE.Matrix4();
      if (opts.moveType === "translate") {
        M.makeTranslation(
          tgtPt.x - srcPt.x,
          tgtPt.y - srcPt.y,
          tgtPt.z - srcPt.z,
        );
      } else {
        const pivotBack = new THREE.Matrix4().makeTranslation(
          -srcPt.x,
          -srcPt.y,
          -srcPt.z,
        );
        const Rm = new THREE.Matrix4().makeRotationFromQuaternion(rot);
        const dest = opts.moveType === "rotate" ? srcPt : tgtPt;
        const post = new THREE.Matrix4().makeTranslation(
          dest.x,
          dest.y,
          dest.z,
        );
        M.multiplyMatrices(post, Rm).multiply(pivotBack);
      }

      get().pushUndo();

      // Primitive bodies are regenerated from params each render — write the
      // transform back into x/y/z + rx/ry/rz instead of baking geometry.
      if (
        feature.type === "primitive" &&
        !(feature.mesh instanceof THREE.Mesh)
      ) {
        const p = feature.params;
        const curPos = new THREE.Vector3(
          (p.x as number) || 0,
          (p.y as number) || 0,
          (p.z as number) || 0,
        );
        const curQuat = new THREE.Quaternion().setFromEuler(
          new THREE.Euler(
            THREE.MathUtils.degToRad((p.rx as number) || 0),
            THREE.MathUtils.degToRad((p.ry as number) || 0),
            THREE.MathUtils.degToRad((p.rz as number) || 0),
            "XYZ",
          ),
        );
        const curMat = new THREE.Matrix4().compose(
          curPos,
          curQuat,
          new THREE.Vector3(1, 1, 1),
        );
        const newMat = new THREE.Matrix4().multiplyMatrices(M, curMat);
        const outPos = new THREE.Vector3();
        const outQuat = new THREE.Quaternion();
        const outScale = new THREE.Vector3();
        newMat.decompose(outPos, outQuat, outScale);
        const e = new THREE.Euler().setFromQuaternion(outQuat, "XYZ");
        get().updateFeatureParams(feature.id, {
          ...p,
          x: outPos.x,
          y: outPos.y,
          z: outPos.z,
          rx: THREE.MathUtils.radToDeg(e.x),
          ry: THREE.MathUtils.radToDeg(e.y),
          rz: THREE.MathUtils.radToDeg(e.z),
        });
        set({
          statusMessage: `Aligned ${feature.name}`,
          alignPickStage: "idle",
          alignSource: null,
          alignTarget: null,
        });
        return;
      }

      // Mesh-backed bodies — bake the world matrix into a cloned geometry.
      if (feature.mesh instanceof THREE.Mesh) {
        const srcMesh = feature.mesh;
        const geom = srcMesh.geometry.clone();
        geom.applyMatrix4(M);
        // Topology polylines are in the pre-transform local frame; delete them so
        // the lazy picker re-extracts from the new world-baked vertex positions.
        delete geom.userData.topology;
        delete geom.userData._topoV;
        geom.computeVertexNormals();
        const newMesh = new THREE.Mesh(geom, srcMesh.material);
        newMesh.userData = { ...srcMesh.userData };
        newMesh.castShadow = true;
        newMesh.receiveShadow = true;
        set((state) => ({
          features: recomputeBooleanDependents(
            state.features.map((f) =>
              f.id === feature.id ? { ...f, mesh: newMesh } : f,
            ),
            [feature.id],
          ),
          statusMessage: `Aligned ${feature.name}`,
          alignPickStage: "idle",
          alignSource: null,
          alignTarget: null,
        }));
        disposeMeshDeferred(srcMesh);
        return;
      }

      get().setStatusMessage("Align: unsupported body type (no mesh)");
    },

    // SLD17 — commitMirrorFeature: mirror a feature's mesh across a plane
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
      // OCC path: use exact BRep mirror when source has an OCC body
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
