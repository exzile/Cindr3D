import type { Feature, Tool } from '../../../../types/cad';
import * as THREE from 'three';
import { GeometryEngine } from '../../../../engine/GeometryEngine';
import type { CADSliceContext } from '../../sliceContext';
import type { CADState } from '../../state';
import { getOccSync } from '../../../../engine/occ/loader';
import { occFillSurfaceWithInstance, type FillContinuity } from '../../../../engine/occ/ops/fillSurface';
import { createRegisteredOccMesh } from '../../../../engine/occ/registeredMesh';
import { BODY_MATERIAL } from '../../../../components/viewport/scene/bodyMaterial';
import { errorMessage } from '../../../../utils/errorHandling';

export function createSurfaceFeatureActions({ set, get }: CADSliceContext): Partial<CADState> {
  return {
    patchSelectedSketchId: null,
    setPatchSelectedSketchId: (id) => set({ patchSelectedSketchId: id }),
    patchContinuity: 'G0' as 'G0' | 'G1' | 'G2',
    setPatchContinuity: (v) => set({ patchContinuity: v }),
    startPatchTool: () => {
      const sketches = get().sketches.filter((s) => s.entities.length > 0);
      if (sketches.length === 0) {
        set({ statusMessage: 'Create a sketch first before using Patch' });
        return;
      }
      set({ activeTool: 'patch' as Tool, patchSelectedSketchId: null, statusMessage: 'Patch - select a closed profile sketch in the panel' });
    },
    cancelPatchTool: () => set({ activeTool: 'select', patchSelectedSketchId: null, patchContinuity: 'G0', statusMessage: 'Patch cancelled' }),
    commitPatch: () => {
      const { patchSelectedSketchId, patchContinuity, sketches, features, units } = get();
      if (!patchSelectedSketchId) {
        set({ statusMessage: 'No profile selected for Patch' });
        return;
      }
      const sketch = sketches.find((s) => s.id === patchSelectedSketchId);
      if (!sketch) {
        set({ statusMessage: 'Selected sketch not found' });
        return;
      }
      const featureId = crypto.randomUUID();
      const n = features.filter((f) => f.type === 'extrude' && f.bodyKind === 'surface' && f.params.patchSketchId !== undefined).length + 1;

      // Build boundary loop from sketch entities
      const boundaryLoop = sketch.entities.flatMap((e) =>
        e.points.map((p) => new THREE.Vector3(p.x, p.y, p.z)),
      );

      let mesh: THREE.Mesh | undefined;
      const occ = getOccSync();
      if (occ && boundaryLoop.length >= 3) {
        try {
          const edgeConstraints = [{ continuity: patchContinuity as FillContinuity }];
          const body = occFillSurfaceWithInstance(occ.oc, boundaryLoop, {
            sourceFeatureId: featureId,
            edgeConstraints,
          });
          if (body) mesh = createRegisteredOccMesh(occ.oc, body, BODY_MATERIAL, featureId);
        } catch (err) {
          console.warn(`[commitPatch] OCC fill failed (${errorMessage(err, 'unknown')}), using THREE fallback`);
        }
      }
      if (!mesh) mesh = GeometryEngine.patchSketch(sketch) ?? undefined;

      const feature: Feature = {
        id: featureId,
        name: `Patch ${n}`,
        type: 'extrude',
        sketchId: patchSelectedSketchId,
        params: { patchSketchId: patchSelectedSketchId, continuity: patchContinuity },
        visible: true,
        suppressed: false,
        timestamp: Date.now(),
        mesh,
        bodyKind: 'surface',
      };
      set({
        features: [...features, feature],
        activeTool: 'select',
        patchSelectedSketchId: null,
        patchContinuity: 'G0',
        statusMessage: `Patch surface created (${units})`,
      });
    },
    ruledSketchAId: null,
    setRuledSketchAId: (id) => set({ ruledSketchAId: id }),
    ruledSketchBId: null,
    setRuledSketchBId: (id) => set({ ruledSketchBId: id }),
    ruledAlignmentMode: 'direction' as 'direction' | 'tangent' | 'normal',
    setRuledAlignmentMode: (m: 'direction' | 'tangent' | 'normal') => set({ ruledAlignmentMode: m }),
    ruledAlignmentDistance: 0,
    setRuledAlignmentDistance: (d: number) => set({ ruledAlignmentDistance: d }),
    startRuledSurfaceTool: () => {
      const sketches = get().sketches.filter((s) => s.entities.length > 0);
      if (sketches.length < 2) {
        set({ statusMessage: 'Ruled Surface requires at least 2 sketches' });
        return;
      }
      set({ activeTool: 'ruled-surface' as Tool, ruledSketchAId: null, ruledSketchBId: null, statusMessage: 'Ruled Surface - select Curve A and Curve B sketches in the panel' });
    },
    cancelRuledSurfaceTool: () => set({ activeTool: 'select', ruledSketchAId: null, ruledSketchBId: null, statusMessage: 'Ruled Surface cancelled' }),
    commitRuledSurface: () => {
      const { ruledSketchAId, ruledSketchBId, ruledAlignmentMode, ruledAlignmentDistance, sketches, features, units } = get();
      if (!ruledSketchAId || !ruledSketchBId) {
        set({ statusMessage: 'Select two curve sketches for Ruled Surface' });
        return;
      }
      const sketchA = sketches.find((s) => s.id === ruledSketchAId);
      const sketchB = sketches.find((s) => s.id === ruledSketchBId);
      if (!sketchA || !sketchB) {
        set({ statusMessage: 'One or more selected sketches not found' });
        return;
      }
      const mesh = GeometryEngine.ruledSurface(sketchA, sketchB, ruledAlignmentMode, ruledAlignmentDistance);
      const feature: Feature = {
        id: crypto.randomUUID(),
        name: `Ruled Surface ${features.filter((f) => f.type === 'loft' && f.bodyKind === 'surface').length + 1}`,
        type: 'loft',
        sketchId: ruledSketchAId,
        params: { ruledSketchAId, ruledSketchBId, alignmentMode: ruledAlignmentMode, alignmentDistance: ruledAlignmentDistance },
        visible: true,
        suppressed: false,
        timestamp: Date.now(),
        mesh: mesh ?? undefined,
        bodyKind: 'surface',
      };
      set({
        features: [...features, feature],
        activeTool: 'select',
        ruledSketchAId: null,
        ruledSketchBId: null,
        statusMessage: `Ruled Surface created (${units})`,
      });
    },
  };
}
