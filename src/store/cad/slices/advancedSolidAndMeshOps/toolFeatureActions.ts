import * as THREE from 'three';
import type { Feature } from '../../../../types/cad';
import { GeometryEngine } from '../../../../engine/GeometryEngine';
import { applyBodyBooleanAsync, placeToolFeatureAsync } from '../featureManagement/bodyBoolean';
import type { CADSliceContext } from '../../sliceContext';
import type { CADState } from '../../state';

/** Async replay helper for tool features (Pipe / SnapFit / LipGroove) — CSG runs in the worker pool. */
async function replayToolBooleanAsync(
  features: Feature[],
  feature: Feature,
  toolMesh: THREE.Mesh,
  operation: 'new-body' | 'join' | 'cut' | 'intersect',
): Promise<{ mesh: THREE.Mesh; note: string }> {
  if (operation === 'new-body') return { mesh: toolMesh, note: '' };
  const parentId = feature.parentFeatureId;
  if (!parentId) return { mesh: toolMesh, note: ` (${operation}: no parent target — standalone)` };
  const parent = features.find((f) => f.id === parentId);
  if (!(parent?.mesh instanceof THREE.Mesh)) {
    return { mesh: toolMesh, note: ` (${operation}: parent body missing — standalone)` };
  }
  const result = await applyBodyBooleanAsync(parent.mesh, toolMesh, operation);
  if (!result) return { mesh: toolMesh, note: ` (${operation} failed — standalone body)` };
  result.userData.pickable = true;
  result.userData.featureId = feature.id;
  toolMesh.geometry.dispose();
  return { mesh: result, note: ` (${operation} with ${parent.name})` };
}

