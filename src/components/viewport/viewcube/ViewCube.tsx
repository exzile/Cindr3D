import './styles/ViewCube.css';
import { useState, useEffect, useCallback, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { Canvas } from '@react-three/fiber';
import { closestFaceLabel, orientationQuaternion } from './constants/defs';
import ViewCubeScene from './scene/ViewCubeScene';
import { HomeIcon, ArrowIcon, OrbitIcon, ZoomFitIcon } from './components/icons';
import type { ViewCubeProps } from '../../../types/view-cube.types';
import { useCADStore } from '../../../store/cadStore';

const orbitCameraEvent = 'cad:orbit-camera';
const setCurrentViewHomeEvent = 'cad:set-current-view-home';
const DRAG_THRESHOLD_PX = 3;

function actionLabel(action: string) {
  return action.toUpperCase();
}

export default function ViewCube({ mainCameraQuaternion, onOrient, onHome, onZoomFit }: ViewCubeProps) {
  const cameraProjection = useCADStore((s) => s.cameraProjection);
  const setCameraProjection = useCADStore((s) => s.setCameraProjection);
  const [label, setLabel] = useState('Front');
  const [previewLabel, setPreviewLabel] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const dragStateRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    moved: boolean;
  } | null>(null);

  useEffect(() => {
    const l = closestFaceLabel(mainCameraQuaternion);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLabel(l);
  }, [mainCameraQuaternion]);

  useEffect(() => {
    if (!menuOpen) return;
    const closeMenu = () => setMenuOpen(false);
    window.addEventListener('pointerdown', closeMenu);
    window.addEventListener('keydown', closeMenu);
    return () => {
      window.removeEventListener('pointerdown', closeMenu);
      window.removeEventListener('keydown', closeMenu);
    };
  }, [menuOpen]);

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

  const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    dragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      moved: false,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }, []);

  const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;

    const totalDx = event.clientX - dragState.startX;
    const totalDy = event.clientY - dragState.startY;
    if (!dragState.moved && Math.hypot(totalDx, totalDy) < DRAG_THRESHOLD_PX) return;

    dragState.moved = true;
    setDragging(true);
    const dx = event.clientX - dragState.lastX;
    const dy = event.clientY - dragState.lastY;
    dragState.lastX = event.clientX;
    dragState.lastY = event.clientY;

    if (Math.abs(dx) > 0.1) {
      orbitBy('y', -dx * 0.35);
    }
    if (Math.abs(dy) > 0.1) {
      orbitBy('x', -dy * 0.35);
    }
  }, [orbitBy]);

  const endDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    dragStateRef.current = null;
    window.setTimeout(() => setDragging(false), 0);
  }, []);

  const orientPreset = useCallback((direction: [number, number, number], up: [number, number, number]) => {
    onOrient(orientationQuaternion(direction, up));
    setMenuOpen(false);
  }, [onOrient]);

  const toggleProjection = useCallback(() => {
    setCameraProjection(cameraProjection === 'perspective' ? 'orthographic' : 'perspective');
    setMenuOpen(false);
  }, [cameraProjection, setCameraProjection]);

  const setProjection = useCallback((projection: 'perspective' | 'orthographic') => {
    setCameraProjection(projection);
    setMenuOpen(false);
  }, [setCameraProjection]);

  const displayLabel = previewLabel ?? label;

  return (
    <div
      className={`viewcube-wrapper ${dragging ? 'is-dragging' : ''}`}
      onContextMenu={(event) => {
        event.preventDefault();
        setMenuOpen((open) => !open);
      }}
    >
      {/* Top row: home + roll/spin CW/CCW */}
      <div className="vc-nav-row vc-nav-top">
        <button className="vc-nav-btn vc-nav-btn-secondary" type="button" aria-label="Go home" data-tooltip="Home view" onClick={onHome}>
          <HomeIcon />
        </button>
        <div className="vc-nav-spacer" />
        <div className="vc-nav-cluster" aria-label="Roll view">
          <button className="vc-nav-btn" type="button" aria-label="Spin left 15 degrees" data-tooltip="Spin left 15 deg" onClick={() => spinBy(15)}>
            <OrbitIcon rotation={0} />
          </button>
          <button className="vc-nav-btn" type="button" aria-label="Spin right 15 degrees" data-tooltip="Spin right 15 deg" onClick={() => spinBy(-15)}>
            <OrbitIcon rotation={180} />
          </button>
        </div>
      </div>

      {/* Middle row: left arrows, cube, right arrows */}
      <div className="vc-nav-row vc-nav-middle">
        <div className="vc-nav-col">
          <button className="vc-nav-btn" type="button" aria-label="Orbit up" data-tooltip="Orbit up" onClick={() => orbitBy('x', 15)}>
            <ArrowIcon rotation={0} />
          </button>
          <button className="vc-nav-btn" type="button" aria-label="Orbit down" data-tooltip="Orbit down" onClick={() => orbitBy('x', -15)}>
            <ArrowIcon rotation={180} />
          </button>
        </div>

        <div
          className="viewcube-container"
          aria-label="View cube. Drag to orbit, click faces edges or corners to snap view, double click for home view."
          data-tooltip="Drag to orbit. Click to snap. Double-click Home."
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onDoubleClick={(event) => {
            event.stopPropagation();
            onHome?.();
          }}
        >
          <div className="viewcube-glow" />
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
              onPreviewLabel={setPreviewLabel}
              dragSuppressed={dragging}
            />
          </Canvas>
        </div>

        <div className="vc-nav-col">
          <button className="vc-nav-btn" type="button" aria-label="Orbit left" data-tooltip="Orbit left" onClick={() => orbitBy('y', 15)}>
            <ArrowIcon rotation={-90} />
          </button>
          <button className="vc-nav-btn" type="button" aria-label="Orbit right" data-tooltip="Orbit right" onClick={() => orbitBy('y', -15)}>
            <ArrowIcon rotation={90} />
          </button>
        </div>
      </div>

      {/* Bottom row: zoom fit + label */}
      <div className="vc-nav-row vc-nav-bottom">
        <button className="vc-nav-btn vc-nav-btn-secondary" type="button" aria-label="Zoom to fit" data-tooltip="Fit visible geometry" onClick={onZoomFit}>
          <ZoomFitIcon />
        </button>
        <div className={`viewcube-label ${previewLabel ? 'is-preview' : ''}`}>{actionLabel(displayLabel)}</div>
      </div>
      {menuOpen && (
        <div
          className="viewcube-menu"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button type="button" onClick={() => { onHome?.(); setMenuOpen(false); }}>Home</button>
          <button type="button" onClick={() => { onZoomFit?.(); setMenuOpen(false); }}>Fit</button>
          <span />
          <button type="button" onClick={() => orientPreset([0, 1, 0], [0, 0, -1])}>Top</button>
          <button type="button" onClick={() => orientPreset([0, 0, 1], [0, 1, 0])}>Front</button>
          <button type="button" onClick={() => orientPreset([1, 0, 0], [0, 1, 0])}>Right</button>
          <span />
          <button
            type="button"
            className={cameraProjection === 'perspective' ? 'is-active' : ''}
            onClick={() => setProjection('perspective')}
          >
            <span className="viewcube-menu-check" aria-hidden="true" />
            Perspective
          </button>
          <button
            type="button"
            className={cameraProjection === 'orthographic' ? 'is-active' : ''}
            onClick={() => setProjection('orthographic')}
          >
            <span className="viewcube-menu-check" aria-hidden="true" />
            Orthographic
          </button>
          <button type="button" onClick={toggleProjection}>Toggle projection</button>
          <button
            type="button"
            onClick={() => {
              window.dispatchEvent(new CustomEvent(setCurrentViewHomeEvent));
              setMenuOpen(false);
            }}
          >
            Set Current as Home
          </button>
        </div>
      )}
    </div>
  );
}
