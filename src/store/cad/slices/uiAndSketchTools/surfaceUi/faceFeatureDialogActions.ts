import * as THREE from 'three';
import type { Feature } from '../../../../../types/cad';
import type { BRepBody } from '../../../../../engine/occ/brepBody';
import { globalBRepBodyRegistry } from '../../../../../engine/occ/globalRegistry';
import { getOccSync } from '../../../../../engine/occ/loader';
import { disposeMeshDeferred } from '../../../../../engine/occ/picking';
import { occOffsetFacesWithInstance } from '../../../../../engine/occ/ops/offsetFaces';
import { occDraftWithInstance } from '../../../../../engine/occ/ops/draft';
import { occSplitFaceWithInstance } from '../../../../../engine/occ/ops/splitFace';
import { occReplaceFaceWithInstance } from '../../../../../engine/occ/ops/replaceFace';
import { sketchPlaneFromFace } from '../../../../../engine/occ/geomSurface';
import { createRegisteredOccMesh } from '../../../../../engine/occ/registeredMesh';
import { BODY_MATERIAL } from '../../../../../components/viewport/scene/bodyMaterial';
import { liveBodyMeshes } from '../../../../meshRegistry';
import { errorMessage } from '../../../../../utils/errorHandling';
import type { CADSliceContext } from '../../../sliceContext';
import type { CADState } from '../../../state';

