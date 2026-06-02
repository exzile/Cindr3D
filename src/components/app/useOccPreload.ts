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
  const bodyRestoreRef = useRef(false);
  const warmedRef = useRef(false);

  // Restore OCC BReps for any document that loads with bodies. Registered BEFORE
  // the warm-up getOcc() below so it's tracked as a step in the loading modal.
  // (registerOccPostLoadTask runs immediately if OCC is already loaded.)
  useEffect(() => {
    if (bodyRestoreRef.current || !hasVisibleSolidMesh(features)) return;
    bodyRestoreRef.current = true;

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
  }, [features]);

  // Warm the OCC kernel once at app start, regardless of whether the document
  // has any bodies yet. This shows the loading modal at boot and guarantees the
  // kernel is ready before any tool (Sweep, Extrude, Fillet, …) needs it — so a
  // tool never silently fails on a cold kernel in a fresh/empty document.
  useEffect(() => {
    if (warmedRef.current) return;
    warmedRef.current = true;
    void getOcc().then(() => {
      void import('../../app/ActiveDialog');
      void import('../dialogs/ExportDialog');
    });
  }, []);
}
