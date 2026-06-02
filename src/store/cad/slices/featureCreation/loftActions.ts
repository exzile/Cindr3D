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
import { sketchEntitiesToWire } from '../../../../engine/occ/sketchEntityToWire';
import type { SketchProfile } from '../../../../engine/occ/ops/sketchToWire';
import { createRegisteredOccMesh } from '../../../../engine/occ/registeredMesh';
import { BODY_MATERIAL } from '../../../../components/viewport/scene/bodyMaterial';
import { errorMessage } from '../../../../utils/errorHandling';
import { shapeToOccSketchProfile, toolBooleanOp } from './featureCreationShared';
import { addToast } from '../../../toastStore';
import { useComponentStore } from '../../../componentStore';

export function createLoftActions({ set, get }: CADSliceContext): Partial<CADState> {
  return {
    loftProfileSketchIds: [],
    setLoftProfileSketchIds: (ids) => set({ loftProfileSketchIds: ids }),
    loftBodyKind: 'solid',
    setLoftBodyKind: (k) => set({ loftBodyKind: k }),
    loftClosed: false,
    loftTangentEdgesMerged: false,
    loftStartCondition: 'free' as 'free' | 'tangent' | 'curvature',
    loftEndCondition: 'free' as 'free' | 'tangent' | 'curvature',
    loftRailSketchId: null,
    loftRailSketchIds: [] as string[],
    setLoftRailSketchIds: (ids: string[]) => set({ loftRailSketchIds: ids, loftRailSketchId: ids[0] ?? null }),
    loftOperation: 'new-body' as 'new-body' | 'join' | 'cut' | 'intersect' | 'new-component',
    setLoftClosed: (v) => set({ loftClosed: v }),
    setLoftTangentEdgesMerged: (v) => set({ loftTangentEdgesMerged: v }),
    setLoftStartCondition: (v) => set({ loftStartCondition: v }),
    setLoftEndCondition: (v) => set({ loftEndCondition: v }),
    setLoftRailSketchId: (v) => set({ loftRailSketchId: v, loftRailSketchIds: v ? [v] : [] }),
    setLoftOperation: (v: 'new-body' | 'join' | 'cut' | 'intersect' | 'new-component') => set({ loftOperation: v }),
    startLoftTool: () => {
      const extrudable = get().sketches.filter((s) => s.entities.length > 0);
      if (extrudable.length < 2) {
        addToast('warning', 'Loft needs 2+ sketches', 'Draw at least 2 profile sketches first');
        set({ statusMessage: 'Loft requires at least 2 profile sketches' });
        return;
      }
      set({ activeTool: 'loft', loftProfileSketchIds: ['', ''], statusMessage: 'Loft - select 2+ profile sketches in the panel, then OK' });
    },
    cancelLoftTool: () => set({ activeTool: 'select', loftProfileSketchIds: [], loftClosed: false, loftTangentEdgesMerged: false, loftStartCondition: 'free', loftEndCondition: 'free', loftRailSketchId: null, loftRailSketchIds: [], loftOperation: 'new-body', statusMessage: 'Loft cancelled' }),
    commitLoft: async () => {
      const { loftProfileSketchIds, loftBodyKind, loftOperation, loftClosed, loftStartCondition, loftEndCondition, loftRailSketchIds, sketches, features, units } = get();
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
      if (loftBodyKind === 'solid' || loftBodyKind === 'surface') {
        const occ = getOccSync();
        if (!occ) {
          if (loftBodyKind === 'solid') {
            set({ statusMessage: 'Loft: OCC kernel is still loading; try again in a moment' });
            return;
          }
          // Surface fallback: THREE mesh
          mesh = GeometryEngine.loftSketches(profileSketches, true) ?? undefined;
        } else {
          try {
            const isSurface = loftBodyKind === 'surface';
            const sections = profileSketches.map((sketch) => {
              const shape = GeometryEngine.sketchToProfileShapesFlat(sketch)[0];
              return shape ? shapeToOccSketchProfile(shape) : null;
            });
            if (!isSurface && sections.some((section) => section === null)) {
              set({ statusMessage: 'Loft: every selected sketch needs a closed profile' });
              return;
            }
            const validSections = sections.filter(Boolean) as SketchProfile[];
            if (validSections.length < 2) {
              set({ statusMessage: 'Loft: need at least 2 valid sketch profiles' });
              return;
            }
            const frames = profileSketches
              .filter((_, i) => sections[i] !== null)
              .map(createOccPlaneFrameFromSketch);
            // Build rail wires if rail sketches are specified
            const railWires: unknown[] = [];
            const validRailIds = loftRailSketchIds.filter(Boolean);
            for (const railId of validRailIds) {
              const railSketch = sketches.find((s) => s.id === railId);
              if (railSketch) {
                const railFrame = createOccPlaneFrameFromSketch(railSketch);
                const wire = sketchEntitiesToWire(occ.oc, railSketch.entities, railFrame);
                if (wire) railWires.push(wire);
              }
            }

            const isSmooth = loftStartCondition !== 'free' || loftEndCondition !== 'free';
            const body = occLoftWithInstance(
              occ.oc,
              validSections,
              frames,
              {
                sourceFeatureId: featureId,
                closed: loftClosed,
                ruled: !isSmooth,
                smooth: isSmooth,
                surface: isSurface,
                railWires: railWires.length > 0 ? railWires : undefined,
              },
            );

            // Dispose rail wires
            for (const w of railWires) (w as { delete(): void }).delete();
            if (!body) {
              if (isSurface) {
                mesh = GeometryEngine.loftSketches(profileSketches, true) ?? undefined;
              } else {
                set({ statusMessage: 'Loft: OCC failed to build the selected profiles' });
                return;
              }
            } else {
              mesh = createRegisteredOccMesh(occ.oc, body, BODY_MATERIAL, featureId);
            }
          } catch (err) {
            if (loftBodyKind === 'surface') {
              mesh = GeometryEngine.loftSketches(profileSketches, true) ?? undefined;
            } else {
              set({ statusMessage: `Loft: OCC failed (${errorMessage(err, 'unknown OCC error')})` });
              return;
            }
          }
        }
      } else {
        mesh = GeometryEngine.loftSketches(profileSketches, true) ?? undefined;
      }
      const feature: Feature = {
        id: featureId,
        name: `${loftBodyKind === 'surface' ? 'Surface ' : ''}Loft ${features.filter((f) => f.type === 'loft').length + 1}`,
        type: 'loft',
        sketchId: validIds[0],
        params: { loftProfileIds: validIds.join(','), railSketchIds: loftRailSketchIds.filter(Boolean).join(','), operation: loftOperation, closed: loftClosed, startCondition: loftStartCondition, endCondition: loftEndCondition },
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

      // Register a browser body so the lofted solid/surface shows under "Bodies".
      if (loftOperation === 'new-body' || loftOperation === 'new-component') {
        const cs = useComponentStore.getState();
        let componentId = profileSketches[0]?.componentId ?? cs.activeComponentId ?? cs.rootComponentId;
        if (loftOperation === 'new-component') {
          const parentId = cs.activeComponentId ?? cs.rootComponentId;
          componentId = cs.addComponent(parentId, `Component ${Object.keys(cs.components ?? {}).length + 1}`);
        }
        const bodyCount = Object.keys(cs.bodies).length + 1;
        const bodyId = cs.addBody(componentId, `${loftBodyKind === 'surface' ? 'Surface' : 'Body'} ${bodyCount}`);
        if (bodyId) {
          cs.addFeatureToBody(bodyId, featureId);
          if (mesh) cs.setBodyMesh(bodyId, mesh as import('three').Mesh);
        }
      }
    },
  };
}
