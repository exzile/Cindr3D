import { useEffect, useRef } from 'react';
import type { Feature } from '../../types/cad';
import { getOcc, registerOccPostLoadTask } from '../../engine/occ/loader';
import { useCADStore } from '../../store/cadStore';
import { ensureOccBodyForFeature } from '../../store/cad/slices/extrudeRevolve/extrudeCommitOccTarget';

function hasVisibleSolidMesh(features: Feature[]) {
  return features.some(
    (feature) =>
      feature.visible &&
      !feature.suppressed &&
      feature.type !== 'sketch' &&
      feature.mesh != null,
  );
}

export function useOccPreload() {
  const features = useCADStore((s) => s.features);
  const occPreloadedRef = useRef(false);

  useEffect(() => {
    if (occPreloadedRef.current || !hasVisibleSolidMesh(features)) return;
    occPreloadedRef.current = true;

    registerOccPostLoadTask(async () => {
      const { features: latestFeatures, sketches } = useCADStore.getState();
      const candidates = latestFeatures.filter(
        (feature) =>
          feature.visible &&
          !feature.suppressed &&
          feature.type !== 'sketch' &&
          feature.mesh != null,
      );
      await Promise.all(
        candidates.map((feature) => ensureOccBodyForFeature(feature, latestFeatures, sketches)),
      );
    }, 'Restoring bodies');

    void getOcc().then(() => {
      void import('../../app/ActiveDialog');
      void import('../dialogs/ExportDialog');
    });
  }, [features]);
}
