import type { Feature } from '../../../../types/cad';
import * as THREE from 'three';
import { GeometryEngine } from '../../../../engine/GeometryEngine';
import type { CADSliceContext } from '../../sliceContext';
import type { CADState } from '../../state';
import {
  disposeUnplacedToolMesh,
  placeToolFeatureAsync,
  toolPlacementFailedMessage,
} from '../featureManagement/bodyBoolean';
import { createOccPlaneFrameFromSketch } from '../../../../engine/occ/plane';
import { getOccSync, getOcc } from '../../../../engine/occ/loader';
import { occSweepFromPathWireWithInstance } from '../../../../engine/occ/ops/sweep';
import type { SketchProfile } from '../../../../engine/occ/ops/sketchToWire';
import { sketchEntitiesToWire } from '../../../../engine/occ/sketchEntityToWire';
import { createRegisteredOccMesh } from '../../../../engine/occ/registeredMesh';
import { BODY_MATERIAL } from '../../../../components/viewport/scene/bodyMaterial';
import { errorMessage } from '../../../../utils/errorHandling';
import { OCC_PROFILE_POINT_COUNT } from '../../../../utils/occConstants';
import { toolBooleanOp } from './featureCreationShared';
import { addToast } from '../../../toastStore';

export function createSweepActions({ set, get }: CADSliceContext): Partial<CADState> {
  return {
    sweepType: 'single-path' as 'single-path' | 'guide-rail',
    setSweepType: (t) => set({ sweepType: t, ...(t === 'single-path' ? { sweepGuideRailId: null } : {}) }),
    sweepChainSelection: true,
    setSweepChainSelection: (v) => set({ sweepChainSelection: v }),
    sweepProfileSketchId: null,
    setSweepProfileSketchId: (id) => set({ sweepProfileSketchId: id }),
    sweepProfileSketchId2: null,
    setSweepProfileSketchId2: (id) => set({ sweepProfileSketchId2: id }),
    sweepActiveInput: null as 'profile1' | 'profile2' | 'path' | 'guide' | null,
    setSweepActiveInput: (i) => set({ sweepActiveInput: i }),
    sweepPathSketchId: null,
    setSweepPathSketchId: (id) => set({ sweepPathSketchId: id }),
    sweepBodyKind: 'solid',
    setSweepBodyKind: (k) => set({ sweepBodyKind: k }),
    sweepOrientation: 'perpendicular' as 'perpendicular' | 'frenet' | 'horizontal' | 'vertical',
    sweepProfileScaling: 'none' as 'none' | 'scale-to-path' | 'scale-to-rail',
    sweepTwistAngle: 0,
    sweepTaperAngle: 0,
    sweepGuideRailId: null,
    sweepIsDirectionFlipped: false,
    sweepOperation: 'new-body' as 'new-body' | 'join' | 'cut' | 'intersect' | 'new-component',
    sweepDistance: 'entire' as 'entire' | 'distance',
    sweepDistanceOne: 0,
    sweepDistanceTwo: 1,
    setSweepIsDirectionFlipped: (v) => set({ sweepIsDirectionFlipped: v }),
    setSweepOrientation: (v) => set({ sweepOrientation: v }),
    setSweepProfileScaling: (v) => set({ sweepProfileScaling: v }),
    setSweepTwistAngle: (v) => set({ sweepTwistAngle: v }),
    setSweepTaperAngle: (v) => set({ sweepTaperAngle: v }),
    setSweepGuideRailId: (v) => set({ sweepGuideRailId: v }),
    setSweepOperation: (v: 'new-body' | 'join' | 'cut' | 'intersect' | 'new-component') => set({ sweepOperation: v }),
    setSweepDistance: (v) => set({ sweepDistance: v }),
    setSweepDistanceOne: (v) => set({ sweepDistanceOne: Math.max(0, Math.min(1, v)) }),
    setSweepDistanceTwo: (v) => set({ sweepDistanceTwo: Math.max(0, Math.min(1, v)) }),
    startSweepTool: () => {
      const extrudable = get().sketches.filter((s) => s.entities.length > 0);
      if (extrudable.length < 2) {
        addToast('warning', 'Sweep needs 2 sketches', 'Draw a profile sketch and a path sketch first');
        set({ statusMessage: 'Sweep requires at least 2 sketches - a profile and a path' });
        return;
      }
      set({ activeTool: 'sweep', sweepProfileSketchId: null, sweepPathSketchId: null, statusMessage: 'Sweep - pick a profile sketch, then a path sketch in the panel' });
    },
    cancelSweepTool: () => set({ activeTool: 'select', sweepType: 'single-path', sweepChainSelection: true, sweepProfileSketchId: null, sweepProfileSketchId2: null, sweepActiveInput: null, sweepPathSketchId: null, sweepOrientation: 'perpendicular', sweepTwistAngle: 0, sweepTaperAngle: 0, sweepGuideRailId: null, sweepIsDirectionFlipped: false, sweepDistance: 'entire', sweepDistanceOne: 0, sweepDistanceTwo: 1, statusMessage: 'Sweep cancelled' }),
    commitSweep: async () => {
      const { sweepProfileSketchId, sweepProfileSketchId2, sweepPathSketchId, sweepBodyKind, sweepDistanceTwo, sweepOrientation, sweepTwistAngle, sweepTaperAngle, sweepGuideRailId, sweepIsDirectionFlipped, sweepChainSelection, sweepOperation, sketches, units } = get();
      if (!sweepProfileSketchId || !sweepPathSketchId) {
        set({ statusMessage: 'Select a profile sketch and a path sketch' });
        return;
      }
      const pathSketch = sketches.find((s) => s.id === sweepPathSketchId);
      if (!pathSketch) {
        set({ statusMessage: 'Selected path sketch not found' });
        return;
      }
      // Collect the selected profiles (Profile 1 required, Profile 2 optional).
      const profileIds = [sweepProfileSketchId, sweepProfileSketchId2].filter(
        (id): id is string => !!id,
      );
      const profileSketches = profileIds
        .map((id) => sketches.find((s) => s.id === id))
        .filter((s): s is NonNullable<typeof s> => !!s);
      if (profileSketches.length === 0) {
        set({ statusMessage: 'Selected profile sketch not found' });
        return;
      }

      const isSurface = sweepBodyKind === 'surface';
      const distanceFraction = Math.max(0.01, Math.min(1, sweepDistanceTwo));
      // commitSweep is async — await the kernel rather than bailing when it isn't
      // warmed yet (getOccSync returns null until the WASM module finishes loading).
      let occ = getOccSync();
      if (!occ) {
        try {
          occ = await getOcc();
        } catch (err) {
          console.warn(`[commitSweep] OCC load failed (${errorMessage(err, 'unknown')})`);
          occ = null;
        }
      }
      if (!occ && !isSurface) {
        addToast('warning', 'Sweep needs the CAD kernel', 'The geometry kernel is still loading — try again in a moment');
        set({ statusMessage: 'Solid sweep requires OCC (still loading) — try again' });
        return;
      }

      // Build a swept mesh for one profile sketch (OCC, with THREE surface fallback).
      const buildMesh = (profileSketch: typeof profileSketches[number], fid: string): THREE.Mesh | null => {
        if (!occ) return isSurface ? GeometryEngine.sweepSketchInternal(profileSketch, pathSketch, true) : null;
        try {
          const firstShape = GeometryEngine.sketchToProfileShapesFlat(profileSketch)[0];
          if (!firstShape) throw new Error('no profile shape');
          const sketchProfile: SketchProfile = {
            outer: firstShape.getPoints(OCC_PROFILE_POINT_COUNT),
            holes: firstShape.holes.map((h) => h.getPoints(OCC_PROFILE_POINT_COUNT)).filter((pts) => pts.length >= 3),
          };
          const profileFrame = createOccPlaneFrameFromSketch(profileSketch);
          const pathFrame = createOccPlaneFrameFromSketch(pathSketch);
          const pathEntities = sweepChainSelection ? pathSketch.entities : pathSketch.entities.slice(0, 1);
          const builtPathWire = sketchEntitiesToWire(occ.oc, pathEntities, pathFrame);
          if (!builtPathWire) throw new Error('failed to build path wire');
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const pathWire: unknown = sweepIsDirectionFlipped ? (builtPathWire as any).Reversed() : builtPathWire;
          let guideWire: unknown | undefined;
          if (sweepGuideRailId) {
            const guideSketch = sketches.find((s) => s.id === sweepGuideRailId);
            if (guideSketch) {
              const guideFrame = createOccPlaneFrameFromSketch(guideSketch);
              guideWire = sketchEntitiesToWire(occ.oc, guideSketch.entities, guideFrame) ?? undefined;
            }
          }
          const occBody = occSweepFromPathWireWithInstance(occ.oc, sketchProfile, profileFrame, pathWire, {
            id: fid,
            sourceFeatureId: fid,
            orientation: sweepOrientation as 'perpendicular' | 'frenet' | 'horizontal' | 'vertical',
            guideWire,
            taperAngle: Math.abs(sweepTaperAngle) > 0.001 ? sweepTaperAngle : undefined,
            twistAngle: Math.abs(sweepTwistAngle) > 0.001 ? sweepTwistAngle : undefined,
            distanceFraction: distanceFraction < 0.999 ? distanceFraction : undefined,
            surface: isSurface,
          });
          builtPathWire.delete();
          if (guideWire) (guideWire as { delete(): void }).delete();
          return createRegisteredOccMesh(occ.oc, occBody, BODY_MATERIAL, fid);
        } catch (err) {
          console.warn(`[commitSweep] OCC path failed (${errorMessage(err, 'unknown')})`);
          return isSurface ? GeometryEngine.sweepSketchInternal(profileSketch, pathSketch, true) : null;
        }
      };

      // Sweep each profile sequentially, threading the feature list through placement.
      let curState = get();
      const builtMeshes: (THREE.Mesh | null)[] = [];
      for (const profileSketch of profileSketches) {
        const fid = crypto.randomUUID();
        const mesh = buildMesh(profileSketch, fid);
        builtMeshes.push(mesh);
        if (!mesh) {
          set({ statusMessage: 'Sweep failed in OCC: no sweep body was created' });
          return;
        }
        const seq = curState.features.filter((f) => f.type === 'sweep').length + 1;
        const feature: Feature = {
          id: fid,
          name: `${isSurface ? 'Surface ' : ''}Sweep ${seq}`,
          type: 'sweep',
          sketchId: profileSketch.id,
          params: {
            pathSketchId: sweepPathSketchId,
            orientation: sweepOrientation,
            taperAngle: sweepTaperAngle,
            twistAngle: sweepTwistAngle,
            distance: distanceFraction,
            chainSelection: sweepChainSelection,
            guideRailId: sweepGuideRailId,
            isDirectionFlipped: sweepIsDirectionFlipped,
            operation: sweepOperation,
          },
          visible: true,
          suppressed: false,
          timestamp: Date.now(),
          mesh,
          bodyKind: isSurface ? 'surface' : 'solid',
        };
        const r = await placeToolFeatureAsync({ ...curState }, feature, toolBooleanOp(sweepOperation, isSurface, !!mesh));
        if (!r.ok) {
          for (const m of builtMeshes) disposeUnplacedToolMesh(m ?? undefined);
          set({ statusMessage: toolPlacementFailedMessage('Sweep', r.note) });
          return;
        }
        curState = { ...curState, features: r.features, designConfigurations: r.designConfigurations };
      }

      get().pushUndo();
      set({
        features: curState.features,
        designConfigurations: curState.designConfigurations,
        activeTool: 'select',
        sweepType: 'single-path',
        sweepChainSelection: true,
        sweepProfileSketchId: null,
        sweepProfileSketchId2: null,
        sweepActiveInput: null,
        sweepPathSketchId: null,
        sweepIsDirectionFlipped: false,
        sweepBodyKind: 'solid',
        statusMessage: `${isSurface ? 'Surface ' : ''}Sweep created (${profileSketches.length} profile${profileSketches.length > 1 ? 's' : ''}) (${units})`,
      });
    },
  };
}
