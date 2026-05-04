import * as THREE from 'three';
import type { Body } from '../../../types/cad';
import { GeometryEngine } from '../../../engine/GeometryEngine';
import { defaultComponentMaterial } from '../defaults';
import type { ComponentStore } from '../types';
import type { ComponentStoreApi } from '../storeApi';

function copyObjectTransform(target: THREE.Object3D, source: THREE.Object3D): void {
  target.position.copy(source.position);
  target.quaternion.copy(source.quaternion);
  target.scale.copy(source.scale);
  target.matrix.copy(source.matrix);
  target.matrixWorld.copy(source.matrixWorld);
  target.matrixAutoUpdate = source.matrixAutoUpdate;
}

export function createBodyActions({ get, set }: ComponentStoreApi): Pick<
  ComponentStore,
  | 'addBody'
  | 'removeBody'
  | 'renameBody'
  | 'toggleBodyVisibility'
  | 'isolateBody'
  | 'showAllBodies'
  | 'setBodyMaterial'
  | 'setBodyMesh'
  | 'setBodyOpacity'
  | 'toggleBodySelectable'
  | 'addFeatureToBody'
  | 'mirrorBody'
> {
  return {
    addBody: (componentId, name) => {
      const { components, bodies } = get();
      const comp = components[componentId];
      if (!comp) return '';

      const id = crypto.randomUUID();
      const body: Body = {
        id,
        name: name || `Body ${Object.keys(bodies).length + 1}`,
        componentId,
        mesh: null,
        visible: true,
        material: { ...defaultComponentMaterial },
        featureIds: [],
      };

      set({
        bodies: { ...bodies, [id]: body },
        components: { ...components, [componentId]: { ...comp, bodyIds: [...comp.bodyIds, id] } },
      });

      return id;
    },

    removeBody: (id) => {
      const { components, bodies } = get();
      const body = bodies[id];
      if (!body) return;

      const comp = components[body.componentId];
      const updatedBodies = { ...bodies };
      delete updatedBodies[id];

      set({
        bodies: updatedBodies,
        components: comp
          ? {
              ...components,
              [body.componentId]: { ...comp, bodyIds: comp.bodyIds.filter((bodyId) => bodyId !== id) },
            }
          : components,
      });
    },

    renameBody: (id, name) => {
      const { bodies } = get();
      const body = bodies[id];
      if (!body) return;
      set({ bodies: { ...bodies, [id]: { ...body, name } } });
    },

    toggleBodyVisibility: (id) => {
      const { bodies } = get();
      const body = bodies[id];
      if (!body) return;
      set({ bodies: { ...bodies, [id]: { ...body, visible: !body.visible } } });
    },

    isolateBody: (id) => {
      const { bodies } = get();
      const allIds = Object.keys(bodies);
      const alreadyIsolated = allIds.every((bodyId) => (bodyId === id ? bodies[bodyId].visible : !bodies[bodyId].visible));
      const updated = Object.fromEntries(
        allIds.map((bodyId) => [bodyId, { ...bodies[bodyId], visible: alreadyIsolated ? true : bodyId === id }]),
      );
      set({ bodies: updated });
    },

    showAllBodies: () => {
      const { bodies } = get();
      const updated = Object.fromEntries(
        Object.entries(bodies).map(([id, body]) => [id, { ...body, visible: true }]),
      );
      set({ bodies: updated });
    },

    setBodyMaterial: (id, material) => {
      const { bodies } = get();
      const body = bodies[id];
      if (!body) return;
      set({ bodies: { ...bodies, [id]: { ...body, material } } });
    },

    setBodyMesh: (id, mesh) => {
      const { bodies } = get();
      const body = bodies[id];
      if (!body) return;
      set({ bodies: { ...bodies, [id]: { ...body, mesh } } });
    },

    setBodyOpacity: (id, opacity) => {
      const { bodies } = get();
      const body = bodies[id];
      if (!body) return;
      set({
        bodies: {
          ...bodies,
          [id]: { ...body, opacity: Math.max(0, Math.min(1, opacity)) },
        },
      });
    },

    toggleBodySelectable: (id) => {
      const { bodies } = get();
      const body = bodies[id];
      if (!body) return;
      set({ bodies: { ...bodies, [id]: { ...body, selectable: body.selectable === false } } });
    },

    addFeatureToBody: (bodyId, featureId) => {
      const { bodies } = get();
      const body = bodies[bodyId];
      if (!body) return;
      set({ bodies: { ...bodies, [bodyId]: { ...body, featureIds: [...body.featureIds, featureId] } } });
    },

    mirrorBody: (bodyId, plane) => {
      const { bodies, components } = get();
      const body = bodies[bodyId];
      if (!body) return null;

      let mirroredMesh: THREE.Mesh | THREE.Group | null = null;
      if (body.mesh instanceof THREE.Mesh) {
        mirroredMesh = GeometryEngine.mirrorMesh(body.mesh, plane);
        copyObjectTransform(mirroredMesh, body.mesh);
      } else if (body.mesh instanceof THREE.Group) {
        const group = new THREE.Group();
        copyObjectTransform(group, body.mesh);
        body.mesh.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            const mirroredChild = GeometryEngine.mirrorMesh(child, plane);
            copyObjectTransform(mirroredChild, child);
            group.add(mirroredChild);
          }
        });
        mirroredMesh = group.children.length > 0 ? group : null;
      }
      if (!mirroredMesh) return null;

      const id = crypto.randomUUID();
      const mirrored: Body = {
        id,
        name: `${body.name} (Mirror ${plane})`,
        componentId: body.componentId,
        mesh: mirroredMesh,
        visible: true,
        material: { ...body.material },
        featureIds: [],
      };

      const comp = components[body.componentId];
      set({
        bodies: { ...bodies, [id]: mirrored },
        components: comp
          ? {
              ...components,
              [body.componentId]: { ...comp, bodyIds: [...comp.bodyIds, id] },
            }
          : components,
      });

      return id;
    },
  };
}
