import type { CADState } from './state';
import { useComponentStore } from '../componentStore';
import { serializeFeature } from './persistence';
import { captureOccSnapshot } from '../../engine/occ/occSnapshot';

type HistorySketch = CADState['sketches'][number];
type SerializableVector3 = { x: number; y: number; z: number } | number[];

const serializeSketchForHistory = (sketch: HistorySketch) => ({
  ...sketch,
  planeNormal: sketch.planeNormal ? [sketch.planeNormal.x, sketch.planeNormal.y, sketch.planeNormal.z] : null,
  planeOrigin: sketch.planeOrigin ? [sketch.planeOrigin.x, sketch.planeOrigin.y, sketch.planeOrigin.z] : null,
});

const serializeVector3 = (value: unknown): SerializableVector3 | undefined => {
  if (!value) return undefined;
  if (Array.isArray(value)) return [Number(value[0]) || 0, Number(value[1]) || 0, Number(value[2]) || 0];
  if (typeof value === 'object') {
    const vector = value as { x?: number; y?: number; z?: number };
    return { x: Number(vector.x) || 0, y: Number(vector.y) || 0, z: Number(vector.z) || 0 };
  }
  return undefined;
};

const serializeConstructionForHistory = (construction: unknown) => {
  const c = construction as {
    planeNormal?: unknown;
    planeOrigin?: unknown;
    axisDirection?: unknown;
    axisOrigin?: unknown;
    point?: unknown;
  };
  return {
    ...c,
    planeNormal: serializeVector3(c.planeNormal),
    planeOrigin: serializeVector3(c.planeOrigin),
    axisDirection: serializeVector3(c.axisDirection),
    axisOrigin: serializeVector3(c.axisOrigin),
    point: serializeVector3(c.point),
  };
};

export function snapshotCADState(state: CADState): string {
  const componentState = useComponentStore.getState();

  return JSON.stringify({
    features: state.features.map((f) => serializeFeature(f)),
    sketches: state.sketches.map(serializeSketchForHistory),
    activeSketch: state.activeSketch ? serializeSketchForHistory(state.activeSketch) : null,
    featureGroups: state.featureGroups,
    designConfigurations: state.designConfigurations,
    activeDesignConfigurationId: state.activeDesignConfigurationId,
    parameters: state.parameters,
    constructionPlanes: state.constructionPlanes,
    constructionAxes: state.constructionAxes,
    constructionPoints: state.constructionPoints,
    jointOrigins: state.jointOrigins,
    contactSets: state.contactSets,
    selectionSets: state.selectionSets,
    canvasReferences: state.canvasReferences,
    formBodies: state.formBodies,
    frozenFormVertices: state.frozenFormVertices,
    units: state.units,
    // OCC-7.3: STEP-serialized BRepBodies for undo/redo
    occBodies: captureOccSnapshot(),
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
      constructions: Object.fromEntries(Object.entries(componentState.constructions).map(([id, construction]) => [
        id,
        serializeConstructionForHistory(construction),
      ])),
      joints: Object.fromEntries(Object.entries(componentState.joints).map(([id, joint]) => [
        id,
        {
          ...joint,
          origin: serializeVector3(joint.origin),
          axis: serializeVector3(joint.axis),
        },
      ])),
      rigidGroups: componentState.rigidGroups,
      motionLinks: componentState.motionLinks,
      animationTracks: componentState.animationTracks,
      animationDuration: componentState.animationDuration,
      animationLoop: componentState.animationLoop,
      occurrences: Object.fromEntries(Object.entries(componentState.occurrences).map(([id, occurrence]) => [
        id,
        {
          ...occurrence,
          transform: occurrence.transform.toArray(),
        },
      ])),
      definitions: componentState.definitions,
      componentConstraints: componentState.componentConstraints,
      explodedOffsets: Object.fromEntries(Object.entries(componentState.explodedOffsets).map(([id, value]) => [
        id,
        serializeVector3(value),
      ])),
    },
  });
}
