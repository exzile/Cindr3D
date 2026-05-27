import type * as THREE from 'three';
import type { Sketch } from '../../../../types/cad';
import { GeometryEngine } from '../../../../engine/GeometryEngine';
import { useComponentStore } from '../../../componentStore';
import {
  buildExtrudeMeshForProfileSelectionAsync,
  type ExtrudeDirection,
  type SelectedExtrudeProfile,
} from './extrudeCommitHelpers';
import type { ExtrudeOperation } from './extrudeCommitOperation';

export async function registerExtrudeBody({
  effectiveOperation,
  sourceSketch,
  resolvedBodyKind,
  featureId,
  needsStoredMesh,
  featureMesh,
  selected,
  absDistance,
  finalDirection,
  extrudeTaperAngle,
  extrudeStartType,
  extrudeStartOffset,
  absDistance2,
  extrudeTaperAngle2,
}: {
  effectiveOperation: ExtrudeOperation;
  sourceSketch: Sketch;
  resolvedBodyKind: 'solid' | 'surface';
  featureId: string;
  needsStoredMesh: boolean;
  featureMesh?: THREE.Mesh;
  selected: SelectedExtrudeProfile;
  absDistance: number;
  finalDirection: ExtrudeDirection;
  extrudeTaperAngle: number;
  extrudeStartType: string;
  extrudeStartOffset: number;
  absDistance2: number;
  extrudeTaperAngle2: number | undefined;
}): Promise<{ componentId?: string; bodyId?: string; extraBodyIds: string[] }> {
  const extraBodyIds: string[] = [];

  if (effectiveOperation === 'new-component') {
    const componentStore = useComponentStore.getState();
    const parentId = componentStore.activeComponentId ?? componentStore.rootComponentId;
    const componentId = componentStore.addComponent(
      parentId,
      `Component ${Object.keys(componentStore.components ?? {}).length + 1}`,
    );
    const bodyId = componentStore.addBody(componentId, 'Body 1');
    if (bodyId) {
      componentStore.addFeatureToBody(bodyId, featureId);
      if (needsStoredMesh && featureMesh) componentStore.setBodyMesh(bodyId, featureMesh);
    }
    return { componentId, bodyId, extraBodyIds };
  }

  if (effectiveOperation !== 'new-body') return { extraBodyIds };

  const componentStore = useComponentStore.getState();
  const componentId = sourceSketch.componentId ?? componentStore.activeComponentId ?? componentStore.rootComponentId;
  const bodyCount = Object.keys(componentStore.bodies).length + 1;
  const bodyLabel = `${resolvedBodyKind === 'surface' ? 'Surface' : 'Body'} ${bodyCount}`;
  const bodyId = componentStore.addBody(componentId, bodyLabel);
  if (bodyId) {
    componentStore.addFeatureToBody(bodyId, featureId);
    if (needsStoredMesh && featureMesh) componentStore.setBodyMesh(bodyId, featureMesh);
  }

  if (!needsStoredMesh && bodyId) {
    try {
      const probe = await buildExtrudeMeshForProfileSelectionAsync(
        selected,
        absDistance,
        finalDirection,
        extrudeTaperAngle,
        extrudeStartType === 'offset' ? extrudeStartOffset : 0,
        absDistance2,
        extrudeTaperAngle2,
      );
      if (probe) {
        const parts = GeometryEngine.splitByConnectedComponents(probe.geometry);
        if (parts.length > 1) {
          for (let index = 1; index < parts.length; index++) {
            const extraBodyId = componentStore.addBody(componentId, `${bodyLabel}.${index + 1}`);
            if (extraBodyId) {
              componentStore.addFeatureToBody(extraBodyId, featureId);
              extraBodyIds.push(extraBodyId);
            }
          }
        }
        for (const geometry of parts) geometry.dispose();
        if (parts.length !== 1 || parts[0] !== probe.geometry) {
          probe.geometry.dispose();
        }
      }
    } catch {
      // Ignore disconnected-body probing failures; the primary body is already registered.
    }
  }

  return { componentId, bodyId, extraBodyIds };
}
