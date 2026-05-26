import * as THREE from "three";
import { disposeMeshDeferred } from "../../../../../engine/occ/picking";
import type { CADSliceContext } from "../../sliceContext";
import type { CADState } from "../../state";
import { recomputeBooleanDependents } from "../featureBooleanUtils";

export function createAlignActions({ set, get }: CADSliceContext): Partial<CADState> {
  return {
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

      const rot = new THREE.Quaternion();
      if (wantRotation && alignSource.dir && alignTarget.dir) {
        const sDir = new THREE.Vector3(...alignSource.dir).normalize();
        let tDir = new THREE.Vector3(...alignTarget.dir).normalize();
        const bothFaces =
          alignSource.kind === "face" && alignTarget.kind === "face";
        if (bothFaces ? !opts.flip : opts.flip) tDir = tDir.negate();
        if (sDir.lengthSq() > 1e-9 && tDir.lengthSq() > 1e-9) {
          rot.setFromUnitVectors(sDir, tDir);
        }
      }

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

      if (feature.mesh instanceof THREE.Mesh) {
        const srcMesh = feature.mesh;
        const geom = srcMesh.geometry.clone();
        geom.applyMatrix4(M);
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
  };
}
