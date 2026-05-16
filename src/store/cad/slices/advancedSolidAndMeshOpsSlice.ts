import * as THREE from 'three';
import type { Feature } from '../../../types/cad';
import { GeometryEngine } from '../../../engine/GeometryEngine';
import type { CADSliceContext } from '../sliceContext';
import type { CADState } from '../state';

export function createAdvancedSolidAndMeshOpsSlice({ set, get }: CADSliceContext) {
  const slice: Partial<CADState> = {
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
  commitPipe: (params) => {
    const { features, sketches } = get();
    const { outerDiameter, hollow, wallThickness, operation, pathSketchId } = params;
    if (!Number.isFinite(outerDiameter) || outerDiameter <= 0) {
      get().setStatusMessage('Pipe: outer diameter must be a positive number');
      return;
    }
    // Path polyline from the sketch entities (point coords are world-space,
    // same convention sweepSketchInternal uses). Empty / missing sketch ⇒
    // pipeGeometry falls back to a straight vertical pipe.
    const sketch = sketches.find((s) => s.id === pathSketchId);
    const pathPoints: THREE.Vector3[] = [];
    if (sketch) {
      for (const e of sketch.entities) {
        if (e.type === 'centerline' || e.type === 'construction-line' || e.isConstruction) continue;
        for (const p of e.points) pathPoints.push(new THREE.Vector3(p.x, p.y, p.z));
      }
    }
    get().pushUndo();
    const geom = GeometryEngine.pipeGeometry(pathPoints, outerDiameter, hollow, wallThickness);
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
    set({ features: [...features, feature] });
    const opNote = operation !== 'new-body' ? ` (${operation} not booleaned — standalone body)` : '';
    get().setStatusMessage(`Pipe ${n} created: ⌀${outerDiameter}mm${hollow ? `, ${wallThickness}mm wall` : ''}${opNote}`);
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
    // Guard against degenerate inputs — pitch=0 spins forever in
    // createCosmeticThread (the helix step depends on `length / pitch` turns),
    // and non-finite/zero radius+length silently produce empty / NaN geometry.
    if (!Number.isFinite(radius) || !Number.isFinite(pitch) || !Number.isFinite(length)
        || radius <= 0 || pitch <= 0 || length <= 0) {
      get().setStatusMessage(`Thread: radius / pitch / length must all be positive finite numbers`);
      return;
    }
    get().pushUndo();
    const helixGeom = GeometryEngine.createCosmeticThread(radius, pitch, length);
    const lineMesh = new THREE.Line(helixGeom, new THREE.LineBasicMaterial({ color: 0x888888 }));
    // Find existing feature and attach helix as overlay (new feature referencing it)
    const n = features.filter((f) => f.type === 'thread').length + 1;
    const feature: Feature = {
      id: crypto.randomUUID(),
      name: `Thread ${n} (cosmetic)`,
      type: 'thread',
      params: { featureId, radius, pitch, length, threadType: 'cosmetic' },
      mesh: lineMesh as unknown as THREE.Mesh,
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

  // ── MSH1 — Remesh ────────────────────────────────────────────────────────
  commitRemesh: (featureId, mode, iterations) => {
    iterations = Math.min(Math.max(1, Math.round(iterations)), 10);
    const { features } = get();
    const srcFeature = features.find((f) => f.id === featureId);
    const srcMesh = srcFeature?.mesh as THREE.Mesh | undefined;
    if (!srcFeature || !srcMesh?.isMesh) {
      get().setStatusMessage('Remesh: feature not found or has no mesh');
      return;
    }
    get().pushUndo();
    const remeshed = GeometryEngine.remesh(srcMesh, mode, iterations);
    remeshed.castShadow = true;
    remeshed.receiveShadow = true;
    const nextFeatures = features.map((f) =>
      f.id === featureId ? { ...f, mesh: remeshed, params: { ...f.params, isRemesh: true, mode, iterations } } : f,
    );
    set({ features: nextFeatures });
    get().setStatusMessage(`Remesh (${mode}, ${iterations} iter) applied`);
  },

  // ── SLD10 — Shell ────────────────────────────────────────────────────────
  commitShell: (featureId, thickness, direction) => {
    const { features } = get();
    const srcFeature = features.find((f) => f.id === featureId);
    const srcMesh = srcFeature?.mesh as THREE.Mesh | undefined;
    if (!srcFeature || !srcMesh?.isMesh) {
      get().setStatusMessage('Shell: no mesh found for selected feature');
      return;
    }
    if (!Number.isFinite(thickness) || thickness <= 0) {
      get().setStatusMessage('Shell: thickness must be a positive finite number');
      return;
    }
    get().pushUndo();
    const result = GeometryEngine.shellMesh(srcMesh, thickness, direction);
    result.castShadow = true;
    result.receiveShadow = true;
    const nextFeatures = features.map((f) =>
      f.id === featureId
        ? { ...f, mesh: result, params: { ...f.params, thickness, direction, featureKind: 'shell' } }
        : f,
    );
    set({ features: nextFeatures });
    get().setStatusMessage(`Shell (${direction}, ${thickness}mm) applied`);
  },

  // ── SLD11 — Draft ────────────────────────────────────────────────────────
  commitDraft: (featureId, pullAxisDir, draftAngle, fixedPlaneY) => {
    const { features } = get();
    const srcFeature = features.find((f) => f.id === featureId);
    const srcMesh = srcFeature?.mesh as THREE.Mesh | undefined;
    if (!srcFeature || !srcMesh?.isMesh) {
      get().setStatusMessage('Draft: no mesh found for selected feature');
      return;
    }
    // 90° collapses the geometry; >=90° produces a degenerate mesh.
    if (!Number.isFinite(draftAngle) || Math.abs(draftAngle) >= 90) {
      get().setStatusMessage('Draft: angle must be finite and within (-90°, 90°)');
      return;
    }
    get().pushUndo();
    const result = GeometryEngine.draftMesh(srcMesh, pullAxisDir, draftAngle, fixedPlaneY);
    result.castShadow = true;
    result.receiveShadow = true;
    const nextFeatures = features.map((f) =>
      f.id === featureId
        ? { ...f, mesh: result, params: { ...f.params, draftAngle, fixedPlaneY, featureKind: 'draft' } }
        : f,
    );
    set({ features: nextFeatures });
    get().setStatusMessage(`Draft (${draftAngle}°) applied`);
  },

  // ── SLD14 — Offset Face ──────────────────────────────────────────────────
  commitOffsetFace: (featureId, distance) => {
    const { features } = get();
    const srcFeature = features.find((f) => f.id === featureId);
    const srcMesh = srcFeature?.mesh as THREE.Mesh | undefined;
    if (!srcFeature || !srcMesh?.isMesh) {
      get().setStatusMessage('Offset Face: no mesh found for selected feature');
      return;
    }
    if (!Number.isFinite(distance)) {
      get().setStatusMessage('Offset Face: distance must be a finite number');
      return;
    }
    get().pushUndo();
    const offsetGeom = GeometryEngine.offsetSurface(srcMesh, distance);
    const mat = srcMesh.material as THREE.Material;
    const result = new THREE.Mesh(offsetGeom, mat);
    result.castShadow = true;
    result.receiveShadow = true;
    result.userData = { ...srcMesh.userData };
    const nextFeatures = features.map((f) =>
      f.id === featureId
        ? { ...f, mesh: result, params: { ...f.params, offsetDistance: distance, featureKind: 'offset-face' } }
        : f,
    );
    set({ features: nextFeatures });
    get().setStatusMessage(`Offset Face (${distance > 0 ? '+' : ''}${distance}mm) applied`);
  },

  // ── SLD16 — Remove Face ──────────────────────────────────────────────────
  commitRemoveFace: (featureId, faceNormal, faceCentroid) => {
    const { features } = get();
    const srcFeature = features.find((f) => f.id === featureId);
    const srcMesh = srcFeature?.mesh as THREE.Mesh | undefined;
    if (!srcFeature || !srcMesh?.isMesh) {
      get().setStatusMessage('Remove Face: no mesh found for selected feature');
      return;
    }
    const result = GeometryEngine.removeFaceAndHeal(srcMesh, faceNormal, faceCentroid);
    result.castShadow = true;
    result.receiveShadow = true;
    const nextFeatures = features.map((f) =>
      f.id === featureId
        ? { ...f, mesh: result, params: { ...f.params, featureKind: 'remove-face' } }
        : f,
    );
    set({ features: nextFeatures });
    get().setStatusMessage('Remove Face: face removed and healed');
  },

  // ── SLD3 — Emboss ────────────────────────────────────────────────────────
  commitEmboss: (sketchId, depth, style) => {
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
    get().addFeature(feature);
    get().setStatusMessage(`Emboss ${n}: ${style} ${depth}mm`);
  },

  // ── SLD6 — Boundary Fill ─────────────────────────────────────────────────
  commitBoundaryFill: (toolFeatureIds, operation) => {
    const { features } = get();
    const toolMeshes = toolFeatureIds
      .map((id) => features.find((f) => f.id === id)?.mesh as THREE.Mesh | undefined)
      .filter((m): m is THREE.Mesh => !!m?.isMesh);
    if (toolMeshes.length === 0) {
      get().setStatusMessage('Boundary Fill: no valid tool bodies selected');
      return;
    }
    get().pushUndo();
    // Compute combined bounding box
    const box = new THREE.Box3();
    for (const m of toolMeshes) {
      box.expandByObject(m);
    }
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);
    const fillGeom = new THREE.BoxGeometry(size.x, size.y, size.z);
    const fillMesh = new THREE.Mesh(
      fillGeom,
      new THREE.MeshPhysicalMaterial({ color: 0x3b82f6, metalness: 0.1, roughness: 0.4 }),
    );
    fillMesh.position.copy(center);
    fillMesh.castShadow = true;
    fillMesh.receiveShadow = true;
    const n = features.filter((f) => f.params?.featureKind === 'boundary-fill').length + 1;
    const feature: Feature = {
      id: crypto.randomUUID(),
      name: `Boundary Fill ${n}`,
      type: 'boundary-fill',
      params: { featureKind: 'boundary-fill', toolFeatureIds: toolFeatureIds.join(','), operation, isBoundaryFill: true },
      mesh: fillMesh,
      visible: true,
      suppressed: false,
      timestamp: Date.now(),
    };
    get().addFeature(feature);
    get().setStatusMessage(`Boundary Fill ${n} (${operation}): bounding box fill created`);
  },

  // ── SLD15 — Silhouette Split ─────────────────────────────────────────────
  commitSilhouetteSplit: (featureId, planeNormal, planeOffset) => {
    const { features } = get();
    const srcFeature = features.find((f) => f.id === featureId);
    const srcMesh = srcFeature?.mesh as THREE.Mesh | undefined;
    if (!srcFeature || !srcMesh?.isMesh) {
      get().setStatusMessage('Split Body: no mesh found for selected feature');
      return;
    }
    const partA = GeometryEngine.planeCutMesh(srcMesh, planeNormal, planeOffset, 'positive');
    const partB = GeometryEngine.planeCutMesh(srcMesh, planeNormal, planeOffset, 'negative');
    partA.castShadow = true; partA.receiveShadow = true;
    partB.castShadow = true; partB.receiveShadow = true;
    const n = features.filter((f) => f.params?.featureKind === 'silhouette-split').length + 1;
    const featureA: Feature = {
      id: crypto.randomUUID(),
      name: `${srcFeature.name} Split ${n}A`,
      type: 'split-body' as Feature['type'],
      params: { featureKind: 'silhouette-split', sourceFeatureId: featureId, half: 'positive' },
      mesh: partA,
      visible: true,
      suppressed: false,
      timestamp: Date.now(),
      bodyKind: srcFeature.bodyKind ?? 'solid',
    };
    const featureB: Feature = {
      id: crypto.randomUUID(),
      name: `${srcFeature.name} Split ${n}B`,
      type: 'split-body' as Feature['type'],
      params: { featureKind: 'silhouette-split', sourceFeatureId: featureId, half: 'negative' },
      mesh: partB,
      visible: true,
      suppressed: false,
      timestamp: Date.now(),
      bodyKind: srcFeature.bodyKind ?? 'solid',
    };
    // Hide original, add both halves
    const nextFeatures = features.map((f) =>
      f.id === featureId ? { ...f, visible: false } : f,
    );
    set({ features: [...nextFeatures, featureA, featureB] });
    get().setStatusMessage(`Split Body ${n}: split into two parts`);
  },

  // ── MSH4 — Erase and Fill ────────────────────────────────────────────────
  commitEraseAndFill: (featureId, faceNormal, faceCentroid) => {
    const { features } = get();
    const srcFeature = features.find((f) => f.id === featureId);
    const srcMesh = srcFeature?.mesh as THREE.Mesh | undefined;
    if (!srcFeature || !srcMesh?.isMesh) {
      get().setStatusMessage('Erase And Fill: no mesh found for selected feature');
      return;
    }
    const result = GeometryEngine.removeFaceAndHeal(srcMesh, faceNormal, faceCentroid);
    result.castShadow = true;
    result.receiveShadow = true;
    const nextFeatures = features.map((f) =>
      f.id === featureId
        ? { ...f, mesh: result, params: { ...f.params, featureKind: 'erase-and-fill' } }
        : f,
    );
    set({ features: nextFeatures });
    get().setStatusMessage('Erase And Fill: face removed and healed');
  },

  // ── MSH6 — Mesh Shell ────────────────────────────────────────────────────
  commitMeshShell: (featureId, thickness, direction) => {
    const { features } = get();
    const srcFeature = features.find((f) => f.id === featureId);
    const srcMesh = srcFeature?.mesh as THREE.Mesh | undefined;
    if (!srcFeature || !srcMesh?.isMesh) {
      get().setStatusMessage('Mesh Shell: no mesh found for selected feature');
      return;
    }
    const result = GeometryEngine.shellMesh(srcMesh, thickness, direction);
    result.castShadow = true;
    result.receiveShadow = true;
    const nextFeatures = features.map((f) =>
      f.id === featureId
        ? { ...f, mesh: result, params: { ...f.params, featureKind: 'mesh-shell', thickness, direction } }
        : f,
    );
    set({ features: nextFeatures });
    get().setStatusMessage(`Mesh Shell: ${thickness}mm ${direction} applied`);
  },

  // ── MSH9 — Mesh Align ────────────────────────────────────────────────────
  commitMeshAlign: (sourceFeatureId, targetFeatureId) => {
    const { features } = get();
    const srcFeature = features.find((f) => f.id === sourceFeatureId);
    const tgtFeature = features.find((f) => f.id === targetFeatureId);
    const srcMesh = srcFeature?.mesh as THREE.Mesh | undefined;
    const tgtMesh = tgtFeature?.mesh as THREE.Mesh | undefined;
    if (!srcFeature || !srcMesh?.isMesh || !tgtFeature || !tgtMesh?.isMesh) {
      get().setStatusMessage('Mesh Align: source or target mesh not found');
      return;
    }
    const result = GeometryEngine.alignMeshToCentroid(srcMesh, tgtMesh);
    result.castShadow = true;
    result.receiveShadow = true;
    const nextFeatures = features.map((f) =>
      f.id === sourceFeatureId
        ? { ...f, mesh: result, params: { ...f.params, featureKind: 'mesh-align', targetFeatureId } }
        : f,
    );
    set({ features: nextFeatures });
    get().setStatusMessage(`Mesh Align: "${srcFeature.name}" aligned to "${tgtFeature.name}"`);
  },

  // ── MSH12 — Convert Mesh to BRep ─────────────────────────────────────────
  commitConvertMeshToBRep: (featureId, mode) => {
    const { features } = get();
    const srcFeature = features.find((f) => f.id === featureId);
    const srcMesh = srcFeature?.mesh as THREE.Mesh | undefined;
    if (!srcFeature || !srcMesh?.isMesh) {
      get().setStatusMessage('Convert to BRep: no mesh found for selected feature');
      return;
    }
    let resultMesh: THREE.Mesh = srcMesh;
    if (mode === 'prismatic') {
      resultMesh = GeometryEngine.makeClosedMesh(srcMesh);
    }
    resultMesh.castShadow = true;
    resultMesh.receiveShadow = true;
    const nextFeatures = features.map((f) =>
      f.id === featureId
        ? {
            ...f,
            mesh: resultMesh,
            type: 'extrude' as Feature['type'],
            bodyKind: 'solid' as Feature['bodyKind'],
            params: { ...f.params, featureKind: 'convert-mesh-to-brep', convertMode: mode },
          }
        : f,
    );
    set({ features: nextFeatures });
    get().setStatusMessage(`Convert to BRep (${mode}): "${srcFeature.name}" is now a solid body`);
  },
  };

  return slice;
}

