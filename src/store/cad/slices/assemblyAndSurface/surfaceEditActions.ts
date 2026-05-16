import * as THREE from 'three';
import type { Feature } from '../../../../types/cad';
import { GeometryEngine } from '../../../../engine/GeometryEngine';
import type { CADSliceContext } from '../../sliceContext';
import type { CADState } from '../../state';

const SURFACE_MATERIAL = () =>
  new THREE.MeshPhysicalMaterial({
    color: 0x8899aa,
    metalness: 0.3,
    roughness: 0.4,
    side: THREE.DoubleSide,
  });

function configureMesh(geom: THREE.BufferGeometry) {
  const mesh = new THREE.Mesh(geom, SURFACE_MATERIAL());
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
      for (const [featureId, picks] of byFeature) {
        const srcMesh = features.find((f) => f.id === featureId)?.mesh as THREE.Mesh | undefined;
        if (!srcMesh?.isMesh) continue;
        let working = srcMesh;
        for (const p of picks) {
          working = GeometryEngine.removeFaceAndHeal(
            working,
            new THREE.Vector3(...p.normal),
            new THREE.Vector3(...p.centroid),
          );
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
      const sourceMesh = [...features]
        .reverse()
        .find((f) => f.mesh && (f.mesh as THREE.Mesh).isMesh && f.bodyKind === 'surface')?.mesh as THREE.Mesh | undefined;
      const signedDistance =
        params.direction === 'inward' ? -params.offsetDistance : params.offsetDistance;
      const mesh = sourceMesh
        ? configureMesh(GeometryEngine.offsetSurface(sourceMesh, signedDistance))
        : undefined;

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
      get().addFeature(feature);
      get().setStatusMessage(`Offset Surface ${n} created`);
    },

    commitSurfaceExtend: (params) => {
      const { features } = get();
      const n = features.filter((f) => f.params?.featureKind === 'surface-extend').length + 1;
      const sourceMesh = [...features]
        .reverse()
        .find((f) => f.mesh && (f.mesh as THREE.Mesh).isMesh && f.bodyKind === 'surface')?.mesh as THREE.Mesh | undefined;
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

    commitThicken: (params) => {
      const { features } = get();
      const n = features.filter((f) => f.params?.featureKind === 'thicken-solid').length + 1;
      const sourceMesh = [...features]
        .reverse()
        .find((f) => f.mesh && (f.mesh as THREE.Mesh).isMesh && f.bodyKind === 'surface')?.mesh as THREE.Mesh | undefined;
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
      get().addFeature(feature);
      get().setStatusMessage(`Thicken ${n}: ${params.thickness}mm ${params.direction}`);
    },
  };
}
