import * as THREE from 'three';
import type { Feature, Sketch } from '../../../types/cad';
import { EXTRUDE_DEFAULTS, REVOLVE_DEFAULTS, getPlaneNormal } from '../defaults';
import { useComponentStore } from '../../componentStore';
import type { CADSliceContext } from '../sliceContext';
import type { CADState } from '../state';

function upsertSketch(sketches: Sketch[], sketch: Sketch): Sketch[] {
  const index = sketches.findIndex((candidate) => candidate.id === sketch.id);
  if (index < 0) return [...sketches, sketch];

  const next = [...sketches];
  next[index] = sketch;
  return next;
}

function getActiveComponentId(): string | undefined {
  const componentStore = useComponentStore.getState();
  const id = componentStore.activeComponentId ?? componentStore.rootComponentId;
  // Guard: if the resolved id doesn't exist in the components map, fall back to root.
  if (id && componentStore.components[id]) return id;
  return componentStore.rootComponentId;
}

function registerSketchWithComponent(sketch: Sketch) {
  const componentId = sketch.componentId;
  if (!componentId) return;
  useComponentStore.setState((state) => {
    const component = state.components[componentId];
    if (!component || component.sketchIds.includes(sketch.id)) return state;
    return {
      components: {
        ...state.components,
        [componentId]: {
          ...component,
          sketchIds: [...component.sketchIds, sketch.id],
        },
      },
    };
  });
}

