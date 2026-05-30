import * as THREE from 'three';
import type { Feature, Sketch } from '../../../../../types/cad';
import { GeometryEngine } from '../../../../../engine/GeometryEngine';
import {
  disposeUnplacedToolMesh,
  placeToolFeatureAsync,
  toolPlacementFailedMessage,
} from '../../featureManagement/bodyBoolean';
import type { CADSliceContext } from '../../../sliceContext';
import type { CADState } from '../../../state';
import { getOccSync } from '../../../../../engine/occ/loader';
import { createOccPlaneFrameFromSketch } from '../../../../../engine/occ/plane';
import { occExtrudeWithInstance } from '../../../../../engine/occ/ops/extrude';
import { occModeledThreadWithInstance } from '../../../../../engine/occ/ops/helix';
import { createRegisteredOccMesh } from '../../../../../engine/occ/registeredMesh';
import { globalBRepBodyRegistry } from '../../../../../engine/occ/globalRegistry';
import { BODY_MATERIAL } from '../../../../../components/viewport/scene/bodyMaterial';
import { makeSketchProfileFromShape } from '../../extrudeRevolve/extrudeCommitHelpers';
import { errorMessage } from '../../../../../utils/errorHandling';

function createModeledThreadMesh(
  featureId: string,
  radius: number,
  pitch: number,
  length: number,
  rightHand: boolean,
): THREE.Mesh | null {
  const occ = getOccSync();
  if (!occ) return null;
  const body = occModeledThreadWithInstance(occ.oc, radius, pitch, length, {
    id: featureId,
    sourceFeatureId: featureId,
    rightHand,
  });
  const threadMesh = createRegisteredOccMesh(occ.oc, body, BODY_MATERIAL, featureId);
  threadMesh.castShadow = true;
  threadMesh.receiveShadow = true;
  return threadMesh;
}

function createCosmeticThreadLine(radius: number, pitch: number, length: number): THREE.Line {
  const helixGeom = GeometryEngine.createCosmeticThread(radius, pitch, length);
  return new THREE.Line(helixGeom, new THREE.LineBasicMaterial({ color: 0x888888 }));
}

