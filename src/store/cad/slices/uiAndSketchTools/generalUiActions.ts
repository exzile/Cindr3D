import * as THREE from 'three';
import type { Feature, Parameter } from '../../../../types/cad';
import { evaluateExpression, resolveParameters } from '../../../../utils/expressionEval';
import { useComponentStore } from '../../../componentStore';
import type { CADSliceContext } from '../../sliceContext';
import type { CADState } from '../../state';

export function createGeneralUiActions({ set, get }: CADSliceContext): Partial<CADState> {
  return {
  showExportDialog: false,
  setShowExportDialog: (show) => set({ showExportDialog: show }),

  // D6 Fillet edge selection + live radius for gizmo drag feedback
  filletEdgeIds: [],
  addFilletEdge: (id) => set((state) => ({
    filletEdgeIds: state.filletEdgeIds.includes(id) ? state.filletEdgeIds : [...state.filletEdgeIds, id],
  })),
  removeFilletEdge: (id) => set((state) => ({ filletEdgeIds: state.filletEdgeIds.filter((e) => e !== id) })),
  clearFilletEdges: () => set({ filletEdgeIds: [] }),
  filletLiveRadius: 2,
  setFilletLiveRadius: (r) => set({ filletLiveRadius: Math.max(0.01, r) }),

  // D7 Chamfer edge selection + live distance for gizmo drag feedback
  chamferEdgeIds: [],
  addChamferEdge: (id) => set((state) => ({
    chamferEdgeIds: state.chamferEdgeIds.includes(id) ? state.chamferEdgeIds : [...state.chamferEdgeIds, id],
  })),
  removeChamferEdge: (id) => set((state) => ({ chamferEdgeIds: state.chamferEdgeIds.filter((e) => e !== id) })),
  clearChamferEdges: () => set({ chamferEdgeIds: [] }),
  chamferLiveDistance: 2,
  setChamferLiveDistance: (d) => set({ chamferLiveDistance: Math.max(0.01, d) }),

  activeDialog: null,
  setActiveDialog: (dialog) => set((state) => ({
    activeDialog: dialog,
    // D186: closing the dialog also clears editing state so the next one opens fresh
    editingFeatureId: dialog === null ? null : state.editingFeatureId,
    // Clear edge selections and reset live radius when opening fillet/chamfer dialogs
    filletEdgeIds: dialog === 'fillet' ? [] : state.filletEdgeIds,
    filletLiveRadius: dialog === 'fillet' ? 2 : state.filletLiveRadius,
    chamferEdgeIds: dialog === 'chamfer' ? [] : state.chamferEdgeIds,
    chamferLiveDistance: dialog === 'chamfer' ? 2 : state.chamferLiveDistance,
  })),
  dialogPayload: null,
  setDialogPayload: (payload) => set({ dialogPayload: payload }),

  measurePoints: [],
  setMeasurePoints: (pts) => set({ measurePoints: pts }),
  clearMeasure: () => set({ measurePoints: [] }),

  statusMessage: 'Ready',
  setStatusMessage: (message) => set({ statusMessage: message }),

  units: 'mm',
  setUnits: (units) => set({ units: units }),
  selectionFilter: { bodies: true, faces: true, edges: true, vertices: true, sketches: true, construction: true },
  setSelectionFilter: (f) => set((state) => ({ selectionFilter: { ...state.selectionFilter, ...f } })),

  // D207 â€” Sketch Grid / Snap settings
  sketchGridEnabled: true,
  sketchSnapEnabled: true,
  setSketchGridEnabled: (v) => set({ sketchGridEnabled: v }),
  setSketchSnapEnabled: (v) => set({ sketchSnapEnabled: v }),

  cameraHomeCounter: 0,
  triggerCameraHome: () => set((state) => ({ cameraHomeCounter: state.cameraHomeCounter + 1 })),
  cameraNavMode: null,
  setCameraNavMode: (mode) => set({ cameraNavMode: mode }),
  // NAV-19
  viewportLayout: '1',
  setViewportLayout: (layout) => set({ viewportLayout: layout }),
  zoomToFitCounter: 0,
  triggerZoomToFit: () => set((state) => ({ zoomToFitCounter: state.zoomToFitCounter + 1 })),
  zoomWindowTrigger: null,
  triggerZoomWindow: (rect) => set({ zoomWindowTrigger: rect }),
  clearZoomWindow: () => set({ zoomWindowTrigger: null }),

  parameters: [],
  addParameter: (name, expression, description, group) => {
    const newParam: Parameter = {
      id: crypto.randomUUID(),
      name,
      expression,
      value: NaN,
      description,
      group,
    };
    set((state) => ({
      parameters: resolveParameters([...state.parameters, newParam]),
    }));
  },
  updateParameter: (id, updates) => {
    set((state) => {
      const updated = state.parameters.map(p =>
        p.id === id ? { ...p, ...updates } : p
      );
      return { parameters: resolveParameters(updated) };
    });
  },
  removeParameter: (id) => {
    set((state) => ({
      parameters: resolveParameters(state.parameters.filter(p => p.id !== id)),
    }));
  },
  evaluateExpression: (expr) => {
    return evaluateExpression(expr, get().parameters);
  },

  // A5 â€” delegates to componentStore.setComponentGrounded so callers reaching
  // for the cadStore facade still get a working ground/unground action.
  // Previously this was a void-stub that silently did nothing.
  groundComponent: (id, grounded) => {
    useComponentStore.getState().setComponentGrounded(id, grounded);
  },

  // A9 â€” Component Pattern
  createComponentPattern: (sourceId, type, params) => {
    const componentStore = useComponentStore.getState();
    const { components, bodies } = componentStore;
    const source = components[sourceId];
    if (!source) return;

    const axisVec = (a: 'X' | 'Y' | 'Z'): THREE.Vector3 =>
      a === 'X' ? new THREE.Vector3(1, 0, 0) : a === 'Y' ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);

    const n = type === 'linear' ? params.count : params.circularCount;
    const parentId = source.parentId ?? componentStore.rootComponentId;

    for (let i = 1; i < n; i++) {
      let offsetMatrix: THREE.Matrix4;
      if (type === 'linear') {
        const dir = axisVec(params.axis).multiplyScalar(params.spacing * i);
        offsetMatrix = new THREE.Matrix4().makeTranslation(dir.x, dir.y, dir.z);
      } else {
        const angle = ((Math.PI * 2) / n) * i;
        offsetMatrix = new THREE.Matrix4().makeRotationAxis(axisVec(params.circularAxis), angle);
      }

      // Create new child component for this copy
      const newCompId = componentStore.addComponent(parentId, `${source.name} (${i + 1})`);

      // Clone each body from the source into the new component
      for (const bodyId of source.bodyIds) {
        const srcBody = bodies[bodyId];
        if (!srcBody || !srcBody.mesh) continue;
        const srcMesh = srcBody.mesh as THREE.Mesh;
        const clonedMesh = srcMesh.clone();
        clonedMesh.applyMatrix4(offsetMatrix);
        clonedMesh.userData.pickable = true;

        const newBodyId = componentStore.addBody(newCompId, `${srcBody.name} (${i + 1})`);
        componentStore.setBodyMesh(newBodyId, clonedMesh as THREE.Mesh);
      }
    }

    const feature: Feature = {
      id: crypto.randomUUID(),
      name: `Component Pattern (${type}, Ã—${n})`,
      type: 'linear-pattern',
      params: { sourceComponentId: sourceId, patternType: type, ...params },
      visible: true,
      suppressed: false,
      timestamp: Date.now(),
    };

    get().addFeature(feature);
    get().setStatusMessage(`Component pattern: ${n - 1} cop${n - 1 === 1 ? 'y' : 'ies'} created`);
  },

  };
}
