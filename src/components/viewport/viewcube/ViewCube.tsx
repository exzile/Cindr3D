import './styles/ViewCube.css';
import { useState, useEffect, useCallback } from 'react';
import { Canvas } from '@react-three/fiber';
import { closestFaceLabel } from './constants/defs';
import ViewCubeScene from './scene/ViewCubeScene';
import { HomeIcon, ArrowIcon, OrbitIcon, ZoomFitIcon } from './components/icons';
import type { ViewCubeProps } from '../../../types/view-cube.types';

const orbitCameraEvent = 'cad:orbit-camera';

export default function ViewCube({ mainCameraQuaternion, onOrient, onHome, onZoomFit }: ViewCubeProps) {
  const [label, setLabel] = useState('Front');

  useEffect(() => {
    const l = closestFaceLabel(mainCameraQuaternion);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLabel(l);
  }, [mainCameraQuaternion]);

  // Orbit helpers: rotate the camera position around the current scene target.
  // This is distinct from ViewCube face clicks, which orient to an absolute view.
  const orbitBy = useCallback((axis: 'x' | 'y', angleDeg: number) => {
    window.dispatchEvent(new CustomEvent(orbitCameraEvent, {
      detail: {
        axis: axis === 'y' ? 'world-y' : 'camera-x',
        angleDeg,
      },
    }));
  }, []);

  const spinBy = useCallback((angleDeg: number) => {
    window.dispatchEvent(new CustomEvent(orbitCameraEvent, {
      detail: {
        axis: 'camera-z',
        angleDeg,
      },
    }));
  }, []);

  return (
    <div className="viewcube-wrapper">
      {/* Top row: home + roll/spin CW/CCW */}
      <div className="vc-nav-row vc-nav-top">
        <button className="vc-nav-btn" title="Go Home" onClick={onHome}>
          <HomeIcon />
        </button>
        <div className="vc-nav-spacer" />
        <button className="vc-nav-btn" title="Spin Left" onClick={() => spinBy(15)}>
          <OrbitIcon rotation={0} />
        </button>
        <button className="vc-nav-btn" title="Spin Right" onClick={() => spinBy(-15)}>
          <OrbitIcon rotation={180} />
        </button>
      </div>

      {/* Middle row: left arrows, cube, right arrows */}
      <div className="vc-nav-row vc-nav-middle">
        <div className="vc-nav-col">
          <button className="vc-nav-btn" title="Orbit Up" onClick={() => orbitBy('x', 15)}>
            <ArrowIcon rotation={0} />
          </button>
          <button className="vc-nav-btn" title="Orbit Down" onClick={() => orbitBy('x', -15)}>
            <ArrowIcon rotation={180} />
          </button>
        </div>

        <div className="viewcube-container">
          <Canvas
            orthographic
            frameloop="demand"
            camera={{ zoom: 22, near: 0.1, far: 100, position: [0, 0, 5] }}
            style={{ width: 140, height: 140, background: 'transparent' }}
            gl={{ alpha: true, antialias: true }}
          >
            <ViewCubeScene
              mainCameraQuaternion={mainCameraQuaternion}
              onOrient={onOrient}
            />
          </Canvas>
        </div>

        <div className="vc-nav-col">
          <button className="vc-nav-btn" title="Orbit Left" onClick={() => orbitBy('y', 15)}>
            <ArrowIcon rotation={-90} />
          </button>
          <button className="vc-nav-btn" title="Orbit Right" onClick={() => orbitBy('y', -15)}>
            <ArrowIcon rotation={90} />
          </button>
        </div>
      </div>

      {/* Bottom row: zoom fit + label */}
      <div className="vc-nav-row vc-nav-bottom">
        <button className="vc-nav-btn" title="Zoom to Fit" onClick={onZoomFit}>
          <ZoomFitIcon />
        </button>
        <div className="viewcube-label">{label}</div>
      </div>
    </div>
  );
}
