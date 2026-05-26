import type { CADSliceContext } from '../../../sliceContext';
import type { CADState } from '../../../state';

export function createConstructionActions({ set }: CADSliceContext): Partial<CADState> {
  return {
    constructionPlanes: [],
    constructionAxes: [],
    constructionPoints: [],
    addConstructionPlane: (p) => set((state) => ({
      constructionPlanes: [
        ...state.constructionPlanes,
        {
          ...p,
          id: crypto.randomUUID(),
          name: 'Plane ' + (state.constructionPlanes.length + 1),
        },
      ],
    })),
    addConstructionAxis: (a) => set((state) => ({
      constructionAxes: [
        ...state.constructionAxes,
        {
          ...a,
          id: crypto.randomUUID(),
          name: 'Axis ' + (state.constructionAxes.length + 1),
        },
      ],
    })),
    addConstructionPoint: (p) => set((state) => ({
      constructionPoints: [
        ...state.constructionPoints,
        {
          ...p,
          id: crypto.randomUUID(),
          name: 'Point ' + (state.constructionPoints.length + 1),
        },
      ],
    })),
    cancelConstructTool: () => set({ activeTool: 'select' }),
  };
}
