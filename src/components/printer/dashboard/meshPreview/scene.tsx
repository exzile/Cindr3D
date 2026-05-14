/**
 * 3D scene primitives used inside the dashboard print-preview Canvas:
 *
 *   • ObjectSilhouette     — translucent body + edge wireframe per PlateObject
 *   • ObjectStatusBadge    — floating Html label (queued / printing / cancelled / risk)
 *   • NozzleMarker         — sphere + cone + crosshair tracking the live tool head
 *   • PreviewCameraControls — OrbitControls + view-preset camera pose driver
 *
 * Extracted from MeshPreviewPanel.tsx so the host can stay focused on state
 * orchestration and overlay layout rather than per-primitive render code.
 */
import { Html, Line, OrbitControls, Text } from '@react-three/drei';
import { useThree, type ThreeEvent } from '@react-three/fiber';
import { useEffect, useMemo, useRef, type ElementRef } from 'react';
import * as THREE from 'three';
import type { PlateObject } from '../../../../types/slicer';
import {
  NOZZLE_CROSSHAIR_POSITIONS,
  objectMatrix, objectWorldCenter, previewCameraPose,
  type DashboardPreviewColorMode, type ObjectStatus, type PreviewBounds, type PreviewViewPreset,
} from './helpers';

export function PreviewCameraControls({
  buildVolume,
  bounds,
  revision,
  view,
}: {
  buildVolume: { x: number; y: number; z: number };
  bounds: PreviewBounds;
  revision: number;
  view: PreviewViewPreset;
}) {
  const controlsRef = useRef<ElementRef<typeof OrbitControls>>(null);
  const { camera, invalidate } = useThree();

  /* eslint-disable react-hooks/immutability */
  useEffect(() => {
    const pose = previewCameraPose(view, bounds, buildVolume);
    camera.position.copy(pose.position);
    camera.up.copy(pose.up);
    camera.near = 0.5;
    camera.far = Math.max(buildVolume.x, buildVolume.y, buildVolume.z, bounds.radius) * 12;
    camera.lookAt(pose.target);
    camera.updateProjectionMatrix();
    controlsRef.current?.target.copy(pose.target);
    controlsRef.current?.update();
    invalidate();
  }, [bounds, buildVolume, camera, invalidate, revision, view]);
  /* eslint-enable react-hooks/immutability */

  return (
    <OrbitControls
      ref={controlsRef}
      target={[bounds.center.x, bounds.center.y, bounds.center.z]}
      enableDamping
      dampingFactor={0.12}
      minDistance={Math.max(buildVolume.x, buildVolume.y) * 0.25}
      maxDistance={Math.max(buildVolume.x, buildVolume.y, buildVolume.z) * 5}
    />
  );
}

export function ObjectSilhouette({
  obj,
  isCurrent,
  isCancelled,
  colorMode,
  onContextMenu,
  onHover,
  onHoverEnd,
}: {
  obj: PlateObject;
  isCurrent: boolean;
  isCancelled: boolean;
  colorMode: DashboardPreviewColorMode;
  onContextMenu: (e: ThreeEvent<MouseEvent>) => void;
  onHover: (e: ThreeEvent<PointerEvent>) => void;
  onHoverEnd: () => void;
}) {
  const matrix = useMemo(() => objectMatrix(obj), [obj]);
  // Reuse the geometry as-is; PlateObject geometry is already in model-local space.
  const geometry = obj.geometry as THREE.BufferGeometry | undefined;
  if (!geometry) return null;

  const baseColor = isCancelled ? '#ef4444' : isCurrent ? '#44aaff' : colorMode === 'object' ? (obj.color ?? '#7a89ff') : '#7a89ff';
  const opacity = isCancelled ? 0.08 : isCurrent ? 0.2 : colorMode === 'object' ? 0.18 : 0.1;
  const edgeOpacity = isCancelled ? 0.5 : isCurrent ? 1 : 0.7;

  return (
    <group matrixAutoUpdate={false} matrix={matrix}>
      <mesh
        geometry={geometry}
        onContextMenu={(e) => { e.stopPropagation(); onContextMenu(e); }}
        onPointerMove={(e) => { e.stopPropagation(); onHover(e); }}
        onPointerOut={onHoverEnd}
      >
        <meshBasicMaterial
          color={baseColor}
          transparent
          opacity={opacity}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>
      {/* Silhouette edges — visible regardless of solid material */}
      <lineSegments>
        <edgesGeometry args={[geometry, 25]} />
        <lineBasicMaterial color={baseColor} transparent opacity={edgeOpacity} linewidth={1} />
      </lineSegments>
    </group>
  );
}

export function ObjectStatusBadge({
  obj,
  status,
}: {
  obj: PlateObject;
  status: ObjectStatus;
}) {
  const position = useMemo(() => objectWorldCenter(obj), [obj]);
  return (
    <Html
      position={[position.x, position.y, position.z]}
      center
      distanceFactor={110}
      zIndexRange={[20, 0]}
      style={{ pointerEvents: 'none' }}
    >
      <div
        style={{
          padding: '2px 5px',
          borderRadius: 4,
          border: `1px solid ${status.color}`,
          background: 'rgba(10, 10, 20, 0.82)',
          color: status.color,
          fontSize: 9,
          fontWeight: 700,
          lineHeight: 1,
          whiteSpace: 'nowrap',
          textTransform: 'uppercase',
        }}
      >
        {status.label}
      </div>
    </Html>
  );
}

export function NozzleMarker({
  position,
  trail,
}: {
  position: { x: number; y: number; z: number } | null;
  trail: Array<{ x: number; y: number; z: number }>;
}) {
  const trailPoints = useMemo(
    () => trail.map((point) => [point.x, point.y, point.z + 2] as [number, number, number]),
    [trail],
  );

  // Build the crosshair geometry once per mount and dispose it on unmount.
  // Inline JSX <bufferAttribute args={[arr, 3]}> rebuilds the GPU buffer on
  // every render (per r3f_critical_patterns.md), leaking on long-lived panels.
  const crosshairGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(NOZZLE_CROSSHAIR_POSITIONS, 3));
    return g;
  }, []);
  useEffect(() => () => crosshairGeo.dispose(), [crosshairGeo]);

  if (!position) return null;

  return (
    <>
      {trailPoints.length > 1 && (
        <Line points={trailPoints} color="#facc15" transparent opacity={0.35} depthWrite={false} />
      )}
      <group position={[position.x, position.y, position.z + 3]}>
        <mesh>
          <sphereGeometry args={[1.8, 16, 16]} />
          <meshBasicMaterial color="#facc15" depthWrite={false} />
        </mesh>
        <mesh rotation={[Math.PI, 0, 0]} position={[0, 0, 4]}>
          <coneGeometry args={[2.4, 6, 18]} />
          <meshBasicMaterial color="#facc15" transparent opacity={0.7} depthWrite={false} />
        </mesh>
        <lineSegments geometry={crosshairGeo}>
          <lineBasicMaterial color="#facc15" transparent opacity={0.8} depthWrite={false} />
        </lineSegments>
        <Text position={[0, 0, 10]} fontSize={4} color="#facc15" anchorX="center" anchorY="middle">
          nozzle
        </Text>
      </group>
    </>
  );
}
