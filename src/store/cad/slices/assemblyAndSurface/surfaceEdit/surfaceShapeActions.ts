import * as THREE from 'three';
import type { Feature } from '../../../../../types/cad';
import { GeometryEngine } from '../../../../../engine/GeometryEngine';
import type { CADSliceContext } from '../../../sliceContext';
import type { CADState } from '../../../state';
import { disposeMeshDeferred } from '../../../../../engine/occ/picking';
import { configureSurfaceMesh } from './surfaceEditShared';

export function createSurfaceShapeActions({ set, get }: CADSliceContext): Partial<CADState> {
  return {
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
        mesh: configureSurfaceMesh(geom),
        visible: true,
        suppressed: false,
        timestamp: Date.now(),
        bodyKind: 'surface',
      };
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
            mesh: configureSurfaceMesh(g),
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
          mesh: configureSurfaceMesh(geom),
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
        if (f.mesh && (f.mesh as THREE.Mesh).isMesh && f.bodyKind === 'surface') {
          sourceMesh = f.mesh as THREE.Mesh;
          break;
        }
      }
      const signedDistance =
        params.direction === 'inward' ? -params.offsetDistance : params.offsetDistance;
      let mesh = sourceMesh
        ? configureSurfaceMesh(GeometryEngine.offsetSurface(sourceMesh, signedDistance))
        : undefined;

      let joinNote = '';
      let consumedSourceId: string | undefined;
      if (params.operation === 'join' && sourceMesh && mesh) {
        let srcFeature: (typeof features)[number] | undefined;
        for (let i = features.length - 1; i >= 0; i--) {
          if (features[i].mesh === sourceMesh && features[i].bodyKind === 'surface') {
            srcFeature = features[i];
            break;
          }
        }
        try {
          const merged = configureSurfaceMesh(GeometryEngine.mergeSurfaces(mesh, sourceMesh));
          mesh.geometry.dispose();
          const oldMat = mesh.material as THREE.Material | undefined;
          if (oldMat && !oldMat.userData?.['shared']) oldMat.dispose();
          mesh = merged;
          consumedSourceId = srcFeature?.id;
          joinNote = srcFeature ? ` (merged with ${srcFeature.name})` : '';
        } catch {
          joinNote = ' (join failed - standalone surface)';
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
        if (f.mesh && (f.mesh as THREE.Mesh).isMesh && f.bodyKind === 'surface') {
          sourceMesh = f.mesh as THREE.Mesh;
          break;
        }
      }
      const mode =
        params.extensionType === 'natural'
          ? 'natural'
          : params.extensionType === 'linear'
            ? 'perpendicular'
            : 'tangent';
      const mesh = sourceMesh
        ? configureSurfaceMesh(GeometryEngine.extendSurface(sourceMesh, params.extendDistance, mode))
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
  };
}
