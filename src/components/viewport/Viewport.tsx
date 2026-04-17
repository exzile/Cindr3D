import "./ViewportOverlay.css";
import { useRef, useCallback, useState, useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Environment, ContactShadows } from '@react-three/drei';
import type { PresetsType } from '@react-three/drei/helpers/environment-assets';
import * as THREE from 'three';
import { useCADStore } from '../../store/cadStore';
import { useThemeStore } from '../../store/themeStore';
import ViewCube from './ViewCube';
import CanvasControls from './CanvasControls';
import SketchPalette from './SketchPalette';
import MeasurePanel from './MeasurePanel';
import ExtrudeTool from './ExtrudeTool';
import RevolveTool from './RevolveTool';
import ExtrudePanel from './ExtrudePanel';
import RevolvePanel from './RevolvePanel';
import SweepPanel from './SweepPanel';
import LoftPanel from './LoftPanel';
import SketchTextPanel from './SketchTextPanel';
import SketchDimensionPanel from './SketchDimensionPanel';
import SketchProjectPanel from './SketchProjectPanel';
import PatchPanel from './PatchPanel';
import RuledSurfacePanel from './RuledSurfacePanel';
import RibPanel from './RibPanel';
import SectionAnalysisPanel from './SectionAnalysisPanel';
import SketchPatternPanel from './SketchPatternPanel';
import SketchTransformPanel from './SketchTransformPanel';
import SketchMirrorPanel from './SketchMirrorPanel';
import SceneTheme from './scene/SceneTheme';
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
import FormInteraction from './FormInteraction';
import FormBodies from './scene/FormBodies';
import JointGizmos from './scene/JointGizmos';
import JointAnimationPlayer from './scene/JointAnimationPlayer';
import ExplodedViewPanel from './ExplodedViewPanel';
import SketchPlaneDragger from './SketchPlaneDragger';
import Sketch3DPlaneIndicator from './Sketch3DPlaneIndicator';
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
import ConstructTwoPlanePanel from './ConstructTwoPlanePanel';
import ConstructThreePlanePanel from './ConstructThreePlanePanel';
import AnalysisOverlay from './scene/AnalysisOverlay';
import AnalysisPanel from './AnalysisPanel';
import JointOriginPicker from './scene/JointOriginPicker';
import JointOriginRenderer from './scene/JointOriginRenderer';
import WindowSelectOverlay from './WindowSelectOverlay';
import LassoSelectOverlay from './LassoSelectOverlay';
import ZoomWindowOverlay from './ZoomWindowOverlay';
import FinishEditInPlaceBar from './FinishEditInPlaceBar';
import { ViewportContextMenu } from './ViewportContextMenu';
import type { ViewportCtxState } from './ViewportContextMenu';
import CameraProjectionSwitcher from './scene/CameraProjectionSwitcher';
import LookAtInteraction from './scene/LookAtInteraction';
import { EffectComposer, SSAO } from '@react-three/postprocessing';
import MultiViewCanvas from './MultiViewCanvas';



