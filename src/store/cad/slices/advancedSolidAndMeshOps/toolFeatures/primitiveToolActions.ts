import * as THREE from 'three';
import type { Feature } from '../../../../../types/cad';
import { GeometryEngine } from '../../../../../engine/GeometryEngine';
import {
  placeToolFeatureAsync,
  toolPlacementFailedMessage,
} from '../../featureManagement/bodyBoolean';
import type { CADSliceContext } from '../../../sliceContext';
import type { CADState } from '../../../state';
import { replayToolBooleanAsync } from '../toolFeatureReplay';

export function createPrimitiveToolActions({ set, get }: CADSliceContext): Partial<CADState> {
  return {
  commitPipe: async (params) => {
    const { features, sketches } = get();
    const { outerDiameter, hollow, wallThickness, operation, pathSketchId } = params;
    if (!Number.isFinite(outerDiameter) || outerDiameter <= 0) {
      get().setStatusMessage('Pipe: outer diameter must be a positive number');
      return;
    }
    const sketch = sketches.find((s) => s.id === pathSketchId);
    const pathPoints: THREE.Vector3[] = [];
    if (sketch) {
      for (const e of sketch.entities) {
        if (e.type === 'centerline' || e.type === 'construction-line' || e.isConstruction) continue;
        for (const p of e.points) pathPoints.push(new THREE.Vector3(p.x, p.y, p.z));
      }
    }
    const geom = await GeometryEngine.pipeGeometry(pathPoints, outerDiameter, hollow, wallThickness);
    const mesh = new THREE.Mesh(geom);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const n = features.filter((f) => f.type === 'pipe').length + 1;
    const featureId = crypto.randomUUID();
    mesh.userData.pickable = true;
    mesh.userData.featureId = featureId;
    const feature: Feature = {
      id: featureId,
      name: `Pipe ${n} (⌀${outerDiameter}mm)`,
      type: 'pipe',
      sketchId: sketch ? pathSketchId : undefined,
      params: { isPipe: true, outerDiameter, hollow, wallThickness, operation, pathSketchId },
      mesh,
      bodyKind: 'solid',
      visible: true,
      suppressed: false,
      timestamp: Date.now(),
    };
    const r = await placeToolFeatureAsync(get(), feature, operation);
    if (!r.ok) {
      mesh.geometry.dispose();
      get().setStatusMessage(toolPlacementFailedMessage('Pipe', r.note));
      return;
    }
    get().pushUndo();
    set({ features: r.features, designConfigurations: r.designConfigurations });
    get().setStatusMessage(`Pipe ${n} created: ⌀${outerDiameter}mm${hollow ? `, ${wallThickness}mm wall` : ''}${r.note}`);
  },

  commitSnapFit: async (params) => {
    const { features } = get();
    const { snapType, length, width, thickness, overhang, overhangAngle, returnAngle, operation } = params;
    if (![length, width, thickness].every((v) => Number.isFinite(v) && v > 0)) {
      get().setStatusMessage('Snap Fit: length, width and thickness must be positive numbers');
      return;
    }
    const geom = await GeometryEngine.snapFitGeometry(
      length, width, thickness, overhang, overhangAngle, returnAngle,
    );
    const mesh = new THREE.Mesh(geom);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const n = features.filter((f) => f.type === 'snapFit').length + 1;
    const featureId = crypto.randomUUID();
    mesh.userData.pickable = true;
    mesh.userData.featureId = featureId;
    const feature: Feature = {
      id: featureId,
      name: `Snap Fit ${n} (${snapType})`,
      type: 'snapFit',
      params: { isSnapFit: true, snapType, length, width, thickness, overhang, overhangAngle, returnAngle, operation },
      mesh,
      bodyKind: 'solid',
      visible: true,
      suppressed: false,
      timestamp: Date.now(),
    };
    const r = await placeToolFeatureAsync(get(), feature, operation);
    if (!r.ok) {
      mesh.geometry.dispose();
      get().setStatusMessage(toolPlacementFailedMessage('Snap Fit', r.note));
      return;
    }
    get().pushUndo();
    set({ features: r.features, designConfigurations: r.designConfigurations });
    get().setStatusMessage(`Snap Fit ${n} created: ${snapType}, ${length}×${width}×${thickness}mm${r.note}`);
  },

  commitLipGroove: async (params) => {
    const { features } = get();
    const { lipWidth, lipHeight, grooveWidth, grooveDepth, clearance, includeGroove, operation } = params;
    if (![lipWidth, lipHeight].every((v) => Number.isFinite(v) && v > 0)) {
      get().setStatusMessage('Lip and Groove: lip width and height must be positive numbers');
      return;
    }
    if (includeGroove && ![grooveWidth, grooveDepth].every((v) => Number.isFinite(v) && v > 0)) {
      get().setStatusMessage('Lip and Groove: groove width and depth must be positive numbers');
      return;
    }
    const geom = await GeometryEngine.lipGrooveGeometry(
      lipWidth, lipHeight, grooveWidth, grooveDepth, clearance, includeGroove,
    );
    const mesh = new THREE.Mesh(geom);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const n = features.filter((f) => f.type === 'lipGroove').length + 1;
    const featureId = crypto.randomUUID();
    mesh.userData.pickable = true;
    mesh.userData.featureId = featureId;
    const feature: Feature = {
      id: featureId,
      name: includeGroove ? `Lip and Groove ${n}` : `Lip ${n}`,
      type: 'lipGroove',
      params: { isLipGroove: true, lipWidth, lipHeight, grooveWidth, grooveDepth, clearance, includeGroove, operation },
      mesh,
      bodyKind: 'solid',
      visible: true,
      suppressed: false,
      timestamp: Date.now(),
    };
    const r = await placeToolFeatureAsync(get(), feature, operation);
    if (!r.ok) {
      mesh.geometry.dispose();
      get().setStatusMessage(toolPlacementFailedMessage('Lip and Groove', r.note));
      return;
    }
    get().pushUndo();
    set({ features: r.features, designConfigurations: r.designConfigurations });
    get().setStatusMessage(
      `Lip and Groove ${n} created: lip ${lipWidth}×${lipHeight}mm`
      + `${includeGroove ? `, groove ${grooveWidth}×${grooveDepth}mm (${clearance}mm clearance)` : ''}${r.note}`,
    );
  },

  updateLipGrooveGeometry: async (featureId, params) => {
    const { features } = get();
    const { lipWidth, lipHeight, grooveWidth, grooveDepth, clearance, includeGroove, operation } = params;
    const existing = features.find((f) => f.id === featureId);
    if (!existing) { get().setStatusMessage('Lip and Groove: feature not found'); return; }
    const geom = await GeometryEngine.lipGrooveGeometry(lipWidth, lipHeight, grooveWidth, grooveDepth, clearance, includeGroove);
    const toolMesh = new THREE.Mesh(geom);
    toolMesh.castShadow = true;
    toolMesh.receiveShadow = true;
    toolMesh.userData.pickable = true;
    toolMesh.userData.featureId = featureId;
    const replayed = await replayToolBooleanAsync(features, existing, toolMesh, operation);
    if (!replayed) {
      toolMesh.geometry.dispose();
      get().setStatusMessage(`Lip and Groove update failed: ${operation} requires OCC-backed parent/tool bodies`);
      return;
    }
    const { mesh, note } = replayed;
    get().pushUndo();
    (existing.mesh as THREE.Mesh | undefined)?.geometry?.dispose();
    set({
      features: get().features.map((f) =>
        f.id === featureId
          ? { ...f, mesh, params: { ...f.params, lipWidth, lipHeight, grooveWidth, grooveDepth, clearance, includeGroove, operation } }
          : f,
      ),
    });
    get().setStatusMessage(`Lip and Groove updated: lip ${lipWidth}×${lipHeight}mm${includeGroove ? `, groove ${grooveWidth}×${grooveDepth}mm` : ''}${note}`);
  },

  updateSnapFitGeometry: async (featureId, params) => {
    const { features } = get();
    const { snapType, length, width, thickness, overhang, overhangAngle, returnAngle, operation } = params;
    const existing = features.find((f) => f.id === featureId);
    if (!existing) { get().setStatusMessage('Snap Fit: feature not found'); return; }
    const geom = await GeometryEngine.snapFitGeometry(length, width, thickness, overhang, overhangAngle, returnAngle);
    const toolMesh = new THREE.Mesh(geom);
    toolMesh.castShadow = true;
    toolMesh.receiveShadow = true;
    toolMesh.userData.pickable = true;
    toolMesh.userData.featureId = featureId;
    const replayed = await replayToolBooleanAsync(features, existing, toolMesh, operation);
    if (!replayed) {
      toolMesh.geometry.dispose();
      get().setStatusMessage(`Snap Fit update failed: ${operation} requires OCC-backed parent/tool bodies`);
      return;
    }
    const { mesh, note } = replayed;
    get().pushUndo();
    (existing.mesh as THREE.Mesh | undefined)?.geometry?.dispose();
    set({
      features: get().features.map((f) =>
        f.id === featureId
          ? { ...f, mesh, params: { ...f.params, snapType, length, width, thickness, overhang, overhangAngle, returnAngle, operation } }
          : f,
      ),
    });
    get().setStatusMessage(`Snap Fit updated: ${snapType}, ${length}×${width}×${thickness}mm${note}`);
  },

  updatePipeGeometry: async (featureId, params) => {
    const { features, sketches } = get();
    const { outerDiameter, hollow, wallThickness, operation, pathSketchId } = params;
    const existing = features.find((f) => f.id === featureId);
    if (!existing) { get().setStatusMessage('Pipe: feature not found'); return; }
    const sketch = sketches.find((s) => s.id === pathSketchId);
    const pathPoints: THREE.Vector3[] = [];
    if (sketch) {
      for (const e of sketch.entities) {
        if (e.type === 'centerline' || e.type === 'construction-line' || e.isConstruction) continue;
        for (const p of e.points) pathPoints.push(new THREE.Vector3(p.x, p.y, p.z));
      }
    }
    const geom = await GeometryEngine.pipeGeometry(pathPoints, outerDiameter, hollow, wallThickness);
    const toolMesh = new THREE.Mesh(geom);
    toolMesh.castShadow = true;
    toolMesh.receiveShadow = true;
    toolMesh.userData.pickable = true;
    toolMesh.userData.featureId = featureId;
    const replayed = await replayToolBooleanAsync(features, existing, toolMesh, operation);
    if (!replayed) {
      toolMesh.geometry.dispose();
      get().setStatusMessage(`Pipe update failed: ${operation} requires OCC-backed parent/tool bodies`);
      return;
    }
    const { mesh, note } = replayed;
    get().pushUndo();
    (existing.mesh as THREE.Mesh | undefined)?.geometry?.dispose();
    set({
      features: get().features.map((f) =>
        f.id === featureId
          ? {
              ...f,
              mesh,
              name: `Pipe (⌀${outerDiameter}mm)`,
              sketchId: sketch ? pathSketchId : undefined,
              params: { ...f.params, outerDiameter, hollow, wallThickness, operation, pathSketchId },
            }
          : f,
      ),
    });
    get().setStatusMessage(`Pipe updated: ⌀${outerDiameter}mm${hollow ? `, ${wallThickness}mm wall` : ''}${note}`);
  },
  };
}