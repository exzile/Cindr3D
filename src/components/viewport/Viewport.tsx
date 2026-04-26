import "./overlays/ViewportOverlay.css";
import { useCallback } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Environment, ContactShadows } from '@react-three/drei';
import type { PresetsType } from '@react-three/drei/helpers/environment-assets';
import * as THREE from 'three';
import { useCADStore } from '../../store/cadStore';
import { useThemeStore } from '../../store/themeStore';
import { EnvErrorBoundary } from './EnvErrorBoundary';
import ExtrudeTool from './tools/ExtrudeTool';
import RevolveTool from './tools/RevolveTool';
import SceneTheme from './scene/SceneTheme';
import SceneInvalidator from './scene/SceneInvalidator';
import VisualStyleEffect from './scene/VisualStyleEffect';
import SliceEffect from './scene/SliceEffect';
import SketchRenderer from './scene/SketchRenderer';
import SketchConstraintOverlay from './scene/SketchConstraintOverlay';
import SketchDimensionAnnotations from './scene/SketchDimensionAnnotations';
import SketchSplineHandles from './scene/SketchSplineHandles';
import PrimitiveBodies from './scene/PrimitiveBodies';
import FastenerBodies from './scene/FastenerBodies';
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
import FormInteraction from './interaction/FormInteraction';
import FormBodies from './scene/FormBodies';
import JointGizmos from './scene/JointGizmos';
import JointAnimationPlayer from './scene/JointAnimationPlayer';
import SketchPlaneDragger from './sketch/SketchPlaneDragger';
import Sketch3DPlaneIndicator from './sketch/Sketch3DPlaneIndicator';
import FilletEdgeHighlight from './scene/FilletEdgeHighlight';
import ChamferEdgeHighlight from './scene/ChamferEdgeHighlight';
import ConstructionGeometryInteraction from './scene/ConstructionGeometryInteraction';
import ConstructionGeometryRenderer from './scene/ConstructionGeometryRenderer';
import ReplaceFaceInteraction from './scene/ReplaceFaceInteraction';
import DirectEditFacePicker from './scene/DirectEditFacePicker';
import TextureExtrudeFacePicker from './scene/TextureExtrudeFacePicker';
import DecalFacePicker from './scene/DecalFacePicker';
import SplitFacePicker from './scene/SplitFacePicker';
import HoleFacePicker from './scene/HoleFacePicker';
import ShellFacePicker from './scene/ShellFacePicker';
import RemoveFacePicker from './scene/RemoveFacePicker';
import DraftPartingLinePicker from './scene/DraftPartingLinePicker';
import MeshExporter from './scene/MeshExporter';
import SnapFitFacePicker from './scene/SnapFitFacePicker';
import LipGrooveEdgePicker from './scene/LipGrooveEdgePicker';
import ExtrudeToEntityPicker from './scene/ExtrudeToEntityPicker';
import ExtrudeStartEntityPicker from './scene/ExtrudeStartEntityPicker';
import AnalysisOverlay from './scene/AnalysisOverlay';
import JointOriginPicker from './scene/JointOriginPicker';
import JointOriginRenderer from './scene/JointOriginRenderer';
import CameraProjectionSwitcher from './scene/CameraProjectionSwitcher';
import LookAtInteraction from './scene/LookAtInteraction';
import { EffectComposer, SSAO } from '@react-three/postprocessing';
import MultiViewCanvas from './multiview/MultiViewCanvas';
import { ViewportPanels } from './ViewportPanels';
import { ViewportOverlays } from './ViewportOverlays';
import { useViewCubeQuaternion } from './hooks/useViewCubeQuaternion';
import { useWindowLassoSelection } from './hooks/useWindowLassoSelection';



/** Module-level singleton — passed to SSAO to avoid per-render Color allocation. */
const SSAO_COLOR = new THREE.Color('black');

/** Scratch objects for window/lasso selection — avoids per-feature allocations on pointer-up. */

/**
 * AUDIT-17: Module-level scratch quaternions — alternated each tick to avoid
 * allocating a new THREE.Quaternion on every camera-movement interval tick.
 * React detects the state change because the object reference alternates between
 * _quatA and _quatB, so it always sees a different reference when the camera moves.
 */

