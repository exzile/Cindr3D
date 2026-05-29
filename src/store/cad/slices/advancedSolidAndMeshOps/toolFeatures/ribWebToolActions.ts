import * as THREE from 'three';
import type { Feature } from '../../../../../types/cad';
import { GeometryEngine } from '../../../../../engine/GeometryEngine';
import type { CADSliceContext } from '../../../sliceContext';
import type { CADState } from '../../../state';
import { getOccSync } from '../../../../../engine/occ/loader';
import { createRegisteredOccMesh } from '../../../../../engine/occ/registeredMesh';
import { BODY_MATERIAL } from '../../../../../components/viewport/scene/bodyMaterial';
import { globalBRepBodyRegistry } from '../../../../../engine/occ/globalRegistry';
import { placeToolFeatureAsync } from '../../featureManagement/bodyBoolean';
import { replayToolBooleanAsync } from '../toolFeatureReplay';
import { errorMessage } from '../../../../../utils/errorHandling';
import { buildOccRibBody } from './ribWebOccGeometry';

export function createRibWebToolActions({ set, get }: CADSliceContext): Partial<CADState> {
  return {
  commitRibFromDialog: async (sketchId, thickness, height) => {
    const { features, sketches } = get();
    const sketch = sketches.find((s) => s.id === sketchId);
    if (!sketch) { get().setStatusMessage('Rib: sketch not found'); return; }
    const pts: THREE.Vector3[] = [];
    for (const e of sketch.entities) {
      if (e.type === 'line' && e.points.length >= 2) {
        const p0 = e.points[0];
        const p1 = e.points[e.points.length - 1];
        pts.push(new THREE.Vector3(p0.x, p0.y, p0.z));
        pts.push(new THREE.Vector3(p1.x, p1.y, p1.z));
      }
    }
    const sketchNormal = sketch.planeNormal?.clone().normalize() ?? new THREE.Vector3(0, 1, 0);
    const n = features.filter((f) => f.type === 'rib').length + 1;
    const featureId = crypto.randomUUID();

    // ── OCC-15.2: Try OCC thin-solid path ─────────────────────────────────
    let mesh: THREE.Mesh | undefined;
    if (pts.length >= 2) {
      const occ = getOccSync();
      if (occ) {
        try {
          const ribBody = buildOccRibBody(occ.oc, pts, thickness, height, sketchNormal, featureId);
          if (ribBody) {
            mesh = createRegisteredOccMesh(occ.oc, ribBody, BODY_MATERIAL, featureId);
          }
        } catch (err) {
          console.warn(`[commitRib] OCC path failed (${errorMessage(err, 'unknown')}), falling back to mesh`);
          mesh = undefined;
        }
      }
    }

    // ── THREE mesh fallback ────────────────────────────────────────────────
    if (!mesh) {
      mesh = pts.length >= 2 ? GeometryEngine.createRib(pts, thickness, height, sketchNormal) : undefined;
    }

    if (mesh) { mesh.castShadow = true; mesh.receiveShadow = true; }

    const feature: Feature = {
      id: featureId,
      name: `Rib ${n}`,
      type: 'rib',
      sketchId,
      params: { thickness, height },
      mesh,
      bodyKind: 'solid',
      visible: true,
      suppressed: false,
      timestamp: Date.now(),
    };

    get().pushUndo();
    if (mesh) {
      // Try to join with the nearest OCC solid; fall back to standalone new-body if none.
      const joinR = await placeToolFeatureAsync(get(), feature, 'join');
      const r = joinR.ok ? joinR : await placeToolFeatureAsync(get(), feature, 'new-body');
      set({ features: r.features, designConfigurations: r.designConfigurations });
      get().setStatusMessage(`Rib ${n} created: ${thickness}mm thick${r.note}`);
    } else {
      set({ features: [...get().features, feature] });
      get().setStatusMessage(`Rib ${n} created: ${thickness}mm thick`);
    }
  },


  commitWeb: async (sketchId, thickness, height) => {
    const { features, sketches } = get();
    const sketch = sketches.find((s) => s.id === sketchId);
    if (!sketch) { get().setStatusMessage('Web: sketch not found'); return; }
    const entityPoints: THREE.Vector3[][] = [];
    // Flatten all line segments into a single point list so buildOccRibBody
    // handles each segment — reuse the same helper as rib.
    const allPts: THREE.Vector3[] = [];
    for (const e of sketch.entities) {
      if (e.type === 'line' && e.points.length >= 2) {
        const p0 = new THREE.Vector3(e.points[0].x, e.points[0].y, e.points[0].z);
        const p1 = new THREE.Vector3(e.points[e.points.length - 1].x, e.points[e.points.length - 1].y, e.points[e.points.length - 1].z);
        entityPoints.push([p0, p1]);
        allPts.push(p0, p1);
      }
    }
    const sketchNormal = sketch.planeNormal?.clone().normalize() ?? new THREE.Vector3(0, 1, 0);
    const n = features.filter((f) => f.type === 'rib' && f.params?.webStyle === 'perpendicular').length + 1;
    const featureId = crypto.randomUUID();

    // ── OCC-15.2: Try OCC thin-solid path ─────────────────────────────────
    let mesh: THREE.Mesh | undefined;
    if (allPts.length >= 2) {
      const occ = getOccSync();
      if (occ) {
        try {
          const webBody = buildOccRibBody(occ.oc, allPts, thickness, height, sketchNormal, featureId);
          if (webBody) {
            mesh = createRegisteredOccMesh(occ.oc, webBody, BODY_MATERIAL, featureId);
          }
        } catch (err) {
          console.warn(`[commitWeb] OCC path failed (${errorMessage(err, 'unknown')}), falling back to mesh`);
          mesh = undefined;
        }
      }
    }

    // ── THREE mesh fallback ────────────────────────────────────────────────
    if (!mesh) {
      const fallbackMesh = entityPoints.length > 0 ? GeometryEngine.createWeb(entityPoints, thickness, height, sketchNormal) : undefined;
      mesh = fallbackMesh;
    }

    if (mesh) { mesh.castShadow = true; mesh.receiveShadow = true; }

    const feature: Feature = {
      id: featureId,
      name: `Web ${n}`,
      type: 'rib',
      sketchId,
      params: { thickness, height, webStyle: 'perpendicular' },
      mesh,
      bodyKind: 'solid',
      visible: true,
      suppressed: false,
      timestamp: Date.now(),
    };

    get().pushUndo();
    if (mesh) {
      const joinR = await placeToolFeatureAsync(get(), feature, 'join');
      const r = joinR.ok ? joinR : await placeToolFeatureAsync(get(), feature, 'new-body');
      set({ features: r.features, designConfigurations: r.designConfigurations });
      get().setStatusMessage(`Web ${n} created: ${thickness}mm thick${r.note}`);
    } else {
      set({ features: [...get().features, feature] });
      get().setStatusMessage(`Web ${n} created: ${thickness}mm thick`);
    }
  },


  updateRibGeometry: async (featureId, sketchId, thickness, height, extras) => {
    const { features, sketches } = get();
    const existing = features.find((f) => f.id === featureId);
    if (!existing) { get().setStatusMessage('Rib: feature not found'); return; }
    const sketch = sketches.find((s) => s.id === sketchId);
    if (!sketch) { get().setStatusMessage('Rib: sketch not found'); return; }
    const pts: THREE.Vector3[] = [];
    for (const e of sketch.entities) {
      if (e.type === 'line' && e.points.length >= 2) {
        const p0 = e.points[0];
        const p1 = e.points[e.points.length - 1];
        pts.push(new THREE.Vector3(p0.x, p0.y, p0.z));
        pts.push(new THREE.Vector3(p1.x, p1.y, p1.z));
      }
    }
    if (pts.length < 2) { get().setStatusMessage('Rib: profile sketch has no line entities'); return; }
    const sketchNormal = sketch.planeNormal?.clone().normalize() ?? new THREE.Vector3(0, 1, 0);

    // ── OCC-15.2: Try OCC thin-solid path ─────────────────────────────────
    const occ = getOccSync();
    if (occ) {
      try {
        const ribBody = buildOccRibBody(occ.oc, pts, thickness, height, sketchNormal, featureId);
        if (ribBody) {
          const occMesh = createRegisteredOccMesh(occ.oc, ribBody, BODY_MATERIAL, featureId);
          occMesh.castShadow = true;
          occMesh.receiveShadow = true;
          const oldBodyId = (existing.mesh as THREE.Mesh | undefined)?.userData?.brepBodyId as string | undefined;
          const replayed = existing.parentFeatureId
            ? await replayToolBooleanAsync(features, existing, occMesh, 'join')
            : null;
          const finalMesh = replayed ? replayed.mesh : occMesh;
          const note = replayed ? replayed.note : '';
          if (oldBodyId) globalBRepBodyRegistry.delete(oldBodyId);
          get().pushUndo();
          (existing.mesh as THREE.Mesh | undefined)?.geometry?.dispose();
          set({
            features: get().features.map((f) =>
              f.id === featureId
                ? { ...f, sketchId, mesh: finalMesh, params: { ...f.params, thickness, height, ...(extras ?? {}) } }
                : f,
            ),
          });
          get().setStatusMessage(`Rib updated: ${thickness}mm thick${note}`);
          return;
        }
      } catch (err) {
        console.warn(`[updateRibGeometry] OCC path failed (${errorMessage(err, 'unknown')}), falling back to mesh`);
      }
    }

    // ── THREE mesh fallback ────────────────────────────────────────────────
    const ribMesh = GeometryEngine.createRib(pts, thickness, height, sketchNormal);
    ribMesh.castShadow = true;
    ribMesh.receiveShadow = true;
    get().pushUndo();
    (existing.mesh as THREE.Mesh | undefined)?.geometry?.dispose();
    set({
      features: features.map((f) =>
        f.id === featureId
          ? { ...f, sketchId, mesh: ribMesh, params: { ...f.params, thickness, height, ...(extras ?? {}) } }
          : f,
      ),
    });
    get().setStatusMessage(`Rib updated: ${thickness}mm thick`);
  },

  updateWebGeometry: async (featureId, sketchId, thickness, height, extras) => {
    const { features, sketches } = get();
    const existing = features.find((f) => f.id === featureId);
    if (!existing) { get().setStatusMessage('Web: feature not found'); return; }
    const sketch = sketches.find((s) => s.id === sketchId);
    if (!sketch) { get().setStatusMessage('Web: sketch not found'); return; }
    const entityPoints: THREE.Vector3[][] = [];
    const allPts: THREE.Vector3[] = [];
    for (const e of sketch.entities) {
      if (e.type === 'line' && e.points.length >= 2) {
        const p0 = new THREE.Vector3(e.points[0].x, e.points[0].y, e.points[0].z);
        const p1 = new THREE.Vector3(e.points[e.points.length - 1].x, e.points[e.points.length - 1].y, e.points[e.points.length - 1].z);
        entityPoints.push([p0, p1]);
        allPts.push(p0, p1);
      }
    }
    if (allPts.length < 2) { get().setStatusMessage('Web: profile sketch has no line entities'); return; }
    const sketchNormal = sketch.planeNormal?.clone().normalize() ?? new THREE.Vector3(0, 1, 0);

    // ── OCC-15.2: Try OCC thin-solid path ─────────────────────────────────
    const occ = getOccSync();
    if (occ) {
      try {
        const webBody = buildOccRibBody(occ.oc, allPts, thickness, height, sketchNormal, featureId);
        if (webBody) {
          const occMesh = createRegisteredOccMesh(occ.oc, webBody, BODY_MATERIAL, featureId);
          occMesh.castShadow = true;
          occMesh.receiveShadow = true;
          const oldBodyId = (existing.mesh as THREE.Mesh | undefined)?.userData?.brepBodyId as string | undefined;
          const replayed = existing.parentFeatureId
            ? await replayToolBooleanAsync(features, existing, occMesh, 'join')
            : null;
          const finalMesh = replayed ? replayed.mesh : occMesh;
          const note = replayed ? replayed.note : '';
          if (oldBodyId) globalBRepBodyRegistry.delete(oldBodyId);
          get().pushUndo();
          (existing.mesh as THREE.Mesh | undefined)?.geometry?.dispose();
          set({
            features: get().features.map((f) =>
              f.id === featureId
                ? { ...f, sketchId, mesh: finalMesh, params: { ...f.params, thickness, height, webStyle: 'perpendicular', ...(extras ?? {}) } }
                : f,
            ),
          });
          get().setStatusMessage(`Web updated: ${thickness}mm thick${note}`);
          return;
        }
      } catch (err) {
        console.warn(`[updateWebGeometry] OCC path failed (${errorMessage(err, 'unknown')}), falling back to mesh`);
      }
    }

    // ── THREE mesh fallback ────────────────────────────────────────────────
    const webMesh = GeometryEngine.createWeb(entityPoints, thickness, height, sketchNormal);
    webMesh.castShadow = true;
    webMesh.receiveShadow = true;
    get().pushUndo();
    (existing.mesh as THREE.Mesh | undefined)?.geometry?.dispose();
    set({
      features: features.map((f) =>
        f.id === featureId
          ? { ...f, sketchId, mesh: webMesh, params: { ...f.params, thickness, height, webStyle: 'perpendicular', ...(extras ?? {}) } }
          : f,
      ),
    });
    get().setStatusMessage(`Web updated: ${thickness}mm thick`);
  },
  };
}
