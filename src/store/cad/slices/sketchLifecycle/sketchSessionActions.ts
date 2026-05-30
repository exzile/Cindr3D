import * as THREE from 'three';
import type { Sketch } from '../../../../types/cad';
import { getPlaneNormal } from '../../defaults';
import type { CADSliceContext } from '../../sliceContext';
import type { CADState } from '../../state';
import { getActiveComponentId, registerSketchWithComponent, upsertSketch } from './helpers';

export function createSketchSessionActions({ set, get }: CADSliceContext): Partial<CADState> {
  return {
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

      const normal = getPlaneNormal(plane);
      const camDir = normal.clone().multiplyScalar(5);
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

      const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
      let candidateUp: THREE.Vector3;
      if (ay <= ax && ay <= az) candidateUp = new THREE.Vector3(0, 1, 0);
      else if (ax <= az)        candidateUp = new THREE.Vector3(1, 0, 0);
      else                      candidateUp = new THREE.Vector3(0, 0, 1);
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
      if (get().activeSketch) get().finishSketch();

      const { sketches } = get();
      const sketch = sketches.find((s) => s.id === id);
      if (!sketch) return;

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
        activeSketch: sketch,
        sketches: sketches.filter((s) => s.id !== id),
        sketchPlaneSelecting: false,
        viewMode: 'sketch',
        activeTool: 'line',
        cameraTargetQuaternion: targetQuat,
        cameraTargetOrbit: origin,
        statusMessage: `Editing ${sketch.name}${isCustom ? ' on face' : ` on ${sketch.plane} plane`}`,
        selectedEntityIds: [],
        constraintSelection: [],
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
          sketch3DActivePlane: null,
        });
      } else {
        const alreadyHasFeature = features.some((f) => f.sketchId === finishedSketch.id);
        set({
          activeSketch: null,
          sketchPlaneSelecting: false,
          sketches: alreadyHasFeature ? upsertSketch(sketches, finishedSketch) : sketches,
          viewMode: '3d',
          activeTool: 'select',
          statusMessage: '',
          sketch3DActivePlane: null,
        });
      }
    },

    cancelSketch: () => {
      const { activeSketch, sketches, features } = get();
      const wasEditing = activeSketch ? features.some((f) => f.sketchId === activeSketch.id) : false;
      set({
        activeSketch: null,
        sketchPlaneSelecting: false,
        sketches: wasEditing && activeSketch ? [...sketches, activeSketch] : sketches,
        viewMode: '3d',
        activeTool: 'select',
        statusMessage: 'Sketch cancelled',
        sketch3DActivePlane: null,
      });
    },
  };
}
