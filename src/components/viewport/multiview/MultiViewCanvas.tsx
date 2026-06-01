import { useRef } from 'react';
import * as THREE from 'three';
import { Canvas } from '@react-three/fiber';
import {
  View,
  OrbitControls,
  OrthographicCamera,
  PerspectiveCamera,
} from '@react-three/drei';
import PrimitiveBodies, { PrimitivePreview } from '../scene/PrimitiveBodies';
import ExtrudedBodies from '../scene/ExtrudedBodies';
import FormBodies from '../scene/FormBodies';
import ImportedModels from '../scene/ImportedModels';
import CanvasReferences from '../scene/CanvasReferences';
import FastenerBodies from '../scene/FastenerBodies';
import WorldAxes from '../scene/WorldAxes';
import SketchRenderer from '../scene/SketchRenderer';
import SketchPlaneGrid, { GroundPlaneGrid } from '../scene/SketchPlaneGrid';
import SceneTheme from '../scene/SceneTheme';
import { CrashBoundary } from '../EnvErrorBoundary';
import FilletEdgeHighlight from '../scene/FilletEdgeHighlight';
import FilletGizmo from '../scene/FilletGizmo';
import ChamferEdgeHighlight from '../scene/ChamferEdgeHighlight';
import ChamferGizmo from '../scene/ChamferGizmo';
import { useCADStore } from '../../../store/cadStore';
import { useThemeStore } from '../../../store/themeStore';
import type { Layout, QuadrantDef, QuadrantKey } from '../../../types/multi-view-canvas.types';

const QUADRANTS: Record<QuadrantKey, QuadrantDef> = {
  top:         { key: 'top',         label: 'Top',         color: '#1a7fe0' },
  front:       { key: 'front',       label: 'Front',       color: '#1aa04a' },
  right:       { key: 'right',       label: 'Right',       color: '#d06020' },
  perspective: { key: 'perspective', label: 'Perspective', color: '#555'    },
};

/**
 * SharedScene is mounted inside each split <View>.
 * Drei renders a View's portal scene whenever that View has children, so
 * root-level scene objects would not appear in split viewports.
 */
function SharedScene() {
  const activeDialog = useCADStore((s) => s.activeDialog);
  const activeSketch = useCADStore((s) => s.activeSketch);
  const gridVisible = useCADStore((s) => s.gridVisible);
  const sketchGridEnabled = useCADStore((s) => s.sketchGridEnabled);
  const edgeOperationActive = activeDialog === 'fillet' || activeDialog === 'chamfer';

  return (
    <>
      <SceneTheme />
      <ambientLight intensity={0.6} />
      <directionalLight position={[50, 80, 50]} intensity={1.0} />
      {!edgeOperationActive && <SketchRenderer />}
      <PrimitiveBodies />
      <PrimitivePreview />
      <ExtrudedBodies />
      <FormBodies />
      <ImportedModels />
      <CanvasReferences />
      <FastenerBodies />
      <WorldAxes />
      {gridVisible && !activeSketch && <GroundPlaneGrid />}
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
      <CrashBoundary label="EdgeOp" resetKey={activeDialog}>
        <FilletEdgeHighlight />
        <FilletGizmo />
        <ChamferEdgeHighlight />
        <ChamferGizmo />
      </CrashBoundary>
    </>
  );
}

function MultiViewScene({ kind }: { kind: QuadrantKey }) {
  const isOrtho = kind !== 'perspective';
  return (
    <>
      {/* Perspective gets full 3D orbit. Top/Front/Right lock rotation —
          directional pan + zoom only (2D navigation within the view plane). */}
      <OrbitControls
        makeDefault
        enableRotate={!isOrtho}
        enablePan
        enableZoom
        screenSpacePanning={isOrtho}
        panSpeed={1}
        zoomSpeed={1}
      />
    </>
  );
}

