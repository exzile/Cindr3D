import type { Feature } from '../../../../types/cad';
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
import { occLoftWithInstance } from '../../../../engine/occ/ops/loft';
import type { SketchProfile } from '../../../../engine/occ/ops/sketchToWire';
import { createRegisteredOccMesh } from '../../../../engine/occ/registeredMesh';
import { BODY_MATERIAL } from '../../../../components/viewport/scene/bodyMaterial';
import { errorMessage } from '../../../../utils/errorHandling';
import { shapeToOccSketchProfile, toolBooleanOp } from './featureCreationShared';

export function createLoftActions({ set, get }: CADSliceContext): Partial<CADState> {
  return {
    loftProfileSketchIds: [],
    setLoftProfileSketchIds: (ids) => set({ loftProfileSketchIds: ids }),
    loftBodyKind: 'solid',
    setLoftBodyKind: (k) => set({ loftBodyKind: k }),
    loftClosed: false,
    loftTangentEdgesMerged: false,
    loftStartCondition: 'free' as const,
    loftEndCondition: 'free' as const,
    loftRailSketchId: null,
    loftOperation: 'new-body' as 'new-body' | 'join' | 'cut' | 'intersect' | 'new-component',
    setLoftClosed: (v) => set({ loftClosed: v }),
    setLoftTangentEdgesMerged: (v) => set({ loftTangentEdgesMerged: v }),
    setLoftStartCondition: (v) => set({ loftStartCondition: v }),
    setLoftEndCondition: (v) => set({ loftEndCondition: v }),
    setLoftRailSketchId: (v) => set({ loftRailSketchId: v }),
    setLoftOperation: (v: 'new-body' | 'join' | 'cut' | 'intersect' | 'new-component') => set({ loftOperation: v }),
    startLoftTool: () => {
      const extrudable = get().sketches.filter((s) => s.entities.length > 0);
      if (extrudable.length < 2) {
        set({ statusMessage: 'Loft requires at least 2 profile sketches' });
        return;
      }
      set({ activeTool: 'loft', loftProfileSketchIds: ['', ''], statusMessage: 'Loft - select 2+ profile sketches in the panel, then OK' });
    },
    cancelLoftTool: () => set({ activeTool: 'select', loftProfileSketchIds: [], loftClosed: false, loftTangentEdgesMerged: false, loftStartCondition: 'free', loftEndCondition: 'free', loftRailSketchId: null, loftOperation: 'new-body', statusMessage: 'Loft cancelled' }),
    commitLoft: async () => {
      const { loftProfileSketchIds, loftBodyKind, loftOperation, sketches, features, units } = get();
      const validIds = loftProfileSketchIds.filter(Boolean);
      if (validIds.length < 2) {
        set({ statusMessage: 'Select at least 2 profile sketches' });
        return;
      }
      const profileSketches = validIds.map((id) => sketches.find((s) => s.id === id)).filter(Boolean) as typeof sketches;
      if (profileSketches.length < 2) {
        set({ statusMessage: 'One or more selected profiles not found' });
        return;
      }
      const featureId = crypto.randomUUID();
      let mesh: Feature['mesh'] | undefined;
      if (loftBodyKind === 'solid') {
        const occ = getOccSync();
        if (!occ) {
          set({ statusMessage: 'Loft: OCC kernel is still loading; try again in a moment' });
          return;
        }
        try {
          const sections = profileSketches.map((sketch) => {
            const shape = GeometryEngine.sketchToProfileShapesFlat(sketch)[0];
            return shape ? shapeToOccSketchProfile(shape) : null;
          });
          if (sections.some((section) => section === null)) {
            set({ statusMessage: 'Loft: every selected sketch needs a closed profile' });
            return;
          }
          const frames = profileSketches.map(createOccPlaneFrameFromSketch);
          const body = occLoftWithInstance(
            occ.oc,
            sections as SketchProfile[],
            frames,
            {
              sourceFeatureId: featureId,
              closed: get().loftClosed,
              ruled: get().loftStartCondition === 'free' && get().loftEndCondition === 'free',
              smooth: get().loftStartCondition !== 'free' || get().loftEndCondition !== 'free',
            },
          );
          if (!body) {
            set({ statusMessage: 'Loft: OCC failed to build the selected profiles' });
            return;
          }
          mesh = createRegisteredOccMesh(occ.oc, body, BODY_MATERIAL, featureId);
        } catch (err) {
          set({ statusMessage: `Loft: OCC failed (${errorMessage(err, 'unknown OCC error')})` });
          return;
        }
      } else {
        mesh = GeometryEngine.loftSketches(profileSketches, true) ?? undefined;
      }
      const feature: Feature = {
        id: featureId,
        name: `${loftBodyKind === 'surface' ? 'Surface ' : ''}Loft ${features.filter((f) => f.type === 'loft').length + 1}`,
        type: 'loft',
        sketchId: validIds[0],
        params: { loftProfileIds: validIds.join(','), operation: loftOperation },
        visible: true,
        suppressed: false,
        timestamp: Date.now(),
        mesh: mesh ?? undefined,
        bodyKind: loftBodyKind === 'surface' ? 'surface' : 'solid',
      };
      const r = await placeToolFeatureAsync(get(), feature, toolBooleanOp(loftOperation, loftBodyKind === 'surface', !!mesh));
      if (!r.ok) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        disposeUnplacedToolMesh(mesh as any);
        set({ statusMessage: toolPlacementFailedMessage('Loft', r.note) });
        return;
      }
      get().pushUndo();
      set({
        features: r.features,
        designConfigurations: r.designConfigurations,
        activeTool: 'select',
        loftProfileSketchIds: [],
        statusMessage: `${loftBodyKind === 'surface' ? 'Surface ' : ''}Loft created across ${profileSketches.length} profiles${r.note} (${units})`,
      });
    },
  };
}
