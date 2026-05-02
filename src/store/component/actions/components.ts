import * as THREE from 'three';
import type { Body, Component } from '../../../types/cad';
import { GeometryEngine } from '../../../engine/GeometryEngine';
import { createRootComponent } from '../defaults';
import type { ComponentStore } from '../types';
import type { ComponentStoreApi } from '../storeApi';

const COMPONENT_COLORS = [
  '#5B9BD5',
  '#ED7D31',
  '#70AD47',
  '#FFC000',
  '#5B5EA6',
  '#44C4A1',
  '#FF6B6B',
  '#C678DD',
  '#E06C75',
  '#98C379',
];

export function createComponentActions(
  { get, set }: ComponentStoreApi,
  rootComponentId: string,
): Pick<
  ComponentStore,
  | 'newDocument'
  | 'addComponent'
  | 'removeComponent'
  | 'renameComponent'
  | 'duplicateComponent'
  | 'mirrorComponent'
  | 'duplicateComponentWithJoints'
  | 'toggleComponentVisibility'
  | 'setComponentGrounded'
  | 'makeComponentIndependent'
  | 'moveComponent'
  | 'expandedIds'
  | 'toggleExpanded'
> {
  return {
    newDocument: () => {
      const newRootId = crypto.randomUUID();
      set({
        rootComponentId: newRootId,
        activeComponentId: newRootId,
        selectedBodyId: null,
        components: { [newRootId]: createRootComponent(newRootId) },
        bodies: {},
        constructions: {},
        joints: {},
        componentConstraints: [],
      });
    },

    addComponent: (parentId, name) => {
      const { components, expandedIds } = get();
      const parent = components[parentId];
      if (!parent) return parentId;

      const id = crypto.randomUUID();
      const component: Component = {
        id,
        name: name || `Component ${Object.keys(components).length}`,
        parentId,
        childIds: [],
        bodyIds: [],
        sketchIds: [],
        constructionIds: [],
        constructionPlaneIds: [],
        constructionAxisIds: [],
        constructionPointIds: [],
        jointIds: [],
        transform: new THREE.Matrix4(),
        visible: true,
        grounded: false,
        isLinked: false,
        color: COMPONENT_COLORS[parent.childIds.length % COMPONENT_COLORS.length],
      };

      const nextExpandedIds = new Set(expandedIds);
      nextExpandedIds.add(parentId);
      nextExpandedIds.add(id);

      set({
        activeComponentId: id,
        expandedIds: nextExpandedIds,
        components: {
          ...components,
          [id]: component,
          [parentId]: { ...parent, childIds: [...parent.childIds, id] },
        },
      });

      return id;
    },

    removeComponent: (id) => {
      const { components, bodies, constructions, joints } = get();
      const comp = components[id];
      if (!comp || !comp.parentId) return;

      const parent = components[comp.parentId];
      const updatedComponents = { ...components };
      updatedComponents[comp.parentId] = {
        ...parent,
        childIds: parent.childIds.filter((childId) => childId !== id),
      };

      const toRemove = new Set<string>();
      const collectChildren = (componentId: string) => {
        toRemove.add(componentId);
        const child = components[componentId];
        if (child) child.childIds.forEach(collectChildren);
      };
      collectChildren(id);

      const updatedBodies = { ...bodies };
      const updatedConstructions = { ...constructions };
      const updatedJoints = { ...joints };

      for (const removeId of toRemove) {
        const current = updatedComponents[removeId];
        if (current) {
          current.bodyIds.forEach((bodyId) => delete updatedBodies[bodyId]);
          current.constructionIds.forEach((constructionId) => delete updatedConstructions[constructionId]);
          current.jointIds.forEach((jointId) => delete updatedJoints[jointId]);
        }
        delete updatedComponents[removeId];
      }

      set({
        components: updatedComponents,
        bodies: updatedBodies,
        constructions: updatedConstructions,
        joints: updatedJoints,
      });
    },

    renameComponent: (id, name) => {
      const { components } = get();
      const comp = components[id];
      if (!comp) return;
      set({ components: { ...components, [id]: { ...comp, name } } });
    },

    duplicateComponent: (id) => {
      const { components, bodies } = get();
      const comp = components[id];
      if (!comp || !comp.parentId) return id;

      const newId = get().addComponent(comp.parentId, `${comp.name} (Copy)`);
      const newBodies: Record<string, Body> = {};
      const newBodyIds: string[] = [];

      for (const bodyId of comp.bodyIds) {
        const body = bodies[bodyId];
        if (!body) continue;
        const newBodyId = crypto.randomUUID();
        newBodies[newBodyId] = {
          ...body,
          id: newBodyId,
          componentId: newId,
          mesh: body.mesh ? body.mesh.clone() : null,
          featureIds: [],
          material: { ...body.material },
        };
        newBodyIds.push(newBodyId);
      }

      const updatedComponents = { ...get().components };
      updatedComponents[newId] = { ...updatedComponents[newId], bodyIds: newBodyIds };

      set({
        bodies: { ...get().bodies, ...newBodies },
        components: updatedComponents,
      });

      return newId;
    },

    mirrorComponent: (params) => {
      const { components, bodies } = get();
      const sourceComp = components[params.componentId];
      if (!sourceComp || !sourceComp.parentId) return null;

      const newId = get().addComponent(sourceComp.parentId, `${sourceComp.name} (Mirror)`);
      const mirroredBodies: Record<string, Body> = {};
      const newBodyIds: string[] = [];

      for (const bodyId of sourceComp.bodyIds) {
        const body = bodies[bodyId];
        if (!body) continue;

        let mirroredMesh: THREE.Mesh | THREE.Group | null = null;
        const applyMirror = (mesh: THREE.Mesh, plane: string): THREE.Mesh => {
          if (plane === 'XY' || plane === 'XZ' || plane === 'YZ') {
            return GeometryEngine.mirrorMesh(mesh, plane as 'XY' | 'XZ' | 'YZ');
          }
          const cloned = mesh.clone();
          cloned.geometry = mesh.geometry.clone();
          if (plane === 'XY') {
            cloned.scale.z *= -1;
            cloned.position.z *= -1;
          } else if (plane === 'XZ') {
            cloned.scale.y *= -1;
            cloned.position.y *= -1;
          } else if (plane === 'YZ') {
            cloned.scale.x *= -1;
            cloned.position.x *= -1;
          }
          return cloned;
        };

        if (body.mesh instanceof THREE.Mesh) {
          mirroredMesh = applyMirror(body.mesh, params.mirrorPlane);
        } else if (body.mesh instanceof THREE.Group) {
          const group = new THREE.Group();
          body.mesh.traverse((child) => {
            if (child instanceof THREE.Mesh) {
              group.add(applyMirror(child, params.mirrorPlane));
            }
          });
          mirroredMesh = group;
        }

        const newBodyId = crypto.randomUUID();
        mirroredBodies[newBodyId] = {
          id: newBodyId,
          name: `${body.name} (Mirror)`,
          componentId: newId,
          mesh: mirroredMesh,
          visible: true,
          material: { ...body.material },
          featureIds: [],
        };
        newBodyIds.push(newBodyId);
      }

      const updatedComponents = { ...get().components };
      updatedComponents[newId] = {
        ...updatedComponents[newId],
        bodyIds: newBodyIds,
        isLinked: params.createLinked,
      };

      set({
        bodies: { ...get().bodies, ...mirroredBodies },
        components: updatedComponents,
      });

      return newId;
    },

    duplicateComponentWithJoints: (componentId) => {
      const { components, joints } = get();
      const comp = components[componentId];
      if (!comp || !comp.parentId) return componentId;

      const newId = get().duplicateComponent(componentId);
      const relatedJoints = Object.values(joints).filter(
        (joint) => joint.componentId1 === componentId || joint.componentId2 === componentId,
      );
      if (relatedJoints.length === 0) return newId;

      const newJoints = { ...get().joints };
      const newJointIds: string[] = [];

      for (const joint of relatedJoints) {
        const newJointId = crypto.randomUUID();
        newJoints[newJointId] = {
          ...joint,
          id: newJointId,
          name: `${joint.name} (Copy)`,
          componentId1: joint.componentId1 === componentId ? newId : joint.componentId1,
          componentId2: joint.componentId2 === componentId ? newId : joint.componentId2,
        };
        newJointIds.push(newJointId);
      }

      const updatedComponents = { ...get().components };
      updatedComponents[newId] = {
        ...updatedComponents[newId],
        jointIds: [...(updatedComponents[newId].jointIds ?? []), ...newJointIds],
      };

      set({ joints: newJoints, components: updatedComponents });
      return newId;
    },

    toggleComponentVisibility: (id) => {
      const { components } = get();
      const comp = components[id];
      if (!comp) return;
      set({ components: { ...components, [id]: { ...comp, visible: !comp.visible } } });
    },

    setComponentGrounded: (id, grounded) => {
      const { components } = get();
      const comp = components[id];
      if (!comp) return;
      set({ components: { ...components, [id]: { ...comp, grounded } } });
    },

    makeComponentIndependent: (id) => {
      const { components } = get();
      const comp = components[id];
      if (!comp || !comp.isLinked) return;
      set({ components: { ...components, [id]: { ...comp, isLinked: false } } });
    },

    moveComponent: (id, newParentId) => {
      const { components } = get();
      const comp = components[id];
      if (!comp || !comp.parentId || id === newParentId) return;

      const oldParent = components[comp.parentId];
      const newParent = components[newParentId];
      if (!oldParent || !newParent) return;

      set({
        components: {
          ...components,
          [id]: { ...comp, parentId: newParentId },
          [comp.parentId]: {
            ...oldParent,
            childIds: oldParent.childIds.filter((childId) => childId !== id),
          },
          [newParentId]: { ...newParent, childIds: [...newParent.childIds, id] },
        },
      });
    },

    expandedIds: new Set([rootComponentId]),
    toggleExpanded: (id) => {
      const { expandedIds } = get();
      const updated = new Set(expandedIds);
      if (updated.has(id)) updated.delete(id);
      else updated.add(id);
      set({ expandedIds: updated });
    },
  };
}
