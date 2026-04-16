import { Canvas } from '@react-three/fiber';
import { SlicerWorkspaceScene } from './SlicerWorkspaceScene';
import { SlicerViewportOverlays } from '../overlays/SlicerViewportOverlays';

export function SlicerWorkspaceViewport() {
  return (
    <div className="slicer-workspace__viewport">
      <Canvas
        className="slicer-workspace__canvas"
        camera={{ position: [300, -200, 250], fov: 45, near: 1, far: 10000, up: [0, 0, 1] }}
      >
        <SlicerWorkspaceScene />
      </Canvas>
      <SlicerViewportOverlays />
    </div>
  );
}