function collectLinearPathPoints(sketch: Sketch): THREE.Vector3[] {
  const pathPoints: THREE.Vector3[] = [];
  for (const entity of sketch.entities) {
    if (entity.type === 'line' && entity.points.length >= 2) {
      const p0 = entity.points[0];
      const p1 = entity.points[entity.points.length - 1];
      if (pathPoints.length === 0) pathPoints.push(new THREE.Vector3(p0.x, p0.y, p0.z));
      pathPoints.push(new THREE.Vector3(p1.x, p1.y, p1.z));
    }
  }
  return pathPoints;
}

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
    // Evict the old OCC body (if any) before disposing the geometry so the WASM
    // heap is freed rather than orphaned in the registry.
    const prevMesh = existing.mesh as THREE.Mesh | undefined;
    const oldBodyId = prevMesh?.userData?.['brepBodyId'] as string | undefined;
    if (oldBodyId) globalBRepBodyRegistry.delete(oldBodyId);
    prevMesh?.geometry?.dispose();
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

  // ── SLD5 — Thread (cosmetic or OCC modeled) ──────────────────────────────
  commitThread: (featureId, radius, pitch, length) => {
    const { features } = get();
    if (!Number.isFinite(radius) || !Number.isFinite(pitch) || !Number.isFinite(length)
        || radius <= 0 || pitch <= 0 || length <= 0) {
      get().setStatusMessage(`Thread: radius / pitch / length must all be positive finite numbers`);
      return;
    }

    // Look up the existing thread feature (added by ThreadDialog via addFeature).
    // If found we UPDATE it with geometry; otherwise we CREATE a new feature (legacy path).
    const existing = features.find((f) => f.id === featureId);
    const threadType = (existing?.params?.threadType as string | undefined) ?? 'cosmetic';
    const n = features.filter((f) => f.type === 'thread').length + (existing ? 0 : 1);

    get().pushUndo();

    // ── OCC-15.5: OCC modeled thread ─────────────────────────────────────
    if (threadType === 'modeled') {
      try {
        const rightHand = (existing?.params?.direction as string | undefined) !== 'left-hand';
        const threadMesh = createModeledThreadMesh(featureId, radius, pitch, length, rightHand);
        if (threadMesh) {
          if (existing) {
            // Update the existing thread feature with BRep mesh
            set({
              features: features.map((f) =>
                f.id === featureId
                  ? { ...f, mesh: threadMesh, name: f.name.replace(' (cosmetic)', ''), timestamp: Date.now() }
                  : f,
              ),
            });
          } else {
            const feature: Feature = {
              id: crypto.randomUUID(),
              name: `Thread ${n} (modeled)`,
              type: 'thread',
              params: { featureId, radius, pitch, length, threadType: 'modeled' },
              mesh: threadMesh,
              visible: true,
              suppressed: false,
              timestamp: Date.now(),
            };
            set({ features: [...features, feature] });
          }
          get().setStatusMessage(`Thread ${n}: modeled (OCC) r=${radius}, p=${pitch}, L=${length}`);
          return;
        }
      } catch (err) {
        console.warn(`[commitThread] OCC modeled path failed (${errorMessage(err, 'unknown')}), falling back to cosmetic`);
      }
    }

    // ── Cosmetic fallback (LINE helix) ────────────────────────────────────
    const lineMesh = createCosmeticThreadLine(radius, pitch, length);

    if (existing) {
      set({
        features: features.map((f) =>
          f.id === featureId
            ? { ...f, mesh: lineMesh, params: { ...f.params, threadType: 'cosmetic' }, timestamp: Date.now() }
            : f,
        ),
      });
    } else {
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
    }
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
    const pathPoints = collectLinearPathPoints(sketch);
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

  // ── SLD3 — Emboss (OCC-15.6) ─────────────────────────────────────────────
  commitEmboss: async (sketchId, depth, style) => {
    const { sketches, features } = get();
    const sketch = sketches.find((s) => s.id === sketchId);
    if (!sketch) {
      get().setStatusMessage('Emboss: sketch not found');
      return;
    }
    const n = features.filter((f) => f.params?.featureKind === 'emboss').length + 1;
    const featureId = crypto.randomUUID();
    const extrudeDepth = style === 'deboss' ? -Math.abs(depth) : Math.abs(depth);
    const operation: 'join' | 'cut' = style === 'deboss' ? 'cut' : 'join';

    // ── Try OCC extrude path first ─────────────────────────────────────
    let mesh: THREE.Mesh | null = null;
    const occ = getOccSync();
    if (occ) {
      try {
        const shapes = GeometryEngine.sketchToProfileShapesFlat(sketch);
        const firstShape = shapes[0];
        if (firstShape) {
          const sketchProfile = makeSketchProfileFromShape(firstShape);
          const frame = createOccPlaneFrameFromSketch(sketch);
          const occBody = occExtrudeWithInstance(occ.oc, sketchProfile, extrudeDepth, frame, {
            id: featureId,
            sourceFeatureId: featureId,
          });
          mesh = createRegisteredOccMesh(occ.oc, occBody, BODY_MATERIAL, featureId);
        }
      } catch (err) {
        console.warn(`[commitEmboss] OCC extrude failed (${errorMessage(err, 'unknown')}), falling back to mesh`);
        mesh = null;
      }
    }

    // ── THREE mesh fallback ────────────────────────────────────────────
    if (!mesh) {
      mesh = GeometryEngine.extrudeSketch(sketch, extrudeDepth);
      if (!mesh) {
        get().setStatusMessage('Emboss: could not extrude sketch profile');
        return;
      }
    }

    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const feature: Feature = {
      id: featureId,
      name: `Emboss ${n} (${style}, ${depth}mm)`,
      type: 'emboss',
      params: { featureKind: 'emboss', sketchId, depth, style, embossStyle: 'emboss' },
      mesh,
      visible: true,
      suppressed: false,
      timestamp: Date.now(),
    };
    const r = await placeToolFeatureAsync(get(), feature, operation);
    if (!r.ok) {
      disposeUnplacedToolMesh(mesh);
      get().setStatusMessage(toolPlacementFailedMessage('Emboss', r.note));
      return;
    }
    get().pushUndo();
    set({ features: r.features, designConfigurations: r.designConfigurations });
    get().setStatusMessage(`Emboss ${n}: ${style} ${depth}mm${r.note}`);
  },
  };
}