export function createSketchLifecycleSlice({ set, get }: CADSliceContext) {
  const slice: Partial<CADState> = {
  activeTool: 'select',
  setActiveTool: (tool) => set({
    activeTool: tool,
    measurePoints: [],
    // Reset transient extrude/revolve state when switching away from them
    ...(tool !== 'extrude' ? EXTRUDE_DEFAULTS : {}),
    ...(tool !== 'revolve' ? REVOLVE_DEFAULTS : {}),
  }),

  viewMode: '3d',
  setViewMode: (mode) => set({ viewMode: mode }),

  workspaceMode: (localStorage.getItem('cindr3d-workspace-mode') as 'design' | 'prepare' | 'printer') ?? 'design',
  setWorkspaceMode: (mode) => {
    localStorage.setItem('cindr3d-workspace-mode', mode);
    set({ workspaceMode: mode });
  },

  activeSketch: null,
  sketches: [],
  sketchPlaneSelecting: false,
  setSketchPlaneSelecting: (selecting) => set({
    sketchPlaneSelecting: selecting,
    statusMessage: selecting ? 'Select a plane or planar face to start sketching' : 'Ready',
  }),
  startSketch: (plane) => {
    const componentId = getActiveComponentId();
    const sketch: Sketch = {
      id: crypto.randomUUID(),
      name: `Sketch ${get().sketches.length + 1}`,
      plane,
      planeNormal: getPlaneNormal(plane),
      planeOrigin: new THREE.Vector3(0, 0, 0),
      componentId,
      entities: [],
      constraints: [],
      dimensions: [],
      fullyConstrained: false,
    };

    // Compute camera orientation to look at the sketch plane from the normal direction.
    // For the horizontal XY plane the camera looks from above → up must be in-plane (not Y).
    const normal = getPlaneNormal(plane);
    const camDir = normal.clone().multiplyScalar(5);
    // Choose an "up" vector that lies in the sketch plane (can't be parallel to normal):
    //   XY (horizontal) → look from above → up = -Z  (south direction on ground)
    //   XZ (vertical front) → standard world up Y
    //   YZ (vertical side) → standard world up Y
    const up = plane === 'XY' ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(0, 1, 0);
    const m = new THREE.Matrix4();
    m.lookAt(camDir, new THREE.Vector3(0, 0, 0), up);
    const targetQuat = new THREE.Quaternion().setFromRotationMatrix(m);

    set({
      activeSketch: sketch,
      sketchPlaneSelecting: false,
      viewMode: 'sketch',
      activeTool: 'line',
      cameraTargetQuaternion: targetQuat,
      cameraTargetOrbit: new THREE.Vector3(0, 0, 0),
      statusMessage: `Sketching on ${plane} plane`,
    });
  },
  startSketchOnFace: (normal, origin) => {
    // Normalize the face normal once
    const n = normal.clone().normalize();
    const o = origin.clone();
    const componentId = getActiveComponentId();

    const sketch: Sketch = {
      id: crypto.randomUUID(),
      name: `Sketch ${get().sketches.length + 1}`,
      plane: 'custom',
      planeNormal: n,
      planeOrigin: o,
      componentId,
      entities: [],
      constraints: [],
      dimensions: [],
      fullyConstrained: false,
    };

    // Camera looks AT the face from `origin + normal * distance` along -normal.
    // Pick an "up" vector that lies in the face plane (least aligned world axis,
    // then orthogonalized against the normal so it's truly in-plane).
    const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
    let candidateUp: THREE.Vector3;
    if (ay <= ax && ay <= az) candidateUp = new THREE.Vector3(0, 1, 0);
    else if (ax <= az)        candidateUp = new THREE.Vector3(1, 0, 0);
    else                      candidateUp = new THREE.Vector3(0, 0, 1);
    // Project candidateUp onto the plane: up = candidateUp - (candidateUp·n) * n
    const up = candidateUp.clone().sub(n.clone().multiplyScalar(candidateUp.dot(n))).normalize();

    const camDir = n.clone().multiplyScalar(50);
    const camPos = o.clone().add(camDir);
    const m = new THREE.Matrix4().lookAt(camPos, o, up);
    const targetQuat = new THREE.Quaternion().setFromRotationMatrix(m);

    set({
      activeSketch: sketch,
      sketchPlaneSelecting: false,
      viewMode: 'sketch',
      activeTool: 'line',
      cameraTargetQuaternion: targetQuat,
      cameraTargetOrbit: o,
      statusMessage: 'Sketching on face',
    });
  },
  editSketch: (id) => {
    // If already editing a sketch, finish it first so it isn't lost
    if (get().activeSketch) get().finishSketch();

    const { sketches } = get();
    const sketch = sketches.find((s) => s.id === id);
    if (!sketch) return;

    // Reuse the same camera-orient logic as startSketch.
    // For 'custom' planes the normal/origin are stored on the sketch.
    const isCustom = sketch.plane === 'custom';
    const normal = isCustom ? sketch.planeNormal.clone().normalize() : getPlaneNormal(sketch.plane);
    const origin = isCustom ? sketch.planeOrigin.clone() : new THREE.Vector3(0, 0, 0);

    let up: THREE.Vector3;
    if (isCustom) {
      const ax = Math.abs(normal.x), ay = Math.abs(normal.y), az = Math.abs(normal.z);
      const candidate =
        ay <= ax && ay <= az ? new THREE.Vector3(0, 1, 0)
        : ax <= az          ? new THREE.Vector3(1, 0, 0)
        :                     new THREE.Vector3(0, 0, 1);
      up = candidate.sub(normal.clone().multiplyScalar(candidate.dot(normal))).normalize();
    } else {
      up = sketch.plane === 'XY' ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(0, 1, 0);
    }

    const camDist = isCustom ? 50 : 5;
    const camPos = origin.clone().add(normal.clone().multiplyScalar(camDist));
    const m = new THREE.Matrix4().lookAt(camPos, origin, up);
    const targetQuat = new THREE.Quaternion().setFromRotationMatrix(m);

    set({
      // Pull the sketch out of the completed list and back into editing
      activeSketch: sketch,
      sketches: sketches.filter((s) => s.id !== id),
      sketchPlaneSelecting: false,
      viewMode: 'sketch',
      activeTool: 'line',
      cameraTargetQuaternion: targetQuat,
      cameraTargetOrbit: origin,
      statusMessage: `Editing ${sketch.name}${isCustom ? ' on face' : ` on ${sketch.plane} plane`}`,
      // CORR-6: restore per-sketch display flags (fallback to global defaults if undefined)
      ...(sketch.arePointsShown !== undefined ? { showSketchPoints: sketch.arePointsShown } : {}),
      ...(sketch.areProfilesShown !== undefined ? { showSketchProfile: sketch.areProfilesShown } : {}),
      ...(sketch.areDimensionsShown !== undefined ? { showSketchDimensions: sketch.areDimensionsShown } : {}),
      ...(sketch.areConstraintsShown !== undefined ? { showSketchConstraints: sketch.areConstraintsShown } : {}),
    });
  },
  finishSketch: () => {
    const { activeSketch, sketches, features } = get();
    if (!activeSketch) return;
    const componentId = activeSketch.componentId ?? getActiveComponentId();
    const finishedSketch: Sketch = { ...activeSketch, componentId };

    if (finishedSketch.entities.length > 0) {
      // Only create a new Feature entry when this sketch doesn't already have one.
      // When editing an existing sketch the feature is already in the timeline.
      const alreadyHasFeature = features.some((f) => f.sketchId === finishedSketch.id);
      const newFeatures = alreadyHasFeature
        ? features
        : [
            ...features,
            {
              id: crypto.randomUUID(),
              name: finishedSketch.name,
              type: 'sketch' as const,
              sketchId: finishedSketch.id,
              componentId,
              params: { plane: finishedSketch.plane },
              visible: true,
              suppressed: false,
              timestamp: Date.now(),
            },
          ];
      registerSketchWithComponent(finishedSketch);

      set({
        activeSketch: null,
        sketchPlaneSelecting: false,
        sketches: upsertSketch(sketches, finishedSketch),
        features: newFeatures,
        viewMode: '3d',
        activeTool: 'select',
        statusMessage: 'Sketch completed',
        sketch3DActivePlane: null, // S7: clear per-session plane override
      });
    } else {
      // Empty sketch — just exit without saving to timeline.
      // If editing an existing sketch that had entities before, put it back as-is.
      const alreadyHasFeature = features.some((f) => f.sketchId === finishedSketch.id);
      set({
        activeSketch: null,
        sketchPlaneSelecting: false,
        sketches: alreadyHasFeature ? upsertSketch(sketches, finishedSketch) : sketches,
        viewMode: '3d',
        activeTool: 'select',
        statusMessage: '',
        sketch3DActivePlane: null, // S7: clear per-session plane override
      });
    }
  },
  cancelSketch: () => {
    const { activeSketch, sketches, features } = get();
    // If cancelling an edit of an existing sketch, restore it to the completed list
    // so it doesn't disappear from the browser permanently.
    const wasEditing = activeSketch ? features.some((f) => f.sketchId === activeSketch.id) : false;
    set({
      activeSketch: null,
      sketchPlaneSelecting: false,
      sketches: wasEditing && activeSketch ? [...sketches, activeSketch] : sketches,
      viewMode: '3d',
      activeTool: 'select',
      statusMessage: 'Sketch cancelled',
      sketch3DActivePlane: null, // S7: clear per-session plane override
    });
  },
  addSketchEntity: (entity) => {
    const { activeSketch, sketches } = get();
    if (activeSketch) {
      get().pushUndo();
      const nextSketch = {
        ...activeSketch,
        entities: [...activeSketch.entities, entity],
      };
      set({
        activeSketch: nextSketch,
        sketches: upsertSketch(sketches, nextSketch),
      });
    }
  },

  replaceSketchEntities: (entities) => {
    const { activeSketch, sketches } = get();
    if (activeSketch) {
      const nextSketch = { ...activeSketch, entities };
      set({ activeSketch: nextSketch, sketches: upsertSketch(sketches, nextSketch) });
    }
  },

  cycleEntityLinetype: (entityId) => {
    const { activeSketch, sketches } = get();
    if (!activeSketch) return;
    const CYCLE: Record<string, 'line' | 'construction-line' | 'centerline'> = {
      'line': 'construction-line',
      'construction-line': 'centerline',
      'centerline': 'line',
    };
    const updated = activeSketch.entities.map((e) => {
      if (e.id !== entityId) return e;
      const next = CYCLE[e.type];
      if (!next) return e; // non-line types unchanged
      return { ...e, type: next };
    });
    const nextSketch = { ...activeSketch, entities: updated };
    set({ activeSketch: nextSketch, sketches: upsertSketch(sketches, nextSketch) });
  },

  // S6 Break Link — remove the 'linked' flag so a projected entity becomes editable
  breakProjectionLink: (entityId) => {
    const { activeSketch, sketches } = get();
    if (!activeSketch) return;
    const updated = activeSketch.entities.map((e) =>
      e.id === entityId ? { ...e, linked: false } : e,
    );
    set({
      activeSketch: { ...activeSketch, entities: updated },
      sketches: upsertSketch(sketches, { ...activeSketch, entities: updated }),
      statusMessage: 'Projection link broken — entity is now independent',
    });
  },

  copySketch: (id) => set((state) => {
    const src = state.sketches.find((s) => s.id === id);
    if (!src) return state;
    const copy: Sketch = {
      ...src,
      id: crypto.randomUUID(),
      name: `${src.name} (Copy)`,
      entities: src.entities.map((e) => ({
        ...e,
        id: crypto.randomUUID(),
        points: e.points.map((p) => ({ ...p, id: crypto.randomUUID() })),
      })),
      constraints: [],
      dimensions: [],
    };
    const copyFeature: Feature = {
      id: crypto.randomUUID(),
      name: copy.name,
      type: 'sketch',
      sketchId: copy.id,
      params: { plane: copy.plane },
      visible: true,
      suppressed: false,
      timestamp: Date.now(),
    };
    return {
      sketches: [...state.sketches, copy],
      features: [...state.features, copyFeature],
      statusMessage: `Sketch copied as "${copy.name}"`,
    };
  }),

  deleteSketch: (id) => {
    get().pushUndo();
    set((state) => {
      const activeSketch = state.activeSketch?.id === id ? null : state.activeSketch;
      return {
        sketches: state.sketches.filter((s) => s.id !== id),
        features: state.features.filter((f) => !(f.type === 'sketch' && f.sketchId === id)),
        activeSketch,
        statusMessage: 'Sketch deleted',
      };
    });
  },

  renameSketch: (id, name) => set((state) => ({
    sketches: state.sketches.map((s) => s.id !== id ? s : { ...s, name }),
    features: state.features.map((f) => f.type === 'sketch' && f.sketchId === id ? { ...f, name } : f),
    statusMessage: `Sketch renamed to "${name}"`,
  })),

  redefineSketchPlane: (id, plane, normal, origin) => set((state) => ({
    sketches: state.sketches.map((s) =>
      s.id !== id ? s : { ...s, plane, planeNormal: normal.clone(), planeOrigin: origin.clone() }
    ),
    statusMessage: `Sketch plane redefined`,
  })),
  };

  return slice;
}