/** Standard ray-casting point-in-polygon test (screen-space pixels). */
function pointInPolygon(p: { x: number; y: number }, poly: { x: number; y: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const pi = poly[i];
    const pj = poly[j];
    const intersect =
      pi.y > p.y !== pj.y > p.y &&
      p.x < ((pj.x - pi.x) * (p.y - pi.y)) / (pj.y - pi.y + 1e-12) + pi.x;
    if (intersect) inside = !inside;
  }
  return inside;
}

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
  const activeTool = useCADStore((s) => s.activeTool);
  const setWindowSelectStart = useCADStore((s) => s.setWindowSelectStart);
  const setWindowSelectEnd = useCADStore((s) => s.setWindowSelectEnd);
  const clearWindowSelect = useCADStore((s) => s.clearWindowSelect);
  const setSelectedEntityIds = useCADStore((s) => s.setSelectedEntityIds);
  const setLassoSelecting = useCADStore((s) => s.setLassoSelecting);
  const setLassoPoints = useCADStore((s) => s.setLassoPoints);
  const clearLasso = useCADStore((s) => s.clearLasso);
  const features = useCADStore((s) => s.features);
  // D207
  const sketchGridEnabled = useCADStore((s) => s.sketchGridEnabled);
  // NAV-19 multi-viewport layout
  const viewportLayout = useCADStore((s) => s.viewportLayout);

  // Drag-state refs (avoid stale closures in pointer handlers)
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const isDraggingRef = useRef(false);
  const isLassoRef = useRef(false);
  const lassoAccumRef = useRef<{ x: number; y: number }[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  // Window/lasso select needs the live camera for screen-space projection.
  // Captured in Canvas.onCreated so it's available to pointerUp handlers.
  const cameraRef = useRef<THREE.Camera | null>(null);
  const [viewportCtxMenu, setViewportCtxMenu] = useState<ViewportCtxState | null>(null);

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
  }, []);  

  const handleViewCubeOrient = useCallback((targetQ: THREE.Quaternion) => {
    setCameraTargetQuaternion(targetQ);
  }, [setCameraTargetQuaternion]);

  // ── D204/D205 pointer handlers ─────────────��──────────────────────────────
  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (activeTool !== 'select') return;
    if (e.button !== 0) return; // left button only
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const p = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    dragStartRef.current = p;
    isDraggingRef.current = false;
    isLassoRef.current = e.shiftKey;
    lassoAccumRef.current = [p];
  }, [activeTool]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStartRef.current) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const p = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const dx = p.x - dragStartRef.current.x;
    const dy = p.y - dragStartRef.current.y;

    if (!isDraggingRef.current) {
      if (Math.sqrt(dx * dx + dy * dy) < 5) return; // threshold
      isDraggingRef.current = true;
      if (isLassoRef.current) {
        setLassoSelecting(true);
        setLassoPoints([dragStartRef.current, p]);
        lassoAccumRef.current = [dragStartRef.current, p];
      } else {
        setWindowSelectStart(dragStartRef.current);
      }
    } else {
      if (isLassoRef.current) {
        lassoAccumRef.current = [...lassoAccumRef.current, p];
        setLassoPoints(lassoAccumRef.current);
      } else {
        setWindowSelectEnd(p);
      }
    }
  }, [setWindowSelectStart, setWindowSelectEnd, setLassoSelecting, setLassoPoints]);

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStartRef.current) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const p = { x: e.clientX - rect.left, y: e.clientY - rect.top };

    if (isDraggingRef.current) {
      const camera = cameraRef.current;
      // Project a world-space point to screen pixels using the live canvas camera.
      // Returns null if the camera isn't ready or the point sits behind it.
      const projectToScreen = (worldPos: THREE.Vector3): { x: number; y: number } | null => {
        if (!camera) return null;
        const ndc = worldPos.clone().project(camera);
        // Behind camera (z > 1 in NDC) → reject
        if (ndc.z > 1 || ndc.z < -1) return null;
        return {
          x: (ndc.x * 0.5 + 0.5) * rect.width,
          y: (1 - (ndc.y * 0.5 + 0.5)) * rect.height,
        };
      };

      // Featrue → screen-projected centroid (or null if not selectable)
      const projectedFeatureCentroid = (f: typeof features[number]): { x: number; y: number } | null => {
        if (!f.mesh || !f.visible) return null;
        const box = new THREE.Box3().setFromObject(f.mesh);
        if (box.isEmpty()) return null;
        const centroid = new THREE.Vector3();
        box.getCenter(centroid);
        return projectToScreen(centroid);
      };

      if (isLassoRef.current) {
        // Lasso: point-in-polygon test on each feature's projected centroid
        const polygon = lassoAccumRef.current;
        const matched = polygon.length >= 3
          ? features.filter((f) => {
              const sp = projectedFeatureCentroid(f);
              return sp !== null && pointInPolygon(sp, polygon);
            })
          : [];
        setSelectedEntityIds(matched.map((f) => f.id));
        clearLasso();
      } else {
        // Window select: select features whose centroids fall inside the drag rect
        const store = useCADStore.getState();
        const start = store.windowSelectStart;
        if (start) {
          const minX = Math.min(start.x, p.x);
          const maxX = Math.max(start.x, p.x);
          const minY = Math.min(start.y, p.y);
          const maxY = Math.max(start.y, p.y);
          const matched = features.filter((f) => {
            const sp = projectedFeatureCentroid(f);
            return sp !== null && sp.x >= minX && sp.x <= maxX && sp.y >= minY && sp.y <= maxY;
          });
          setSelectedEntityIds(matched.map((f) => f.id));
        }
        clearWindowSelect();
      }
    }

    dragStartRef.current = null;
    isDraggingRef.current = false;
    lassoAccumRef.current = [];
  }, [features, setSelectedEntityIds, clearWindowSelect, clearLasso]);

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
        onContextMenu={(e) => {
          e.preventDefault();
          setViewportCtxMenu({ x: e.clientX, y: e.clientY });
        }}
      >
        {/* Sync scene background with theme */}
        <SceneTheme />
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
          shadow-mapSize={[2048, 2048]}
        />
        <directionalLight position={[-30, 40, -20]} intensity={0.5} />
        <hemisphereLight
          color={themeColors.hemisphereColor}
          groundColor={themeColors.hemisphereGround}
          intensity={0.3}
        />

        {/* Environment — IBL/reflections only; background is always the solid canvasBg color */}
        {showReflections && (
          <Environment preset={environmentPreset} background={false} />
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

        {/* NAV-21: Ambient Occlusion — SSAO via @react-three/postprocessing */}
        {ambientOcclusionEnabled && (
          <EffectComposer>
            <SSAO
              radius={0.1}
              intensity={20}
              luminanceInfluence={0.6}
              color={new THREE.Color('black')}
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

      {/* MM6/MM7 Finish Edit In Place banner */}
      <FinishEditInPlaceBar />

      {/* Viewport right-click context menu */}
      {viewportCtxMenu && (
        <ViewportContextMenu
          menu={viewportCtxMenu}
          onClose={() => setViewportCtxMenu(null)}
        />
      )}

      {/* D204 Window Select overlay */}
      <WindowSelectOverlay />

      {/* D205 Lasso Select overlay */}
      <LassoSelectOverlay />

      {/* NAV-5: Zoom Window overlay */}
      <ZoomWindowOverlay />

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
      <PatchPanel />
      <RuledSurfacePanel />
      <RibPanel />
      <SectionAnalysisPanel />
      <SketchPatternPanel />
      <SketchTransformPanel />
      <SketchMirrorPanel />
      <SketchTextPanel />
      <SketchDimensionPanel />
      <SketchProjectPanel />
      <ConstructTwoPlanePanel />
      <ConstructThreePlanePanel />
      <AnalysisPanel />
      <ExplodedViewPanel />
    </div>
  );
}
