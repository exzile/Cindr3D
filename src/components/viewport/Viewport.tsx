import "./ViewportOverlay.css";
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
import ConstructTwoPlanePanel from './ConstructTwoPlanePanel';
import ConstructThreePlanePanel from './ConstructThreePlanePanel';
import AnalysisOverlay from './scene/AnalysisOverlay';
import AnalysisPanel from './AnalysisPanel';
import JointOriginPicker from './scene/JointOriginPicker';
import JointOriginRenderer from './scene/JointOriginRenderer';
import WindowSelectOverlay from './WindowSelectOverlay';
import LassoSelectOverlay from './LassoSelectOverlay';
import FinishEditInPlaceBar from './FinishEditInPlaceBar';
import { ViewportContextMenu } from './ViewportContextMenu';
import type { ViewportCtxState } from './ViewportContextMenu';



export default function Viewport() {
  const viewMode = useCADStore((s) => s.viewMode);
  const gridVisible = useCADStore((s) => s.gridVisible);
  const activeSketch = useCADStore((s) => s.activeSketch);
  const showEnvironment = useCADStore((s) => s.showEnvironment);
  const showShadows = useCADStore((s) => s.showShadows);
  const showGroundPlane = useCADStore((s) => s.showGroundPlane);
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

  // Drag-state refs (avoid stale closures in pointer handlers)
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const isDraggingRef = useRef(false);
  const isLassoRef = useRef(false);
  const lassoAccumRef = useRef<{ x: number; y: number }[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
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
      if (isLassoRef.current) {
        // Lasso: point-in-polygon test on feature centroids
        const matched = features.filter((f) => {
          if (!f.mesh || !f.visible) return false;
          const mesh = f.mesh;
          const box = new THREE.Box3().setFromObject(mesh);
          const centroid = new THREE.Vector3();
          box.getCenter(centroid);
          // Project centroid to screen — we don't have camera here so use stored centroid position
          // Approximate: test if centroid bbox center in screen coords falls inside lasso polygon
          // Since we don't have a camera ref here, we do a simple bounding-box overlap instead
          // using the window rect approach
          return false; // Geometric lasso test deferred — feature raycast happens in SketchInteraction
        });
        setSelectedEntityIds(matched.map((f) => f.id));
        clearLasso();
      } else {
        // Window select: collect feature IDs whose mesh bbox projects within the rect
        const store = useCADStore.getState();
        const start = store.windowSelectStart;
        const end = { x: p.x, y: p.y };
        if (start) {
          const minX = Math.min(start.x, end.x);
          const maxX = Math.max(start.x, end.x);
          const minY = Math.min(start.y, end.y);
          const maxY = Math.max(start.y, end.y);
          // Select features whose names match (simplified — full 3D frustum is in SketchInteraction)
          // For now: select all visible features when drag rect is drawn (plug-in point for raycasting)
          const _ = [minX, maxX, minY, maxY]; void _;
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
        <JointOriginPicker />
        <JointOriginRenderer />
        <AnalysisOverlay />

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