/** Standard ray-casting point-in-polygon test (screen-space pixels). */
export default function Viewport() {
  const viewMode = useCADStore((s) => s.viewMode);
  const cameraNavMode = useCADStore((s) => s.cameraNavMode);
  const gridVisible = useCADStore((s) => s.gridVisible);
  const activeSketch = useCADStore((s) => s.activeSketch);
  const showReflections = useCADStore((s) => s.showReflections);
  const environmentPreset = useCADStore((s) => s.environmentPreset) as PresetsType;
  const showShadows = useCADStore((s) => s.showShadows);
  const showGroundPlane = useCADStore((s) => s.showGroundPlane);
  const groundPlaneOffset = useCADStore((s) => s.groundPlaneOffset);
  const shadowSoftness = useCADStore((s) => s.shadowSoftness);
  const ambientOcclusionEnabled = useCADStore((s) => s.ambientOcclusionEnabled);
  const setCameraTargetQuaternion = useCADStore((s) => s.setCameraTargetQuaternion);
  const themeColors = useThemeStore((s) => s.colors);

  // D204/D205 — Window & Lasso selection
  // D207
  const sketchGridEnabled = useCADStore((s) => s.sketchGridEnabled);
  // NAV-19 multi-viewport layout
  const viewportLayout = useCADStore((s) => s.viewportLayout);

  // Drag-state refs (avoid stale closures in pointer handlers)
  // Tracks where the right mouse button was pressed so onContextMenu can
  // distinguish "click to open menu" from "drag to pan" — we only want the
  // context menu on a stationary right-click, not after a right-drag pan.
  // Window/lasso select needs the live camera for screen-space projection.
  // Captured in Canvas.onCreated so it's available to pointerUp handlers.
  const { camQuat, handleQuaternionChange } = useViewCubeQuaternion();
  const {
    cameraRef,
    containerRef,
    handleContextMenu,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    setViewportCtxMenu,
    viewportCtxMenu,
  } = useWindowLassoSelection();

    // Only trigger a React re-render ~10 times per second to avoid excessive updates

  // Throttled sync from ref to state for the ViewCube overlay.
  // Uses functional setState so camQuat is NOT needed as a dep — avoids
  // the infinite loop: camQuat change → effect re-runs → new interval → camQuat changes…
  // AUDIT-17: alternates between two module-level scratch quaternions instead of
  // cloning a new one each tick, eliminating ~10 allocations/sec during camera movement.

  const handleViewCubeOrient = useCallback((targetQ: THREE.Quaternion) => {
    setCameraTargetQuaternion(targetQ);
  }, [setCameraTargetQuaternion]);
  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '100%', background: themeColors.canvasBg, position: 'relative' }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      <div style={{ width: '100%', height: '100%', display: viewportLayout === '1' ? 'block' : 'none' }}>
      <Canvas
        frameloop="demand"
        shadows={{ type: THREE.PCFShadowMap }}
        camera={{
          position: [50, 50, 50],
          fov: 45,
          near: 0.1,
          far: 10000,
        }}
        gl={{ antialias: true, alpha: false }}
        onCreated={({ gl, camera }) => {
          gl.setClearColor(themeColors.canvasBg);
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.2;
          // Expose camera to DOM-level pointer handlers for window/lasso selection
          cameraRef.current = camera;
        }}
        onContextMenu={handleContextMenu}
      >
        {/* Sync scene background with theme */}
        <SceneTheme />
        {/* Demand-mode invalidation — re-renders whenever scene content changes */}
        <SceneInvalidator />
        {/* NAV-10: visual style rendering override */}
        <VisualStyleEffect />
        {/* D54 Slice clipping plane */}
        <SliceEffect />

        {/* Lighting */}
        <ambientLight intensity={0.4} />
        <directionalLight
          position={[50, 80, 50]}
          intensity={1.2}
          castShadow
          shadow-mapSize={[1024, 1024]}
        />
        <directionalLight position={[-30, 40, -20]} intensity={0.5} />
        <hemisphereLight
          color={themeColors.hemisphereColor}
          groundColor={themeColors.hemisphereGround}
          intensity={0.3}
        />

        {/* Environment — IBL/reflections only; background is always the solid canvasBg color */}
        {showReflections && (
          <EnvErrorBoundary>
            <Environment preset={environmentPreset as PresetsType} background={false} />
          </EnvErrorBoundary>
        )}
        {showShadows && showGroundPlane && (
          <ContactShadows
            position={[0, groundPlaneOffset - 0.01, 0]}
            opacity={0.3}
            scale={100}
            blur={shadowSoftness}
          />
        )}

        {/* Axis lines — always visible (X=red, Y=blue, Z=green) */}
        <WorldAxes />

        {/* World grid — hidden during active sketch (replaced by sketch-plane grid) */}
        {gridVisible && !activeSketch && <GroundPlaneGrid />}

        {/* Sketch-plane grid — shown only while a sketch is active and grid is enabled (D207) */}
        {activeSketch && sketchGridEnabled && activeSketch.plane !== 'custom' && (
          <SketchPlaneGrid plane={activeSketch.plane} />
        )}
        {activeSketch && sketchGridEnabled && activeSketch.plane === 'custom' && (
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
        <SketchConstraintOverlay />
        <SketchDimensionAnnotations />
        <SketchSplineHandles />
        <ExtrudedBodies />
        <PrimitiveBodies />
        <FastenerBodies />
        <ImportedModels />
        <SketchPlaneIndicator />
        <SketchInteraction />
        <MeasureInteraction />
        <ExtrudeTool />
        <RevolveTool />
        <FormBodies />
        <FormInteraction />
        <JointGizmos />
        <JointAnimationPlayer />
        <SketchPlaneDragger />
        <Sketch3DPlaneIndicator />
        <FilletEdgeHighlight />
        <ChamferEdgeHighlight />
        <ConstructionGeometryInteraction />
        <ConstructionGeometryRenderer />
        <ReplaceFaceInteraction />
        <DirectEditFacePicker />
        <TextureExtrudeFacePicker />
        <DecalFacePicker />
        <SplitFacePicker />
        <HoleFacePicker />
        <ShellFacePicker />
        <RemoveFacePicker />
        <DraftPartingLinePicker />
        <MeshExporter />
        <SnapFitFacePicker />
        <LipGrooveEdgePicker />
        <ExtrudeToEntityPicker />
        <ExtrudeStartEntityPicker />
        <JointOriginPicker />
        <JointOriginRenderer />
        <AnalysisOverlay />

        {/* Camera controller — also feeds quaternion to ViewCube */}
        <CameraController onQuaternionChange={handleQuaternionChange} />
        {/* NAV-20: Perspective / Orthographic switcher */}
        <CameraProjectionSwitcher />
        {/* NAV-6: Look At face pick */}
        <LookAtInteraction />

        {/* Controls */}
        <OrbitControls
          makeDefault
          enableDamping
          dampingFactor={0.1}
          enabled={true}
          mouseButtons={{
            LEFT: cameraNavMode === 'pan' ? THREE.MOUSE.PAN
                : cameraNavMode === 'zoom' ? THREE.MOUSE.DOLLY
                : viewMode === 'sketch' ? undefined
                : THREE.MOUSE.ROTATE,
            MIDDLE: THREE.MOUSE.DOLLY,
            RIGHT: THREE.MOUSE.PAN,
          }}
        />

        {/* Shift + Middle-click pan (in addition to right-click pan) */}
        <ShiftMiddlePan />

        {/* NAV-21 / AUDIT-21: Ambient Occlusion — SSAO via @react-three/postprocessing.
            SSAO_COLOR is a module-level singleton so we don't allocate a fresh
            THREE.Color on every Viewport render.
            AUDIT-21: EffectComposer cleanup is handled by @react-three/postprocessing
            on unmount — no manual dispose needed. Package version ^3.0.4 (v3+)
            performs render-target and pass cleanup automatically via React's
            unmount lifecycle. */}
        {ambientOcclusionEnabled && (
          <EffectComposer>
            <SSAO
              radius={0.1}
              intensity={20}
              luminanceInfluence={0.6}
              color={SSAO_COLOR}
            />
          </EffectComposer>
        )}
      </Canvas>
      </div>

      {/* NAV-19: Multi-viewport — replaces main Canvas when layout !== '1' */}
      {viewportLayout !== '1' && (
        <div style={{ position: 'absolute', inset: 0 }}>
          <MultiViewCanvas layout={viewportLayout} />
        </div>
      )}

      <ViewportOverlays
        camQuat={camQuat}
        viewportCtxMenu={viewportCtxMenu}
        onCloseContextMenu={() => setViewportCtxMenu(null)}
        onOrientViewCube={handleViewCubeOrient}
        onHomeViewCube={() => useCADStore.getState().triggerCameraHome()}
      />
      <ViewportPanels />
    </div>
  );
}
