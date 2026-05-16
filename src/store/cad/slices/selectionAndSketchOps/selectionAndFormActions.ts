import type { CADSliceContext } from '../../sliceContext';
import type { CADState } from '../../state';

export function createSelectionAndFormActions({ set }: CADSliceContext): Partial<CADState> {
  return {
    selectedFeatureId: null,
    setSelectedFeatureId: (id) => set({ selectedFeatureId: id }),

    selectedEntityIds: [],
    setSelectedEntityIds: (ids) => set({ selectedEntityIds: ids }),
    toggleEntitySelection: (id) =>
      set((state) => {
        const ids = state.selectedEntityIds;
        return {
          selectedEntityIds: ids.includes(id) ? ids.filter((i) => i !== id) : [...ids, id],
        };
      }),

    selectionMode: 'normal',
    setSelectionMode: (mode) => set({ selectionMode: mode }),

    windowSelecting: false,
    windowSelectStart: null,
    windowSelectEnd: null,
    setWindowSelectStart: (p) => set({ windowSelecting: true, windowSelectStart: p, windowSelectEnd: p }),
    setWindowSelectEnd: (p) => set({ windowSelectEnd: p }),
    clearWindowSelect: () => set({ windowSelecting: false, windowSelectStart: null, windowSelectEnd: null }),

    lassoSelecting: false,
    lassoPoints: [],
    setLassoSelecting: (v) => set({ lassoSelecting: v }),
    setLassoPoints: (pts) => set({ lassoPoints: pts }),
    clearLasso: () => set({ lassoSelecting: false, lassoPoints: [] }),

    formBodies: [],
    activeFormBodyId: null,
    formSelection: null,
    addFormBody: (cage) => set((state) => ({ formBodies: [...state.formBodies, cage] })),
    removeFormBody: (id) =>
      set((state) => ({
        formBodies: state.formBodies.filter((b) => b.id !== id),
        activeFormBodyId: state.activeFormBodyId === id ? null : state.activeFormBodyId,
        formSelection: state.formSelection?.bodyId === id ? null : state.formSelection,
      })),
    setActiveFormBody: (id) => set({ activeFormBodyId: id }),
    setFormSelection: (sel) => set({ formSelection: sel }),
    deleteFormElements: (type, ids) =>
      set((state) => {
        const body = state.formBodies.find((b) => b.id === state.activeFormBodyId);
        if (!body) return {};
        let updated;
        if (type === 'vertex') {
          const removed = new Set(ids);
          const cleanEdges = body.edges.filter(
            (e) => !removed.has(e.vertexIds[0]) && !removed.has(e.vertexIds[1]),
          );
          const cleanFaces = body.faces.filter((f) => !f.vertexIds.some((v) => removed.has(v)));
          updated = {
            ...body,
            vertices: body.vertices.filter((v) => !removed.has(v.id)),
            edges: cleanEdges,
            faces: cleanFaces,
          };
        } else if (type === 'edge') {
          const removed = new Set(ids);
          updated = { ...body, edges: body.edges.filter((e) => !removed.has(e.id)) };
        } else {
          const removed = new Set(ids);
          updated = { ...body, faces: body.faces.filter((f) => !removed.has(f.id)) };
        }
        return {
          formBodies: state.formBodies.map((b) => (b.id === updated.id ? updated : b)),
          formSelection: null,
        };
      }),

    updateFormVertices: (bodyId, updates) =>
      set((state) => {
        const body = state.formBodies.find((b) => b.id === bodyId);
        if (!body) return {};
        const posMap = new Map(updates.map((u) => [u.id, u.position]));
        const newVerts = body.vertices.map((v) =>
          posMap.has(v.id) ? { ...v, position: posMap.get(v.id)! } : v,
        );
        return { formBodies: state.formBodies.map((b) => (b.id === bodyId ? { ...body, vertices: newVerts } : b)) };
      }),

    setFormBodySubdivisionLevel: (id, level) =>
      set((state) => ({
        formBodies: state.formBodies.map((b) =>
          b.id !== id ? b : { ...b, subdivisionLevel: Math.max(1, Math.min(3, level)) },
        ),
      })),

    setFormBodyCrease: (id, crease) =>
      set((state) => ({
        formBodies: state.formBodies.map((b) =>
          b.id !== id ? b : { ...b, vertices: b.vertices.map((v) => ({ ...v, crease })) },
        ),
      })),

    frozenFormVertices: [],
    toggleFrozenFormVertex: (id) =>
      set((state) => {
        const frozen = state.frozenFormVertices;
        return {
          frozenFormVertices: frozen.includes(id) ? frozen.filter((v) => v !== id) : [...frozen, id],
        };
      }),
  };
}
