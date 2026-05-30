import type { CADSliceContext } from '../../sliceContext';
import type { CADState } from '../../state';
import { upsertSketch } from './helpers';

export function createSketchEntityActions({ set, get }: CADSliceContext): Partial<CADState> {
  return {
    addSketchEntity: (entity) => {
      const { activeSketch, sketches } = get();
      if (activeSketch) {
        get().pushUndo();
        const nextSketch = {
          ...activeSketch,
          entities: [...activeSketch.entities, entity],
        };
        set({
          activeSketch: nextSketch,
          sketches: upsertSketch(sketches, nextSketch),
        });
      }
    },

    replaceSketchEntities: (entities) => {
      const { activeSketch, sketches } = get();
      if (!activeSketch) return;
      const liveIds = new Set(entities.map((e) => e.id));
      const nextSketch = {
        ...activeSketch,
        entities,
        constraints: activeSketch.constraints?.filter((c) => c.entityIds.every((id) => liveIds.has(id))) ?? [],
        dimensions: activeSketch.dimensions?.filter((d) => d.entityIds.every((id) => liveIds.has(id.split('::')[0]))) ?? [],
      };
      set({ activeSketch: nextSketch, sketches: upsertSketch(sketches, nextSketch) });
    },

    cycleEntityLinetype: (entityId) => {
      const { activeSketch, sketches } = get();
      if (!activeSketch) return;
      const CYCLE: Record<string, 'line' | 'construction-line' | 'centerline'> = {
        'line': 'construction-line',
        'construction-line': 'centerline',
        'centerline': 'line',
      };
      const updated = activeSketch.entities.map((e) => {
        if (e.id !== entityId) return e;
        const next = CYCLE[e.type];
        if (!next) return e;
        return { ...e, type: next };
      });
      const nextSketch = { ...activeSketch, entities: updated };
      set({ activeSketch: nextSketch, sketches: upsertSketch(sketches, nextSketch) });
    },

    breakProjectionLink: (entityId) => {
      const { activeSketch, sketches } = get();
      if (!activeSketch) return;
      const updated = activeSketch.entities.map((e) =>
        e.id === entityId ? { ...e, linked: false } : e,
      );
      set({
        activeSketch: { ...activeSketch, entities: updated },
        sketches: upsertSketch(sketches, { ...activeSketch, entities: updated }),
        statusMessage: 'Projection link broken - entity is now independent',
      });
    },
  };
}
