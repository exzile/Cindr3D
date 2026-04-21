import { create } from 'zustand';
import { persist, type PersistStorage } from 'zustand/middleware';
import * as THREE from 'three';
import type {
  Component, Body, ConstructionGeometry, Joint,
  MaterialAppearance, RigidGroup, MotionLink, JointTrack,
  ComponentDefinition, ComponentOccurrence, ComponentConstraint,
} from '../types/cad';
import { GeometryEngine } from '../engine/GeometryEngine';
import type { MirrorComponentParams } from '../components/dialogs/assembly/MirrorComponentDialog';

// ── IndexedDB storage adapter (mirrors cadStore pattern) ─────────────────────
function openComponentDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('dzign3d-component-store', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

// Plain string-keyed IndexedDB adapter. The concrete shape matches Zustand's
// string-based storage contract; we cast to PersistStorage<unknown> where the
// persist middleware expects the typed form (cadStore uses the same pattern).
const idbStorage = {
  getItem: async (name: string): Promise<string | null> => {
    try {
      const db = await openComponentDB();
      return new Promise((resolve) => {
        const tx  = db.transaction('kv', 'readonly');
        const req = tx.objectStore('kv').get(name);
        req.onsuccess = () => { db.close(); resolve(req.result ?? null); };
        req.onerror   = () => { db.close(); resolve(null); };
      });
    } catch { return null; }
  },
  setItem: async (name: string, value: string): Promise<void> => {
    try {
      const db = await openComponentDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').put(value, name);
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror    = () => { db.close(); reject(tx.error); };
      });
    } catch { /* storage unavailable — silently skip */ }
  },
  removeItem: async (name: string): Promise<void> => {
    try {
      const db = await openComponentDB();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').delete(name);
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror    = () => { db.close(); reject(tx.error); };
      });
    } catch { /* ignore */ }
  },
};

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
  activeComponentId: string | null;
  setActiveComponentId: (id: string | null) => void;
  selectedBodyId: string | null;
  setSelectedBodyId: (id: string | null) => void;
  newDocument: () => void;

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
  /** A28: Make Independent — breaks external reference link, converts to local embedded component. */
  makeComponentIndependent: (id: string) => void;
  moveComponent: (id: string, newParentId: string) => void;

  // Body operations
  addBody: (componentId: string, name?: string) => string;
  removeBody: (id: string) => void;
  renameBody: (id: string, name: string) => void;
  toggleBodyVisibility: (id: string) => void;
  /** Isolate a body: hide all other bodies; if already isolated, restore all. */
  isolateBody: (id: string) => void;
  /** Show every body regardless of current visibility. */
  showAllBodies: () => void;
  setBodyMaterial: (id: string, material: MaterialAppearance) => void;
  setBodyMesh: (id: string, mesh: THREE.Mesh | THREE.Group) => void;
  addFeatureToBody: (bodyId: string, featureId: string) => void;
  /** CTX-7: Set body opacity [0,1]. */
  setBodyOpacity: (id: string, opacity: number) => void;
  /** CTX-9: Toggle body selectability. */
  toggleBodySelectable: (id: string) => void;
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

  // CORR-4: split definition/occurrence stores (additive — existing Component tree unchanged)
  definitions: Record<string, ComponentDefinition>;
  occurrences: Record<string, ComponentOccurrence>;
  /** CORR-4: create a ComponentDefinition from an existing Component (by copying its data fields). */
  createDefinitionFromComponent: (componentId: string) => string;
  /** CORR-4: place an occurrence of a definition inside a parent occurrence. */
  placeOccurrence: (definitionId: string, parentOccurrenceId: string | null, transform?: THREE.Matrix4) => string;
  /** CORR-4: remove an occurrence (does NOT remove the definition or its bodies). */
  removeOccurrence: (occurrenceId: string) => void;
  /** CORR-5: set grounded on a specific occurrence (not all occurrences of that definition). */
  setOccurrenceGrounded: (occurrenceId: string, grounded: boolean) => void;
  /** CORR-4: update an occurrence's transform. */
  setOccurrenceTransform: (occurrenceId: string, transform: THREE.Matrix4) => void;
  /** CORR-4: toggle visibility of a specific occurrence. */
  toggleOccurrenceVisibility: (occurrenceId: string) => void;

  // A24: Component constraints
  componentConstraints: ComponentConstraint[];
  addComponentConstraint: (constraint: Omit<ComponentConstraint, 'id'>) => string;
  removeComponentConstraint: (id: string) => void;
  suppressComponentConstraint: (id: string, suppressed: boolean) => void;
  /** A24: Solve a single constraint — compute + apply the transform to move component B to satisfy it. */
  solveComponentConstraint: (constraintId: string) => void;
  /** A24: Solve all active constraints in order. */
  solveAllComponentConstraints: () => void;
}

