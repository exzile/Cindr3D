import { create } from 'zustand';
import * as THREE from 'three';
import type {
  Component, Body, ConstructionGeometry, Joint,
  MaterialAppearance,
} from '../types/cad';
import { GeometryEngine } from '../engine/GeometryEngine';

interface ComponentStore {
  // Root assembly
  rootComponentId: string;
  components: Record<string, Component>;
  bodies: Record<string, Body>;
  constructions: Record<string, ConstructionGeometry>;
  joints: Record<string, Joint>;

  // Active context
  activeComponentId: string;
  setActiveComponentId: (id: string) => void;
  selectedBodyId: string | null;
  setSelectedBodyId: (id: string | null) => void;

  // Component operations
  addComponent: (parentId: string, name?: string) => string;
  removeComponent: (id: string) => void;
  renameComponent: (id: string, name: string) => void;
  duplicateComponent: (id: string) => string;
  toggleComponentVisibility: (id: string) => void;
  setComponentGrounded: (id: string, grounded: boolean) => void;
  moveComponent: (id: string, newParentId: string) => void;

  // Body operations
  addBody: (componentId: string, name?: string) => string;
  removeBody: (id: string) => void;
  renameBody: (id: string, name: string) => void;
  toggleBodyVisibility: (id: string) => void;
  setBodyMaterial: (id: string, material: MaterialAppearance) => void;
  setBodyMesh: (id: string, mesh: THREE.Mesh | THREE.Group) => void;
  addFeatureToBody: (bodyId: string, featureId: string) => void;
  /** D168: Mirror a body through XY/XZ/YZ plane, adding the reflected body to the same component. */
  mirrorBody: (bodyId: string, plane: 'XY' | 'XZ' | 'YZ') => string | null;

  // Construction geometry
  addConstruction: (geometry: Omit<ConstructionGeometry, 'id'>) => string;
  removeConstruction: (id: string) => void;
  toggleConstructionVisibility: (id: string) => void;

  // Joints
  addJoint: (joint: Omit<Joint, 'id'>) => string;
  removeJoint: (id: string) => void;
  setJointValue: (id: string, rotation?: number, translation?: number) => void;
  toggleJointLock: (id: string) => void;

  // Expand/collapse state for tree view
  expandedIds: Set<string>;
  toggleExpanded: (id: string) => void;
}

const rootId = crypto.randomUUID();

const defaultMaterial: MaterialAppearance = {
  id: 'aluminum',
  name: 'Aluminum',
  color: '#B0B8C0',
  metalness: 0.8,
  roughness: 0.3,
  opacity: 1,
  category: 'metal',
};

