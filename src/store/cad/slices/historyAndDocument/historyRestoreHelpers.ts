import * as THREE from 'three';
import type {
  Body,
  Component,
  Feature,
  FeatureGroup,
  Sketch,
} from '../../../../types/cad';
import { globalBRepBodyRegistry } from '../../../../engine/occ/globalRegistry';
import { detachTessellationFromMesh } from '../../../../engine/occ/picking';
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
  componentStore?: {
    rootComponentId: string;
    activeComponentId: string | null;
    selectedBodyId: string | null;
    components: Record<
      string,
      Component & { transform: number[] | { elements?: number[] } }
    >;
    bodies: Record<string, Body>;
  };
};

export const restoreComponentStoreSnapshot = (
  snapshot: HistorySnapshot['componentStore'],
) => {
  if (!snapshot) return;

  const currentBodies = useComponentStore.getState().bodies;
  const snapshotBodyIds = new Set(Object.keys(snapshot.bodies));
  for (const [id, body] of Object.entries(currentBodies)) {
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
        const rawTransform = component.transform;
        const transformArray = Array.isArray(rawTransform)
          ? rawTransform
          : rawTransform?.elements;
        return [
          id,
          {
            ...component,
            transform: Array.isArray(transformArray)
              ? new THREE.Matrix4().fromArray(transformArray)
              : new THREE.Matrix4(),
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
  });
};
