import { create } from 'zustand';
import * as THREE from 'three';
import type {
  Component, Body, ConstructionGeometry, Joint,
  MaterialAppearance, RigidGroup, MotionLink, JointTrack,
} from '../types/cad';
import { GeometryEngine } from '../engine/GeometryEngine';
import type { MirrorComponentParams } from '../components/dialogs/assembly/MirrorComponentDialog';

interface ComponentStore {
  // Root assembly
  rootComponentId: string;
  components: Record<string, Component>;
  bodies: Record<string, Body>;
  constructions: Record<string, ConstructionGeometry>;
  joints: Record<string, Joint>;

  // Rigid groups (A18)
  rigidGroups: RigidGroup[];
  addRigidGroup(componentIds: string[], name?: string): void;
  removeRigidGroup(id: string): void;

  // Motion links (A20)
  motionLinks: MotionLink[];
  addMotionLink(link: Omit<MotionLink, 'id'>): void;
  removeMotionLink(id: string): void;

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
  /** A22: Mirror all bodies of a component through a plane, creating a new mirrored component. */
  mirrorComponent: (params: MirrorComponentParams) => string | null;
  /** A23: Duplicate a component AND copy its associated joints. */
  duplicateComponentWithJoints: (componentId: string) => string;
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

  // ===== Animation (A19) =====
  animationTime: number;
  animationDuration: number;
  animationPlaying: boolean;
  animationLoop: boolean;
  animationTracks: JointTrack[];
  setAnimationTime(t: number): void;
  setAnimationDuration(d: number): void;
  setAnimationPlaying(playing: boolean): void;
  setAnimationLoop(loop: boolean): void;
  setJointTrack(jointId: string, track: Omit<JointTrack, 'jointId'>): void;
  removeJointTrack(jointId: string): void;
  tickAnimation(deltaSeconds: number): void;

  // ===== Exploded View (A27) =====
  explodeActive: boolean;
  explodeFactor: number;
  explodedOffsets: Record<string, THREE.Vector3>;
  setExplodeFactor(f: number): void;
  toggleExplode(): void;
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

  // A22 — Mirror Component
  mirrorComponent: (params) => {
    const { components, bodies } = get();
    const { componentId, mirrorPlane } = params;
    const sourceComp = components[componentId];
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
        // Construction plane: reflect through custom plane normal
        const cloned = mesh.clone();
        cloned.geometry = mesh.geometry.clone();
        if (plane === 'XY') { cloned.scale.z *= -1; cloned.position.z *= -1; }
        else if (plane === 'XZ') { cloned.scale.y *= -1; cloned.position.y *= -1; }
        else if (plane === 'YZ') { cloned.scale.x *= -1; cloned.position.x *= -1; }
        return cloned;
      };

