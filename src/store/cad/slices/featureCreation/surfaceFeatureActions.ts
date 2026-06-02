import type { Feature, Tool } from '../../../../types/cad';
import { GeometryEngine } from '../../../../engine/GeometryEngine';
import type { CADSliceContext } from '../../sliceContext';
import type { CADState } from '../../state';

export function createSurfaceFeatureActions({ set, get }: CADSliceContext): Partial<CADState> {
  return {
    patchSelectedSketchId: null,
    setPatchSelectedSketchId: (id) => set({ patchSelectedSketchId: id }),
    startPatchTool: () => {
      const sketches = get().sketches.filter((s) => s.entities.length > 0);
      if (sketches.length === 0) {
        set({ statusMessage: 'Create a sketch first before using Patch' });
        return;
      }
      set({ activeTool: 'patch' as Tool, patchSelectedSketchId: null, statusMessage: 'Patch - select a closed profile sketch in the panel' });
    },
    cancelPatchTool: () => set({ activeTool: 'select', patchSelectedSketchId: null, statusMessage: 'Patch cancelled' }),
    commitPatch: () => {
      const { patchSelectedSketchId, sketches, features, units } = get();
      if (!patchSelectedSketchId) {
        set({ statusMessage: 'No profile selected for Patch' });
        return;
      }
      const sketch = sketches.find((s) => s.id === patchSelectedSketchId);
      if (!sketch) {
        set({ statusMessage: 'Selected sketch not found' });
        return;
      }
      const mesh = GeometryEngine.patchSketch(sketch);
      const feature: Feature = {
        id: crypto.randomUUID(),
        name: `Patch ${features.filter((f) => f.type === 'extrude' && f.bodyKind === 'surface' && f.params.patchSketchId !== undefined).length + 1}`,
        type: 'extrude',
        sketchId: patchSelectedSketchId,
        params: { patchSketchId: patchSelectedSketchId },
        visible: true,
        suppressed: false,
        timestamp: Date.now(),
        mesh: mesh ?? undefined,
        bodyKind: 'surface',
      };
      set({
        features: [...features, feature],
        activeTool: 'select',
        patchSelectedSketchId: null,
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