export function createFaceFeatureDialogActions({ set, get }: CADSliceContext): Partial<CADState> {
  return {
    replaceFaceSourceId: null,
    replaceFaceTargetId: null,
    replaceFaceSourceOccBodyId: null,
    replaceFaceSourceOccFaceId: null,
    replaceFaceSourceFeatureId: null,
    replaceFaceTargetOccBodyId: null,
    replaceFaceTargetOccFaceId: null,
    replaceFaceTargetFeatureId: null,
    isTangentChainReplaceFace: true,
    openReplaceFaceDialog: () => set({
      activeDialog: 'replace-face',
      replaceFaceSourceId: null,
      replaceFaceTargetId: null,
      replaceFaceSourceOccBodyId: null,
      replaceFaceSourceOccFaceId: null,
      replaceFaceSourceFeatureId: null,
      replaceFaceTargetOccBodyId: null,
      replaceFaceTargetOccFaceId: null,
      replaceFaceTargetFeatureId: null,
      isTangentChainReplaceFace: true,
    }),
    setReplaceFaceSource: (id, occ) => set({
      replaceFaceSourceId: id,
      replaceFaceSourceOccBodyId: occ?.bodyId ?? null,
      replaceFaceSourceOccFaceId: occ?.faceId ?? null,
      replaceFaceSourceFeatureId: occ?.featureId ?? null,
    }),
    setReplaceFaceTarget: (id, occ) => set({
      replaceFaceTargetId: id,
      replaceFaceTargetOccBodyId: occ?.bodyId ?? null,
      replaceFaceTargetOccFaceId: occ?.faceId ?? null,
      replaceFaceTargetFeatureId: occ?.featureId ?? null,
    }),
    setReplaceFaceIsTangentChain: (v) => set({ isTangentChainReplaceFace: v }),
    // OCC-21.3: replace-face via halfspace boolean subtract.
    commitReplaceFace: () => {
      const {
        replaceFaceSourceId,
        replaceFaceTargetId,
        replaceFaceSourceOccBodyId,
        replaceFaceSourceOccFaceId,
        replaceFaceTargetOccBodyId,
        replaceFaceTargetOccFaceId,
        replaceFaceSourceFeatureId,
        isTangentChainReplaceFace,
        features,
        setActiveDialog,
      } = get();

      if (!replaceFaceSourceId || !replaceFaceTargetId) return;

      const resetState = () => set({
        replaceFaceSourceId: null,
        replaceFaceTargetId: null,
        replaceFaceSourceOccBodyId: null,
        replaceFaceSourceOccFaceId: null,
        replaceFaceSourceFeatureId: null,
        replaceFaceTargetOccBodyId: null,
        replaceFaceTargetOccFaceId: null,
        replaceFaceTargetFeatureId: null,
      });

      // Require OCC info for both picks.
      if (
        !replaceFaceSourceOccBodyId ||
        replaceFaceSourceOccFaceId == null ||
        !replaceFaceTargetOccBodyId ||
        replaceFaceTargetOccFaceId == null ||
        !replaceFaceSourceFeatureId
      ) {
        get().setStatusMessage('Replace Face: requires an OCC body — create a solid first');
        setActiveDialog(null);
        resetState();
        return;
      }

      // Source and target must be on the same body.
      if (replaceFaceSourceOccBodyId !== replaceFaceTargetOccBodyId) {
        get().setStatusMessage('Replace Face: source and target faces must be on the same body');
        setActiveDialog(null);
        resetState();
        return;
      }

      const occ = getOccSync();
      const srcBody: BRepBody | undefined = occ ? globalBRepBodyRegistry.get(replaceFaceSourceOccBodyId) : undefined;
      const feature = features.find((f) => f.id === replaceFaceSourceFeatureId);

      if (!occ || !srcBody || !feature) {
        get().setStatusMessage('Replace Face: OCC body not available');
        setActiveDialog(null);
        resetState();
        return;
      }

      const result = occReplaceFaceWithInstance(
        occ.oc,
        srcBody,
        [replaceFaceSourceOccFaceId],
        replaceFaceTargetOccFaceId,
        {
          sourceFeatureId: replaceFaceSourceFeatureId,
          isTangentChain: isTangentChainReplaceFace,
        },
      );

      if (!result) {
        get().setStatusMessage('Replace Face: OCC operation failed — check face selections');
        setActiveDialog(null);
        resetState();
        return;
      }

      const srcMesh = feature.mesh as THREE.Mesh | undefined;
      let newMesh: THREE.Mesh;
      try {
        newMesh = createRegisteredOccMesh(occ.oc, result, srcMesh?.material ?? BODY_MATERIAL, replaceFaceSourceFeatureId);
      } catch (err) {
        get().setStatusMessage(`Replace Face failed: ${errorMessage(err, 'unknown')}`);
        setActiveDialog(null);
        resetState();
        return;
      }

      get().pushUndo();
      set((state) => ({
        features: state.features.map((f) =>
          f.id === replaceFaceSourceFeatureId
            ? { ...f, mesh: newMesh, params: { ...f.params, featureKind: 'replace-face' } }
            : f,
        ),
        statusMessage: 'Replace Face applied',
        activeDialog: null,
        replaceFaceSourceId: null,
        replaceFaceTargetId: null,
        replaceFaceSourceOccBodyId: null,
        replaceFaceSourceOccFaceId: null,
        replaceFaceSourceFeatureId: null,
        replaceFaceTargetOccBodyId: null,
        replaceFaceTargetOccFaceId: null,
        replaceFaceTargetFeatureId: null,
      }));
      if (srcMesh?.isMesh) disposeMeshDeferred(srcMesh);
    },

    directEditFaceId: null,
    directEditOccBodyId: null,
    directEditOccFaceId: null,
    directEditFeatureId: null,
    openDirectEditDialog: () => set({
      activeDialog: 'direct-edit',
      directEditFaceId: null,
      directEditOccBodyId: null,
      directEditOccFaceId: null,
      directEditFeatureId: null,
    }),
    setDirectEditFace: (id, occ) => set({
      directEditFaceId: id,
      directEditOccBodyId: occ?.bodyId ?? null,
      directEditOccFaceId: occ?.faceId ?? null,
      directEditFeatureId: occ?.featureId ?? null,
    }),
    commitDirectEdit: (params) => {
      const { directEditFaceId, directEditOccBodyId, directEditOccFaceId, directEditFeatureId, features } = get();
      if (!directEditFaceId) {
        get().setStatusMessage('Direct Edit: pick a face in the viewport first');
        return;
      }

      const { mode, distance, tapAngle = 0 } = params;
      const featureId = directEditFeatureId ?? '';
      const feature = features.find((f) => f.id === featureId);

      if (!directEditOccBodyId || directEditOccFaceId == null || !feature) {
        get().setStatusMessage('Direct Edit: requires an OCC body — create a solid first');
        get().setActiveDialog(null);
        set({ directEditFaceId: null, directEditOccBodyId: null, directEditOccFaceId: null, directEditFeatureId: null });
        return;
      }

      const occ = getOccSync();
      const srcBody: BRepBody | undefined = occ ? globalBRepBodyRegistry.get(directEditOccBodyId) : undefined;

      let srcMesh: THREE.Mesh | undefined = feature.mesh as THREE.Mesh | undefined;
      if (!srcMesh?.isMesh) {
        for (const [, m] of liveBodyMeshes) {
          if ((m as THREE.Mesh).userData?.featureId === featureId) { srcMesh = m as THREE.Mesh; break; }
        }
      }

      if (!occ || !srcBody || !srcMesh?.isMesh) {
        get().setStatusMessage('Direct Edit: OCC body not available');
        get().setActiveDialog(null);
        set({ directEditFaceId: null, directEditOccBodyId: null, directEditOccFaceId: null, directEditFeatureId: null });
        return;
      }

      let result: BRepBody | null = null;

      if (mode === 'offset-face' || mode === 'extrude') {
        result = occOffsetFacesWithInstance(occ.oc, srcBody, [directEditOccFaceId], distance, { sourceFeatureId: featureId });
      } else if (mode === 'taper') {
        const sketchPlane = sketchPlaneFromFace(occ.oc, srcBody, directEditOccFaceId);
        if (!sketchPlane) {
          get().setStatusMessage('Direct Edit (taper): face is not planar');
          get().setActiveDialog(null);
          set({ directEditFaceId: null, directEditOccBodyId: null, directEditOccFaceId: null, directEditFeatureId: null });
          return;
        }
        const pullDir = sketchPlane.frame.normal.clone();
        const neutralPlane = { origin: sketchPlane.frame.origin.clone(), normal: pullDir.clone() };
        result = occDraftWithInstance(
          occ.oc,
          srcBody,
          [directEditOccFaceId],
          pullDir,
          THREE.MathUtils.degToRad(tapAngle),
          neutralPlane,
          { sourceFeatureId: featureId },
        );
      }

      if (!result) {
        get().setStatusMessage(`Direct Edit (${mode}): OCC operation failed`);
        get().setActiveDialog(null);
        set({ directEditFaceId: null, directEditOccBodyId: null, directEditOccFaceId: null, directEditFeatureId: null });
        return;
      }

      let newMesh: THREE.Mesh;
      try {
        newMesh = createRegisteredOccMesh(occ.oc, result, srcMesh.material, featureId);
      } catch (err) {
        get().setStatusMessage(`Direct Edit failed: ${errorMessage(err, 'unknown')}`);
        get().setActiveDialog(null);
        set({ directEditFaceId: null, directEditOccBodyId: null, directEditOccFaceId: null, directEditFeatureId: null });
        return;
      }

      get().pushUndo();
      set((state) => ({
        features: state.features.map((f) =>
          f.id === featureId
            ? { ...f, mesh: newMesh, params: { ...f.params, featureKind: 'direct-edit' } }
            : f,
        ),
        statusMessage: `Direct Edit (${mode}) applied`,
        activeDialog: null,
        directEditFaceId: null,
        directEditOccBodyId: null,
        directEditOccFaceId: null,
        directEditFeatureId: null,
      }));
      disposeMeshDeferred(srcMesh);
    },

    textureExtrudeFaceId: null,
    openTextureExtrudeDialog: () => set({
      activeDialog: 'texture-extrude',
      textureExtrudeFaceId: null,
    }),
    setTextureExtrudeFace: (id) => set({ textureExtrudeFaceId: id }),
    // OCC-21.5: Texture Extrude is out-of-scope — UV-tiled pattern boolean extrude
    // is planned for a future release. Show a user-visible message and close the dialog.
    commitTextureExtrude: () => {
      get().setStatusMessage('Texture Extrude: not yet implemented — UV-tiled pattern extrude is planned for a future release');
      get().setActiveDialog(null);
      set({ textureExtrudeFaceId: null });
    },

    decalFaceId: null,
    decalFaceNormal: null,
    decalFaceCentroid: null,
    openDecalDialog: () => set({
      activeDialog: 'decal',
      decalFaceId: null,
      decalFaceNormal: null,
      decalFaceCentroid: null,
    }),
    setDecalFace: (id, normal, centroid) => set({
      decalFaceId: id,
      decalFaceNormal: normal,
      decalFaceCentroid: centroid,
    }),
    closeDecalDialog: () => set({
      activeDialog: null,
      decalFaceId: null,
      decalFaceNormal: null,
      decalFaceCentroid: null,
    }),
    // OCC-15.7: decal = visual annotation only — no geometry change intended. Correct as-is.
    commitDecal: (params) => {
      const { decalFaceId, decalFaceNormal, decalFaceCentroid, features, setActiveDialog } = get();
      const targetFeatureId = params.faceId ?? decalFaceId ?? '';
      if (!targetFeatureId || !decalFaceNormal || !decalFaceCentroid) {
        get().setStatusMessage('Decal: pick a face on a body first');
        return;
      }
      const n = features.filter((f) => f.type === 'decal').length + 1;
      const feature: Feature = {
        id: crypto.randomUUID(),
        name: `Decal ${n}`,
        type: 'decal',
        params: {
          ...params,
          faceId: targetFeatureId,
          targetFeatureId,
          point: decalFaceCentroid,
          normal: decalFaceNormal,
        },
        visible: true,
        suppressed: false,
        timestamp: Date.now(),
      };
      get().addFeature(feature);
      setActiveDialog(null);
      set({ decalFaceId: null, decalFaceNormal: null, decalFaceCentroid: null });
    },

    attachedCanvasId: null,
    openAttachedCanvasDialog: (canvasId) => set({
      activeDialog: 'attached-canvas',
      attachedCanvasId: canvasId ?? null,
    }),
    closeAttachedCanvasDialog: () => set({ activeDialog: null, attachedCanvasId: null }),
    updateCanvas: (id, changes) => set((state) => ({
      canvasReferences: state.canvasReferences.map((c) =>
        c.id === id ? { ...c, ...changes } : c
      ),
      features: state.features.map((f) => {
        if (f.id !== id) return f;
        return { ...f, params: { ...f.params, ...changes } };
      }),
    })),

    splitFaceId: null,
    splitFaceOccBodyId: null,
    splitFaceOccFaceId: null,
    splitFaceFeatureId: null,
    openSplitFaceDialog: () => set({
      activeDialog: 'split-face',
      splitFaceId: null,
      splitFaceOccBodyId: null,
      splitFaceOccFaceId: null,
      splitFaceFeatureId: null,
    }),
    setSplitFace: (id, occ) => set({
      splitFaceId: id,
      splitFaceOccBodyId: occ?.bodyId ?? null,
      splitFaceOccFaceId: occ?.faceId ?? null,
      splitFaceFeatureId: occ?.featureId ?? null,
    }),
    closeSplitFaceDialog: () => set({
      activeDialog: null,
      splitFaceId: null,
      splitFaceOccBodyId: null,
      splitFaceOccFaceId: null,
      splitFaceFeatureId: null,
    }),
    // OCC-21.2: split-face via BRepFeat_SplitShape.
    commitSplitFace: (params) => {
      const { splitFaceOccBodyId, splitFaceOccFaceId, splitFaceFeatureId, features } = get();

      if (splitFaceOccFaceId == null || !splitFaceOccBodyId || !splitFaceFeatureId) {
        get().setStatusMessage('Split Face: pick a face in the viewport first');
        get().setActiveDialog(null);
        set({ splitFaceId: null, splitFaceOccBodyId: null, splitFaceOccFaceId: null, splitFaceFeatureId: null });
        return;
      }

      // Resolve the splitting plane from params.planeId or params.splittingTool.
      let planeOrigin = { x: 0, y: 0, z: 0 };
      let planeNormal = { x: 0, y: 0, z: 1 }; // default XY plane

      if (params.splittingTool === 'plane' && params.planeId) {
        const cPlane = get().constructionPlanes?.find((p: { id: string }) => p.id === params.planeId);
        if (cPlane) {
          planeNormal = { x: cPlane.normal[0], y: cPlane.normal[1], z: cPlane.normal[2] };
          planeOrigin = { x: cPlane.origin[0], y: cPlane.origin[1], z: cPlane.origin[2] };
        }
      }
      // sketch and surface tools fall back to default XY plane for now

      const occ = getOccSync();
      const srcBody: BRepBody | undefined = occ ? globalBRepBodyRegistry.get(splitFaceOccBodyId) : undefined;
      const feature = features.find((f) => f.id === splitFaceFeatureId);

      if (!occ || !srcBody || !feature) {
        get().setStatusMessage('Split Face: OCC body not available');
        get().setActiveDialog(null);
        set({ splitFaceId: null, splitFaceOccBodyId: null, splitFaceOccFaceId: null, splitFaceFeatureId: null });
        return;
      }

      const result = occSplitFaceWithInstance(
        occ.oc,
        srcBody,
        splitFaceOccFaceId,
        planeOrigin,
        planeNormal,
        { sourceFeatureId: splitFaceFeatureId },
      );

      if (!result) {
        get().setStatusMessage('Split Face: OCC operation failed — check that the plane intersects the face');
        get().setActiveDialog(null);
        set({ splitFaceId: null, splitFaceOccBodyId: null, splitFaceOccFaceId: null, splitFaceFeatureId: null });
        return;
      }

      const srcMesh = feature.mesh as THREE.Mesh | undefined;
      let newMesh: THREE.Mesh;
      try {
        newMesh = createRegisteredOccMesh(occ.oc, result, srcMesh?.material ?? BODY_MATERIAL, splitFaceFeatureId);
      } catch (err) {
        get().setStatusMessage(`Split Face failed: ${errorMessage(err, 'unknown')}`);
        get().setActiveDialog(null);
        set({ splitFaceId: null, splitFaceOccBodyId: null, splitFaceOccFaceId: null, splitFaceFeatureId: null });
        return;
      }

      get().pushUndo();
      set((state) => ({
        features: state.features.map((f) =>
          f.id === splitFaceFeatureId
            ? { ...f, mesh: newMesh, params: { ...f.params, featureKind: 'split-face' } }
            : f,
        ),
        statusMessage: 'Split Face applied',
        activeDialog: null,
        splitFaceId: null,
        splitFaceOccBodyId: null,
        splitFaceOccFaceId: null,
        splitFaceFeatureId: null,
      }));
      if (srcMesh?.isMesh) disposeMeshDeferred(srcMesh);
    },
  };
}