export function createToolFeatureActions({ set, get }: CADSliceContext): Partial<CADState> {
  return {
  commitRibFromDialog: (sketchId, thickness, height) => {
    const { features, sketches } = get();
    const sketch = sketches.find((s) => s.id === sketchId);
    if (!sketch) { get().setStatusMessage('Rib: sketch not found'); return; }
    get().pushUndo();
    const pts: THREE.Vector3[] = [];
    for (const e of sketch.entities) {
      if (e.type === 'line' && e.points.length >= 2) {
        const p0 = e.points[0];
        const p1 = e.points[e.points.length - 1];
        pts.push(new THREE.Vector3(p0.x, p0.y, p0.z));
        pts.push(new THREE.Vector3(p1.x, p1.y, p1.z));
      }
    }
    const normal = sketch.planeNormal?.clone() ?? new THREE.Vector3(0, 1, 0);
    const ribMesh = pts.length >= 2 ? GeometryEngine.createRib(pts, thickness, height, normal) : undefined;
    const n = features.filter((f) => f.type === 'rib').length + 1;
    const feature: Feature = {
      id: crypto.randomUUID(),
      name: `Rib ${n}`,
      type: 'rib',
      sketchId,
      params: { thickness, height },
      mesh: ribMesh,
      visible: true,
      suppressed: false,
      timestamp: Date.now(),
    };
    set({ features: [...features, feature] });
    get().setStatusMessage(`Rib ${n} created: ${thickness}mm thick`);
  },

  // ── SLD2 — Web ───────────────────────────────────────────────────────────
  commitWeb: (sketchId, thickness, height) => {
    const { features, sketches } = get();
    const sketch = sketches.find((s) => s.id === sketchId);
    if (!sketch) { get().setStatusMessage('Web: sketch not found'); return; }
    get().pushUndo();
    const entityPoints: THREE.Vector3[][] = [];
    for (const e of sketch.entities) {
      if (e.type === 'line' && e.points.length >= 2) {
        const p0 = e.points[0];
        const p1 = e.points[e.points.length - 1];
        entityPoints.push([
          new THREE.Vector3(p0.x, p0.y, p0.z),
          new THREE.Vector3(p1.x, p1.y, p1.z),
        ]);
      }
    }
    const normal = sketch.planeNormal?.clone() ?? new THREE.Vector3(0, 1, 0);
    const webMesh = entityPoints.length > 0 ? GeometryEngine.createWeb(entityPoints, thickness, height, normal) : undefined;
    const n = features.filter((f) => f.type === 'rib' && f.params?.webStyle === 'perpendicular').length + 1;
    const feature: Feature = {
      id: crypto.randomUUID(),
      name: `Web ${n}`,
      type: 'rib',
      sketchId,
      params: { thickness, height, webStyle: 'perpendicular' },
      mesh: webMesh,
      visible: true,
      suppressed: false,
      timestamp: Date.now(),
    };
    set({ features: [...features, feature] });
    get().setStatusMessage(`Web ${n} created: ${thickness}mm thick`);
  },

  // ── SLD — Pipe ───────────────────────────────────────────────────────────
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
    get().pushUndo();
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
    set({ features: r.features, designConfigurations: r.designConfigurations });
    get().setStatusMessage(`Pipe ${n} created: ⌀${outerDiameter}mm${hollow ? `, ${wallThickness}mm wall` : ''}${r.note}`);
  },

  // ── SLD — Snap Fit (cantilever snap-hook) ────────────────────────────────
  commitSnapFit: async (params) => {
    const { features } = get();
    const { snapType, length, width, thickness, overhang, overhangAngle, returnAngle, operation } = params;
    if (![length, width, thickness].every((v) => Number.isFinite(v) && v > 0)) {
      get().setStatusMessage('Snap Fit: length, width and thickness must be positive numbers');
      return;
    }
    get().pushUndo();
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
    set({ features: r.features, designConfigurations: r.designConfigurations });
    get().setStatusMessage(`Snap Fit ${n} created: ${snapType}, ${length}×${width}×${thickness}mm${r.note}`);
  },

  // ── SLD — Lip and Groove ─────────────────────────────────────────────────
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
    get().pushUndo();
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
    get().pushUndo();
    const geom = await GeometryEngine.lipGrooveGeometry(lipWidth, lipHeight, grooveWidth, grooveDepth, clearance, includeGroove);
    const toolMesh = new THREE.Mesh(geom);
    toolMesh.castShadow = true;
    toolMesh.receiveShadow = true;
    toolMesh.userData.pickable = true;
    toolMesh.userData.featureId = featureId;
    const { mesh, note } = await replayToolBooleanAsync(features, existing, toolMesh, operation);
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
    get().pushUndo();
    const geom = await GeometryEngine.snapFitGeometry(length, width, thickness, overhang, overhangAngle, returnAngle);
    const toolMesh = new THREE.Mesh(geom);
    toolMesh.castShadow = true;
    toolMesh.receiveShadow = true;
    toolMesh.userData.pickable = true;
    toolMesh.userData.featureId = featureId;
    const { mesh, note } = await replayToolBooleanAsync(features, existing, toolMesh, operation);
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
    get().pushUndo();
    const geom = await GeometryEngine.pipeGeometry(pathPoints, outerDiameter, hollow, wallThickness);
    const toolMesh = new THREE.Mesh(geom);
    toolMesh.castShadow = true;
    toolMesh.receiveShadow = true;
    toolMesh.userData.pickable = true;
    toolMesh.userData.featureId = featureId;
    const { mesh, note } = await replayToolBooleanAsync(features, existing, toolMesh, operation);
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

  updateRibGeometry: (featureId, sketchId, thickness, height, extras) => {
    const { features, sketches } = get();
    const existing = features.find((f) => f.id === featureId);
    if (!existing) { get().setStatusMessage('Rib: feature not found'); return; }
    const sketch = sketches.find((s) => s.id === sketchId);
    if (!sketch) { get().setStatusMessage('Rib: sketch not found'); return; }
    get().pushUndo();
    const pts: THREE.Vector3[] = [];
    for (const e of sketch.entities) {
      if (e.type === 'line' && e.points.length >= 2) {
        const p0 = e.points[0];
        const p1 = e.points[e.points.length - 1];
        pts.push(new THREE.Vector3(p0.x, p0.y, p0.z));
        pts.push(new THREE.Vector3(p1.x, p1.y, p1.z));
      }
    }
    const normal = sketch.planeNormal?.clone() ?? new THREE.Vector3(0, 1, 0);
    const ribMesh = pts.length >= 2 ? GeometryEngine.createRib(pts, thickness, height, normal) : undefined;
    if (!ribMesh) { get().setStatusMessage('Rib: profile sketch has no line entities'); return; }
    ribMesh.castShadow = true;
    ribMesh.receiveShadow = true;
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

  updateWebGeometry: (featureId, sketchId, thickness, height, extras) => {
    const { features, sketches } = get();
    const existing = features.find((f) => f.id === featureId);
    if (!existing) { get().setStatusMessage('Web: feature not found'); return; }
    const sketch = sketches.find((s) => s.id === sketchId);
    if (!sketch) { get().setStatusMessage('Web: sketch not found'); return; }
    get().pushUndo();
    const entityPoints: THREE.Vector3[][] = [];
    for (const e of sketch.entities) {
      if (e.type === 'line' && e.points.length >= 2) {
        const p0 = e.points[0];
        const p1 = e.points[e.points.length - 1];
        entityPoints.push([
          new THREE.Vector3(p0.x, p0.y, p0.z),
          new THREE.Vector3(p1.x, p1.y, p1.z),
        ]);
      }
    }
    const normal = sketch.planeNormal?.clone() ?? new THREE.Vector3(0, 1, 0);
    const webMesh = entityPoints.length > 0 ? GeometryEngine.createWeb(entityPoints, thickness, height, normal) : undefined;
    if (!webMesh) { get().setStatusMessage('Web: profile sketch has no line entities'); return; }
    webMesh.castShadow = true;
    webMesh.receiveShadow = true;
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

  // ── SLD4 — Rest ──────────────────────────────────────────────────────────
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
    get().pushUndo();
    const r = await placeToolFeatureAsync(get(), feature, style === 'deboss' ? 'cut' : 'join');
    set({ features: r.features, designConfigurations: r.designConfigurations });
    get().setStatusMessage(`Emboss ${n}: ${style} ${depth}mm${r.note}`);
  },
  };
}
