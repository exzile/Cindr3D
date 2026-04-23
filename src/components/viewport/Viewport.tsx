import "./overlays/ViewportOverlay.css";
import { useRef, useCallback, useState, useEffect } from 'react';
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
import type { ViewportCtxState } from '../../types/viewport-context-menu.types';
import CameraProjectionSwitcher from './scene/CameraProjectionSwitcher';
import LookAtInteraction from './scene/LookAtInteraction';
import { EffectComposer, SSAO } from '@react-three/postprocessing';
import MultiViewCanvas from './multiview/MultiViewCanvas';
import { ViewportPanels } from './ViewportPanels';
import { ViewportOverlays } from './ViewportOverlays';



/** Module-level singleton — passed to SSAO to avoid per-render Color allocation. */
const SSAO_COLOR = new THREE.Color('black');

/** Scratch objects for window/lasso selection — avoids per-feature allocations on pointer-up. */
const _selBox3 = new THREE.Box3();
const _selVec3 = new THREE.Vector3();

/**
 * AUDIT-17: Module-level scratch quaternions — alternated each tick to avoid
 * allocating a new THREE.Quaternion on every camera-movement interval tick.
 * React detects the state change because the object reference alternates between
 * _quatA and _quatB, so it always sees a different reference when the camera moves.
 */
const _quatA = new THREE.Quaternion();
const _quatB = new THREE.Quaternion();
let _quatToggle = false;

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
  // Tracks where the right mouse button was pressed so onContextMenu can
  // distinguish "click to open menu" from "drag to pan" — we only want the
  // context menu on a stationary right-click, not after a right-drag pan.
  const rightDownRef = useRef<{ x: number; y: number } | null>(null);
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
  // AUDIT-17: alternates between two module-level scratch quaternions instead of
  // cloning a new one each tick, eliminating ~10 allocations/sec during camera movement.
  useEffect(() => {
    const id = setInterval(() => {
      setCamQuat((prev) => {
        if (quatRef.current.equals(prev)) return prev;
        _quatToggle = !_quatToggle;
        const scratch = _quatToggle ? _quatA : _quatB;
        scratch.copy(quatRef.current);
        return scratch;
      });
    }, 100);
    return () => clearInterval(id);
  }, []);

  const handleViewCubeOrient = useCallback((targetQ: THREE.Quaternion) => {
    setCameraTargetQuaternion(targetQ);
  }, [setCameraTargetQuaternion]);

  // ── D204/D205 pointer handlers ─────────────��──────────────────────────────
  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    // Track right-button position regardless of tool so the context-menu
    // suppression below works the same way in every mode.
    if (e.button === 2) {
      rightDownRef.current = { x: e.clientX, y: e.clientY };
    }
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
        // Reuse scratch vec — project() mutates in place
        _selVec3.copy(worldPos).project(camera);
        if (_selVec3.z > 1 || _selVec3.z < -1) return null;
        return {
          x: (_selVec3.x * 0.5 + 0.5) * rect.width,
          y: (1 - (_selVec3.y * 0.5 + 0.5)) * rect.height,
        };
      };

      // Feature → screen-projected centroid (or null if not selectable).
      // Uses module-level scratch Box3/Vector3 — no allocation per feature.
      type AnyFeature = ReturnType<typeof useCADStore.getState>['features'][number];
      const projectedFeatureCentroid = (f: AnyFeature): { x: number; y: number } | null => {
        if (!f.mesh || !f.visible) return null;
        _selBox3.setFromObject(f.mesh);
        if (_selBox3.isEmpty()) return null;
        _selBox3.getCenter(_selVec3);
        return projectToScreen(_selVec3);
      };

      // Read features directly from store — no React subscription needed here
      const { features, windowSelectStart } = useCADStore.getState();

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
        if (windowSelectStart) {
          const minX = Math.min(windowSelectStart.x, p.x);
          const maxX = Math.max(windowSelectStart.x, p.x);
          const minY = Math.min(windowSelectStart.y, p.y);
          const maxY = Math.max(windowSelectStart.y, p.y);
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
  }, [setSelectedEntityIds, clearWindowSelect, clearLasso]);

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
        onContextMenu={(e) => {
          // Always suppress the native browser context menu.
          e.preventDefault();
          // If the right button was dragged (used to pan the camera), do NOT
          // open our custom context menu — the user was just panning.
          const down = rightDownRef.current;
          rightDownRef.current = null;
          if (down) {
            const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
            if (moved > 5) return;
          }
          setViewportCtxMenu({ x: e.clientX, y: e.clientY });
        }}
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
