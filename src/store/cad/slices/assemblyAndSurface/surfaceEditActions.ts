import * as THREE from 'three';
import type { Feature } from '../../../../types/cad';
import { GeometryEngine } from '../../../../engine/GeometryEngine';
import type { CADSliceContext } from '../../sliceContext';
import type { CADState } from '../../state';
import { placeToolFeatureAsync } from '../featureManagement/bodyBoolean';
import { occThickenWithInstance } from '../../../../engine/occ/ops/thicken';
import { globalBRepBodyRegistry } from '../../../../engine/occ/globalRegistry';
import { getOccSync } from '../../../../engine/occ/loader';
import { createRegisteredOccMesh } from '../../../../engine/occ/registeredMesh';
import { disposeMeshDeferred, disposeMeshesDeferred } from '../../../../engine/occ/picking';
import { BODY_MATERIAL } from '../../../../components/viewport/scene/bodyMaterial';

const SURFACE_MATERIAL = new THREE.MeshPhysicalMaterial({
  color: 0x8899aa,
  metalness: 0.3,
  roughness: 0.4,
  side: THREE.DoubleSide,
});
SURFACE_MATERIAL.userData['shared'] = true;

function configureMesh(geom: THREE.BufferGeometry) {
  const mesh = new THREE.Mesh(geom, SURFACE_MATERIAL);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export function createSurfaceEditActions({ set, get }: CADSliceContext): Partial<CADState> {
  return {
    showDeleteFaceDialog: false,
    deleteFaceIds: [],
    deleteFacePicks: [],
    openDeleteFaceDialog: () => set({ activeDialog: 'delete-face', showDeleteFaceDialog: true, deleteFaceIds: [], deleteFacePicks: [] }),
    addDeleteFace: (id) =>
      set((s) => ({
        deleteFaceIds: s.deleteFaceIds.includes(id) ? s.deleteFaceIds : [...s.deleteFaceIds, id],
      })),
    addDeleteFacePick: (featureId, normal, centroid) =>
      set((s) => {
        const id = centroid.map((v) => v.toFixed(3)).join(',');
        if (s.deleteFaceIds.includes(id)) return {};
        return {
          deleteFaceIds: [...s.deleteFaceIds, id],
          deleteFacePicks: [...s.deleteFacePicks, { featureId, normal, centroid }],
        };
      }),
    clearDeleteFaces: () => set({ deleteFaceIds: [], deleteFacePicks: [] }),
    closeDeleteFaceDialog: () => set({ activeDialog: null, showDeleteFaceDialog: false, deleteFaceIds: [], deleteFacePicks: [] }),
    commitDeleteFace: (params) => {
      const { features, deleteFacePicks } = get();
      if (deleteFacePicks.length === 0) {
        get().setStatusMessage('Delete Face: click one or more faces in the viewport first');
        return;
      }
      // Group picks by the body they were picked on; remove each face (and
      // heal the hole) in turn on that body's mesh. Mirrors commitRemoveFace
      // but multi-face + multi-body.
      const byFeature = new Map<string, typeof deleteFacePicks>();
      for (const p of deleteFacePicks) {
        const arr = byFeature.get(p.featureId);
        if (arr) arr.push(p); else byFeature.set(p.featureId, [p]);
      }
      let removed = 0;
      const nextMesh = new Map<string, THREE.Mesh>();
      const originalMeshes: THREE.Mesh[] = [];
      for (const [featureId, picks] of byFeature) {
        const srcMesh = features.find((f) => f.id === featureId)?.mesh as THREE.Mesh | undefined;
        if (!srcMesh?.isMesh) continue;
        originalMeshes.push(srcMesh);
        let working = srcMesh;
        for (const p of picks) {
          const prev = working;
          working = GeometryEngine.removeFaceAndHeal(
            prev,
            new THREE.Vector3(...p.normal),
            new THREE.Vector3(...p.centroid),
          );
          // Dispose intermediate meshes immediately — each call produces a fresh mesh.
          // The originals are deferred until after set() below.
          if (prev !== srcMesh) prev.geometry.dispose();
          removed++;
        }
        working.castShadow = true;
        working.receiveShadow = true;
        nextMesh.set(featureId, working);
      }
      if (nextMesh.size === 0) {
        get().setStatusMessage('Delete Face: picked faces are not on a body');
        return;
      }
      get().pushUndo();
      set({
        features: features.map((f) =>
          nextMesh.has(f.id)
            ? { ...f, mesh: nextMesh.get(f.id)!, params: { ...f.params, deleteFaceHealMode: params.healMode } }
            : f,
        ),
        activeDialog: null,
        showDeleteFaceDialog: false,
        deleteFaceIds: [],
        deleteFacePicks: [],
      });
      // Defer original mesh disposal until after state is committed.
      disposeMeshesDeferred(originalMeshes);
      get().setStatusMessage(`Delete Face: removed ${removed} face${removed !== 1 ? 's' : ''}`);
    },

    commitSurfaceTrim: (params) => {
      const { features } = get();
      const source = features.find((f) => f.id === params.sourceFeatureId);
      const trimmer = features.find((f) => f.id === params.trimmerFeatureId);
      const srcMesh = source?.mesh as THREE.Mesh | undefined;
      const trimMesh = trimmer?.mesh as THREE.Mesh | undefined;
      if (!srcMesh?.isMesh || !trimMesh?.isMesh) {
        get().setStatusMessage('Surface Trim: select a source surface and a trimming tool');
        return;
      }
      const n = features.filter((f) => f.params?.featureKind === 'surface-trim').length + 1;
      const geom = GeometryEngine.trimSurface(srcMesh, trimMesh, params.keepSide);
      get().pushUndo();
      const feature: Feature = {
        id: crypto.randomUUID(),
        name: `Surface Trim ${n}`,
        type: 'split-body',
        params: { featureKind: 'surface-trim', ...params },
        mesh: configureMesh(geom),
        visible: true,
        suppressed: false,
        timestamp: Date.now(),
        bodyKind: 'surface',
      };
      // Trim consumes the source surface (Fusion behaviour) — hide it so the
      // trimmed result replaces it rather than overlapping.
      set({
        features: [
          ...features.map((f) => (f.id === params.sourceFeatureId ? { ...f, visible: false } : f)),
          feature,
        ],
      });
      disposeMeshDeferred(srcMesh);
      get().setStatusMessage(`Surface Trim ${n}: kept ${params.keepSide} side`);
    },

    commitSurfaceSplit: (params) => {
      const { features } = get();
      const n = features.filter((f) => f.params?.featureKind === 'surface-split').length + 1;
      const source = features.find((f) => f.id === params.sourceFeatureId)?.mesh as THREE.Mesh | undefined;
      const splitterMesh = features.find((f) => f.id === params.splitterFeatureId)?.mesh as THREE.Mesh | undefined;
      const newFeatures: Feature[] = [];
      if (source && splitterMesh) {
        const geos = GeometryEngine.splitSurface(source, splitterMesh);
        geos.forEach((g, idx) => {
          newFeatures.push({
            id: crypto.randomUUID(),
            name: `Surface Split ${n}${geos.length > 1 ? `-${idx + 1}` : ''}`,
            type: 'split-body',
            params: { featureKind: 'surface-split', ...params, pieceIndex: idx },
            mesh: configureMesh(g),
            visible: true,
            suppressed: false,
            timestamp: Date.now(),
            bodyKind: 'surface',
          });
        });
      } else {
        const geom = new THREE.PlaneGeometry(10, 10);
        newFeatures.push({
          id: crypto.randomUUID(),
          name: `Surface Split ${n}`,
          type: 'split-body',
          params: { featureKind: 'surface-split', ...params, placeholder: 1 },
          mesh: configureMesh(geom),
          visible: true,
          suppressed: false,
          timestamp: Date.now(),
          bodyKind: 'surface',
        });
      }
      set({ features: [...features, ...newFeatures] });
      get().setStatusMessage(`Surface Split ${n}: ${newFeatures.length} piece${newFeatures.length !== 1 ? 's' : ''}`);
    },

    commitUntrim: (params) => {
      const { features } = get();
      const n = features.filter((f) => f.params?.featureKind === 'surface-untrim').length + 1;
      const feature: Feature = {
        id: crypto.randomUUID(),
        name: `Untrim ${n}`,
        type: 'split-body',
        params: { featureKind: 'surface-untrim', ...params },
        visible: true,
        suppressed: false,
        timestamp: Date.now(),
        bodyKind: 'surface',
      };
      get().addFeature(feature);
      get().setStatusMessage(`Untrim ${n} created`);
    },

    commitOffsetSurface: (params) => {
      const { features } = get();
      const n = features.filter((f) => f.params?.featureKind === 'offset-surface').length + 1;
      let sourceMesh: THREE.Mesh | undefined;
      for (let i = features.length - 1; i >= 0; i--) {
        const f = features[i];
        if (f.mesh && (f.mesh as THREE.Mesh).isMesh && f.bodyKind === 'surface') { sourceMesh = f.mesh as THREE.Mesh; break; }
      }
      const signedDistance =
        params.direction === 'inward' ? -params.offsetDistance : params.offsetDistance;
      let mesh = sourceMesh
        ? configureMesh(GeometryEngine.offsetSurface(sourceMesh, signedDistance))
        : undefined;

      // operation 'join' on a surface = MERGE the offset result back into the
      // source surface (surface semantics — not a solid boolean), consuming
      // the source. 'new-body' (default) keeps the offset as its own surface.
      let joinNote = '';
      let consumedSourceId: string | undefined;
      if (params.operation === 'join' && sourceMesh && mesh) {
        let srcFeature: (typeof features)[number] | undefined;
        for (let i = features.length - 1; i >= 0; i--) {
          if (features[i].mesh === sourceMesh && features[i].bodyKind === 'surface') { srcFeature = features[i]; break; }
        }
        try {
          const merged = configureMesh(GeometryEngine.mergeSurfaces(mesh, sourceMesh));
          mesh.geometry.dispose();
          const oldMat = mesh.material as THREE.Material | undefined;
          if (oldMat && !oldMat.userData?.['shared']) oldMat.dispose();
          mesh = merged;
          consumedSourceId = srcFeature?.id;
          joinNote = srcFeature ? ` (merged with ${srcFeature.name})` : '';
        } catch {
          joinNote = ' (join failed — standalone surface)';
        }
      }

      const feature: Feature = {
        id: crypto.randomUUID(),
        name: `Offset Surface ${n}`,
        type: 'offset-face',
        params: { featureKind: 'offset-surface', ...params },
        mesh,
        visible: true,
        suppressed: false,
        timestamp: Date.now(),
        bodyKind: 'surface',
      };
      get().pushUndo();
      set((s) => ({
        features: [
          ...s.features.map((f) =>
            consumedSourceId && f.id === consumedSourceId ? { ...f, visible: false, suppressed: true } : f,
          ),
          feature,
        ],
      }));
      get().setStatusMessage(`Offset Surface ${n} created${joinNote}`);
    },

    commitSurfaceExtend: (params) => {
      const { features } = get();
      const n = features.filter((f) => f.params?.featureKind === 'surface-extend').length + 1;
      let sourceMesh: THREE.Mesh | undefined;
      for (let i = features.length - 1; i >= 0; i--) {
        const f = features[i];
        if (f.mesh && (f.mesh as THREE.Mesh).isMesh && f.bodyKind === 'surface') { sourceMesh = f.mesh as THREE.Mesh; break; }
      }
      const mode =
        params.extensionType === 'natural'
          ? 'natural'
          : params.extensionType === 'linear'
            ? 'perpendicular'
            : 'tangent';
      const mesh = sourceMesh
        ? configureMesh(GeometryEngine.extendSurface(sourceMesh, params.extendDistance, mode))
        : undefined;
      const feature: Feature = {
        id: crypto.randomUUID(),
        name: `Surface Extend ${n}`,
        type: 'direct-edit',
        params: { featureKind: 'surface-extend', ...params },
        mesh,
        visible: true,
        suppressed: false,
        timestamp: Date.now(),
        bodyKind: 'surface',
      };
      get().addFeature(feature);
      get().setStatusMessage(`Surface Extend ${n} created`);
    },

    commitStitch: (params) => {
      const { features } = get();
      const n = features.filter((f) => f.params?.featureKind === 'stitch').length + 1;
      const selected = params.sourceFeatureIds.length > 0
        ? features.filter((f) => params.sourceFeatureIds.includes(f.id) && f.mesh && f.bodyKind === 'surface')
        : [];
      const sourceMeshes = (selected.length > 0
        ? selected
        : features.filter((f) => f.mesh && f.bodyKind === 'surface')).map((f) => f.mesh as THREE.Mesh);
      const stitched = sourceMeshes.length > 0
        ? GeometryEngine.stitchSurfaces(sourceMeshes, params.tolerance)
        : null;

      let mesh: THREE.Mesh | undefined;
      let bodyKind: Feature['bodyKind'] = 'surface';
      let closedHoles = false;
      if (stitched) {
        mesh = configureMesh(stitched.geometry);
        bodyKind = stitched.isSolid ? 'solid' : 'surface';
        // "Close Open Edges": cap remaining boundary loops so the stitched
        // result becomes a watertight solid. Only worth running when stitching
        // didn't already produce a closed body.
        if (params.closeOpenEdges && !stitched.isSolid) {
          try {
            const closed = GeometryEngine.makeClosedMesh(mesh);
            // makeClosedMesh re-walks edges; if no open boundary edge remains
            // the result is a closed solid. Re-test the same way stitch does.
            const sealed = GeometryEngine.stitchSurfaces([closed], params.tolerance);
            // The capped mesh supersedes the open stitched mesh — dispose the
            // intermediate geometries we created (never shared singletons).
            mesh.geometry.dispose();
            closed.geometry.dispose();
            mesh = configureMesh(sealed.geometry);
            bodyKind = sealed.isSolid ? 'solid' : 'surface';
            closedHoles = true;
          } catch (err) {
            // Capping failed — keep the plain stitched surface, don't corrupt state.
            get().setStatusMessage(
              `Stitch ${n}: could not close open edges (${err instanceof Error ? err.message : 'error'}); kept open surface`,
            );
          }
        }
      }
      const feature: Feature = {
        id: crypto.randomUUID(),
        name: `Stitch ${n}`,
        type: 'combine',
        params: { featureKind: 'stitch', ...params },
        mesh,
        visible: true,
        suppressed: false,
        timestamp: Date.now(),
        bodyKind,
      };
      get().addFeature(feature);
      if (!params.keepOriginal && params.sourceFeatureIds.length > 0) {
        set({
          features: features.map((f) => (params.sourceFeatureIds.includes(f.id) ? { ...f, visible: false } : f)),
        });
      }
      get().setStatusMessage(
        closedHoles
          ? `Stitch ${n} created (open edges closed${bodyKind === 'solid' ? ' — solid body' : ''})`
          : `Stitch ${n} created`,
      );
    },

    commitUnstitch: (params) => {
      const { features } = get();
      const n = features.filter((f) => f.params?.featureKind === 'unstitch').length + 1;
      const sourceMesh = features.find((f) => f.id === params.sourceFeatureId)?.mesh as THREE.Mesh | undefined;
      const newFeatures: Feature[] = [];
      if (sourceMesh) {
        const geos = GeometryEngine.unstitchSurface(sourceMesh);
        geos.forEach((g, idx) => {
          newFeatures.push({
            id: crypto.randomUUID(),
            name: `Surface Face ${n}${geos.length > 1 ? `-${idx + 1}` : ''}`,
            type: 'split-body',
            params: {
              featureKind: 'unstitch',
              sourceFeatureId: params.sourceFeatureId,
              faceIndex: idx,
              keepOriginal: params.keepOriginal ? 1 : 0,
            },
            mesh: configureMesh(g),
            visible: true,
            suppressed: false,
            timestamp: Date.now(),
            bodyKind: 'surface',
          });
        });
      } else {
        newFeatures.push({
          id: crypto.randomUUID(),
          name: `Unstitch ${n}`,
          type: 'split-body',
          params: {
            featureKind: 'unstitch',
            sourceFeatureId: params.sourceFeatureId,
            keepOriginal: params.keepOriginal ? 1 : 0,
          },
          visible: true,
          suppressed: false,
          timestamp: Date.now(),
          bodyKind: 'surface',
        });
      }

      const nextFeatures = params.keepOriginal
        ? features
        : features.map((f) => (f.id === params.sourceFeatureId ? { ...f, visible: false } : f));
      set({ features: [...nextFeatures, ...newFeatures] });
      get().setStatusMessage(`Unstitch ${n}: separated into ${newFeatures.length} face${newFeatures.length !== 1 ? 's' : ''}`);
    },

    commitThicken: async (params) => {
      const { features } = get();
      const n = features.filter((f) => f.params?.featureKind === 'thicken-solid').length + 1;
      let sourceFeature: (typeof features)[number] | undefined;
      for (let i = features.length - 1; i >= 0; i--) {
        const f = features[i];
        if (f.mesh && (f.mesh as THREE.Mesh).isMesh && f.bodyKind === 'surface') { sourceFeature = f; break; }
      }
      const sourceMesh = sourceFeature?.mesh as THREE.Mesh | undefined;

      // OCC path: thicken via BRep when the source surface has an OCC body
      const thickenOccBodyId = sourceMesh?.userData?.['brepBodyId'] as string | undefined;
      if (thickenOccBodyId) {
        const occ = getOccSync();
        const thickenSrcBody = occ ? globalBRepBodyRegistry.get(thickenOccBodyId) : undefined;
        if (occ && thickenSrcBody) {
          const isSymmetric = params.direction === 'symmetric';
          const thickness = Math.abs(params.thickness);
          const thickenResult = occThickenWithInstance(occ.oc, thickenSrcBody, thickness, { symmetric: isSymmetric });
          if (thickenResult) {
            const newFeatureId = crypto.randomUUID();
            thickenResult.sourceFeatureId = newFeatureId;
            let thickenMesh: THREE.Mesh;
            try {
              thickenMesh = createRegisteredOccMesh(occ.oc, thickenResult, BODY_MATERIAL, newFeatureId);
            } catch (err) {
              get().setStatusMessage(`Thicken (OCC) failed: ${err instanceof Error ? err.message : String(err)}`);
              return;
            }
            const occThickenFeature: Feature = {
              id: newFeatureId,
              name: `Thicken (${thickness}mm, ${params.direction})`,
              type: 'thicken',
              params: { featureKind: 'thicken-solid', ...params },
              mesh: thickenMesh,
              visible: true,
              suppressed: false,
              timestamp: Date.now(),
              bodyKind: 'solid',
            };
            get().pushUndo();
            const r = await placeToolFeatureAsync(get(), occThickenFeature, params.operation ?? 'new-body');
            // If the boolean was actually applied (tool mesh consumed into a result),
            // the tool BRepBody is no longer referenced by any feature — evict it from
            // the registry so the WASM heap entry is freed.
            const toolBrepBodyId = thickenMesh.userData['brepBodyId'] as string | undefined;
            if (toolBrepBodyId && !r.features.some((f) => f.mesh === thickenMesh)) {
              globalBRepBodyRegistry.delete(toolBrepBodyId);
            }
            set({ features: r.features, designConfigurations: r.designConfigurations });
            get().setStatusMessage(`Thicken ${n} (OCC): ${thickness}mm ${params.direction}${r.note}`);
            return;
          }
        }
      }

      const mesh = sourceMesh
        ? configureMesh(GeometryEngine.thickenSurface(sourceMesh, params.thickness, params.direction))
        : undefined;
      const feature: Feature = {
        id: crypto.randomUUID(),
        name: `Thicken (${params.thickness}mm, ${params.direction})`,
        type: 'thicken',
        params: { featureKind: 'thicken-solid', ...params },
        mesh,
        visible: true,
        suppressed: false,
        timestamp: Date.now(),
        bodyKind: 'solid',
      };
      // Thicken yields a solid — honour operation join/cut against the most
      // recent solid body via the shared helper (was: always standalone).
      get().pushUndo();
      const r = await placeToolFeatureAsync(get(), feature, params.operation ?? 'new-body');
      set({ features: r.features, designConfigurations: r.designConfigurations });
      get().setStatusMessage(`Thicken ${n}: ${params.thickness}mm ${params.direction}${r.note}`);
    },
  };
}
