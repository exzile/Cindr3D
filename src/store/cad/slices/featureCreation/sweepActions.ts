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
import { getOccSync } from '../../../../engine/occ/loader';
import { occSweepFromPathWireWithInstance } from '../../../../engine/occ/ops/sweep';
import type { SketchProfile } from '../../../../engine/occ/ops/sketchToWire';
import { sketchEntitiesToWire } from '../../../../engine/occ/sketchEntityToWire';
import { createRegisteredOccMesh } from '../../../../engine/occ/registeredMesh';
import { BODY_MATERIAL } from '../../../../components/viewport/scene/bodyMaterial';
import { errorMessage } from '../../../../utils/errorHandling';
import { OCC_PROFILE_POINT_COUNT } from '../../../../utils/occConstants';
import { toolBooleanOp } from './featureCreationShared';

export function createSweepActions({ set, get }: CADSliceContext): Partial<CADState> {
  return {
    sweepProfileSketchId: null,
    setSweepProfileSketchId: (id) => set({ sweepProfileSketchId: id }),
    sweepPathSketchId: null,
    setSweepPathSketchId: (id) => set({ sweepPathSketchId: id }),
    sweepBodyKind: 'solid',
    setSweepBodyKind: (k) => set({ sweepBodyKind: k }),
    sweepOrientation: 'perpendicular' as 'perpendicular' | 'parallel' | 'default',
    sweepProfileScaling: 'none' as 'none' | 'scale-to-path' | 'scale-to-rail',
    sweepTwistAngle: 0,
    sweepTaperAngle: 0,
    sweepGuideRailId: null,
    sweepOperation: 'new-body' as 'new-body' | 'join' | 'cut' | 'intersect' | 'new-component',
    sweepDistance: 'entire' as 'entire' | 'distance',
    sweepDistanceOne: 0,
    sweepDistanceTwo: 1,
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
        set({ statusMessage: 'Sweep requires at least 2 sketches - a profile and a path' });
        return;
      }
      set({ activeTool: 'sweep', sweepProfileSketchId: null, sweepPathSketchId: null, statusMessage: 'Sweep - pick a profile sketch, then a path sketch in the panel' });
    },
    cancelSweepTool: () => set({ activeTool: 'select', sweepProfileSketchId: null, sweepPathSketchId: null, sweepOrientation: 'perpendicular', sweepTwistAngle: 0, sweepTaperAngle: 0, sweepGuideRailId: null, sweepDistance: 'entire', sweepDistanceOne: 0, sweepDistanceTwo: 1, statusMessage: 'Sweep cancelled' }),
    commitSweep: async () => {
      const { sweepProfileSketchId, sweepPathSketchId, sweepBodyKind, sweepDistance, sweepDistanceOne, sweepDistanceTwo, sweepOrientation, sweepProfileScaling, sweepTwistAngle, sweepTaperAngle, sweepGuideRailId, sweepOperation, sketches, features, units } = get();
      if (!sweepProfileSketchId || !sweepPathSketchId) {
        set({ statusMessage: 'Select both a profile sketch and a path sketch' });
        return;
      }
      const profileSketch = sketches.find((s) => s.id === sweepProfileSketchId);
      const pathSketch = sketches.find((s) => s.id === sweepPathSketchId);
      if (!profileSketch || !pathSketch) {
        set({ statusMessage: 'Selected sketch(es) not found' });
        return;
      }
      const featureId = crypto.randomUUID();

      let mesh: THREE.Mesh | null = null;
      if (sweepBodyKind === 'solid' && Math.abs(sweepTwistAngle ?? 0) >= 0.001) {
        set({ statusMessage: 'Solid sweep twist requires OCC twist support before it can be committed' });
        return;
      }
      if (sweepBodyKind === 'solid') {
        const occ = getOccSync();
        if (!occ) {
          set({ statusMessage: 'Solid sweep requires OCC to be loaded' });
          return;
        }
        try {
          const profileShapes = GeometryEngine.sketchToProfileShapesFlat(profileSketch);
          const firstShape = profileShapes[0];
          if (firstShape) {
            const sketchProfile: SketchProfile = {
              outer: firstShape.getPoints(OCC_PROFILE_POINT_COUNT),
              holes: firstShape.holes.map((h) => h.getPoints(OCC_PROFILE_POINT_COUNT)).filter((pts) => pts.length >= 3),
            };
            const profileFrame = createOccPlaneFrameFromSketch(profileSketch);
            const pathFrame = createOccPlaneFrameFromSketch(pathSketch);
            const pathWire = sketchEntitiesToWire(occ.oc, pathSketch.entities, pathFrame);
            if (pathWire) {
              let guideWire: unknown | undefined;
              if (sweepGuideRailId) {
                const guideSketch = get().sketches.find((s) => s.id === sweepGuideRailId);
                if (guideSketch) {
                  const guideFrame = createOccPlaneFrameFromSketch(guideSketch);
                  guideWire = sketchEntitiesToWire(occ.oc, guideSketch.entities, guideFrame) ?? undefined;
                }
              }
              const occBody = occSweepFromPathWireWithInstance(occ.oc, sketchProfile, profileFrame, pathWire, {
                id: featureId,
                sourceFeatureId: featureId,
                orientation: sweepOrientation === 'default' ? 'perpendicular' : (sweepOrientation as 'perpendicular' | 'frenet' | 'horizontal' | 'vertical'),
                guideWire,
                taperAngle: Math.abs(sweepTaperAngle) > 0.001 ? sweepTaperAngle : undefined,
              });
              pathWire.delete();
              if (guideWire) (guideWire as { delete(): void }).delete();
              mesh = createRegisteredOccMesh(occ.oc, occBody, BODY_MATERIAL, featureId);
            }
          }
        } catch (err) {
          const message = errorMessage(err, 'unknown');
          console.warn(`[commitSweep] OCC path failed (${message})`);
          set({ statusMessage: `Sweep failed in OCC: ${message}` });
          return;
        }
        if (!mesh) {
          set({ statusMessage: 'Sweep failed in OCC: no sweep body was created' });
          return;
        }
      }

      if (!mesh && sweepBodyKind === 'surface') {
        mesh = GeometryEngine.sweepSketchInternal(profileSketch, pathSketch, sweepBodyKind === 'surface');
      }

      const feature: Feature = {
        id: featureId,
        name: `${sweepBodyKind === 'surface' ? 'Surface ' : ''}Sweep ${features.filter((f) => f.type === 'sweep').length + 1}`,
        type: 'sweep',
        sketchId: sweepProfileSketchId,
        params: {
          pathSketchId: sweepPathSketchId,
          orientation: sweepOrientation,
          profileScaling: sweepProfileScaling,
          twistAngle: sweepTwistAngle,
          taperAngle: sweepTaperAngle,
          guideRailId: sweepGuideRailId,
          operation: sweepOperation,
          distance: sweepDistance,
          ...(sweepDistance === 'distance' ? { distanceOne: sweepDistanceOne, distanceTwo: sweepDistanceTwo } : {}),
        },
        visible: true,
        suppressed: false,
        timestamp: Date.now(),
        mesh: mesh ?? undefined,
        bodyKind: sweepBodyKind === 'surface' ? 'surface' : 'solid',
      };
      const r = await placeToolFeatureAsync(get(), feature, toolBooleanOp(sweepOperation, sweepBodyKind === 'surface', !!mesh));
      if (!r.ok) {
        disposeUnplacedToolMesh(mesh);
        set({ statusMessage: toolPlacementFailedMessage('Sweep', r.note) });
        return;
      }
      get().pushUndo();
      set({
        features: r.features,
        designConfigurations: r.designConfigurations,
        activeTool: 'select',
        sweepProfileSketchId: null,
        sweepPathSketchId: null,
        sweepBodyKind: 'solid',
        statusMessage: `${sweepBodyKind === 'surface' ? 'Surface ' : ''}Sweep created${r.note} (${units})`,
      });
    },
  };
}
