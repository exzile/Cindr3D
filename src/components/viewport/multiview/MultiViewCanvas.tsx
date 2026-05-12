import { useRef } from 'react';
import * as THREE from 'three';
import { Canvas } from '@react-three/fiber';
import {
  View,
  OrbitControls,
  OrthographicCamera,
  PerspectiveCamera,
} from '@react-three/drei';
import PrimitiveBodies from '../scene/PrimitiveBodies';
import ExtrudedBodies from '../scene/ExtrudedBodies';
import FormBodies from '../scene/FormBodies';
import ImportedModels from '../scene/ImportedModels';
import CanvasReferences from '../scene/CanvasReferences';
import FastenerBodies from '../scene/FastenerBodies';
import WorldAxes from '../scene/WorldAxes';
import { GroundPlaneGrid } from '../scene/SketchPlaneGrid';
import type { Layout, QuadrantDef, QuadrantKey } from '../../../types/multi-view-canvas.types';

const QUADRANTS: Record<QuadrantKey, QuadrantDef> = {
  top:         { key: 'top',         label: 'Top',         color: '#1a7fe0' },
  front:       { key: 'front',       label: 'Front',       color: '#1aa04a' },
  right:       { key: 'right',       label: 'Right',       color: '#d06020' },
  perspective: { key: 'perspective', label: 'Perspective', color: '#555'    },
};

/**
 * SharedScene renders scene objects ONCE at the Canvas level (outside any View).
 * Because each <View> uses scissoring over the same root Canvas scene, these
 * objects are visible in every viewport without needing to be mounted per-View.
 * Mounting them inside each <View> would cause THREE.Object3D reparenting
 * collisions (a mesh can only have one parent — the last View's mount wins).
 */
function SharedScene() {
  return (
    <>
      <ambientLight intensity={0.6} />
      <directionalLight position={[50, 80, 50]} intensity={1.0} />
      <PrimitiveBodies />
      <ExtrudedBodies />
      <FormBodies />
      <ImportedModels />
      <CanvasReferences />
      <FastenerBodies />
      <WorldAxes />
      <GroundPlaneGrid />
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
      style={{ position: 'relative', width: '100%', height: '100%' }}
    >
      {/* DOM grid of quadrant divs — each acts as a tracked region for its View */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'grid',
          gridTemplate,
        }}
      >
        {/* eslint-disable react-hooks/refs -- refs passed as prop, not read during render */}
        {quadrantList.map((q) => (
          <div
            key={q.def.key}
            ref={q.ref}
            style={{
              position: 'relative',
              border: '1px solid #2a2a2a',
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
        style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
        gl={{ antialias: true, alpha: false }}
      >
        {/*
          SharedScene is rendered ONCE here at the Canvas root level, outside any
          <View>. All Views scissor over the same underlying Canvas/scene, so these
          objects are visible in every viewport. This avoids the THREE.Object3D
          single-parent constraint: mounting the same mesh inside multiple <View>
          portals would reparent it, leaving only the last View populated.
        */}
        <SharedScene />
        <View.Port />
        {/* eslint-disable react-hooks/refs -- refs passed to track prop */}
        {quadrantList.map((q, i) => (
          <View key={q.def.key} index={i + 1} track={q.ref}>
            <QuadrantCamera kind={q.def.key} />
            <MultiViewScene kind={q.def.key} />
          </View>
        ))}
        {/* eslint-enable react-hooks/refs */}
      </Canvas>
    </div>
  );
}