const rootId = crypto.randomUUID();

/**
 * Snapshot of joint rotation/translation values captured at the moment
 * animation playback starts. Restored on stop so the model returns to its
 * pre-animation pose — without this, tickAnimation's per-frame writes leave
 * the joints frozen at the last interpolated value.
 */
let _animationJointSnapshot: Record<string, { rotation?: number; translation?: number }> | null = null;

/**
 * Mutable per-frame joint rotation values — updated by tickAnimation WITHOUT
 * triggering Zustand re-renders (60Hz). Scene consumers (JointAnimationPlayer)
 * read this directly via getState() or this export and apply transforms to
 * body meshes imperatively, bypassing React's render cycle entirely.
 *
 * Values are cleared when animation stops and Zustand joints are synced back.
 */
export const _liveJointValues: Record<string, { rotationValue: number; translationValue?: number }> = {};

const defaultMaterial: MaterialAppearance = {
  id: 'aluminum',
  name: 'Aluminum',
  color: '#B0B8C0',
  metalness: 0.8,
  roughness: 0.3,
  opacity: 1,
  category: 'metal',
};

export const useComponentStore = create<ComponentStore>()(persist((set, get) => ({
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
      constructionPlaneIds: [],
      constructionAxisIds: [],
      constructionPointIds: [],
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
  componentConstraints: [] as ComponentConstraint[],

  activeComponentId: rootId,
  setActiveComponentId: (id) => set({ activeComponentId: id ?? rootId }),

  selectedBodyId: null,
  setSelectedBodyId: (id) => set({ selectedBodyId: id }),

  newDocument: () => {
    const newRootId = crypto.randomUUID();
    set({
      rootComponentId: newRootId,
      activeComponentId: newRootId,
      selectedBodyId: null,
      components: {
        [newRootId]: {
          id: newRootId,
          name: 'Assembly',
          parentId: null,
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
          grounded: true,
          isLinked: false,
          color: '#5B9BD5',
        },
      },
      bodies: {},
      constructions: {},
      joints: {},
      componentConstraints: [],
    });
  },

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
      constructionPlaneIds: [],
      constructionAxisIds: [],
      constructionPointIds: [],
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
    const { components, bodies } = get();
    const comp = components[id];
    if (!comp || !comp.parentId) return id;

    const newId = get().addComponent(comp.parentId, `${comp.name} (Copy)`);

    // Deep-copy each body so the duplicate gets independent geometry and does
    // not share array refs with the source component. The mesh is cloned via
    // THREE.Object3D.clone() so each component has its own scene object.
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
        // Clone the Three.js scene object so edits to one don't affect the other.
        mesh: body.mesh ? body.mesh.clone() : null,
        // Each body starts with its own empty feature list; the source feature
        // history is not transferred because features reference the original body.
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

  makeComponentIndependent: (id) => {
    const { components } = get();
    const comp = components[id];
    if (!comp || !comp.isLinked) return;
    // A28: clear the linked flag so this becomes a local embedded component
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

  isolateBody: (id) => {
    const { bodies } = get();
    // If already isolated (only this body visible), restore all
    const allIds = Object.keys(bodies);
    const alreadyIsolated = allIds.every((bid) => bid === id ? bodies[bid].visible : !bodies[bid].visible);
    const updated = Object.fromEntries(
      allIds.map((bid) => [bid, { ...bodies[bid], visible: alreadyIsolated ? true : bid === id }])
    );
    set({ bodies: updated });
  },

  showAllBodies: () => {
    const { bodies } = get();
    const updated = Object.fromEntries(
      Object.entries(bodies).map(([id, b]) => [id, { ...b, visible: true }])
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
    const clamped = Math.max(0, Math.min(1, opacity));
    set({ bodies: { ...bodies, [id]: { ...body, opacity: clamped } } });
  },

  toggleBodySelectable: (id) => {
    const { bodies } = get();
    const body = bodies[id];
    if (!body) return;
    const next = body.selectable === false ? true : false;
    set({ bodies: { ...bodies, [id]: { ...body, selectable: next } } });
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
          // CORR-16: also maintain typed sub-collections
          constructionPlaneIds: geometry.type === 'plane'
            ? [...(comp.constructionPlaneIds ?? []), id]
            : (comp.constructionPlaneIds ?? []),
          constructionAxisIds: geometry.type === 'axis'
            ? [...(comp.constructionAxisIds ?? []), id]
            : (comp.constructionAxisIds ?? []),
          constructionPointIds: geometry.type === 'point'
            ? [...(comp.constructionPointIds ?? []), id]
            : (comp.constructionPointIds ?? []),
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
          // CORR-16: also remove from the appropriate typed collection
          constructionPlaneIds: (comp.constructionPlaneIds ?? []).filter(cid => cid !== id),
          constructionAxisIds: (comp.constructionAxisIds ?? []).filter(cid => cid !== id),
          constructionPointIds: (comp.constructionPointIds ?? []).filter(cid => cid !== id),
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
  setAnimationPlaying: (playing) => {
    const state = get();
    if (playing && !state.animationPlaying) {
      // Starting playback — capture each tracked joint's current value so we
      // can restore on stop without permanently mutating the model.
      const snapshot: Record<string, { rotation?: number; translation?: number }> = {};
      for (const track of state.animationTracks) {
        const j = state.joints[track.jointId];
        if (j) snapshot[track.jointId] = { rotation: j.rotationValue, translation: j.translationValue };
      }
      _animationJointSnapshot = snapshot;
      set({ animationPlaying: true });
    } else if (!playing && state.animationPlaying) {
      // Stopping playback — restore the snapshot so the model returns to its
      // pre-animation pose. Without this, the joints stay frozen at whatever
      // interpolated value the last tick wrote.
      const snap = _animationJointSnapshot;
      if (snap) {
        const restored = { ...state.joints };
        for (const id of Object.keys(snap)) {
          const j = restored[id];
          const s = snap[id];
          if (j && s) restored[id] = { ...j, rotationValue: s.rotation ?? j.rotationValue, translationValue: s.translation ?? j.translationValue };
        }
        set({ animationPlaying: false, animationTime: 0, joints: restored });
        _animationJointSnapshot = null;
      } else {
        set({ animationPlaying: false });
      }
    } else {
      set({ animationPlaying: playing });
    }
  },
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
    const { animationPlaying, animationDuration, animationLoop, animationTracks, joints } = get();
    if (!animationPlaying) return;

    let newTime = get().animationTime + deltaSeconds;
    let playing = true;

    if (newTime >= animationDuration) {
      if (animationLoop) {
        newTime = newTime % animationDuration;
      } else {
        newTime = animationDuration;
        playing = false;
      }
    }

    // Compute per-track values and write them into the module-level
    // _liveJointValues map WITHOUT touching Zustand joints. This avoids
    // triggering a React re-render on every frame (60Hz) for all components
    // subscribed to `joints` — those components are only needed at rest pose,
    // not during playback. JointAnimationPlayer reads _liveJointValues and
    // applies transforms directly to body meshes each frame.
    const t = animationDuration > 0 ? newTime / animationDuration : 0;
    for (const track of animationTracks) {
      let easedT: number;
      switch (track.easing) {
        case 'ease-in':  easedT = t * t; break;
        case 'ease-out': easedT = t * (2 - t); break;
        case 'ease-in-out': easedT = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t; break;
        default: easedT = t;
      }
      const value = track.startValue + (track.endValue - track.startValue) * easedT;
      _liveJointValues[track.jointId] = { rotationValue: value };
    }

    if (playing) {
      // During playback only update time/playing — NOT joints — to avoid
      // 60Hz Zustand re-renders across every joint subscriber.
      set({ animationTime: newTime, animationPlaying: true });
    } else {
      // Playback ended naturally (loop=false reached duration).
      // Restore the pre-animation snapshot so the model returns to its rest pose,
      // clear _liveJointValues, and perform a single Zustand joints sync.
      if (_animationJointSnapshot) {
        const snap = _animationJointSnapshot;
        const restored = { ...joints };
        for (const id of Object.keys(snap)) {
          const j = restored[id];
          const s = snap[id];
          if (j && s) restored[id] = { ...j, rotationValue: s.rotation ?? j.rotationValue, translationValue: s.translation ?? j.translationValue };
        }
        // Clear live values
        for (const id of Object.keys(_liveJointValues)) delete _liveJointValues[id];
        set({ joints: restored, animationTime: 0, animationPlaying: false });
        _animationJointSnapshot = null;
      } else {
        for (const id of Object.keys(_liveJointValues)) delete _liveJointValues[id];
        set({ animationTime: 0, animationPlaying: false });
      }
    }
  },

  // ===== Exploded View (A27) =====
  explodeActive: false,
  explodeFactor: 0,
  explodedOffsets: {},

  setExplodeFactor: (f) => {
    const { components, bodies } = get();
    const offsets: Record<string, THREE.Vector3> = {};

    // Cache each body's world-space center once per invocation. The previous
    // implementation called `Box3.setFromObject(body.mesh)` TWICE per body
    // (once in the centroid loop, once in the component loop) which on a
    // 200-body assembly with a dragged slider would traverse geometry ~80k
    // times per second. Now: one pass, one Box3 allocation, O(bodies) work.
    const bodyCenters = new Map<string, THREE.Vector3>();
    const _bb = new THREE.Box3();
    for (const comp of Object.values(components)) {
      for (const bodyId of comp.bodyIds) {
        if (bodyCenters.has(bodyId)) continue;
        const body = bodies[bodyId];
        if (!body?.mesh) continue;
        _bb.setFromObject(body.mesh);
        const c = new THREE.Vector3();
        _bb.getCenter(c);
        bodyCenters.set(bodyId, c);
      }
    }

    // Compute assembly centroid from cached body centers.
    const centroid = new THREE.Vector3();
    let count = 0;
    for (const c of bodyCenters.values()) {
      centroid.add(c);
      count++;
    }
    if (count > 0) centroid.divideScalar(count);

    // Compute per-component offsets using cached body centers.
    const compCenter = new THREE.Vector3();
    for (const comp of Object.values(components)) {
      if (comp.bodyIds.length === 0) continue;
      compCenter.set(0, 0, 0);
      let bodyCount = 0;
      for (const bodyId of comp.bodyIds) {
        const c = bodyCenters.get(bodyId);
        if (!c) continue;
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

  // ===== CORR-4/CORR-5: Definition/Occurrence Stores =====
  definitions: {} as Record<string, ComponentDefinition>,
  occurrences: {} as Record<string, ComponentOccurrence>,

  createDefinitionFromComponent: (componentId) => {
    const { components, definitions } = get();
    const comp = components[componentId];
    if (!comp) return componentId;
    const def: ComponentDefinition = {
      id: comp.id, // reuse same ID for 1:1 compatibility
      name: comp.name,
      bodyIds: [...comp.bodyIds],
      sketchIds: [...comp.sketchIds],
      constructionIds: [...comp.constructionIds],
      constructionPlaneIds: [...comp.constructionPlaneIds],
      constructionAxisIds: [...comp.constructionAxisIds],
      constructionPointIds: [...comp.constructionPointIds],
      jointIds: [...comp.jointIds],
      color: comp.color,
      childDefinitionIds: [...comp.childIds],
    };
    set({ definitions: { ...definitions, [def.id]: def } });
    return def.id;
  },

  placeOccurrence: (definitionId, parentOccurrenceId, transform) => {
    const { occurrences, definitions } = get();
    const def = definitions[definitionId];
    if (!def) return '';
    const id = crypto.randomUUID();
    const occ: ComponentOccurrence = {
      id,
      definitionId,
      name: def.name,
      parentOccurrenceId,
      childOccurrenceIds: [],
      transform: transform ?? new THREE.Matrix4(),
      visible: true,
      isGrounded: false,
      isLinked: false,
    };
    // Add to parent's childOccurrenceIds if applicable
    const updatedOccurrences = { ...occurrences, [id]: occ };
    if (parentOccurrenceId && occurrences[parentOccurrenceId]) {
      const parent = occurrences[parentOccurrenceId];
      updatedOccurrences[parentOccurrenceId] = {
        ...parent,
        childOccurrenceIds: [...parent.childOccurrenceIds, id],
      };
    }
    set({ occurrences: updatedOccurrences });
    return id;
  },

  removeOccurrence: (occurrenceId) => {
    const { occurrences } = get();
    const occ = occurrences[occurrenceId];
    if (!occ) return;
    const updated = { ...occurrences };
    delete updated[occurrenceId];
    // Remove from parent's childOccurrenceIds
    if (occ.parentOccurrenceId && updated[occ.parentOccurrenceId]) {
      const parent = updated[occ.parentOccurrenceId];
      updated[occ.parentOccurrenceId] = {
        ...parent,
        childOccurrenceIds: parent.childOccurrenceIds.filter((id) => id !== occurrenceId),
      };
    }
    set({ occurrences: updated });
  },

  setOccurrenceGrounded: (occurrenceId, grounded) => {
    const { occurrences } = get();
    const occ = occurrences[occurrenceId];
    if (!occ) return;
    set({ occurrences: { ...occurrences, [occurrenceId]: { ...occ, isGrounded: grounded } } });
  },

  setOccurrenceTransform: (occurrenceId, transform) => {
    const { occurrences } = get();
    const occ = occurrences[occurrenceId];
    if (!occ) return;
    set({ occurrences: { ...occurrences, [occurrenceId]: { ...occ, transform } } });
  },

  toggleOccurrenceVisibility: (occurrenceId) => {
    const { occurrences } = get();
    const occ = occurrences[occurrenceId];
    if (!occ) return;
    set({ occurrences: { ...occurrences, [occurrenceId]: { ...occ, visible: !occ.visible } } });
  },

  // ===== A24: Component Constraints =====
  addComponentConstraint: (constraint) => {
    const id = crypto.randomUUID();
    const { componentConstraints } = get();
    const full: ComponentConstraint = { ...constraint, id };
    set({ componentConstraints: [...componentConstraints, full] });
    return id;
  },

  removeComponentConstraint: (id) => {
    const { componentConstraints } = get();
    set({ componentConstraints: componentConstraints.filter(c => c.id !== id) });
  },

  suppressComponentConstraint: (id, suppressed) => {
    const { componentConstraints } = get();
    set({ componentConstraints: componentConstraints.map(c => c.id === id ? { ...c, suppressed } : c) });
  },

  solveComponentConstraint: (constraintId) => {
    const { componentConstraints, components } = get();
    const c = componentConstraints.find(cc => cc.id === constraintId);
    if (!c || c.suppressed) return;

    const compA = components[c.entityA.componentId];
    if (!compA) return;

    const compB = components[c.entityB.componentId];
    if (!compB) return;

    const nA = new THREE.Vector3(...c.entityA.normal);
    const nB = new THREE.Vector3(...c.entityB.normal);
    const cA = new THREE.Vector3(...c.entityA.centroid);
    const cB = new THREE.Vector3(...c.entityB.centroid);

    // Compute the rotation that brings nB to face -nA (mate) or nA (flush)
    const targetNormal = c.type === 'flush' ? nA.clone() : nA.clone().negate();
    const rotAxis = new THREE.Vector3().crossVectors(nB, targetNormal);
    const rotAngle = Math.acos(Math.max(-1, Math.min(1, nB.dot(targetNormal))));

    const rotation = new THREE.Matrix4();
    if (rotAxis.lengthSq() > 1e-10 && Math.abs(rotAngle) > 1e-6) {
      rotation.makeRotationAxis(rotAxis.normalize(), rotAngle);
    } else if (rotAngle > Math.PI - 1e-6) {
      // Antiparallel case: nB is exactly opposite targetNormal so the cross
      // product collapses to zero and the previous branch silently skipped
      // the rotation, leaving the constraint mis-oriented. Pick any axis
      // perpendicular to nB and rotate by π to flip it.
      const perp = Math.abs(nB.x) < 0.9
        ? new THREE.Vector3(1, 0, 0)
        : new THREE.Vector3(0, 1, 0);
      const flipAxis = new THREE.Vector3().crossVectors(nB, perp).normalize();
      rotation.makeRotationAxis(flipAxis, Math.PI);
    }

    // Apply rotation to compB transform
    const newTransform = rotation.clone().multiply(compB.transform);

    // Translate: after rotation, move compB so cB aligns with cA
    const rotatedCB = cB.clone().applyMatrix4(rotation);
    const translationOffset = cA.clone().sub(rotatedCB);
    if (c.type === 'mate' && c.offset) {
      translationOffset.addScaledVector(nA, c.offset);
    }
    // Matrix4 has no .getPosition() — extract the existing translation column
    // via setFromMatrixPosition, then write the offset back via setPosition.
    // Original A24 implementation crashed at runtime with TypeError.
    const currentPos = new THREE.Vector3().setFromMatrixPosition(newTransform);
    newTransform.setPosition(currentPos.add(translationOffset));

    set({ components: { ...components, [c.entityB.componentId]: { ...compB, transform: newTransform } } });
  },

  solveAllComponentConstraints: () => {
    const { componentConstraints } = get();
    // Work against a LOCAL component map and apply a SINGLE `set` at the end.
    // The previous implementation called `solveComponentConstraint` per
    // constraint, each of which did its own `set` — C constraints triggered
    // C full-store re-renders and re-rendered the entire Browser tree C
    // times. Batching into one commit cuts that to a single render.
    let workingComponents = { ...get().components };
    const stale: string[] = [];
    const _rotAxis = new THREE.Vector3();
    const _rotation = new THREE.Matrix4();
    const _rotatedCB = new THREE.Vector3();
    const _translationOffset = new THREE.Vector3();
    const _currentPos = new THREE.Vector3();

    for (const c of componentConstraints) {
      if (c.suppressed) continue;
      const compA = workingComponents[c.entityA.componentId];
      const compB = workingComponents[c.entityB.componentId];
      if (!compA || !compB) { stale.push(c.id); continue; }

      const nA = new THREE.Vector3(...c.entityA.normal);
      const nB = new THREE.Vector3(...c.entityB.normal);
      const cA = new THREE.Vector3(...c.entityA.centroid);
      const cB = new THREE.Vector3(...c.entityB.centroid);

      const targetNormal = c.type === 'flush' ? nA.clone() : nA.clone().negate();
      _rotAxis.crossVectors(nB, targetNormal);
      const rotAngle = Math.acos(Math.max(-1, Math.min(1, nB.dot(targetNormal))));

      _rotation.identity();
      if (_rotAxis.lengthSq() > 1e-10 && Math.abs(rotAngle) > 1e-6) {
        _rotation.makeRotationAxis(_rotAxis.normalize(), rotAngle);
      } else if (rotAngle > Math.PI - 1e-6) {
        const perp = Math.abs(nB.x) < 0.9
          ? new THREE.Vector3(1, 0, 0)
          : new THREE.Vector3(0, 1, 0);
        const flipAxis = new THREE.Vector3().crossVectors(nB, perp).normalize();
        _rotation.makeRotationAxis(flipAxis, Math.PI);
      }

      const newTransform = _rotation.clone().multiply(compB.transform);
      _rotatedCB.copy(cB).applyMatrix4(_rotation);
      _translationOffset.copy(cA).sub(_rotatedCB);
      if (c.type === 'mate' && c.offset) {
        _translationOffset.addScaledVector(nA, c.offset);
      }
      _currentPos.setFromMatrixPosition(newTransform);
      newTransform.setPosition(_currentPos.add(_translationOffset));

      workingComponents = {
        ...workingComponents,
        [c.entityB.componentId]: { ...compB, transform: newTransform },
      };
    }

    const nextConstraints = stale.length > 0
      ? componentConstraints.filter((c) => !stale.includes(c.id))
      : componentConstraints;
    set({
      components: workingComponents,
      ...(stale.length > 0 ? { componentConstraints: nextConstraints } : {}),
    });
  },
}),
{
  name: 'dzign3d-component-store',
  storage: idbStorage as unknown as PersistStorage<unknown>,

  onRehydrateStorage: () => (state) => {
    if (!state) return;
    // Reconstruct THREE.Matrix4 from serialized number[] for components
    for (const comp of Object.values(state.components ?? {})) {
      if (Array.isArray((comp as unknown as { transform: unknown }).transform)) {
        comp.transform = new THREE.Matrix4().fromArray(
          (comp as unknown as { transform: number[] }).transform,
        );
      }
    }
    // Reconstruct THREE.Matrix4 from serialized number[] for occurrences
    for (const occ of Object.values(state.occurrences ?? {})) {
      if (Array.isArray((occ as unknown as { transform: unknown }).transform)) {
        occ.transform = new THREE.Matrix4().fromArray(
          (occ as unknown as { transform: number[] }).transform,
        );
      }
    }
    // Reconstruct THREE.Vector3 for Joint origin / axis
    for (const joint of Object.values(state.joints ?? {})) {
      const j = joint as unknown as { origin: unknown; axis?: unknown };
      if (j.origin && !((j.origin) instanceof THREE.Vector3)) {
        const o = j.origin as { x?: number; y?: number; z?: number } | number[];
        if (Array.isArray(o)) {
          joint.origin = new THREE.Vector3(o[0] ?? 0, o[1] ?? 0, o[2] ?? 0);
        } else {
          joint.origin = new THREE.Vector3(o.x ?? 0, o.y ?? 0, o.z ?? 0);
        }
      }
      if (j.axis && !((j.axis) instanceof THREE.Vector3)) {
        const a = j.axis as { x?: number; y?: number; z?: number } | number[];
        if (Array.isArray(a)) {
          joint.axis = new THREE.Vector3(a[0] ?? 0, a[1] ?? 0, a[2] ?? 0);
        } else {
          joint.axis = new THREE.Vector3(a.x ?? 0, a.y ?? 0, a.z ?? 0);
        }
      }
    }
    // Reconstruct THREE.Vector3 for explodedOffsets
    for (const [key, val] of Object.entries(state.explodedOffsets ?? {})) {
      if (!(val instanceof THREE.Vector3)) {
        const v = val as unknown as { x?: number; y?: number; z?: number } | number[];
        if (Array.isArray(v)) {
          state.explodedOffsets[key] = new THREE.Vector3(v[0] ?? 0, v[1] ?? 0, v[2] ?? 0);
        } else {
          state.explodedOffsets[key] = new THREE.Vector3(v.x ?? 0, v.y ?? 0, v.z ?? 0);
        }
      }
    }
  },

  partialize: (state) => ({
    rootComponentId: state.rootComponentId,
    // Serialize THREE.Matrix4 as number[] (16 elements)
    components: Object.fromEntries(
      Object.entries(state.components).map(([id, comp]) => [
        id,
        {
          ...comp,
          transform: comp.transform instanceof THREE.Matrix4
            ? comp.transform.toArray()
            : comp.transform,
        },
      ]),
    ),
    // Exclude mesh (THREE.Object3D) from bodies
    bodies: Object.fromEntries(
      Object.entries(state.bodies).map(([id, body]) => [
        id,
        { ...body, mesh: null },
      ]),
    ),
    // Serialize Joint: origin and axis as plain objects
    joints: Object.fromEntries(
      Object.entries(state.joints).map(([id, joint]) => [
        id,
        {
          ...joint,
          origin: joint.origin instanceof THREE.Vector3
            ? { x: joint.origin.x, y: joint.origin.y, z: joint.origin.z }
            : joint.origin,
          axis: joint.axis instanceof THREE.Vector3
            ? { x: joint.axis.x, y: joint.axis.y, z: joint.axis.z }
            : joint.axis,
        },
      ]),
    ),
    rigidGroups: state.rigidGroups,
    motionLinks: state.motionLinks,
    animationTracks: state.animationTracks,
    animationDuration: state.animationDuration,
    animationLoop: state.animationLoop,
    // Serialize occurrences: THREE.Matrix4 as number[]
    occurrences: Object.fromEntries(
      Object.entries(state.occurrences).map(([id, occ]) => [
        id,
        {
          ...occ,
          transform: occ.transform instanceof THREE.Matrix4
            ? occ.transform.toArray()
            : occ.transform,
        },
      ]),
    ),
    definitions: state.definitions,
    componentConstraints: state.componentConstraints,
    // Serialize explodedOffsets: THREE.Vector3 as plain objects
    explodedOffsets: Object.fromEntries(
      Object.entries(state.explodedOffsets).map(([id, v]) => [
        id,
        v instanceof THREE.Vector3
          ? { x: v.x, y: v.y, z: v.z }
          : v,
      ]),
    ),
  }),
}));
