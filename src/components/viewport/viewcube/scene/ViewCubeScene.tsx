import { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import {
  CUBE_SIZE, HALF, FACES, EDGES, CORNERS, orientationQuaternion,
  type FaceDef, type EdgeDef, type CornerDef,
} from '../constants/defs';

/** The main textured cube body */
function CubeBody({ hoveredZone, activeFace }: { hoveredZone: string | null; activeFace: string | null }) {
  const meshRef = useRef<THREE.Mesh>(null);

  return (
    <mesh ref={meshRef}>
      <boxGeometry args={[CUBE_SIZE, CUBE_SIZE, CUBE_SIZE]} />
      <meshStandardMaterial
        color={hoveredZone ? '#f4f8ff' : activeFace ? '#edf5ff' : '#e8edf3'}
        roughness={0.58}
        metalness={0.08}
        emissive={hoveredZone ? '#0b3a78' : activeFace ? '#0b3a78' : '#000000'}
        emissiveIntensity={hoveredZone ? 0.08 : activeFace ? 0.025 : 0}
      />
    </mesh>
  );
}

/** Wireframe edges of the cube */
function CubeEdges() {
  const boxGeo = useMemo(() => new THREE.BoxGeometry(CUBE_SIZE, CUBE_SIZE, CUBE_SIZE), []);
  // Dispose the BoxGeometry on unmount — edgesGeometry consumes it via args
  // but the source geometry still holds GPU buffers that need cleanup.
  useEffect(() => () => boxGeo.dispose(), [boxGeo]);
  return (
    <lineSegments>
      <edgesGeometry args={[boxGeo]} />
      <lineBasicMaterial color="#5f7698" transparent opacity={0.95} />
    </lineSegments>
  );
}

/** A single clickable face label overlay */
function FaceLabel({
  face,
  isHovered,
  isActive,
  onHover,
  onUnhover,
  onClick,
}: {
  face: FaceDef;
  isHovered: boolean;
  isActive: boolean;
  onHover: () => void;
  onUnhover: () => void;
  onClick: () => void;
}) {
  const canvasTexture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, 128, 128);
    ctx.fillStyle = '#555';
    ctx.font = 'bold 28px "Segoe UI", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(face.name, 64, 64);
    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    return tex;
  }, [face.name]);

  // Dispose GPU texture when face.name changes or component unmounts
  useEffect(() => {
    return () => { canvasTexture.dispose(); };
  }, [canvasTexture]);

  return (
    <group position={face.position} rotation={face.rotation}>
      {/* Invisible hit area */}
      <mesh
        onPointerOver={(e) => { e.stopPropagation(); onHover(); }}
        onPointerOut={(e) => { e.stopPropagation(); onUnhover(); }}
        onClick={(e) => { e.stopPropagation(); onClick(); }}
      >
        <planeGeometry args={face.size} />
        <meshBasicMaterial
          color={isHovered ? '#72a8ff' : '#dbe7f7'}
          transparent
          opacity={isHovered ? 0.86 : 0.08}
          depthTest={false}
        />
      </mesh>
      {/* Text label */}
      <mesh position={[0, 0, 0.001]}>
        <planeGeometry args={face.size} />
        <meshBasicMaterial
          map={canvasTexture}
          transparent
          opacity={isActive ? 1 : 0.78}
          color={isActive ? '#0d4f9b' : '#ffffff'}
          depthTest={false}
        />
      </mesh>
      {isActive && (
        <mesh position={[0, 0, 0.0005]}>
          <planeGeometry args={[face.size[0] * 0.92, face.size[1] * 0.92]} />
          <meshBasicMaterial color="#75b9ff" transparent opacity={0.16} depthTest={false} />
        </mesh>
      )}
    </group>
  );
}

/** Invisible clickable edge hit-zone */
function EdgeHitZone({
  edge,
  isHovered,
  onHover,
  onUnhover,
  onClick,
}: {
  edge: EdgeDef;
  isHovered: boolean;
  onHover: () => void;
  onUnhover: () => void;
  onClick: () => void;
}) {
  return (
    <mesh
      position={edge.position}
      rotation={edge.rotation}
      onPointerOver={(e) => { e.stopPropagation(); onHover(); }}
      onPointerOut={(e) => { e.stopPropagation(); onUnhover(); }}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
    >
      <planeGeometry args={edge.size} />
      <meshBasicMaterial
        color="#ff9f2f"
        transparent
        opacity={isHovered ? 0.72 : 0.22}
        depthTest={false}
      />
    </mesh>
  );
}

