import * as THREE from 'three';
import type { Feature, FeatureType } from '../../../../types/cad';
import { GeometryEngine } from '../../../../engine/GeometryEngine';
import { useComponentStore } from '../../../componentStore';
import type { CADSliceContext } from '../../sliceContext';
import type { CADState } from '../../state';

export function createFeatureCoreActions({ set, get }: CADSliceContext): Partial<CADState> {
  return {
  features: [],
  addFeature: (feature) => {
    const { historyEnabled } = get();
    if (historyEnabled) get().pushUndo();
    const f = historyEnabled ? feature : { ...feature, suppressTimeline: true };
    set((state) => ({ features: [...state.features, f] }));
  },
  addPrimitive: (kind, params) => set((state) => {
    const label =
      kind === 'box' ? 'Box' :
      kind === 'cylinder' ? 'Cylinder' :
      kind === 'sphere' ? 'Sphere' :
      kind === 'coil' ? 'Coil' : 'Torus';
    const count = state.features.filter((f) => f.type === 'primitive').length + 1;

    // For coil we pre-build the mesh so PrimitiveBodies doesn't need to handle it
    let mesh: Feature['mesh'] | undefined;
    if (kind === 'coil') {
      const geom = GeometryEngine.coilGeometry(
        (params.outerRadius as number) || 15,
        (params.wireRadius as number) || 2,
        (params.pitch as number) || 10,
        (params.turns as number) || 5,
      );
      // Use a fresh MeshPhysicalMaterial matching the EXTRUDE_MATERIAL style
      const mat = new THREE.MeshPhysicalMaterial({ color: 0x8899aa, metalness: 0.3, roughness: 0.4, side: THREE.DoubleSide });
      const m = new THREE.Mesh(geom, mat);
      m.castShadow = true;
      m.receiveShadow = true;
      mesh = m;
    }

    const feature: Feature = {
      id: crypto.randomUUID(),
      name: `${label} ${count}`,
      type: 'primitive',
      params: { kind, ...params },
      visible: true,
      suppressed: false,
      timestamp: Date.now(),
      ...(mesh ? { mesh } : {}),
    };
    return {
      features: [...state.features, feature],
      statusMessage: `${label} added`,
    };
  }),

  insertFastener: (params) => {
    get().pushUndo();
    const { features, units } = get();
    const componentStore = useComponentStore.getState();
    const { rootComponentId } = componentStore;
    const scale = units === 'in' ? 1 / 25.4 : 1;
    const d = params.diameter * scale;
    const hd = params.headDiameter * scale;
    const hh = params.headHeight * scale;
    const len = params.length * scale;

    const group = new THREE.Group();

    const isNut = params.type === 'hex-nut';
    const isWasher = params.type === 'washer';

    if (!isNut && !isWasher) {
      const shankGeo = new THREE.CylinderGeometry(d / 2, d / 2, len, 16);
      const shankMesh = new THREE.Mesh(shankGeo, new THREE.MeshStandardMaterial({ color: '#B0B8C0', metalness: 0.8, roughness: 0.3 }));
      shankMesh.position.y = -len / 2;
      group.add(shankMesh);
    }

    const headSegs = (params.type === 'hex-bolt' || params.type === 'hex-nut') ? 6 : 16;
    const headGeo = new THREE.CylinderGeometry(hd / 2, hd / 2, hh, headSegs);
    const headMesh = new THREE.Mesh(headGeo, new THREE.MeshStandardMaterial({ color: '#B0B8C0', metalness: 0.8, roughness: 0.3 }));

    if (isNut || isWasher) {
      headMesh.position.y = 0;
    } else if (params.type === 'flat-head') {
      headMesh.position.y = -hh / 2;
    } else {
      headMesh.position.y = hh / 2;
    }
    group.add(headMesh);

    group.position.set(params.x * scale, params.y * scale, params.z * scale);

    const featureId = crypto.randomUUID();
    const bodyId = componentStore.addBody(rootComponentId, `${params.size} ${params.type}`);
    if (bodyId) {
      componentStore.addFeatureToBody(bodyId, featureId);
    }
    const feature: Feature = {
      id: featureId,
      name: `${params.size} ${params.type.replace(/-/g, ' ')}`,
      type: 'fastener',
      params: { ...params } as unknown as Record<string, number | string | boolean | number[]>,
      mesh: group as unknown as THREE.Mesh,
      visible: true,
      suppressed: false,
      timestamp: Date.now(),
      bodyKind: 'brep',
    };
    set({ features: [...features, feature], statusMessage: `${params.size} ${params.type} inserted` });
  },

  removeFeature: (id) => {
    get().pushUndo();
    // Capture the mesh reference before removal so we can dispose AFTER
    // the feature is out of state (prevents renderer accessing disposed GPU resources).
    const target = get().features.find((f) => f.id === id);
    const removedSketchId = target?.type === 'sketch' ? target.sketchId : null;
    set((state) => ({
      features: state.features.filter((f) => f.id !== id),
      ...(removedSketchId
        ? {
            sketches: state.sketches.filter((sketch) => sketch.id !== removedSketchId),
            activeSketch: state.activeSketch?.id === removedSketchId ? null : state.activeSketch,
            extrudeSelectedSketchId:
              state.extrudeSelectedSketchId?.split('::')[0] === removedSketchId ? null : state.extrudeSelectedSketchId,
            extrudeSelectedSketchIds: state.extrudeSelectedSketchIds.filter(
              (selectionId) => selectionId.split('::')[0] !== removedSketchId,
            ),
            revolveSelectedSketchId:
              state.revolveSelectedSketchId?.split('::')[0] === removedSketchId ? null : state.revolveSelectedSketchId,
          }
        : {}),
    }));
    // Now safe to dispose â€” feature is no longer in state.
    //
    // CRITICAL: skip materials tagged `userData.shared = true` â€” those are
    // module-level singletons (EXTRUDE_MATERIAL, SKETCH_MATERIAL, etc. in
    // GeometryEngine.ts). Disposing them turns every other feature still
    // using them into a black/broken material instance.
    const disposeMat = (mat: THREE.Material | THREE.Material[] | null | undefined) => {
      if (!mat) return;
      const arr = Array.isArray(mat) ? mat : [mat];
      for (const m of arr) {
        if (m?.userData?.shared) continue;
        m?.dispose?.();
      }
    };
    if (target?.mesh) {
      const m = target.mesh as THREE.Object3D;
      if (m instanceof THREE.Mesh) {
        m.geometry?.dispose();
        disposeMat(m.material);
      } else if (m instanceof THREE.Group) {
        m.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.geometry?.dispose();
            disposeMat(child.material);
          }
        });
      }
    }
  },
  deriveFromDesign: (itemIds, sourceFileName) => {
    get().pushUndo();
    const { features } = get();
    const now = Date.now();
    const newFeatures: Feature[] = itemIds.map((itemId, i) => ({
      id: crypto.randomUUID(),
      name: `Derived: ${itemId.slice(0, 8)}\u2026`,
      type: 'derive' as FeatureType,
      params: { sourceFileName, sourceItemId: itemId } as unknown as Record<string, number | string | boolean | number[]>,
      visible: true,
      suppressed: false,
      timestamp: now + i,
      derivedFrom: sourceFileName,
    }));
    set({ features: [...features, ...newFeatures], statusMessage: `Derived ${newFeatures.length} item(s) from ${sourceFileName}` });
  },
  renameFeature: (id, name) => set((state) => ({
    features: state.features.map((f) => f.id === id ? { ...f, name } : f),
  })),
  // D186 Edit Feature state
  editingFeatureId: null,
  setEditingFeatureId: (id) => set({ editingFeatureId: id }),
  updateFeatureParams: (id, params) => {
    get().pushUndo();
    set((state) => ({
      features: state.features.map((f) =>
        f.id === id ? { ...f, params: { ...f.params, ...params } } : f,
      ),
      statusMessage: 'Feature parameters updated',
    }));
  },
  // D189 reorder feature
  reorderFeature: (id, newIndex) => set((state) => {
    const idx = state.features.findIndex((f) => f.id === id);
    if (idx === -1) return {};
    const next = [...state.features];
    const [moved] = next.splice(idx, 1);
    const clamped = Math.max(0, Math.min(newIndex, next.length));
    next.splice(clamped, 0, moved);
    return { features: next, statusMessage: `Moved ${moved.name}` };
  }),
  // D190 rollback bar
  rollbackIndex: -1,
  setRollbackIndex: (index) => set({ rollbackIndex: index }),

  // MM3 â€” Base Feature container
  baseFeatureActive: false,
  openBaseFeature: (name) => {
    const { features } = get();
    const n = features.filter((f) => f.type === 'base-feature').length + 1;
    const feature: Feature = {
      id: crypto.randomUUID(),
      name: name || `Base Feature ${n}`,
      type: 'base-feature',
      params: {},
      visible: true,
      suppressed: false,
      timestamp: Date.now(),
      isBaseFeatureContainer: true,
      baseFeatureOpen: true,
    };
    set((state) => ({
      features: [...state.features, feature],
      baseFeatureActive: true,
      statusMessage: 'Base Feature open â€” direct edits inside will not trigger parametric recompute',
    }));
  },
  finishBaseFeature: () => set((state) => ({
    baseFeatureActive: false,
    // Mark the open container as closed
    features: state.features.map((f) =>
      f.isBaseFeatureContainer && f.baseFeatureOpen ? { ...f, baseFeatureOpen: false } : f,
    ),
    statusMessage: 'Base Feature closed',
  })),

  // MM4 â€” Timeline feature groups
  featureGroups: [],
  createFeatureGroup: (name, featureIds) => {
    const groupId = crypto.randomUUID();
    set((state) => ({
      featureGroups: [...state.featureGroups, { id: groupId, name, collapsed: false }],
      features: state.features.map((f) =>
        featureIds.includes(f.id) ? { ...f, groupId } : f,
      ),
      statusMessage: `Group "${name}" created`,
    }));
  },
  renameFeatureGroup: (groupId, name) => set((state) => ({
    featureGroups: state.featureGroups.map((g) => g.id === groupId ? { ...g, name } : g),
    statusMessage: `Group renamed to "${name}"`,
  })),
  deleteFeatureGroup: (groupId) => set((state) => ({
    featureGroups: state.featureGroups.filter((g) => g.id !== groupId),
    features: state.features.map((f) => f.groupId === groupId ? { ...f, groupId: undefined } : f),
    statusMessage: 'Group deleted',
  })),
  moveFeatureToGroup: (featureId, groupId) => set((state) => ({
    features: state.features.map((f) =>
      f.id === featureId ? { ...f, groupId: groupId ?? undefined } : f,
    ),
  })),

  toggleFeatureGroup: (groupId) => set((state) => ({
    featureGroups: state.featureGroups.map((g) =>
      g.id === groupId ? { ...g, collapsed: !g.collapsed } : g,
    ),
  })),
  // CORR-17: nest a group inside another
  nestGroupInGroup: (childGroupId, parentGroupId) => set((state) => ({
    featureGroups: state.featureGroups.map((g) =>
      g.id === childGroupId ? { ...g, parentGroupId: parentGroupId ?? undefined } : g,
    ),
  })),
  };
}
