import { useState, useEffect, useCallback } from 'react';
import { Canvas } from '@react-three/fiber';
import * as THREE from 'three';
import { closestFaceLabel } from './viewcube/defs';
import ViewCubeScene from './viewcube/ViewCubeScene';
import { HomeIcon, ArrowIcon, OrbitIcon, ZoomFitIcon } from './viewcube/icons';

interface ViewCubeProps {
  /** Quaternion from the main camera, updated every frame */
  mainCameraQuaternion: THREE.Quaternion;
  /** Called when the user clicks a face/edge/corner to request a new orientation */
  onOrient: (targetQuaternion: THREE.Quaternion) => void;
  /** Go to home view */
  onHome?: () => void;
  /** Zoom to fit all objects */
  onZoomFit?: () => void;
}

export default function ViewCube({ mainCameraQuaternion, onOrient, onHome, onZoomFit }: ViewCubeProps) {
  const [label, setLabel] = useState('Front');

  useEffect(() => {
    const l = closestFaceLabel(mainCameraQuaternion);
    setLabel(l);
  }, [mainCameraQuaternion]);

  // Orbit helpers: rotate the current camera orientation by a small angle
  const orbitBy = useCallback((axis: 'x' | 'y', angleDeg: number) => {
    const angle = (angleDeg * Math.PI) / 180;
    const rotQ = new THREE.Quaternion();
    if (axis === 'y') {
      rotQ.setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle);
    } else {
      // Rotate around the camera's local X axis
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(mainCameraQuaternion);
      rotQ.setFromAxisAngle(right, angle);
    }
    const newQ = rotQ.clone().multiply(mainCameraQuaternion);
    onOrient(newQ);
  }, [mainCameraQuaternion, onOrient]);

  return (
    <div className="viewcube-wrapper">
      {/* Top row: home + orbit CW/CCW */}
      <div className="vc-nav-row vc-nav-top">
        <button className="vc-nav-btn" title="Go Home" onClick={onHome}>
          <HomeIcon />
        </button>
        <div className="vc-nav-spacer" />
        <button className="vc-nav-btn" title="Orbit Left" onClick={() => orbitBy('y', 15)}>
          <OrbitIcon rotation={0} />
        </button>
        <button className="vc-nav-btn" title="Orbit Right" onClick={() => orbitBy('y', -15)}>
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
