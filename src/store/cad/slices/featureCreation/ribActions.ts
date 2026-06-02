import type { Feature, Tool } from '../../../../types/cad';
import { GeometryEngine } from '../../../../engine/GeometryEngine';
import type { CADSliceContext } from '../../sliceContext';
import type { CADState } from '../../state';
import { addToast } from '../../../toastStore';

export function createRibActions({ set, get }: CADSliceContext): Partial<CADState> {
  return {
    ribSelectedSketchId: null,
    setRibSelectedSketchId: (id) => set({ ribSelectedSketchId: id }),
    ribThickness: 2,
    setRibThickness: (t) => set({ ribThickness: Math.max(0.01, t) }),
    ribHeight: 10,
    setRibHeight: (h) => set({ ribHeight: Math.max(0.01, h) }),
    ribDirection: 'normal',
    setRibDirection: (d) => set({ ribDirection: d }),
    startRibTool: () => {
      const sketches = get().sketches.filter((s) => s.entities.length > 0);
      if (sketches.length === 0) {
        addToast('warning', 'Rib needs a sketch', 'Draw a profile sketch first');
        set({ statusMessage: 'Create a sketch first before adding a rib' });
        return;
      }
      set({ activeTool: 'rib' as Tool, ribSelectedSketchId: null, statusMessage: 'Rib - pick a profile sketch in the panel' });
    },
    cancelRibTool: () => set({ activeTool: 'select', ribSelectedSketchId: null, statusMessage: 'Rib cancelled' }),
    commitRib: () => {
      const { ribSelectedSketchId, ribThickness, ribHeight, ribDirection, sketches, features, units } = get();
      if (!ribSelectedSketchId) {
        set({ statusMessage: 'No profile selected for rib' });
        return;
      }
      const sketch = sketches.find((s) => s.id === ribSelectedSketchId);
      if (!sketch) {
        set({ statusMessage: 'Selected sketch not found' });
        return;
      }
      get().pushUndo();
      const signedHeight = ribDirection === 'flip' ? -ribHeight : ribHeight;
      const ribMesh = GeometryEngine.extrudeThinSketch(sketch, Math.abs(signedHeight), ribThickness, 'center') ?? undefined;
      const feature: Feature = {
        id: crypto.randomUUID(),
        name: `Rib ${features.filter((f) => f.type === 'rib').length + 1}`,
        type: 'rib',
        sketchId: ribSelectedSketchId,
        params: { thickness: ribThickness, height: ribHeight, direction: ribDirection },
        visible: true,
        suppressed: false,
        timestamp: Date.now(),
        mesh: ribMesh,
      };
      set({
        features: [...features, feature],
        activeTool: 'select',
        ribSelectedSketchId: null,
        statusMessage: `Rib created: ${ribThickness}mm thick, ${ribHeight}${units} tall`,
      });
    },
  };
}
