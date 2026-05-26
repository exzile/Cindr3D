import type { Feature, FeatureType } from '../../../../../types/cad';
import type { CADSliceContext } from '../../../sliceContext';
import type { CADState } from '../../../state';

export function createFeatureLifecycleTimelineActions({ set, get }: CADSliceContext): Partial<CADState> {
  return {
    deriveFromDesign: (itemIds, sourceFileName) => {
      get().pushUndo();
      const { features } = get();
      const now = Date.now();
      const newFeatures: Feature[] = itemIds.map((itemId, i) => ({
        id: crypto.randomUUID(),
        name: `Derived: ${itemId.slice(0, 8)}...`,
        type: 'derive' as FeatureType,
        params: { sourceFileName, sourceItemId: itemId } as unknown as Record<string, number | string | boolean | number[]>,
        visible: true,
        suppressed: false,
        timestamp: now + i,
        derivedFrom: sourceFileName,
      }));
      set({ features: [...features, ...newFeatures], statusMessage: `Derived ${newFeatures.length} item(s) from ${sourceFileName}` });
    },

    renameFeature: (id, name) => set((state) => ({
      features: state.features.map((f) => f.id === id ? { ...f, name } : f),
    })),

    editingFeatureId: null,
    setEditingFeatureId: (id) => set({ editingFeatureId: id }),

    updateFeatureParams: (id, params) => {
      get().pushUndo();
      set((state) => ({
        features: state.features.map((f) =>
          f.id === id ? { ...f, params: { ...f.params, ...params } } : f,
        ),
        statusMessage: 'Feature parameters updated',
      }));
    },

    reorderFeature: (id, newIndex) => set((state) => {
      const idx = state.features.findIndex((f) => f.id === id);
      if (idx === -1) return {};
      const moved = state.features[idx];

      const clamped = Math.max(0, Math.min(newIndex, state.features.length));
      const mustBeBefore = new Set<string>();
      const mustBeAfter = new Set<string>();

      for (const f of state.features) {
        const parentId = f.parentFeatureId ?? (f.params.parentFeatureId as string | undefined);
        if ((f.type === 'fillet' || f.type === 'chamfer') && parentId === moved.id) {
          mustBeAfter.add(f.id);
        }
        const movedParentId = moved.parentFeatureId ?? (moved.params.parentFeatureId as string | undefined);
        if ((moved.type === 'fillet' || moved.type === 'chamfer') && f.id === movedParentId) {
          mustBeBefore.add(f.id);
        }
        if (moved.type === 'combine') {
          const targetId = moved.params.targetId as string | undefined;
          const toolId = moved.params.toolId as string | undefined;
          if (targetId && f.id === targetId) mustBeBefore.add(f.id);
          if (toolId && f.id === toolId) mustBeBefore.add(f.id);
        }
      }

      let earliest = 0;
      for (let i = 0; i < state.features.length; i++) {
        if (mustBeBefore.has(state.features[i].id)) earliest = i + 1;
      }
      let latest = state.features.length;
      for (let i = state.features.length - 1; i >= 0; i--) {
        if (mustBeAfter.has(state.features[i].id)) latest = i - 1;
      }

      if (earliest > latest) {
        return { statusMessage: `Cannot move ${moved.name}: dependency conflict` };
      }
      const validIndex = Math.max(earliest, Math.min(latest, clamped));

      const next = [...state.features];
      next.splice(idx, 1);
      next.splice(validIndex > idx ? validIndex - 1 : validIndex, 0, moved);
      return { features: next, statusMessage: `Moved ${moved.name}` };
    }),

    rollbackIndex: -1,
    setRollbackIndex: (index) => set({ rollbackIndex: index }),

    baseFeatureActive: false,
    openBaseFeature: (name) => {
      const { features } = get();
      const n = features.filter((f) => f.type === 'base-feature').length + 1;
      const feature: Feature = {
        id: crypto.randomUUID(),
        name: name || `Base Feature ${n}`,
        type: 'base-feature',
        params: {},
        visible: true,
        suppressed: false,
        timestamp: Date.now(),
        isBaseFeatureContainer: true,
        baseFeatureOpen: true,
      };
      set((state) => ({
        features: [...state.features, feature],
        baseFeatureActive: true,
        statusMessage: 'Base Feature open - direct edits inside will not trigger parametric recompute',
      }));
    },

    finishBaseFeature: () => set((state) => ({
      baseFeatureActive: false,
      features: state.features.map((f) =>
        f.isBaseFeatureContainer && f.baseFeatureOpen ? { ...f, baseFeatureOpen: false } : f,
      ),
      statusMessage: 'Base Feature closed',
    })),
  };
}