      if (body.mesh instanceof THREE.Mesh) {
        mirroredMesh = applyMirror(body.mesh, mirrorPlane);
      } else if (body.mesh instanceof THREE.Group) {
        const group = new THREE.Group();
        body.mesh.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            group.add(applyMirror(child, mirrorPlane));
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

  // A23 — Duplicate Component With Joints
  duplicateComponentWithJoints: (componentId) => {
    const { components, joints } = get();
    const comp = components[componentId];
    if (!comp || !comp.parentId) return componentId;

    const newId = get().duplicateComponent(componentId);

    // Find all joints referencing the source component
    const relatedJoints = Object.values(joints).filter(
      (j) => j.componentId1 === componentId || j.componentId2 === componentId,
    );

    if (relatedJoints.length === 0) return newId;

    const newJoints: Record<string, Joint> = { ...get().joints };
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

  // ===== Rigid Groups (A18) =====
  rigidGroups: [],
  addRigidGroup: (componentIds, name) => {
    const { rigidGroups } = get();
    const id = crypto.randomUUID();
    const n = rigidGroups.length + 1;
    const group: RigidGroup = { id, name: name ?? `Rigid Group ${n}`, componentIds };
    set({ rigidGroups: [...rigidGroups, group] });
  },
  removeRigidGroup: (id) => {
    const { rigidGroups } = get();
    set({ rigidGroups: rigidGroups.filter((g) => g.id !== id) });
  },

  // ===== Motion Links (A20) =====
  motionLinks: [],
  addMotionLink: (link) => {
    const { motionLinks } = get();
    const id = crypto.randomUUID();
    set({ motionLinks: [...motionLinks, { ...link, id }] });
  },
  removeMotionLink: (id) => {
    const { motionLinks } = get();
    set({ motionLinks: motionLinks.filter((m) => m.id !== id) });
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

  // ===== Animation (A19) =====
  animationTime: 0,
  animationDuration: 5,
  animationPlaying: false,
  animationLoop: true,
  animationTracks: [],

  setAnimationTime: (t) => set({ animationTime: t }),
  setAnimationDuration: (d) => set({ animationDuration: d }),
  setAnimationPlaying: (playing) => set({ animationPlaying: playing }),
  setAnimationLoop: (loop) => set({ animationLoop: loop }),

  setJointTrack: (jointId, track) => {
    const { animationTracks } = get();
    const existing = animationTracks.findIndex((t) => t.jointId === jointId);
    const newTrack: JointTrack = { ...track, jointId };
    if (existing >= 0) {
      const updated = [...animationTracks];
      updated[existing] = newTrack;
      set({ animationTracks: updated });
    } else {
      set({ animationTracks: [...animationTracks, newTrack] });
    }
  },

  removeJointTrack: (jointId) => {
    const { animationTracks } = get();
    set({ animationTracks: animationTracks.filter((t) => t.jointId !== jointId) });
  },

  tickAnimation: (deltaSeconds) => {
    const { animationPlaying, animationDuration, animationLoop, animationTracks } = get();
    if (!animationPlaying) return;

    let newTime = get().animationTime + deltaSeconds;

    if (newTime >= animationDuration) {
      if (animationLoop) {
        newTime = newTime % animationDuration;
      } else {
        newTime = animationDuration;
        set({ animationTime: newTime, animationPlaying: false });
        // Apply final values
        for (const track of animationTracks) {
          get().setJointValue(track.jointId, track.endValue, undefined);
        }
        return;
      }
    }

    set({ animationTime: newTime });

    // Apply interpolated values for each track
    const t = animationDuration > 0 ? newTime / animationDuration : 0;
    for (const track of animationTracks) {
      let easedT: number;
      switch (track.easing) {
        case 'ease-in':
          easedT = t * t;
          break;
        case 'ease-out':
          easedT = t * (2 - t);
          break;
        case 'ease-in-out':
          easedT = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
          break;
        default: // linear
          easedT = t;
      }
      const value = track.startValue + (track.endValue - track.startValue) * easedT;
      get().setJointValue(track.jointId, value, undefined);
    }
  },

  // ===== Exploded View (A27) =====
  explodeActive: false,
  explodeFactor: 0,
  explodedOffsets: {},

  setExplodeFactor: (f) => {
    const { components, bodies } = get();
    const offsets: Record<string, THREE.Vector3> = {};

    // Compute assembly centroid from all body mesh positions
    const centroid = new THREE.Vector3();
    let count = 0;
    for (const comp of Object.values(components)) {
      for (const bodyId of comp.bodyIds) {
        const body = bodies[bodyId];
        if (!body?.mesh) continue;
        const box = new THREE.Box3().setFromObject(body.mesh);
        const center = new THREE.Vector3();
        box.getCenter(center);
        centroid.add(center);
        count++;
      }
    }
    if (count > 0) centroid.divideScalar(count);

    // Compute per-component offsets
    for (const comp of Object.values(components)) {
      if (comp.bodyIds.length === 0) continue;
      // Compute component body centroid
      const compCenter = new THREE.Vector3();
      let bodyCount = 0;
      for (const bodyId of comp.bodyIds) {
        const body = bodies[bodyId];
        if (!body?.mesh) continue;
        const box = new THREE.Box3().setFromObject(body.mesh);
        const c = new THREE.Vector3();
        box.getCenter(c);
        compCenter.add(c);
        bodyCount++;
      }
      if (bodyCount === 0) continue;
      compCenter.divideScalar(bodyCount);

      const dir = compCenter.clone().sub(centroid);
      if (dir.length() < 0.001) continue;
      dir.normalize();
      offsets[comp.id] = dir.multiplyScalar(f * 10);
    }

    set({ explodeFactor: f, explodedOffsets: offsets });
  },

  toggleExplode: () => {
    const { explodeActive } = get();
    const newActive = !explodeActive;
    set({ explodeActive: newActive });
    get().setExplodeFactor(newActive ? 1 : 0);
  },
}));
