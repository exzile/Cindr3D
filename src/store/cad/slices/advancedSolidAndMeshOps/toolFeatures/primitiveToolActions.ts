import * as THREE from 'three';
import type { Feature } from '../../../../../types/cad';
import { GeometryEngine } from '../../../../../engine/GeometryEngine';
import {
  disposeUnplacedToolMesh,
  placeToolFeatureAsync,
  toolPlacementFailedMessage,
} from '../../featureManagement/bodyBoolean';
import type { CADSliceContext } from '../../../sliceContext';
import type { CADState } from '../../../state';
import { replayToolBooleanAsync } from '../toolFeatureReplay';
import { getOccSync } from '../../../../../engine/occ/loader';
import { globalBRepBodyRegistry } from '../../../../../engine/occ/globalRegistry';
import { errorMessage } from '../../../../../utils/errorHandling';
import { buildOccPipeMeshFromSketch, collectPipePathPoints } from './pipeToolGeometry';

async function placeGeneratedToolFeature(
  context: CADSliceContext,
  feature: Feature,
  mesh: THREE.Mesh,
  operation: Parameters<typeof placeToolFeatureAsync>[2],
  toolLabel: string,
): Promise<string | null> {
  const result = await placeToolFeatureAsync(context.get(), feature, operation);
  if (!result.ok) {
    disposeUnplacedToolMesh(mesh);
    context.get().setStatusMessage(toolPlacementFailedMessage(toolLabel, result.note));
    return null;
  }
  context.get().pushUndo();
  context.set({ features: result.features, designConfigurations: result.designConfigurations });
  return result.note;
}

export function createPrimitiveToolActions({ set, get }: CADSliceContext): Partial<CADState> {
  return {
  commitPipe: async (params) => {
    const { features, sketches } = get();
    const { outerDiameter, hollow, wallThickness, operation, pathSketchId, sectionType = 'circular' } = params;
    if (!Number.isFinite(outerDiameter) || outerDiameter <= 0) {
      get().setStatusMessage('Pipe: outer diameter must be a positive number');
      return;
    }
    const sketch = sketches.find((s) => s.id === pathSketchId);
    const n = features.filter((f) => f.type === 'pipe').length + 1;
    const featureId = crypto.randomUUID();

    // ── OCC-15.3: Try OCC sweep path first ────────────────────────────────
    let mesh: THREE.Mesh | null = null;
    if (sketch) {
      const occ = getOccSync();
      if (occ) {
        try {
          mesh = buildOccPipeMeshFromSketch(
            occ,
            sketch,
            outerDiameter,
            hollow,
            wallThickness,
            featureId,
          );
        } catch (err) {
          console.warn(`[commitPipe] OCC sweep failed (${errorMessage(err, 'unknown')}), falling back to mesh`);
          mesh = null;
        }
      }
    }

    // ── THREE mesh fallback ───────────────────────────────────────────────
    if (!mesh) {
      const pathPoints = collectPipePathPoints(sketch);
      const geom = await GeometryEngine.pipeGeometry(pathPoints, outerDiameter, hollow, wallThickness, sectionType);
      mesh = new THREE.Mesh(geom);
    }

    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.pickable = true;
    mesh.userData.featureId = featureId;

    const feature: Feature = {
      id: featureId,
      name: `Pipe ${n} (⌀${outerDiameter}mm)`,
      type: 'pipe',
      sketchId: sketch ? pathSketchId : undefined,
      params: { isPipe: true, outerDiameter, hollow, wallThickness, operation, pathSketchId, sectionType },
      mesh,
      bodyKind: 'solid',
      visible: true,
      suppressed: false,
      timestamp: Date.now(),
    };
    const r = await placeToolFeatureAsync(get(), feature, operation);
    if (!r.ok) {
      disposeUnplacedToolMesh(mesh);
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
    const note = await placeGeneratedToolFeature({ set, get }, feature, mesh, operation, 'Snap Fit');
    if (note === null) {
      return;
    }
    get().setStatusMessage(`Snap Fit ${n} created: ${snapType}, ${length}×${width}×${thickness}mm${note}`);
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
    const note = await placeGeneratedToolFeature({ set, get }, feature, mesh, operation, 'Lip and Groove');
    if (note === null) {
      return;
    }
    get().setStatusMessage(
      `Lip and Groove ${n} created: lip ${lipWidth}×${lipHeight}mm`
      + `${includeGroove ? `, groove ${grooveWidth}×${grooveDepth}mm (${clearance}mm clearance)` : ''}${note}`,
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
    const { outerDiameter, hollow, wallThickness, operation, pathSketchId, sectionType = 'circular' } = params;
    const existing = features.find((f) => f.id === featureId);
    if (!existing) { get().setStatusMessage('Pipe: feature not found'); return; }
    const sketch = sketches.find((s) => s.id === pathSketchId);

    // ── OCC-15.3: Try OCC sweep path first ────────────────────────────────
    if (sketch) {
      const occ = getOccSync();
      if (occ) {
        try {
          const occMesh = buildOccPipeMeshFromSketch(
            occ,
            sketch,
            outerDiameter,
            hollow,
            wallThickness,
            featureId,
          );
          if (occMesh) {
            // Capture old body id before replay so we can evict it from the registry after.
            const oldBodyId = (existing.mesh as THREE.Mesh | undefined)?.userData?.brepBodyId as string | undefined;
            const replayed = await replayToolBooleanAsync(features, existing, occMesh, operation);
            if (replayed) {
              // applyBodyBooleanAsync already removes the tool body (occMesh's id) from the
              // registry for join/cut/intersect. We must evict the OLD pipe body ourselves.
              if (oldBodyId) globalBRepBodyRegistry.delete(oldBodyId);
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
                        sketchId: pathSketchId,
                        params: { ...f.params, outerDiameter, hollow, wallThickness, operation, pathSketchId, sectionType },
                      }
                    : f,
                ),
              });
              get().setStatusMessage(`Pipe updated: ⌀${outerDiameter}mm${hollow ? `, ${wallThickness}mm wall` : ''}${note}`);
              return;
            }
            // replay failed — clean up the intermediate OCC mesh we just created
            disposeUnplacedToolMesh(occMesh);
          }
        } catch (err) {
          console.warn(`[updatePipeGeometry] OCC sweep failed (${errorMessage(err, 'unknown')}), falling back to mesh`);
        }
      }
    }

    // ── THREE mesh fallback ───────────────────────────────────────────────
    const pathPoints = collectPipePathPoints(sketch);
    const geom = await GeometryEngine.pipeGeometry(pathPoints, outerDiameter, hollow, wallThickness, sectionType);
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