export const useComponentStore = create<ComponentStore>((set, get) => ({
  rootComponentId: rootId,

  components: {
    [rootId]: {
      id: rootId,
      name: 'Assembly',
      parentId: null,
      childIds: [],
      bodyIds: [],
      sketchIds: [],
      constructionIds: [],
      jointIds: [],
      transform: new THREE.Matrix4(),
      visible: true,
      grounded: true,
      isLinked: false,
      color: '#5B9BD5',
    },
  },

  bodies: {},
  constructions: {},
  joints: {},

  activeComponentId: rootId,
  setActiveComponentId: (id) => set({ activeComponentId: id }),

  selectedBodyId: null,
  setSelectedBodyId: (id) => set({ selectedBodyId: id }),

  // ===== Component Operations =====
  addComponent: (parentId, name) => {
    const { components } = get();
    const parent = components[parentId];
    if (!parent) return parentId;

    const id = crypto.randomUUID();
    const childCount = parent.childIds.length;
    const colors = ['#5B9BD5', '#ED7D31', '#70AD47', '#FFC000', '#5B5EA6',
      '#44C4A1', '#FF6B6B', '#C678DD', '#E06C75', '#98C379'];

    const component: Component = {
      id,
      name: name || `Component ${Object.keys(components).length}`,
      parentId,
      childIds: [],
      bodyIds: [],
      sketchIds: [],
      constructionIds: [],
      jointIds: [],
      transform: new THREE.Matrix4(),
      visible: true,
      grounded: false,
      isLinked: false,
      color: colors[childCount % colors.length],
    };

    set({
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
    if (!comp || !comp.parentId) return; // Can't remove root

    // Remove from parent
    const parent = components[comp.parentId];
    const updatedComponents = { ...components };
    updatedComponents[comp.parentId] = {
      ...parent,
      childIds: parent.childIds.filter(cid => cid !== id),
    };

    // Recursively collect all children to remove
    const toRemove = new Set<string>();
    const collectChildren = (compId: string) => {
      toRemove.add(compId);
      const c = components[compId];
      if (c) c.childIds.forEach(collectChildren);
    };
    collectChildren(id);

    // Remove components, bodies, constructions, joints
    const updatedBodies = { ...bodies };
    const updatedConstructions = { ...constructions };
    const updatedJoints = { ...joints };

    for (const removeId of toRemove) {
      const c = updatedComponents[removeId];
      if (c) {
        c.bodyIds.forEach(bid => delete updatedBodies[bid]);
        c.constructionIds.forEach(cid => delete updatedConstructions[cid]);
        c.jointIds.forEach(jid => delete updatedJoints[jid]);
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
    const { components } = get();
    const comp = components[id];
    if (!comp || !comp.parentId) return id;

    const newId = get().addComponent(comp.parentId, `${comp.name} (Copy)`);
    // TODO: deep copy bodies and features
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
        [comp.parentId]: { ...oldParent, childIds: oldParent.childIds.filter(cid => cid !== id) },
        [newParentId]: { ...newParent, childIds: [...newParent.childIds, id] },
      },
    });
  },

  // ===== Body Operations =====
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
      material: { ...defaultMaterial },
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
      components: comp ? {
        ...components,
        [body.componentId]: { ...comp, bodyIds: comp.bodyIds.filter(bid => bid !== id) },
      } : components,
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

  addFeatureToBody: (bodyId, featureId) => {
    const { bodies } = get();
    const body = bodies[bodyId];
    if (!body) return;
    set({
      bodies: { ...bodies, [bodyId]: { ...body, featureIds: [...body.featureIds, featureId] } },
    });
  },

  // D168 Mirror a solid body through one of the three world planes.
  // Adds the reflected body to the same component and returns its id.
  mirrorBody: (bodyId, plane) => {
    const { bodies, components } = get();
    const body = bodies[bodyId];
    if (!body) return null;

    let mirroredMesh: THREE.Mesh | THREE.Group | null = null;
    if (body.mesh instanceof THREE.Mesh) {
      mirroredMesh = GeometryEngine.mirrorMesh(body.mesh, plane);
    } else if (body.mesh instanceof THREE.Group) {
      const group = new THREE.Group();
      body.mesh.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          group.add(GeometryEngine.mirrorMesh(child, plane));
        }
      });
      mirroredMesh = group;
    }

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

  // ===== Construction Geometry =====
  addConstruction: (geometry) => {
    const { constructions, components } = get();
    const id = crypto.randomUUID();
    const construction: ConstructionGeometry = { ...geometry, id };

    const comp = components[geometry.componentId];
    set({
      constructions: { ...constructions, [id]: construction },
      components: comp ? {
        ...components,
        [geometry.componentId]: {
          ...comp,
          constructionIds: [...comp.constructionIds, id],
        },
      } : components,
    });

    return id;
  },

  removeConstruction: (id) => {
    const { constructions, components } = get();
    const construction = constructions[id];
    if (!construction) return;

    const updated = { ...constructions };
    delete updated[id];

    const comp = components[construction.componentId];
    set({
      constructions: updated,
      components: comp ? {
        ...components,
        [construction.componentId]: {
          ...comp,
          constructionIds: comp.constructionIds.filter(cid => cid !== id),
        },
      } : components,
    });
  },

  toggleConstructionVisibility: (id) => {
    const { constructions } = get();
    const c = constructions[id];
    if (!c) return;
    set({ constructions: { ...constructions, [id]: { ...c, visible: !c.visible } } });
  },

  // ===== Joints =====
  addJoint: (joint) => {
    const { joints, components } = get();
    const id = crypto.randomUUID();
    const newJoint: Joint = { ...joint, id };

    const comp = components[joint.componentId1];
    set({
      joints: { ...joints, [id]: newJoint },
      components: comp ? {
        ...components,
        [joint.componentId1]: {
          ...comp,
          jointIds: [...comp.jointIds, id],
        },
      } : components,
    });

    return id;
  },

  removeJoint: (id) => {
    const { joints } = get();
    const updated = { ...joints };
    delete updated[id];
    set({ joints: updated });
  },

  setJointValue: (id, rotation, translation) => {
    const { joints } = get();
    const joint = joints[id];
    if (!joint) return;
    set({
      joints: {
        ...joints,
        [id]: {
          ...joint,
          rotationValue: rotation ?? joint.rotationValue,
          translationValue: translation ?? joint.translationValue,
        },
      },
    });
  },

  toggleJointLock: (id) => {
    const { joints } = get();
    const joint = joints[id];
    if (!joint) return;
    set({ joints: { ...joints, [id]: { ...joint, locked: !joint.locked } } });
  },

  // ===== UI Tree State =====
  expandedIds: new Set([rootId]),
  toggleExpanded: (id) => {
    const { expandedIds } = get();
    const updated = new Set(expandedIds);
    if (updated.has(id)) updated.delete(id);
    else updated.add(id);
    set({ expandedIds: updated });
  },
}));
