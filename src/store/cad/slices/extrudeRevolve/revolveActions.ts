import * as THREE from 'three';
import type { Feature } from '../../../../types/cad';
import { REVOLVE_DEFAULTS } from '../../defaults';
import type { CADSliceContext } from '../../sliceContext';
import type { CADState } from '../../state';

export function createRevolveActions({ set, get }: CADSliceContext): Partial<CADState> {
  return {
  // Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Revolve tool Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  ...REVOLVE_DEFAULTS,
  setRevolveSelectedSketchId: (id) => set({ revolveSelectedSketchId: id }),
  setRevolveAxis: (a) => set({ revolveAxis: a }),
  setRevolveAngle: (angle) => set({ revolveAngle: angle }),
  // D70 direction modes
  setRevolveDirection: (d) => set({ revolveDirection: d }),
  setRevolveAngle2: (a) => set({ revolveAngle2: a }),
  // D103 body kind
  setRevolveBodyKind: (k) => set({ revolveBodyKind: k }),
  setRevolveOperation: (op) => set({ revolveOperation: op }),
  // CORR-10
  setRevolveIsProjectAxis: (v) => set({ revolveIsProjectAxis: v }),
  // Face mode
  setRevolveProfileMode: (m) => set({ revolveProfileMode: m }),
  clearRevolveFace: () => set({ revolveFaceBoundary: null, revolveFaceNormal: null }),
  startRevolveFromFace: (boundary, normal) => {
    if (boundary.length < 3) return;
    const flat = boundary.flatMap((v) => [v.x, v.y, v.z]);
    set({
      revolveFaceBoundary: flat,
      revolveFaceNormal: [normal.x, normal.y, normal.z],
      statusMessage: 'Face selected Ã¢â‚¬â€ set axis and angle, then click OK',
    });
  },
  startRevolveTool: () => {
    set({
      activeTool: 'revolve',
      ...REVOLVE_DEFAULTS,
      statusMessage: 'Revolve Ã¢â‚¬â€ pick a sketch profile or use Face mode',
    });
  },
  cancelRevolveTool: () => {
    set({
      activeTool: 'select',
      ...REVOLVE_DEFAULTS,
      statusMessage: 'Revolve cancelled',
    });
  },
  commitRevolve: () => {
    const { revolveProfileMode, revolveSelectedSketchId, revolveFaceBoundary, revolveAxis, revolveAngle, revolveDirection, revolveAngle2, revolveBodyKind, revolveOperation, revolveIsProjectAxis, sketches, features, units } = get();

    // Ã¢â€â‚¬Ã¢â€â‚¬ Face mode Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
    if (revolveProfileMode === 'face') {
      if (!revolveFaceBoundary || revolveFaceBoundary.length < 9) {
        set({ statusMessage: 'Click a face in the viewport first' });
        return;
      }
      const primaryAngle = revolveDirection === 'symmetric' ? revolveAngle / 2 : revolveAngle;
      if (Math.abs(primaryAngle) < 0.5) {
        set({ statusMessage: 'Angle must be greater than 0' });
        return;
      }
      const feature: Feature = {
        id: crypto.randomUUID(),
        name: `${revolveBodyKind === 'surface' ? 'Surface ' : ''}Revolve ${features.filter((f) => f.type === 'revolve').length + 1}`,
        type: 'revolve',
        params: {
          angle: revolveAngle,
          axis: revolveAxis,
          direction: revolveDirection,
          angle2: revolveAngle2,
          faceRevolve: true,
          faceBoundary: revolveFaceBoundary,
          isProjectAxis: revolveIsProjectAxis,
          operation: revolveOperation,
        },
        visible: true,
        suppressed: false,
        timestamp: Date.now(),
        bodyKind: revolveBodyKind === 'surface' ? 'surface' : 'solid',
      };
      const angleDesc = revolveDirection === 'symmetric' ? `Ã‚Â±${revolveAngle / 2}Ã‚Â°` : `${revolveAngle}Ã‚Â°`;
      get().pushUndo();
      set({
        features: [...features, feature],
        activeTool: 'select',
        ...REVOLVE_DEFAULTS,
        statusMessage: `Revolved face by ${angleDesc} around ${revolveAxis} (${units})`,
      });
      return;
    }

    // Ã¢â€â‚¬Ã¢â€â‚¬ Sketch mode Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
    if (!revolveSelectedSketchId) {
      set({ statusMessage: 'No profile selected for revolve' });
      return;
    }
    const sketch = sketches.find((s) => s.id === revolveSelectedSketchId);
    if (!sketch) {
      set({ statusMessage: 'Selected profile not found' });
      return;
    }
    // For symmetric, each side gets angle/2; for two-sides, side1=revolveAngle, side2=revolveAngle2.
    // The stored angle is always the primary (or full) angle Ã¢â‚¬â€ the renderer uses revolveDirection.
    const primaryAngle = revolveDirection === 'symmetric' ? revolveAngle / 2 : revolveAngle;
    if (Math.abs(primaryAngle) < 0.5) {
      set({ statusMessage: 'Angle must be greater than 0' });
      return;
    }
    // S5: if centerline axis, find centerline entity in sketch and extract axis
    let resolvedAxisKey = revolveAxis as string;
    let centerlineAxisDirection: [number, number, number] | undefined;
    let centerlineAxisOrigin: [number, number, number] | undefined;
    if (revolveAxis === 'centerline') {
      const clEntity = sketch.entities.find((e) => e.type === 'centerline' && e.points.length >= 2);
      if (!clEntity) {
        set({ statusMessage: 'Spun Profile: no centerline found in sketch Ã¢â‚¬â€ add a centerline entity first' });
        return;
      }
      const p0 = clEntity.points[0];
      const p1 = clEntity.points[clEntity.points.length - 1];
      const dir = new THREE.Vector3(p1.x - p0.x, p1.y - p0.y, p1.z - p0.z).normalize();
      centerlineAxisDirection = [dir.x, dir.y, dir.z];
      centerlineAxisOrigin = [p0.x, p0.y, p0.z];
      // Map to nearest standard axis for LatheGeometry orientation fallback
      const ax = Math.abs(dir.x), ay = Math.abs(dir.y), az = Math.abs(dir.z);
      resolvedAxisKey = ax >= ay && ax >= az ? 'X' : ay >= ax && ay >= az ? 'Y' : 'Z';
    }
    get().pushUndo();
    const feature: Feature = {
      id: crypto.randomUUID(),
      name: `${revolveBodyKind === 'surface' ? 'Surface ' : ''}Revolve ${features.filter((f) => f.type === 'revolve').length + 1}`,
      type: 'revolve',
      sketchId: revolveSelectedSketchId,
      params: {
        angle: revolveAngle,
        axis: resolvedAxisKey,
        ...(centerlineAxisDirection ? { useCenterline: true, axisDirection: centerlineAxisDirection, axisOrigin: centerlineAxisOrigin } : {}),
        direction: revolveDirection,
        angle2: revolveAngle2,
        isProjectAxis: revolveIsProjectAxis,
        operation: revolveOperation,
      },
      visible: true,
      suppressed: false,
      timestamp: Date.now(),
      bodyKind: revolveBodyKind === 'surface' ? 'surface' : 'solid',
    };
    const angleDesc = revolveDirection === 'symmetric'
      ? `Ã‚Â±${revolveAngle / 2}Ã‚Â°`
      : revolveDirection === 'two-sides'
        ? `${revolveAngle}Ã‚Â°/${revolveAngle2}Ã‚Â°`
        : `${revolveAngle}Ã‚Â°`;
    set({
      features: [...features, feature],
      activeTool: 'select',
      ...REVOLVE_DEFAULTS,
      statusMessage: `Revolved ${sketch.name} by ${angleDesc} around ${revolveAxis === 'centerline' ? 'sketch centerline' : revolveAxis} (${units})`,
    });
  },
  };
}
