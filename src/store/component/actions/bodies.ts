import * as THREE from 'three';
import type { Body } from '../../../types/cad';
import { GeometryEngine } from '../../../engine/GeometryEngine';
import { defaultComponentMaterial } from '../defaults';
import type { ComponentStore } from '../types';
import type { ComponentStoreApi } from '../storeApi';
import { globalBRepBodyRegistry } from '../../../engine/occ/globalRegistry';
import { detachTessellationFromMesh, BREP_BODY_ID_KEY } from '../../../engine/occ/picking';

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
  | 'removeFeatureFromBody'
  | 'mirrorBody'
  | 'copyBody'
  | 'createComponentFromBody'
  | 'clipboardBodyId'
  | 'setClipboardBody'
  | 'pasteBody'
  | 'setBodyDeflectionOverride'
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

      // Dispose GPU resources so the old geometry doesn't linger on the GPU heap.
      if (body.mesh instanceof THREE.Mesh) {
        body.mesh.geometry?.dispose();
        // Only dispose materials this body owns exclusively (shared library materials are singletons).
        const mat = body.mesh.material;
        if (mat) {
          const mats = Array.isArray(mat) ? mat : [mat];
          for (const m of mats) {
            if (!m.userData?.shared) m.dispose?.();
          }
        }
      } else if (body.mesh instanceof THREE.Group) {
        body.mesh.traverse((child) => {
          if (child instanceof THREE.Mesh) child.geometry?.dispose();
        });
      }

      // Evict the OCC body from the registry (calls body.dispose() internally).
      const brepBodyId =
        body.mesh instanceof THREE.Mesh
          ? (body.mesh.userData['brepBodyId'] as string | undefined)
          : undefined;
      if (brepBodyId) globalBRepBodyRegistry.delete(brepBodyId);

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

    removeFeatureFromBody: (bodyId, featureId) => {
      const { bodies } = get();
      const body = bodies[bodyId];
      if (!body) return;
      set({ bodies: { ...bodies, [bodyId]: { ...body, featureIds: body.featureIds.filter((fid) => fid !== featureId) } } });
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

    copyBody: (bodyId) => {
      const { bodies, components } = get();
      const body = bodies[bodyId];
      if (!body) return null;

      // Clone the display mesh geometry so the copy owns independent GPU buffers.
      // OCC BRep ownership is NOT shared: removeBody on either body calls
      // globalBRepBodyRegistry.delete(brepBodyId), which would dispose the WASM
      // shape and leave the other body with a dangling brepBodyId. Clear OCC refs
      // from the clone so the copy is treated as a tessellation-only (no-BRep) body.
      let clonedMesh: THREE.Mesh | THREE.Group | null = null;
      if (body.mesh instanceof THREE.Mesh) {
        clonedMesh = body.mesh.clone();
        (clonedMesh as THREE.Mesh).geometry = (body.mesh as THREE.Mesh).geometry.clone();
        detachTessellationFromMesh(clonedMesh as THREE.Mesh);
        delete (clonedMesh as THREE.Mesh).userData[BREP_BODY_ID_KEY];
      } else if (body.mesh instanceof THREE.Group) {
        clonedMesh = body.mesh.clone(true);
        clonedMesh.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            detachTessellationFromMesh(child);
            delete child.userData[BREP_BODY_ID_KEY];
          }
        });
      }

      const id = crypto.randomUUID();
      const copied: Body = {
        ...body,
        id,
        name: `${body.name} (Copy)`,
        mesh: clonedMesh,
        featureIds: [],
      };

      const comp = components[body.componentId];
      set({
        bodies: { ...bodies, [id]: copied },
        components: comp
          ? {
              ...components,
              [body.componentId]: { ...comp, bodyIds: [...comp.bodyIds, id] },
            }
          : components,
        selectedBodyId: id,
      });

      return id;
    },

    clipboardBodyId: null,

    setClipboardBody: (bodyId) => set({ clipboardBodyId: bodyId }),

    pasteBody: () => {
      const { clipboardBodyId, bodies, components, activeComponentId } = get();
      if (!clipboardBodyId) return null;

      const srcBody = bodies[clipboardBodyId];
      const targetCompId = activeComponentId ?? srcBody?.componentId;
      if (!srcBody || !targetCompId) return null;

      const comp = components[targetCompId];
      if (!comp) return null;

      let clonedMesh: THREE.Mesh | THREE.Group | null = null;
      if (srcBody.mesh instanceof THREE.Mesh) {
        clonedMesh = srcBody.mesh.clone();
        (clonedMesh as THREE.Mesh).geometry = (srcBody.mesh as THREE.Mesh).geometry.clone();
        detachTessellationFromMesh(clonedMesh as THREE.Mesh);
        delete (clonedMesh as THREE.Mesh).userData[BREP_BODY_ID_KEY];
      } else if (srcBody.mesh instanceof THREE.Group) {
        clonedMesh = srcBody.mesh.clone(true);
        clonedMesh.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            detachTessellationFromMesh(child);
            delete child.userData[BREP_BODY_ID_KEY];
          }
        });
      }

      const id = crypto.randomUUID();
      const pasted: Body = {
        ...srcBody,
        id,
        name: `${srcBody.name} (Paste)`,
        componentId: targetCompId,
        mesh: clonedMesh,
        featureIds: [],
      };

      set((state) => {
        const freshComp = state.components[targetCompId];
        if (!freshComp) return state;
        return {
          bodies: { ...state.bodies, [id]: pasted },
          components: {
            ...state.components,
            [targetCompId]: { ...freshComp, bodyIds: [...freshComp.bodyIds, id] },
          },
          selectedBodyId: id,
        };
      });

      return id;
    },

    createComponentFromBody: (bodyId) => {
      const { bodies, components } = get();
      const body = bodies[bodyId];
      if (!body) return null;

      const srcComp = components[body.componentId];
      if (!srcComp) return null;

      // New component lives as a sibling of srcComp (child of srcComp's parent),
      // or under srcComp if it is the root (no parent).
      const parentId = srcComp.parentId ?? srcComp.id;

      const newCompId = get().addComponent(parentId, body.name);
      if (!newCompId) return null;

      // Reassign body to the new component using a single functional updater
      // to avoid tearing from multiple get() calls around an addComponent set().
      set((state) => {
        const freshSrcComp = state.components[body.componentId];
        const freshNewComp = state.components[newCompId];
        if (!freshSrcComp || !freshNewComp) return state;
        return {
          bodies: {
            ...state.bodies,
            [bodyId]: { ...state.bodies[bodyId], componentId: newCompId },
          },
          components: {
            ...state.components,
            [body.componentId]: {
              ...freshSrcComp,
              bodyIds: freshSrcComp.bodyIds.filter((id) => id !== bodyId),
            },
            [newCompId]: {
              ...freshNewComp,
              bodyIds: [bodyId],
            },
          },
          activeComponentId: newCompId,
        };
      });

      return newCompId;
    },

    setBodyDeflectionOverride: (bodyId, deflection) => {
      const { bodies } = get();
      const body = bodies[bodyId];
      if (!body) return;
      set({ bodies: { ...bodies, [bodyId]: { ...body, deflectionOverride: deflection } } });
    },
  };
}
