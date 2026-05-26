import type { Feature, Sketch } from '../../../../types/cad';
import type { CADSliceContext } from '../../sliceContext';
import type { CADState } from '../../state';

export function createSketchBrowserActions({ set, get }: CADSliceContext): Partial<CADState> {
  return {
    copySketch: (id) => set((state) => {
      const src = state.sketches.find((s) => s.id === id);
      if (!src) return state;
      const copy: Sketch = {
        ...src,
        id: crypto.randomUUID(),
        name: `${src.name} (Copy)`,
        entities: src.entities.map((e) => ({
          ...e,
          id: crypto.randomUUID(),
          points: e.points.map((p) => ({ ...p, id: crypto.randomUUID() })),
        })),
        constraints: [],
        dimensions: [],
      };
      const copyFeature: Feature = {
        id: crypto.randomUUID(),
        name: copy.name,
        type: 'sketch',
        sketchId: copy.id,
        params: { plane: copy.plane },
        visible: true,
        suppressed: false,
        timestamp: Date.now(),
      };
      return {
        sketches: [...state.sketches, copy],
        features: [...state.features, copyFeature],
        statusMessage: `Sketch copied as "${copy.name}"`,
      };
    }),

    deleteSketch: (id) => {
      get().pushUndo();
      set((state) => {
        const activeSketch = state.activeSketch?.id === id ? null : state.activeSketch;
        return {
          sketches: state.sketches.filter((s) => s.id !== id),
          features: state.features.filter((f) => !(f.type === 'sketch' && f.sketchId === id)),
          activeSketch,
          statusMessage: 'Sketch deleted',
        };
      });
    },

    renameSketch: (id, name) => set((state) => ({
      sketches: state.sketches.map((s) => s.id !== id ? s : { ...s, name }),
      features: state.features.map((f) => f.type === 'sketch' && f.sketchId === id ? { ...f, name } : f),
      statusMessage: `Sketch renamed to "${name}"`,
    })),

    redefineSketchPlane: (id, plane, normal, origin) => set((state) => ({
      sketches: state.sketches.map((s) =>
        s.id !== id ? s : { ...s, plane, planeNormal: normal.clone(), planeOrigin: origin.clone() }
      ),
      statusMessage: 'Sketch plane redefined',
    })),
  };
}
