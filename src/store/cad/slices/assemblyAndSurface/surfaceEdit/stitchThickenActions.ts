import * as THREE from 'three';
import type { Feature } from '../../../../../types/cad';
import { GeometryEngine } from '../../../../../engine/GeometryEngine';
import type { CADSliceContext } from '../../../sliceContext';
import type { CADState } from '../../../state';
import {
  disposeUnplacedToolMesh,
  placeToolFeatureAsync,
  toolPlacementFailedMessage,
} from '../../featureManagement/bodyBoolean';
import { occThickenWithInstance } from '../../../../../engine/occ/ops/thicken';
import { globalBRepBodyRegistry } from '../../../../../engine/occ/globalRegistry';
import { getOccSync } from '../../../../../engine/occ/loader';
import { createRegisteredOccMesh } from '../../../../../engine/occ/registeredMesh';
import { BODY_MATERIAL } from '../../../../../components/viewport/scene/bodyMaterial';
import { configureSurfaceMesh } from './surfaceEditShared';

export function createStitchThickenActions({ set, get }: CADSliceContext): Partial<CADState> {
  return {
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
        mesh = configureSurfaceMesh(stitched.geometry);
        bodyKind = stitched.isSolid ? 'solid' : 'surface';
        if (params.closeOpenEdges && !stitched.isSolid) {
          try {
            const closed = GeometryEngine.makeClosedMesh(mesh);
            const sealed = GeometryEngine.stitchSurfaces([closed], params.tolerance);
            mesh.geometry.dispose();
            closed.geometry.dispose();
            mesh = configureSurfaceMesh(sealed.geometry);
            bodyKind = sealed.isSolid ? 'solid' : 'surface';
            closedHoles = true;
          } catch (err) {
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
          ? `Stitch ${n} created (open edges closed${bodyKind === 'solid' ? ' - solid body' : ''})`
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
            mesh: configureSurfaceMesh(g),
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
        if (f.mesh && (f.mesh as THREE.Mesh).isMesh && f.bodyKind === 'surface') {
          sourceFeature = f;
          break;
        }
      }
      const sourceMesh = sourceFeature?.mesh as THREE.Mesh | undefined;

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
            const r = await placeToolFeatureAsync(get(), occThickenFeature, params.operation ?? 'new-body');
            if (!r.ok) {
              disposeUnplacedToolMesh(thickenMesh);
              get().setStatusMessage(toolPlacementFailedMessage('Thicken', r.note));
              return;
            }
            const toolBrepBodyId = thickenMesh.userData['brepBodyId'] as string | undefined;
            if (toolBrepBodyId && !r.features.some((f) => f.mesh === thickenMesh)) {
              globalBRepBodyRegistry.delete(toolBrepBodyId);
            }
            get().pushUndo();
            set({ features: r.features, designConfigurations: r.designConfigurations });
            get().setStatusMessage(`Thicken ${n} (OCC): ${thickness}mm ${params.direction}${r.note}`);
            return;
          }
        }
      }

      get().setStatusMessage('Thicken requires an OCC surface body');
    },
  };
}
