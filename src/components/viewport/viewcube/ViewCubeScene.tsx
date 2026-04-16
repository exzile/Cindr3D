import { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import {
  CUBE_SIZE, HALF, FACES, EDGES, CORNERS, orientationQuaternion,
  type FaceDef, type EdgeDef, type CornerDef,
} from './defs';

/** The main textured cube body */
function CubeBody({ hoveredZone }: { hoveredZone: string | null }) {
  void hoveredZone; // reserved for future hover highlight effect
  const meshRef = useRef<THREE.Mesh>(null);

  return (
    <mesh ref={meshRef}>
      <boxGeometry args={[CUBE_SIZE, CUBE_SIZE, CUBE_SIZE]} />
      <meshStandardMaterial color="#e8e8ec" roughness={0.7} metalness={0.05} />
    </mesh>
  );
}

/** Wireframe edges of the cube */
function CubeEdges() {
  return (
    <lineSegments>
      <edgesGeometry args={[new THREE.BoxGeometry(CUBE_SIZE, CUBE_SIZE, CUBE_SIZE)]} />
      <lineBasicMaterial color="#999" />
    </lineSegments>
  );
}

/** A single clickable face label overlay */
function FaceLabel({
  face,
  isHovered,
  onHover,
  onUnhover,
  onClick,
}: {
  face: FaceDef;
  isHovered: boolean;
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
          color={isHovered ? '#b0c4ff' : '#e8e8ec'}
          transparent
          opacity={isHovered ? 0.85 : 0.01}
          depthTest={false}
        />
      </mesh>
      {/* Text label */}
      <mesh position={[0, 0, 0.001]}>
        <planeGeometry args={face.size} />
        <meshBasicMaterial map={canvasTexture} transparent depthTest={false} />
      </mesh>
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
        color="#7090ff"
        transparent
        opacity={isHovered ? 0.6 : 0}
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
        color="#7090ff"
        transparent
        opacity={isHovered ? 0.7 : 0}
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
  const end: [number, number, number] = [dir[0] * len, dir[1] * len, dir[2] * len];
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

  return (
    <group>
      {/* Line shaft */}
      <line>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            args={[new Float32Array([0, 0, 0, ...end]), 3]}
          />
        </bufferGeometry>
        <lineBasicMaterial color={color} linewidth={2} />
      </line>
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
}: {
  mainCameraQuaternion: THREE.Quaternion;
  onOrient: (q: THREE.Quaternion) => void;
}) {
  const { camera } = useThree();
  const [hoveredZone, setHoveredZone] = useState<string | null>(null);
  const groupRef = useRef<THREE.Group>(null);

  // Sync mini-camera to mirror main camera rotation
  useFrame(() => {
    // Position the mini camera to look at origin from the same orientation as the main camera
    const dir = new THREE.Vector3(0, 0, 1).applyQuaternion(mainCameraQuaternion);
    camera.position.copy(dir.multiplyScalar(5));
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
  });

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

      <CubeBody hoveredZone={hoveredZone} />
      <CubeEdges />

      {/* Face labels */}
      {FACES.map((face) => (
        <FaceLabel
          key={face.name}
          face={face}
          isHovered={hoveredZone === face.name}
          onHover={() => setHoveredZone(face.name)}
          onUnhover={() => setHoveredZone(null)}
          onClick={() => handleFaceClick(face)}
        />
      ))}

      {/* Edge hit zones */}
      {EDGES.map((edge) => (
        <EdgeHitZone
          key={edge.name}
          edge={edge}
          isHovered={hoveredZone === edge.name}
          onHover={() => setHoveredZone(edge.name)}
          onUnhover={() => setHoveredZone(null)}
          onClick={() => handleEdgeClick(edge)}
        />
      ))}

      {/* Corner hit zones */}
      {CORNERS.map((corner) => (
        <CornerHitZone
          key={corner.name}
          corner={corner}
          isHovered={hoveredZone === corner.name}
          onHover={() => setHoveredZone(corner.name)}
          onUnhover={() => setHoveredZone(null)}
          onClick={() => handleCornerClick(corner)}
        />
      ))}

      {/* Axis triad below/beside the cube - like Fusion 360 */}
      <AxisTriad />
    </group>
  );
}
