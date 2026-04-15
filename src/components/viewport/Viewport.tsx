import { useRef, useCallback, useState, useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Environment, ContactShadows } from '@react-three/drei';
import * as THREE from 'three';
import { useCADStore } from '../../store/cadStore';
import { useThemeStore } from '../../store/themeStore';
import ViewCube from './ViewCube';
import CanvasControls from './CanvasControls';
import SketchPalette from './SketchPalette';
import MeasurePanel from './MeasurePanel';
import ExtrudeTool from './ExtrudeTool';
import ExtrudePanel from './ExtrudePanel';
import RevolvePanel from './RevolvePanel';
import SweepPanel from './SweepPanel';
import LoftPanel from './LoftPanel';
import RibPanel from './RibPanel';
import SectionAnalysisPanel from './SectionAnalysisPanel';
import SketchPatternPanel from './SketchPatternPanel';
import SketchTransformPanel from './SketchTransformPanel';
import SketchMirrorPanel from './SketchMirrorPanel';
import SceneTheme from './scene/SceneTheme';
import SliceEffect from './scene/SliceEffect';
import SketchRenderer from './scene/SketchRenderer';
import PrimitiveBodies from './scene/PrimitiveBodies';
import ExtrudedBodies from './scene/ExtrudedBodies';
import ImportedModels from './scene/ImportedModels';
import SketchPlaneIndicator from './scene/SketchPlaneIndicator';
import WorldAxes from './scene/WorldAxes';
import SketchPlaneGrid, { GroundPlaneGrid } from './scene/SketchPlaneGrid';
import CameraController from './scene/CameraController';
import ShiftMiddlePan from './interaction/ShiftMiddlePan';
import SketchInteraction from './interaction/SketchInteraction';
import MeasureInteraction from './interaction/MeasureInteraction';
import SketchPlaneSelector from './interaction/SketchPlaneSelector';
import FormInteraction from './FormInteraction';
import FormBodies from './scene/FormBodies';



