import * as THREE from "three";
import type { Feature } from "../../../../../types/cad";
import { useComponentStore } from "../../../../componentStore";
import type { CADSliceContext } from "../../../sliceContext";
import type { CADState } from "../../../state";

export function createComponentPatternActions({ get }: CADSliceContext): Partial<CADState> {
  return {
    groundComponent: (id, grounded) => {
      useComponentStore.getState().setComponentGrounded(id, grounded);
    },
    createComponentPattern: (sourceId, type, params) => {
      const componentStore = useComponentStore.getState();
      const { components, bodies } = componentStore;
      const source = components[sourceId];
      if (!source) return;

      const axisVec = (axis: "X" | "Y" | "Z"): THREE.Vector3 =>
        axis === "X"
          ? new THREE.Vector3(1, 0, 0)
          : axis === "Y"
            ? new THREE.Vector3(0, 1, 0)
            : new THREE.Vector3(0, 0, 1);

      const count = type === "linear" ? params.count : params.circularCount;
      const parentId = source.parentId ?? componentStore.rootComponentId;

      for (let index = 1; index < count; index += 1) {
        let offsetMatrix: THREE.Matrix4;
        if (type === "linear") {
          const dir = axisVec(params.axis).multiplyScalar(params.spacing * index);
          offsetMatrix = new THREE.Matrix4().makeTranslation(dir.x, dir.y, dir.z);
        } else {
          const angle = ((Math.PI * 2) / count) * index;
          offsetMatrix = new THREE.Matrix4().makeRotationAxis(axisVec(params.circularAxis), angle);
        }

        const newCompId = componentStore.addComponent(parentId, `${source.name} (${index + 1})`);

        for (const bodyId of source.bodyIds) {
          const srcBody = bodies[bodyId];
          if (!srcBody || !srcBody.mesh) continue;
          const srcMesh = srcBody.mesh as THREE.Mesh;
          const clonedMesh = srcMesh.clone();
          clonedMesh.applyMatrix4(offsetMatrix);
          clonedMesh.userData.pickable = true;

          const newBodyId = componentStore.addBody(newCompId, `${srcBody.name} (${index + 1})`);
          componentStore.setBodyMesh(newBodyId, clonedMesh);
        }
      }

      const feature: Feature = {
        id: crypto.randomUUID(),
        name: `Component Pattern (${type}, x${count})`,
        type: "linear-pattern",
        params: { sourceComponentId: sourceId, patternType: type, ...params },
        visible: true,
        suppressed: false,
        timestamp: Date.now(),
      };

      get().addFeature(feature);
      get().setStatusMessage(
        `Component pattern: ${count - 1} cop${count - 1 === 1 ? "y" : "ies"} created`,
      );
    },
  };
}
