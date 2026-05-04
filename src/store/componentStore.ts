import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import * as THREE from 'three';
import type {
  ComponentConstraint,
} from '../types/cad';
import type { ComponentStore } from '../types/component-store.types';
import { componentStorage } from './component/storage';
import { createRootComponent } from './component/defaults';
import { createAnimationState, liveJointValues } from './component/actions/animation';
import { createAssemblyState } from './component/actions/assembly';
import { createComponentActions } from './component/actions/components';
import { createBodyActions } from './component/actions/bodies';
import { createConstructionActions } from './component/actions/construction';
import { createJointActions } from './component/actions/joints';

const rootId = crypto.randomUUID();

export const _liveJointValues = liveJointValues;

export const useComponentStore = create<ComponentStore>()(persist((set, get) => ({
  rootComponentId: rootId,

  components: {
    [rootId]: createRootComponent(rootId),
  },

  bodies: {},
  constructions: {},
  joints: {},
  componentConstraints: [] as ComponentConstraint[],

  activeComponentId: rootId,
  setActiveComponentId: (id) => set({ activeComponentId: id ?? rootId }),

  selectedBodyId: null,
  setSelectedBodyId: (id) => set({ selectedBodyId: id }),

  ...createComponentActions({ set, get }, rootId),
  ...createBodyActions({ set, get }),
  ...createConstructionActions({ set, get }),
  ...createJointActions({ set, get }),

  ...createAnimationState({ set, get }),

  ...createAssemblyState({ set, get }),
}),
{
  name: 'cindr3d-component-store',
  storage: componentStorage,

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
    // After rehydration rootComponentId is the persisted UUID, but activeComponentId
    // and expandedIds were initialised at module load with a fresh UUID that differs
    // from the persisted root. Align them to the actual root so new sketches are
    // assigned to the correct component and the root node renders as expanded.
    if (state.rootComponentId) {
      state.activeComponentId = state.rootComponentId;
      state.expandedIds = new Set([state.rootComponentId]);
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