export default function Viewport() {
  const viewMode = useCADStore((s) => s.viewMode);
  const gridVisible = useCADStore((s) => s.gridVisible);
  const activeSketch = useCADStore((s) => s.activeSketch);
  const showEnvironment = useCADStore((s) => s.showEnvironment);
  const showShadows = useCADStore((s) => s.showShadows);
  const showGroundPlane = useCADStore((s) => s.showGroundPlane);
  const setCameraTargetQuaternion = useCADStore((s) => s.setCameraTargetQuaternion);
  const themeColors = useThemeStore((s) => s.colors);

  // Camera quaternion state shared between the main Canvas and the ViewCube overlay
  const [camQuat, setCamQuat] = useState(() => new THREE.Quaternion());
  const quatRef = useRef(new THREE.Quaternion());

  const handleQuaternionChange = useCallback((q: THREE.Quaternion) => {
    // Only trigger a React re-render ~10 times per second to avoid excessive updates
    if (!quatRef.current.equals(q)) {
      quatRef.current.copy(q);
    }
  }, []);

  // Throttled sync from ref to state for the ViewCube overlay.
  // Uses functional setState so camQuat is NOT needed as a dep — avoids
  // the infinite loop: camQuat change → effect re-runs → new interval → camQuat changes…
  useEffect(() => {
    const id = setInterval(() => {
      setCamQuat((prev) =>
        quatRef.current.equals(prev) ? prev : quatRef.current.clone()
      );
    }, 100);
    return () => clearInterval(id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleViewCubeOrient = useCallback((targetQ: THREE.Quaternion) => {
    setCameraTargetQuaternion(targetQ);
  }, [setCameraTargetQuaternion]);

  return (
    <div style={{ width: '100%', height: '100%', background: themeColors.canvasBg, position: 'relative' }}>
      <Canvas
        shadows={{ type: THREE.PCFShadowMap }}
        camera={{
          position: [50, 50, 50],
          fov: 45,
          near: 0.1,
          far: 10000,
        }}
        gl={{ antialias: true, alpha: false }}
        onCreated={({ gl }) => {
          gl.setClearColor(themeColors.canvasBg);
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.2;
        }}
        onContextMenu={(e) => e.preventDefault()}
      >
        {/* Sync scene background with theme */}
        <SceneTheme />
        {/* D54 Slice clipping plane */}
        <SliceEffect />

        {/* Lighting */}
        <ambientLight intensity={0.4} />
        <directionalLight
          position={[50, 80, 50]}
          intensity={1.2}
          castShadow
          shadow-mapSize={[2048, 2048]}
        />
        <directionalLight position={[-30, 40, -20]} intensity={0.5} />
        <hemisphereLight
          color={themeColors.hemisphereColor}
          groundColor={themeColors.hemisphereGround}
          intensity={0.3}
        />

        {/* Environment */}
        {showEnvironment && <Environment preset="studio" background={false} />}
        {showShadows && showGroundPlane && (
          <ContactShadows
            position={[0, -0.01, 0]}
            opacity={0.3}
            scale={100}
            blur={2}
          />
        )}

        {/* Axis lines — always visible (X=red, Y=blue, Z=green) */}
        <WorldAxes />

        {/* World grid — hidden during active sketch (replaced by sketch-plane grid) */}
        {gridVisible && !activeSketch && <GroundPlaneGrid />}

        {/* Sketch-plane grid — shown only while a sketch is active */}
        {activeSketch && activeSketch.plane !== 'custom' && (
          <SketchPlaneGrid plane={activeSketch.plane} />
        )}
        {activeSketch && activeSketch.plane === 'custom' && (
          <SketchPlaneGrid
            plane="custom"
            customNormal={activeSketch.planeNormal}
            customOrigin={activeSketch.planeOrigin}
          />
        )}

        {/* Plane selection for Create Sketch */}
        <SketchPlaneSelector />

        {/* CAD Content */}
        <SketchRenderer />
        <ExtrudedBodies />
        <PrimitiveBodies />
        <ImportedModels />
        <SketchPlaneIndicator />
        <SketchInteraction />
        <MeasureInteraction />
        <ExtrudeTool />
        <FormBodies />
        <FormInteraction />

        {/* Camera controller — also feeds quaternion to ViewCube */}
        <CameraController onQuaternionChange={handleQuaternionChange} />

        {/* Controls */}
        <OrbitControls
          makeDefault
          enableDamping
          dampingFactor={0.1}
          enabled={true}
          mouseButtons={{
            LEFT: viewMode === 'sketch' ? undefined : THREE.MOUSE.ROTATE,
            MIDDLE: THREE.MOUSE.DOLLY,
            RIGHT: THREE.MOUSE.PAN,
          }}
        />

        {/* Shift + Middle-click pan (in addition to right-click pan) */}
        <ShiftMiddlePan />
      </Canvas>

      {/* ViewCube overlay (top-right) */}
      <ViewCube
        mainCameraQuaternion={camQuat}
        onOrient={handleViewCubeOrient}
        onHome={() => useCADStore.getState().triggerCameraHome()}
      />

      {/* Canvas Controls bar (bottom-right, Fusion 360 style) */}
      <CanvasControls />

      {/* ToolPanel removed — sketch options handled by SketchPalette */}

      {/* Sketch Palette (Fusion 360 style options panel) */}
      <SketchPalette />

      {/* Measure Panel (Fusion 360 style results panel) */}
      <MeasurePanel />

      {/* Extrude Panel (Fusion 360 style properties panel) */}
      <ExtrudePanel />
      <RevolvePanel />
      <SweepPanel />
      <LoftPanel />
      <RibPanel />
      <SectionAnalysisPanel />
      <SketchPatternPanel />
      <SketchTransformPanel />
      <SketchMirrorPanel />
    </div>
  );
}
