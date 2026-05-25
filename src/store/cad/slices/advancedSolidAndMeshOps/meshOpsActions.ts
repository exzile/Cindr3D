import * as THREE from 'three';
import type { Feature } from '../../../../types/cad';
import { GeometryEngine } from '../../../../engine/GeometryEngine';
import { disposeMeshDeferred } from '../../../../engine/occ/picking';
import { requireMesh } from './advancedOpsUtils';
import type { CADSliceContext } from '../../sliceContext';
import type { CADState } from '../../state';

export function createMeshOpsActions({ set, get }: CADSliceContext): Partial<CADState> {
  return {
  // ── MSH1 — Remesh ────────────────────────────────────────────────────────
  commitRemesh: (featureId, mode, iterations) => {
    iterations = Math.min(Math.max(1, Math.round(iterations)), 10);
    const { features } = get();
    const r = requireMesh(features, featureId, 'Remesh', get().setStatusMessage);
    if (!r) return;
    const { srcMesh } = r;
    get().pushUndo();
    const remeshed = GeometryEngine.remesh(srcMesh, mode, iterations);
    remeshed.castShadow = true;
    remeshed.receiveShadow = true;
    const nextFeatures = features.map((f) =>
      f.id === featureId ? { ...f, mesh: remeshed, params: { ...f.params, isRemesh: true, mode, iterations } } : f,
    );
    set({ features: nextFeatures });
    disposeMeshDeferred(srcMesh);
    get().setStatusMessage(`Remesh (${mode}, ${iterations} iter) applied`);
  },

  // ── MSH4 — Erase and Fill ────────────────────────────────────────────────
  commitEraseAndFill: (featureId, faceNormal, faceCentroid) => {
    const { features } = get();
    const r = requireMesh(features, featureId, 'Erase And Fill', get().setStatusMessage);
    if (!r) return;
    const { srcMesh } = r;
    const result = GeometryEngine.removeFaceAndHeal(srcMesh, faceNormal, faceCentroid);
    result.castShadow = true;
    result.receiveShadow = true;
    const nextFeatures = features.map((f) =>
      f.id === featureId
        ? { ...f, mesh: result, params: { ...f.params, featureKind: 'erase-and-fill' } }
        : f,
    );
    set({ features: nextFeatures });
    disposeMeshDeferred(srcMesh);
    get().setStatusMessage('Erase And Fill: face removed and healed');
  },

  // ── MSH6 — Mesh Shell ────────────────────────────────────────────────────
  commitMeshShell: (featureId, thickness, direction) => {
    const { features } = get();
    const r = requireMesh(features, featureId, 'Mesh Shell', get().setStatusMessage);
    if (!r) return;
    const { srcMesh } = r;
    const result = GeometryEngine.shellMesh(srcMesh, thickness, direction);
    result.castShadow = true;
    result.receiveShadow = true;
    const nextFeatures = features.map((f) =>
      f.id === featureId
        ? { ...f, mesh: result, params: { ...f.params, featureKind: 'mesh-shell', thickness, direction } }
        : f,
    );
    set({ features: nextFeatures });
    disposeMeshDeferred(srcMesh);
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
    disposeMeshDeferred(srcMesh);
    get().setStatusMessage(`Mesh Align: "${srcFeature.name}" aligned to "${tgtFeature.name}"`);
  },

  // ── MSH12 — Convert Mesh to BRep ─────────────────────────────────────────
  commitConvertMeshToBRep: (featureId, mode) => {
    const { features } = get();
    const r = requireMesh(features, featureId, 'Convert to BRep', get().setStatusMessage);
    if (!r) return;
    const { srcFeature, srcMesh } = r;
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
    if (resultMesh !== srcMesh) disposeMeshDeferred(srcMesh);
    get().setStatusMessage(`Convert to BRep (${mode}): "${srcFeature.name}" is now a solid body`);
  },
  };
}
