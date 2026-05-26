import * as THREE from 'three';
import type { Feature } from '../../../../../types/cad';
import { GeometryEngine } from '../../../../../engine/GeometryEngine';
import type { CADSliceContext } from '../../../sliceContext';
import type { CADState } from '../../../state';

export function createRibWebToolActions({ set, get }: CADSliceContext): Partial<CADState> {
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
  };
}