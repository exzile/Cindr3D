import * as THREE from 'three';
import type { Feature } from '../../../../../types/cad';
import { GeometryEngine } from '../../../../../engine/GeometryEngine';
import {
  placeToolFeatureAsync,
  toolPlacementFailedMessage,
} from '../../featureManagement/bodyBoolean';
import type { CADSliceContext } from '../../../sliceContext';
import type { CADState } from '../../../state';

export function createMiscToolActions({ set, get }: CADSliceContext): Partial<CADState> {
  return {
  updateRestGeometry: (featureId, params) => {
    const { features } = get();
    const existing = features.find((f) => f.id === featureId);
    if (!existing) { get().setStatusMessage('Rest: feature not found'); return; }
    get().pushUndo();
    const restMesh = GeometryEngine.createRest(
      params.centerX, params.centerY, params.centerZ,
      params.normalX, params.normalY, params.normalZ,
      params.width, params.depth, params.thickness,
    );
    restMesh.castShadow = true;
    restMesh.receiveShadow = true;
    (existing.mesh as THREE.Mesh | undefined)?.geometry?.dispose();
    set({
      features: features.map((f) =>
        f.id === featureId
          ? { ...f, mesh: restMesh, params: { ...f.params, ...params, ...(params.extras ?? {}), restStyle: 'rest' } }
          : f,
      ),
    });
    get().setStatusMessage(`Rest updated: ${params.width}×${params.depth}×${params.thickness}mm`);
  },

  updateCoilFeatureMesh: (featureId, mesh, params) => {
    const { features } = get();
    const existing = features.find((f) => f.id === featureId);
    if (!existing) { get().setStatusMessage('Coil: feature not found'); return; }
    get().pushUndo();
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    (existing.mesh as THREE.Mesh | undefined)?.geometry?.dispose();
    set({
      features: features.map((f) =>
        f.id === featureId ? { ...f, mesh, params: { ...f.params, ...params } } : f,
      ),
    });
    get().setStatusMessage(`Coil updated`);
  },


  commitRest: (params) => {
    const { features } = get();
    const restMesh = GeometryEngine.createRest(
      params.centerX, params.centerY, params.centerZ,
      params.normalX, params.normalY, params.normalZ,
      params.width, params.depth, params.thickness,
    );
    const n = features.filter((f) => f.params?.restStyle === 'rest').length + 1;
    const feature: Feature = {
      id: crypto.randomUUID(),
      name: `Rest ${n}`,
      type: 'rib',
      params: { ...params, restStyle: 'rest' },
      mesh: restMesh,
      visible: true,
      suppressed: false,
      timestamp: Date.now(),
    };
    set({ features: [...features, feature] });
    get().setStatusMessage(`Rest ${n} created`);
  },

  // ── SLD5 — Thread (cosmetic helix) ───────────────────────────────────────
  commitThread: (featureId, radius, pitch, length) => {
    const { features } = get();
    if (!Number.isFinite(radius) || !Number.isFinite(pitch) || !Number.isFinite(length)
        || radius <= 0 || pitch <= 0 || length <= 0) {
      get().setStatusMessage(`Thread: radius / pitch / length must all be positive finite numbers`);
      return;
    }
    get().pushUndo();
    const helixGeom = GeometryEngine.createCosmeticThread(radius, pitch, length);
    const lineMesh = new THREE.Line(helixGeom, new THREE.LineBasicMaterial({ color: 0x888888 }));
    const n = features.filter((f) => f.type === 'thread').length + 1;
    const feature: Feature = {
      id: crypto.randomUUID(),
      name: `Thread ${n} (cosmetic)`,
      type: 'thread',
      params: { featureId, radius, pitch, length, threadType: 'cosmetic' },
      mesh: lineMesh,
      visible: true,
      suppressed: false,
      timestamp: Date.now(),
    };
    set({ features: [...features, feature] });
    get().setStatusMessage(`Thread ${n}: cosmetic helix (r=${radius}, p=${pitch}, L=${length})`);
  },

  // ── SLD9 — Pattern on Path ───────────────────────────────────────────────
  commitPatternOnPath: (featureId, sketchId, count) => {
    const { features, sketches } = get();
    const srcFeature = features.find((f) => f.id === featureId);
    const sketch = sketches.find((s) => s.id === sketchId);
    if (!srcFeature || !sketch) {
      get().setStatusMessage('Pattern on Path: feature or sketch not found');
      return;
    }
    const srcMesh = srcFeature.mesh as THREE.Mesh | undefined;
    if (!srcMesh?.isMesh) {
      get().setStatusMessage('Pattern on Path: feature has no mesh');
      return;
    }
    get().pushUndo();
    const pathPoints: THREE.Vector3[] = [];
    for (const e of sketch.entities) {
      if (e.type === 'line' && e.points.length >= 2) {
        const p0 = e.points[0];
        const p1 = e.points[e.points.length - 1];
        if (pathPoints.length === 0) pathPoints.push(new THREE.Vector3(p0.x, p0.y, p0.z));
        pathPoints.push(new THREE.Vector3(p1.x, p1.y, p1.z));
      }
    }
    const copies = GeometryEngine.patternOnPath(srcMesh, pathPoints, count);
    const newFeatures: Feature[] = copies.map((copyMesh, idx) => ({
      id: crypto.randomUUID(),
      name: `${srcFeature.name} Path[${idx + 1}]`,
      type: 'circular-pattern' as Feature['type'],
      params: { patternOnPath: true, sourceFeatureId: featureId, sketchId, count, instanceIndex: idx },
      mesh: copyMesh,
      visible: true,
      suppressed: false,
      timestamp: Date.now(),
    }));
    set({ features: [...features, ...newFeatures] });
    get().setStatusMessage(`Pattern on Path: ${copies.length} copies`);
  },

  // ── SLD3 — Emboss ────────────────────────────────────────────────────────
  commitEmboss: async (sketchId, depth, style) => {
    const { sketches, features } = get();
    const sketch = sketches.find((s) => s.id === sketchId);
    if (!sketch) {
      get().setStatusMessage('Emboss: sketch not found');
      return;
    }
    const extrudeDepth = style === 'deboss' ? -Math.abs(depth) : Math.abs(depth);
    const mesh = GeometryEngine.extrudeSketch(sketch, extrudeDepth);
    if (!mesh) {
      get().setStatusMessage('Emboss: could not extrude sketch profile');
      return;
    }
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const n = features.filter((f) => f.params?.featureKind === 'emboss').length + 1;
    const feature: Feature = {
      id: crypto.randomUUID(),
      name: `Emboss ${n} (${style}, ${depth}mm)`,
      type: 'emboss',
      params: { featureKind: 'emboss', sketchId, depth, style, embossStyle: 'emboss' },
      mesh,
      visible: true,
      suppressed: false,
      timestamp: Date.now(),
    };
    const r = await placeToolFeatureAsync(get(), feature, style === 'deboss' ? 'cut' : 'join');
    if (!r.ok) {
      mesh.geometry.dispose();
      get().setStatusMessage(toolPlacementFailedMessage('Emboss', r.note));
      return;
    }
    get().pushUndo();
    set({ features: r.features, designConfigurations: r.designConfigurations });
    get().setStatusMessage(`Emboss ${n}: ${style} ${depth}mm${r.note}`);
  },
  };
}