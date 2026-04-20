import { useEffect, useMemo, useState, useCallback } from 'react';
import { Canvas } from '@react-three/fiber';
import * as THREE from 'three';
import { Check, Box, Loader2, Layers } from 'lucide-react';
import { SlicerWorkspaceScene } from './SlicerWorkspaceScene';
import { SlicerViewportOverlays } from '../overlays/SlicerViewportOverlays';
import { useSlicerStore } from '../../../../store/slicerStore';

// Granular boot steps shown in the viewport loading overlay.
type Stage = 'hydrate' | 'geometry' | 'canvas' | 'ready';

export function SlicerWorkspaceViewport() {
  const [stage, setStage] = useState<Stage>('hydrate');
  const [hydrated, setHydrated] = useState(() => useSlicerStore.persist.hasHydrated());
  const [canvasReady, setCanvasReady] = useState(false);
  const plateObjects = useSlicerStore((s) => s.plateObjects);

  // Listen for zustand persist finishing IDB rehydration.
  useEffect(() => {
    const unsub = useSlicerStore.persist.onFinishHydration(() => setHydrated(true));
    if (useSlicerStore.persist.hasHydrated()) setHydrated(true);
    return unsub;
  }, []);

  // Geometry readiness: count plateObjects with a valid BufferGeometry.
  // Memoised so we don't rescan every render — `filter().length` over the
  // plate list otherwise runs each time a parent rerenders.
  const total = plateObjects.length;
  const ready = useMemo(
    () => plateObjects.reduce(
      (n, o) => n + (o.geometry instanceof THREE.BufferGeometry ? 1 : 0),
      0,
    ),
    [plateObjects],
  );

  // Derive the current stage.
  useEffect(() => {
    if (!hydrated) { setStage('hydrate'); return; }
    if (total > 0 && ready < total) { setStage('geometry'); return; }
    if (!canvasReady) { setStage('canvas'); return; }
    setStage('ready');
  }, [hydrated, total, ready, canvasReady]);

  const handleCreated = useCallback(() => {
    // Defer setting ready so one frame paints first.
    requestAnimationFrame(() => setCanvasReady(true));
  }, []);

  const showLoader = stage !== 'ready';
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
      <SlicerViewportOverlays />
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