function QuadrantCamera({ kind }: { kind: QuadrantKey }) {
  // IMPORTANT: drei's OrthographicCamera/PerspectiveCamera do NOT auto-target origin
  // from `position`. The camera's forward is always -Z in its local frame, so we must
  // call lookAt(0,0,0) via onUpdate to aim at the scene. Without this, Top at
  // [0,200,0] and Right at [200,0,0] look sideways into empty space.
  const aimAtOrigin = (cam: THREE.Camera) => cam.lookAt(0, 0, 0);

  switch (kind) {
    case 'top':
      return (
        <OrthographicCamera
          makeDefault
          position={[0, 200, 0]}
          zoom={5}
          near={0.1}
          far={10000}
          up={[0, 0, -1]}
          onUpdate={aimAtOrigin}
        />
      );
    case 'front':
      return (
        <OrthographicCamera
          makeDefault
          position={[0, 0, 200]}
          zoom={5}
          near={0.1}
          far={10000}
          onUpdate={aimAtOrigin}
        />
      );
    case 'right':
      return (
        <OrthographicCamera
          makeDefault
          position={[200, 0, 0]}
          zoom={5}
          near={0.1}
          far={10000}
          onUpdate={aimAtOrigin}
        />
      );
    case 'perspective':
      return (
        <PerspectiveCamera
          makeDefault
          position={[50, 50, 50]}
          fov={45}
          near={0.1}
          far={10000}
          onUpdate={aimAtOrigin}
        />
      );
  }
}

function QuadrantLabel({ label, color }: { label: string; color: string }) {
  return (
    <div
      style={{
        position: 'absolute',
        top: 4,
        left: 4,
        background: color,
        color: '#fff',
        fontSize: 10,
        fontWeight: 600,
        padding: '1px 6px',
        borderRadius: 3,
        letterSpacing: '0.05em',
        opacity: 0.9,
        pointerEvents: 'none',
        zIndex: 2,
      }}
    >
      {label}
    </div>
  );
}

export default function MultiViewCanvas({ layout }: { layout: Layout }) {
  const canvasBg = useThemeStore((s) => s.colors.canvasBg);
  const containerRef = useRef<HTMLDivElement>(null!);
  const topRef = useRef<HTMLDivElement>(null!);
  const frontRef = useRef<HTMLDivElement>(null!);
  const rightRef = useRef<HTMLDivElement>(null!);
  const perspRef = useRef<HTMLDivElement>(null!);

  // Determine which quadrants show in each layout
  const quadrantList: { def: QuadrantDef; ref: React.RefObject<HTMLDivElement> }[] =
    layout === '2h'
      ? [
          { def: QUADRANTS.top,         ref: topRef },
          { def: QUADRANTS.perspective, ref: perspRef },
        ]
      : layout === '2v'
      ? [
          { def: QUADRANTS.top,         ref: topRef },
          { def: QUADRANTS.perspective, ref: perspRef },
        ]
      : [
          { def: QUADRANTS.top,         ref: topRef },
          { def: QUADRANTS.front,       ref: frontRef },
          { def: QUADRANTS.right,       ref: rightRef },
          { def: QUADRANTS.perspective, ref: perspRef },
        ];

  const gridTemplate =
    layout === '4'
      ? '1fr 1fr / 1fr 1fr'
      : layout === '2h'
      ? '1fr / 1fr 1fr'
      : '1fr 1fr / 1fr';

  return (
    <div
      ref={containerRef}
      style={{ position: 'relative', width: '100%', height: '100%', background: canvasBg }}
    >
      {/* DOM grid of quadrant divs — each acts as a tracked region for its View */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'grid',
          gridTemplate,
          zIndex: 2,
        }}
      >
        {/* eslint-disable react-hooks/refs -- refs passed as prop, not read during render */}
        {quadrantList.map((q) => (
          <div
            key={q.def.key}
            ref={q.ref}
            style={{
              position: 'relative',
              border: '1px solid rgba(42, 42, 42, 0.55)',
              overflow: 'hidden',
            }}
          >
            <QuadrantLabel label={q.def.label} color={q.def.color} />
          </div>
        ))}
        {/* eslint-enable react-hooks/refs */}
      </div>

      {/* Single Canvas overlays the grid; drei scissors into each tracked div */}
      <Canvas
        eventSource={containerRef}
        eventPrefix="client"
        frameloop="demand"
        style={{ position: 'absolute', inset: 0 }}
        gl={{ antialias: true, alpha: false }}
        onCreated={({ gl }) => {
          gl.setClearColor(canvasBg);
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.2;
        }}
      >
        <View.Port />
        {/* eslint-disable react-hooks/refs -- refs passed to track prop */}
        {quadrantList.map((q, i) => (
          <View key={q.def.key} index={i + 1} track={q.ref}>
            <SharedScene />
            <QuadrantCamera kind={q.def.key} />
            <MultiViewScene kind={q.def.key} />
          </View>
        ))}
        {/* eslint-enable react-hooks/refs */}
      </Canvas>
    </div>
  );
}
