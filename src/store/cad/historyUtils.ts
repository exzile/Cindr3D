import type { CADState } from './state';
import { useComponentStore } from '../componentStore';

type HistorySketch = CADState['sketches'][number];

const serializeSketchForHistory = (sketch: HistorySketch) => ({
  ...sketch,
  planeNormal: sketch.planeNormal ? [sketch.planeNormal.x, sketch.planeNormal.y, sketch.planeNormal.z] : null,
  planeOrigin: sketch.planeOrigin ? [sketch.planeOrigin.x, sketch.planeOrigin.y, sketch.planeOrigin.z] : null,
});

export function snapshotCADState(state: CADState): string {
  const componentState = useComponentStore.getState();

  return JSON.stringify({
    features: state.features.map((f) => ({
      ...f,
      mesh: undefined,
    })),
    sketches: state.sketches.map(serializeSketchForHistory),
    activeSketch: state.activeSketch ? serializeSketchForHistory(state.activeSketch) : null,
    featureGroups: state.featureGroups,
    componentStore: {
      rootComponentId: componentState.rootComponentId,
      activeComponentId: componentState.activeComponentId,
      selectedBodyId: componentState.selectedBodyId,
      components: Object.fromEntries(Object.entries(componentState.components).map(([id, component]) => [
        id,
        {
          ...component,
          transform: component.transform.toArray(),
        },
      ])),
      bodies: Object.fromEntries(Object.entries(componentState.bodies).map(([id, body]) => [
        id,
        {
          ...body,
          mesh: null,
        },
      ])),
    },
  });
}