/** Invisible clickable corner hit-zone */
function CornerHitZone({
  corner,
  isHovered,
  onHover,
  onUnhover,
  onClick,
}: {
  corner: CornerDef;
  isHovered: boolean;
  onHover: () => void;
  onUnhover: () => void;
  onClick: () => void;
}) {
  return (
    <mesh
      position={corner.position}
      onPointerOver={(e) => { e.stopPropagation(); onHover(); }}
      onPointerOut={(e) => { e.stopPropagation(); onUnhover(); }}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
    >
      <sphereGeometry args={[corner.size, 8, 8]} />
      <meshBasicMaterial
        color="#ffb14a"
        transparent
        opacity={isHovered ? 0.78 : 0.28}
        depthTest={false}
      />
    </mesh>
  );
}

/** Single axis arrow with cone arrowhead and letter label */
function AxisArrow({ dir, color, label }: { dir: [number, number, number]; color: string; label: string }) {
  const len = 1.8;
  const coneLen = 0.3;
  const coneRadius = 0.1;
  const conePos: [number, number, number] = [dir[0] * (len - coneLen / 2), dir[1] * (len - coneLen / 2), dir[2] * (len - coneLen / 2)];
  const labelPos: [number, number, number] = [dir[0] * (len + 0.45), dir[1] * (len + 0.45), dir[2] * (len + 0.45)];

  // Quaternion to rotate the cone (default points up +Y) to the axis direction
  const coneQuat = useMemo(() => {
    const q = new THREE.Quaternion();
    const from = new THREE.Vector3(0, 1, 0);
    const to = new THREE.Vector3(...dir).normalize();
    q.setFromUnitVectors(from, to);
    return q;
  }, [dir]);

  // Build the shaft geometry ONCE per direction. The previous inline
  // <bufferAttribute args={[new Float32Array(...)]}> pattern re-allocated the
  // Float32Array on every render and R3F rebuilt the GPU buffer each time,
  // leaving the old one orphaned without an explicit dispose. We key the memo
  // on dir's components (not the `end` array, which is a fresh literal each
  // render) so the geometry is stable across re-renders.
  const [dx, dy, dz] = dir;
  const shaft = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([0, 0, 0, dx * len, dy * len, dz * len], 3),
    );
    const mat = new THREE.LineBasicMaterial({ color });
    return new THREE.Line(g, mat);
  }, [dx, dy, dz, len, color]);
  useEffect(() => () => {
    shaft.geometry.dispose();
    (shaft.material as THREE.Material).dispose();
  }, [shaft]);

  return (
    <group>
      {/* Line shaft */}
      <primitive object={shaft} />
      {/* Cone arrowhead */}
      <mesh position={conePos} quaternion={coneQuat}>
        <coneGeometry args={[coneRadius, coneLen, 8]} />
        <meshBasicMaterial color={color} />
      </mesh>
      {/* Axis letter label */}
      <Html position={labelPos} center style={{ pointerEvents: 'none' }}>
        <span style={{
          color,
          fontSize: '13px',
          fontWeight: 800,
          fontFamily: '"Segoe UI", Arial, sans-serif',
          textShadow: `0 0 4px rgba(0,0,0,0.25), 0 1px 2px rgba(0,0,0,0.15)`,
          userSelect: 'none',
          letterSpacing: '0.5px',
        }}>{label}</span>
      </Html>
    </group>
  );
}

/** Colored X/Y/Z axis triad originating from the bottom-left-front corner of the cube */
function AxisTriad() {
  // Origin at bottom-left-front corner of the cube
  const origin: [number, number, number] = [-HALF, -HALF, HALF];
  return (
    <group position={origin}>
      {/* X axis - Red (goes right) */}
      <AxisArrow dir={[1, 0, 0]} color="#e03030" label="X" />
      {/* Y axis - Green (goes up) */}
      <AxisArrow dir={[0, 1, 0]} color="#30a030" label="Y" />
      {/* Z axis - Blue (goes back / toward viewer) */}
      <AxisArrow dir={[0, 0, 1]} color="#3070e0" label="Z" />
    </group>
  );
}

