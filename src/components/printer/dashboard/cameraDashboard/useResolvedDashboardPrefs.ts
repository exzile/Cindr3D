/**
 * useResolvedDashboardPrefs — composes the four memoized "what does the
 * dashboard see right now?" derivations off the active printer:
 *
 *   • basePrefs      — DEFAULT_PREFS ⊕ global getDuetPrefs() ⊕ printer prefs
 *   • cameras        — only the enabled camera entries
 *   • prefs          — basePrefs with activeCameraId guaranteed to resolve to
 *                      a real entry (prefsWithCamera)
 *   • activeCamera   — resolved active camera (active id, then first enabled,
 *                      then first declared) — may still be undefined when no
 *                      cameras are configured
 *   • dashboardPrefs — DEFAULT_CAMERA_DASHBOARD_PREFS ⊕ stored printer entry
 *                      (or legacy localStorage fall-back when no printer
 *                      entry exists yet)
 *
 * Hoisting the chain out of the host removes ~25 lines of memo wiring from
 * the panel and keeps the precedence rules in one place.
 */
import { useMemo } from 'react';
import {
  DEFAULT_CAMERA_DASHBOARD_PREFS,
  DEFAULT_PREFS,
  getDuetPrefs,
  type CameraDashboardPrefs,
  type DuetPrefs,
} from '../../../../utils/duetPrefs';
import { enabledCamerasFromPrefs, prefsWithCamera } from '../../../../utils/cameraStreamUrl';
import type { SavedPrinter } from '../../../../types/duet';
import { loadCameraDashboardPrefs, loadCameraPresets } from './prefsStorage';

export function useResolvedDashboardPrefs(activePrinter: SavedPrinter | undefined) {
  const basePrefs = useMemo<DuetPrefs>(() => ({
    ...DEFAULT_PREFS,
    ...getDuetPrefs(),
    ...(activePrinter?.prefs as Partial<DuetPrefs> | undefined),
  }), [activePrinter]);

  const cameras = useMemo(() => enabledCamerasFromPrefs(basePrefs), [basePrefs]);

  const prefs = useMemo<DuetPrefs>(
    () => prefsWithCamera(basePrefs, basePrefs.activeCameraId),
    [basePrefs],
  );

  const activeCamera = useMemo(() => (
    prefs.cameras.find((camera) => camera.id === prefs.activeCameraId)
    ?? cameras[0]
    ?? prefs.cameras[0]
  ), [cameras, prefs.activeCameraId, prefs.cameras]);

  const dashboardPrefs = useMemo<CameraDashboardPrefs>(() => {
    const printerPrefs = activePrinter?.prefs as Partial<DuetPrefs> | undefined;
    const storedDashboardPrefs = printerPrefs?.cameraDashboard;
    return {
      ...DEFAULT_CAMERA_DASHBOARD_PREFS,
      ...(storedDashboardPrefs ? {} : loadCameraDashboardPrefs()),
      ...storedDashboardPrefs,
      calibration: {
        ...DEFAULT_CAMERA_DASHBOARD_PREFS.calibration,
        ...(storedDashboardPrefs?.calibration ?? {}),
      },
      cameraPresets: storedDashboardPrefs?.cameraPresets ?? (storedDashboardPrefs ? [] : loadCameraPresets()),
    };
  }, [activePrinter]);

  return { basePrefs, cameras, prefs, activeCamera, dashboardPrefs };
}
