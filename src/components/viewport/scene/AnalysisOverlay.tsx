import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useCADStore } from '../../../store/cadStore';
import { useComponentStore } from '../../../store/componentStore';
import {
  buildAccessibility,
  buildCurvatureComb,
  buildCurvatureMap,
  buildDraft,
  buildIsocurve,
  buildMinRadius,
  buildZebra,
  type AnalysisType,
} from './analysisOverlay/builders';

type VisibleBody = { mesh?: THREE.Mesh | THREE.Group | null; visible: boolean };
type VisibleFeature = { mesh?: THREE.Mesh; visible: boolean; suppressed?: boolean };

function collectBodyMeshes(bodies: Record<string, VisibleBody>): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  for (const body of Object.values(bodies)) {
    if (!body.visible || !body.mesh) continue;
    if (body.mesh instanceof THREE.Mesh) {
      out.push(body.mesh);
      continue;
    }
    if (body.mesh instanceof THREE.Group) {
      body.mesh.traverse((child) => {
        if (child instanceof THREE.Mesh) out.push(child);
      });
    }
  }
  return out;
}

function collectFeatureMeshes(features: VisibleFeature[]): THREE.Mesh[] {
  return features
    .filter((feature) => feature.visible && !feature.suppressed && feature.mesh instanceof THREE.Mesh)
    .map((feature) => feature.mesh as THREE.Mesh);
}

export default function AnalysisOverlay() {
  const activeAnalysis = useCADStore((state) => state.activeAnalysis);
  const analysisParams = useCADStore((state) => state.analysisParams);
  const cadFeatures = useCADStore((state) => state.features);
  const bodies = useComponentStore((state) => state.bodies);

  const allMeshes = useMemo(() => {
    const seen = new Set<THREE.Mesh>();
    for (const mesh of [
      ...collectFeatureMeshes(cadFeatures as VisibleFeature[]),
      ...collectBodyMeshes(bodies as Record<string, VisibleBody>),
    ]) {
      seen.add(mesh);
    }
    return Array.from(seen);
  }, [cadFeatures, bodies]);

  const paramsKey = `${activeAnalysis}|${JSON.stringify(analysisParams)}`;
  const result = useMemo(() => {
    if (!activeAnalysis || allMeshes.length === 0) return null;
    switch (activeAnalysis as AnalysisType) {
      case 'zebra':
        return buildZebra(allMeshes, analysisParams);
      case 'draft':
        return buildDraft(allMeshes, analysisParams);
      case 'curvature-map':
        return buildCurvatureMap(allMeshes);
      case 'isocurve':
        return buildIsocurve(allMeshes, analysisParams);
      case 'accessibility':
        return buildAccessibility(allMeshes, analysisParams);
      case 'min-radius':
        return buildMinRadius(allMeshes, analysisParams);
      case 'curvature-comb':
        return buildCurvatureComb(allMeshes, analysisParams);
      default:
        return null;
    }
  // paramsKey encodes activeAnalysis + full params; allMeshes changes when bodies change
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramsKey, allMeshes]);

  useEffect(() => () => { result?.dispose(); }, [result]);

  if (!result || result.objects.length === 0) return null;
  return (
    <>
      {result.objects.map((object, index) => (
        <primitive key={index} object={object} />
      ))}
    </>
  );
}
