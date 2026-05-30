import * as THREE from 'three';
import { globalBRepBodyRegistry } from '../../../../engine/occ/globalRegistry';
import { getOccSync } from '../../../../engine/occ/loader';
import { occSliceSketch } from '../../../../engine/occ/ops/sliceSketch';
import { useComponentStore } from '../../../componentStore';
import type { CADSliceContext } from '../../sliceContext';
import type { CADState } from '../../state';
import { upsertSketch } from './helpers';

export function createSliceSketchAction({ set, get }: CADSliceContext): Partial<CADState> {
  return {
    sliceSketch: (sketchId) => {
      const state = get();
      const sketch = state.sketches.find((s) => s.id === sketchId)
        ?? (state.activeSketch?.id === sketchId ? state.activeSketch : null);
      if (!sketch) {
        state.setStatusMessage('Slice Sketch: sketch not found');
        return;
      }

      const occ = getOccSync();
      if (!occ) {
        state.setStatusMessage('Slice Sketch: OCC kernel is still loading');
        return;
      }

      const componentState = useComponentStore.getState();
      const selectedBodyId = componentState.selectedBodyId;
      if (!selectedBodyId) {
        state.setStatusMessage('Slice Sketch: select a body first');
        return;
      }
      const body = componentState.bodies[selectedBodyId];
      const brepBodyId =
        body?.mesh instanceof THREE.Mesh
          ? (body.mesh.userData['brepBodyId'] as string | undefined)
          : undefined;
      const brepBody = brepBodyId ? globalBRepBodyRegistry.get(brepBodyId) : undefined;
      if (!brepBody) {
        get().setStatusMessage('Slice Sketch: selected body has no OCC geometry');
        return;
      }

      const entities = occSliceSketch(occ.oc, brepBody, sketch.planeOrigin, sketch.planeNormal);
      if (entities.length === 0) {
        get().setStatusMessage('Slice Sketch: no intersection found');
        return;
      }

      get().pushUndo();
      if (get().activeSketch?.id === sketchId) {
        set((s) => {
          if (!s.activeSketch) return s;
          const nextSketch = { ...s.activeSketch, entities: [...s.activeSketch.entities, ...entities] };
          return { activeSketch: nextSketch, sketches: upsertSketch(s.sketches, nextSketch) };
        });
      } else {
        set((s) => ({
          sketches: s.sketches.map((sk) =>
            sk.id !== sketchId ? sk : { ...sk, entities: [...sk.entities, ...entities] },
          ),
        }));
      }
      get().setStatusMessage(`Slice Sketch: imported ${entities.length} edge${entities.length !== 1 ? 's' : ''}`);
    },
  };
}
