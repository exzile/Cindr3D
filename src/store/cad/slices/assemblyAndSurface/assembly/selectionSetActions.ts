import type { SelectionSet } from '../../../../../types/cad/assembly/relationships';
import { useComponentStore } from '../../../../componentStore';
import type { CADSliceContext } from '../../../sliceContext';
import type { CADState } from '../../../state';

export function createSelectionSetActions({ set, get }: CADSliceContext): Partial<CADState> {
  return {
    selectionSets: [],

    addSelectionSet: (name, bodyIds) => {
      const id = crypto.randomUUID();
      set((state) => {
        const n = state.selectionSets.length + 1;
        const entry: SelectionSet = { id, name: name || `Selection Set ${n}`, bodyIds: [...bodyIds] };
        return { selectionSets: [...state.selectionSets, entry] };
      });
      return id;
    },

    removeSelectionSet: (id) => {
      set((state) => ({ selectionSets: state.selectionSets.filter((s) => s.id !== id) }));
    },

    renameSelectionSet: (id, name) => {
      set((state) => ({ selectionSets: state.selectionSets.map((s) => s.id === id ? { ...s, name } : s) }));
    },

    addBodiesToSelectionSet: (id, bodyIds) => {
      set((state) => ({
        selectionSets: state.selectionSets.map((s) => {
          if (s.id !== id) return s;
          const existing = new Set(s.bodyIds);
          return { ...s, bodyIds: [...s.bodyIds, ...bodyIds.filter((b) => !existing.has(b))] };
        }),
      }));
    },

    removeBodyFromSelectionSet: (setId, bodyId) => {
      set((state) => ({
        selectionSets: state.selectionSets.map((s) =>
          s.id === setId ? { ...s, bodyIds: s.bodyIds.filter((b) => b !== bodyId) } : s,
        ),
      }));
    },

    selectSelectionSet: (id) => {
      const componentStore = useComponentStore.getState();
      const ss = get().selectionSets.find((s) => s.id === id);
      if (!ss || ss.bodyIds.length === 0) return;
      componentStore.setSelectedBodyId(ss.bodyIds[0]);
      get().setStatusMessage(`Selection set "${ss.name}": ${ss.bodyIds.length} bodies selected`);
    },
  };
}
