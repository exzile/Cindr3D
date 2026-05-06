import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { Canvas, type RootState } from '@react-three/fiber';
import * as THREE from 'three';
import { Check, Box, Loader2, Layers } from 'lucide-react';
import { SlicerWorkspaceScene } from './SlicerWorkspaceScene';
import { SlicerViewportOverlays } from '../overlays/SlicerViewportOverlays';
import { SlicerColorSchemePanel } from '../overlays/SlicerColorSchemePanel';
import { SlicerPreviewCanvasControls } from '../overlays/SlicerPreviewCanvasControls';
import { CameraPresets } from '../overlays/CameraPresets';
import { PickToolsOverlay } from '../overlays/PickToolsOverlay';
import { useSlicerStore } from '../../../../store/slicerStore';

// Granular boot steps shown in the viewport loading overlay.
type Stage = 'hydrate' | 'geometry' | 'canvas' | 'ready';

export function SlicerWorkspaceViewport() {
  const [hydrated, setHydrated] = useState(() => useSlicerStore.persist.hasHydrated());
  const [canvasReady, setCanvasReady] = useState(false);
  const createdRafRef = useRef<number | null>(null);
  // User- or timeout-forced dismissal. Wins over every other condition so the
  // overlay can never trap the user even if the Canvas `onCreated` never fires
  // (WebGL context failure, silent error inside the scene, etc.).
  const [dismissed, setDismissed] = useState(false);
  const plateObjects = useSlicerStore((s) => s.plateObjects);
  const previewMode = useSlicerStore((s) => s.previewMode);
  const colorSchemeOpen = useSlicerStore((s) => s.previewColorSchemeOpen);

  // Listen for zustand persist finishing IDB rehydration.
  useEffect(() => {
    return useSlicerStore.persist.onFinishHydration(() => setHydrated(true));
  }, []);

  // Geometry readiness: count plateObjects that don't need any further work.
  // An object is "ready" when its geometry is a live BufferGeometry OR when
  // it's explicitly `null` — the latter can happen when the source CAD
  // feature was deleted before the plate was serialized. We still keep the
  // row so the user can re-add geometry, but we must not hang the loader
  // waiting for a rehydration that will never come.
  // Memoised so we don't rescan every render — `filter().length` over the
  // plate list otherwise runs each time a parent rerenders.
  const total = plateObjects.length;
  const ready = useMemo(
    () => plateObjects.reduce(
      (n, o) => n + (o.geometry instanceof THREE.BufferGeometry || o.geometry == null ? 1 : 0),
      0,
    ),
    [plateObjects],
  );

  const stage: Stage = useMemo(() => {
    if (!hydrated) return 'hydrate';
    if (total > 0 && ready < total) return 'geometry';
    if (!canvasReady) return 'canvas';
    return 'ready';
  }, [hydrated, total, ready, canvasReady]);

  const handleCreated = useCallback((state: RootState) => {
    // Defer setting ready so one frame paints first.
    if (createdRafRef.current !== null) cancelAnimationFrame(createdRafRef.current);
    createdRafRef.current = requestAnimationFrame(() => {
      createdRafRef.current = null;
      setCanvasReady(true);
    });
    // In demand mode, context restoration doesn't auto-schedule a new frame.
    // Without this, a context-loss/restore cycle leaves the canvas blank until
    // something else calls invalidate() (e.g. navigating away and back).
    state.gl.domElement.addEventListener('webglcontextrestored', () => state.invalidate());
  }, []);

  useEffect(() => () => {
    if (createdRafRef.current !== null) cancelAnimationFrame(createdRafRef.current);
  }, []);

  // Absolute safety net: no matter what stage we're on, force the loader to
  // dismiss itself after 2 seconds. onCreated can silently never fire if the
  // scene throws, if WebGL context creation fails, or if the canvas is
  // mounted while the tab is backgrounded. The user should be able to see
  // the workspace in all those cases — an error in the scene is far more
  // diagnosable than a frozen spinner.
  useEffect(() => {
    const t = setTimeout(() => setDismissed(true), 2000);
    return () => clearTimeout(t);
  }, []);

  const handleSkipLoader = useCallback(() => setDismissed(true), []);

  const showLoader = !dismissed && stage !== 'ready';
  const geomPercent = total === 0 ? 100 : Math.round((ready / total) * 100);

  return (
    <div className="slicer-workspace__viewport">
      {showLoader && (
        <div className="slicer-viewport-loading" role="status" aria-live="polite">
          <div className="slicer-viewport-loading__panel">
            <div className="slicer-viewport-loading__spinner" />
            <div className="slicer-viewport-loading__title">
              Preparing your build plate
            </div>
            <ul className="slicer-viewport-loading__steps">
              <Step
                icon={<Layers size={12} />}
                label="Restoring saved plate"
                state={hydrated ? 'done' : 'active'}
              />
              <Step
                icon={<Box size={12} />}
                label={total === 0
                  ? 'No saved models'
                  : `Parsing geometries (${ready}/${total})`}
                state={!hydrated
                  ? 'pending'
                  : (total === 0 || ready >= total) ? 'done' : 'active'}
                progress={total > 0 && ready < total ? geomPercent : undefined}
              />
              <Step
                icon={<Loader2 size={12} />}
                label="Initializing 3D viewport"
                state={stage === 'canvas' ? 'active' : (canvasReady ? 'done' : 'pending')}
              />
            </ul>
            <button
              type="button"
              className="slicer-viewport-loading__skip"
              onClick={handleSkipLoader}
              title="Dismiss this overlay and enter the workspace"
            >
              Skip
            </button>
          </div>
        </div>
      )}
      <Canvas
        className="slicer-workspace__canvas"
        camera={{ position: [300, -200, 250], fov: 45, near: 1, far: 10000, up: [0, 0, 1] }}
        frameloop="demand"
        onCreated={handleCreated}
      >
        <SlicerWorkspaceScene />
      </Canvas>
      <CameraPresets />
      {previewMode === 'model' && <PickToolsOverlay />}
      <SlicerViewportOverlays />
      <SlicerPreviewCanvasControls />
      {previewMode === 'preview' && colorSchemeOpen && <SlicerColorSchemePanel />}
    </div>
  );
}

function Step({
  icon, label, state, progress,
}: {
  icon: React.ReactNode;
  label: string;
  state: 'pending' | 'active' | 'done';
  progress?: number;
}) {
  return (
    <li className={`slicer-viewport-loading__step is-${state}`}>
      <span className="slicer-viewport-loading__step-dot">
        {state === 'done' ? <Check size={12} />
          : state === 'active' ? <span className="slicer-viewport-loading__dot-spin" />
          : icon}
      </span>
      <span className="slicer-viewport-loading__step-label">{label}</span>
      {typeof progress === 'number' && state === 'active' && (
        <span className="slicer-viewport-loading__step-bar">
          <span
            className="slicer-viewport-loading__step-bar-fill"
            style={{ width: `${progress}%` }}
          />
        </span>
      )}
    </li>
  );
}
