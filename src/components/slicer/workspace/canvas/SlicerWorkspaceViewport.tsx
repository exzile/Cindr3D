import { useState, useCallback } from 'react';
import { Canvas } from '@react-three/fiber';
import { SlicerWorkspaceScene } from './SlicerWorkspaceScene';
import { SlicerViewportOverlays } from '../overlays/SlicerViewportOverlays';
import { useSlicerStore } from '../../../../store/slicerStore';

export function SlicerWorkspaceViewport() {
  const [ready, setReady] = useState(false);
  const plateObjects = useSlicerStore((s) => s.plateObjects);

  const handleCreated = useCallback(() => {
    setReady(true);
  }, []);

  const modelCount = plateObjects.length;

  return (
    <div className="slicer-workspace__viewport">
      {!ready && (
        <div className="slicer-viewport-loading">
          <div className="slicer-viewport-loading__spinner" />
          <div className="slicer-viewport-loading__text">Initializing 3D viewport…</div>
          {modelCount > 0 && (
            <div className="slicer-viewport-loading__sub">
              Loading {modelCount} model{modelCount !== 1 ? 's' : ''}
            </div>
          )}
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
