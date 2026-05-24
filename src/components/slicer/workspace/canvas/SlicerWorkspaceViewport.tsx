import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { Canvas, type RootState } from '@react-three/fiber';
import * as THREE from 'three';
import { Check, Box, Loader2, Layers } from 'lucide-react';
import { SlicerWorkspaceScene } from './SlicerWorkspaceScene';
import { SlicerViewportOverlays } from '../overlays/SlicerViewportOverlays';
import { SlicerGCodeDockPanel } from '../overlays/SlicerGCodeDockPanel';
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
  const canvasContextCleanupRef = useRef<(() => void) | null>(null);
  // Incremented to force an unmount+remount of the Canvas when the WebGL
  // context is permanently lost (e.g. in sandboxed environments or after a
  // GPU crash).  Remounting creates a fresh WebGL context.
  const [canvasKey, setCanvasKey] = useState(0);
  const contextLostTimerRef = useRef<number>(0);
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
    canvasContextCleanupRef.current?.();
    canvasContextCleanupRef.current = null;

    // Defer setting ready so one frame paints first.
    if (createdRafRef.current !== null) cancelAnimationFrame(createdRafRef.current);
    createdRafRef.current = requestAnimationFrame(() => {
      createdRafRef.current = null;
      setCanvasReady(true);
    });

    const canvas = state.gl.domElement;

    // In demand mode, context restoration doesn't auto-schedule a new frame.
    const handleContextRestored = () => {
      clearTimeout(contextLostTimerRef.current);
      state.invalidate();
    };
    canvas.addEventListener('webglcontextrestored', handleContextRestored);

    // When the context is lost, give the browser 2 s to restore it on its own
    // (the normal path for GPU crashes / tab backgrounding).  If it hasn't
    // restored by then, bump canvasKey to force a full Canvas remount which
    // creates a brand-new WebGL context.  This keeps the viewport alive in
    // sandboxed environments (like the Claude Preview) where the browser kills
    // contexts aggressively.
    const handleContextLost = (e: Event) => {
      e.preventDefault(); // signal that we want context restoration
      // Show the loading overlay immediately — the canvas is blank right now.
      // Don't wait for the 2 s remount timer; the user sees a blank viewport
      // the instant the context is lost.
      setCanvasReady(false);
      setDismissed(false);
      clearTimeout(contextLostTimerRef.current);
      contextLostTimerRef.current = window.setTimeout(() => {
        // Context still not restored — remount the canvas entirely.
        setCanvasKey((k) => k + 1);
      }, 2000);
    };
    canvas.addEventListener('webglcontextlost', handleContextLost);

    canvasContextCleanupRef.current = () => {
      canvas.removeEventListener('webglcontextrestored', handleContextRestored);
      canvas.removeEventListener('webglcontextlost', handleContextLost);
    };
  }, []);

  useEffect(() => () => {
    if (createdRafRef.current !== null) cancelAnimationFrame(createdRafRef.current);
    canvasContextCleanupRef.current?.();
    canvasContextCleanupRef.current = null;
    clearTimeout(contextLostTimerRef.current);
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

  // When the canvas remounts due to WebGL context recovery (canvasKey > 0),
  // reset dismissed so the loading overlay re-appears and covers the blank
  // period until handleCreated fires for the new canvas.
  useEffect(() => {
    if (canvasKey === 0) return;
    let disposed = false;
    queueMicrotask(() => {
      if (!disposed) setDismissed(false);
    });
    const t = setTimeout(() => setDismissed(true), 2000);
    return () => {
      disposed = true;
      clearTimeout(t);
    };
  }, [canvasKey]);

  const handleSkipLoader = useCallback(() => setDismissed(true), []);

  const showLoader = !dismissed && stage !== 'ready';
  const geomPercent = total === 0 ? 100 : Math.round((ready / total) * 100);

  return (
    <div className="slicer-workspace__viewport">
      {/* Canvas area — flex: 1 so the dock panel below can take its natural height */}
      <div className="slicer-workspace__canvas-area">
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
          key={canvasKey}
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
      <SlicerGCodeDockPanel />
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