/** Mini scene that mirrors the main camera rotation */
export default function ViewCubeScene({
  mainCameraQuaternion,
  onOrient,
  onPreviewLabel,
  dragSuppressed = false,
}: {
  mainCameraQuaternion: THREE.Quaternion;
  onOrient: (q: THREE.Quaternion) => void;
  onPreviewLabel?: (label: string | null) => void;
  dragSuppressed?: boolean;
}) {
  const { camera, invalidate } = useThree();
  const [hoveredZone, setHoveredZone] = useState<string | null>(null);
  const groupRef = useRef<THREE.Group>(null);

  // Sync mini-camera to mirror main camera rotation.
  // Strategy: request ONE frame per quaternion update (via useEffect), then
  // update the mini-camera in that frame. Never call invalidate() inside useFrame
  // — that would create the unconditional 60fps loop that previously locked both
  // canvases at full frame rate even when the viewport was completely idle.
  const dirScratch = useRef(new THREE.Vector3());
  const upScratch = useRef(new THREE.Vector3());
  useEffect(() => {
    // Each time the quaternion prop changes, schedule one render frame so the
    // view cube mini-camera gets updated.  useFrame then applies the new
    // orientation without scheduling any further frames.
    invalidate();
  }, [mainCameraQuaternion, invalidate]);
  useFrame(() => {
    const dir = dirScratch.current.set(0, 0, 1).applyQuaternion(mainCameraQuaternion);
    const up = upScratch.current.set(0, 1, 0).applyQuaternion(mainCameraQuaternion).normalize();
    camera.position.copy(dir).multiplyScalar(5);
    camera.up.copy(up);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    // No invalidate() here — one frame per quaternion update is enough.
  });

  const activeFace = useMemo(() => {
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(mainCameraQuaternion).normalize();
    const view = forward.negate();
    let bestFace: FaceDef | null = null;
    let bestDot = -Infinity;
    for (const face of FACES) {
      const dot = view.dot(new THREE.Vector3(...face.normal).normalize());
      if (dot > bestDot) {
        bestDot = dot;
        bestFace = face;
      }
    }
    return bestFace && bestDot > 0.52 ? bestFace.name : null;
  }, [mainCameraQuaternion]);

  const preview = useCallback((label: string | null) => {
    setHoveredZone(label);
    onPreviewLabel?.(label ? `Snap to ${label.replaceAll('-', ' ')}` : null);
  }, [onPreviewLabel]);

  const handleFaceClick = useCallback((face: FaceDef) => {
    const q = orientationQuaternion(face.normal, face.up);
    onOrient(q);
  }, [onOrient]);

  const handleEdgeClick = useCallback((edge: EdgeDef) => {
    const q = orientationQuaternion(edge.direction, edge.up);
    onOrient(q);
  }, [onOrient]);

  const handleCornerClick = useCallback((corner: CornerDef) => {
    const q = orientationQuaternion(corner.direction, corner.up);
    onOrient(q);
  }, [onOrient]);

  return (
    <group ref={groupRef}>
      {/* Lighting for the mini cube */}
      <ambientLight intensity={0.7} />
      <directionalLight position={[3, 4, 5]} intensity={0.8} />

      <CubeBody hoveredZone={hoveredZone} activeFace={activeFace} />
      <CubeEdges />

      {/* Face labels */}
      {FACES.map((face) => (
        <FaceLabel
          key={face.name}
          face={face}
          isHovered={hoveredZone === face.name}
          isActive={activeFace === face.name}
          onHover={() => preview(face.name)}
          onUnhover={() => preview(null)}
          onClick={() => { if (!dragSuppressed) handleFaceClick(face); }}
        />
      ))}

      {/* Edge hit zones */}
      {EDGES.map((edge) => (
        <EdgeHitZone
          key={edge.name}
          edge={edge}
          isHovered={hoveredZone === edge.name}
          onHover={() => preview(edge.name)}
          onUnhover={() => preview(null)}
          onClick={() => { if (!dragSuppressed) handleEdgeClick(edge); }}
        />
      ))}

      {/* Corner hit zones */}
      {CORNERS.map((corner) => (
        <CornerHitZone
          key={corner.name}
          corner={corner}
          isHovered={hoveredZone === corner.name}
          onHover={() => preview(corner.name)}
          onUnhover={() => preview(null)}
          onClick={() => { if (!dragSuppressed) handleCornerClick(corner); }}
        />
      ))}

      {/* Axis triad below/beside the cube - like Fusion 360 */}
      <AxisTriad />
    </group>
  );
}
