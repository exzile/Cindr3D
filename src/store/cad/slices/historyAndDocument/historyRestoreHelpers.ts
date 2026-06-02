import * as THREE from 'three';
import type {
  Body,
  Component,
  ConstructionGeometry,
  Feature,
  FeatureGroup,
  Joint,
  Sketch,
} from '../../../../types/cad';
import { globalBRepBodyRegistry } from '../../../../engine/occ/globalRegistry';
import { detachTessellationFromMesh } from '../../../../engine/occ/picking';
import { bodyIdGeometryCache } from '../../../meshRegistry';
import type { DesignConfiguration } from '../../state/coreState';
import { useComponentStore } from '../../../componentStore';

export type HistorySketch = Sketch & {
  planeNormal: [number, number, number] | null;
  planeOrigin: [number, number, number] | null;
};

export type HistorySnapshot = {
  features: Feature[];
  sketches: HistorySketch[];
  activeSketch?: HistorySketch | null;
  featureGroups: FeatureGroup[];
  designConfigurations?: DesignConfiguration[];
  activeDesignConfigurationId?: string;
  parameters?: unknown[];
  constructionPlanes?: unknown[];
  constructionAxes?: unknown[];
  constructionPoints?: unknown[];
  jointOrigins?: unknown[];
  contactSets?: unknown[];
  selectionSets?: unknown[];
  canvasReferences?: unknown[];
  formBodies?: unknown[];
  frozenFormVertices?: string[];
  units?: string;
  componentStore?: {
    rootComponentId: string;
    activeComponentId: string | null;
    selectedBodyId: string | null;
    components: Record<
      string,
      Component & { transform: number[] | { elements?: number[] } }
    >;
    bodies: Record<string, Body>;
    constructions?: Record<string, ConstructionGeometry>;
    joints?: Record<string, Joint>;
    rigidGroups?: ReturnType<typeof useComponentStore.getState>['rigidGroups'];
    motionLinks?: ReturnType<typeof useComponentStore.getState>['motionLinks'];
    animationTracks?: ReturnType<typeof useComponentStore.getState>['animationTracks'];
    animationDuration?: number;
    animationLoop?: boolean;
    occurrences?: Record<
      string,
      Omit<ReturnType<typeof useComponentStore.getState>['occurrences'][string], 'transform'> & {
        transform: number[] | { elements?: number[] };
      }
    >;
    definitions?: ReturnType<typeof useComponentStore.getState>['definitions'];
    componentConstraints?: ReturnType<typeof useComponentStore.getState>['componentConstraints'];
    explodedOffsets?: Record<string, { x?: number; y?: number; z?: number } | number[]>;
  };
};

const vectorFromSerializable = (value: unknown): THREE.Vector3 => {
  if (value instanceof THREE.Vector3) return value;
  if (Array.isArray(value)) {
    return new THREE.Vector3(Number(value[0]) || 0, Number(value[1]) || 0, Number(value[2]) || 0);
  }
  if (value && typeof value === 'object') {
    const vector = value as { x?: number; y?: number; z?: number };
    return new THREE.Vector3(Number(vector.x) || 0, Number(vector.y) || 0, Number(vector.z) || 0);
  }
  return new THREE.Vector3();
};

const matrixFromSerializable = (value: unknown): THREE.Matrix4 => {
  const transformArray = Array.isArray(value)
    ? value
    : (value as { elements?: number[] } | undefined)?.elements;
  return Array.isArray(transformArray)
    ? new THREE.Matrix4().fromArray(transformArray.map((entry) => Number(entry) || 0))
    : new THREE.Matrix4();
};

const restoreConstructionGeometry = (construction: ConstructionGeometry): ConstructionGeometry => ({
  ...construction,
  planeNormal: construction.planeNormal ? vectorFromSerializable(construction.planeNormal) : undefined,
  planeOrigin: construction.planeOrigin ? vectorFromSerializable(construction.planeOrigin) : undefined,
  axisDirection: construction.axisDirection ? vectorFromSerializable(construction.axisDirection) : undefined,
  axisOrigin: construction.axisOrigin ? vectorFromSerializable(construction.axisOrigin) : undefined,
  point: construction.point ? vectorFromSerializable(construction.point) : undefined,
});

export const restoreComponentStoreSnapshot = (
  snapshot: HistorySnapshot['componentStore'],
) => {
  if (!snapshot) return;

  const currentBodies = useComponentStore.getState().bodies;
  const snapshotBodyIds = new Set(Object.keys(snapshot.bodies));
  for (const [id, body] of Object.entries(currentBodies)) {
    if (!snapshotBodyIds.has(id)) {
      bodyIdGeometryCache.get(id)?.dispose();
      bodyIdGeometryCache.delete(id);
    }
    if (!snapshotBodyIds.has(id) && body.mesh) {
      if (body.mesh instanceof THREE.Mesh) {
        body.mesh.geometry?.dispose();
        detachTessellationFromMesh(body.mesh);
      } else if (body.mesh instanceof THREE.Group) {
        body.mesh.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.geometry?.dispose();
            detachTessellationFromMesh(child);
          }
        });
      }
      const brepBodyId =
        body.mesh instanceof THREE.Mesh
          ? (body.mesh.userData['brepBodyId'] as string | undefined)
          : undefined;
      if (brepBodyId) globalBRepBodyRegistry.delete(brepBodyId);
    }
  }

  useComponentStore.setState({
    rootComponentId: snapshot.rootComponentId,
    activeComponentId: snapshot.activeComponentId ?? snapshot.rootComponentId,
    selectedBodyId: snapshot.selectedBodyId,
    components: Object.fromEntries(
      Object.entries(snapshot.components).map(([id, component]) => {
        return [
          id,
          {
            ...component,
            transform: matrixFromSerializable(component.transform),
          },
        ];
      }),
    ),
    bodies: Object.fromEntries(
      Object.entries(snapshot.bodies).map(([id, body]) => [
        id,
        { ...body, mesh: null },
      ]),
    ),
    constructions: Object.fromEntries(
      Object.entries(snapshot.constructions ?? {}).map(([id, construction]) => [
        id,
        restoreConstructionGeometry(construction),
      ]),
    ),
    joints: Object.fromEntries(
      Object.entries(snapshot.joints ?? {}).map(([id, joint]) => [
        id,
        {
          ...joint,
          origin: vectorFromSerializable(joint.origin),
          axis: joint.axis ? vectorFromSerializable(joint.axis) : undefined,
        },
      ]),
    ),
    rigidGroups: snapshot.rigidGroups ?? [],
    motionLinks: snapshot.motionLinks ?? [],
    animationTracks: snapshot.animationTracks ?? [],
    animationDuration: snapshot.animationDuration ?? useComponentStore.getState().animationDuration,
    animationLoop: snapshot.animationLoop ?? useComponentStore.getState().animationLoop,
    occurrences: Object.fromEntries(
      Object.entries(snapshot.occurrences ?? {}).map(([id, occurrence]) => [
        id,
        {
          ...occurrence,
          transform: matrixFromSerializable(occurrence.transform),
        },
      ]),
    ),
    definitions: snapshot.definitions ?? {},
    componentConstraints: snapshot.componentConstraints ?? [],
    explodedOffsets: Object.fromEntries(
      Object.entries(snapshot.explodedOffsets ?? {}).map(([id, value]) => [
        id,
        vectorFromSerializable(value),
      ]),
    ),
    expandedIds: new Set([snapshot.rootComponentId]),
  });
};
