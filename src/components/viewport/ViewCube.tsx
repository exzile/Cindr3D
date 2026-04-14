import { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';

// ---- Orientation definitions ----

interface FaceDef {
  name: string;
  normal: [number, number, number];
  up: [number, number, number];
  position: [number, number, number];
  rotation: [number, number, number];
  size: [number, number];
}

interface EdgeDef {
  name: string;
  /** Midpoint of the two adjacent face-normals (normalised later) */
  direction: [number, number, number];
  up: [number, number, number];
  position: [number, number, number];
  rotation: [number, number, number];
  size: [number, number];
}

interface CornerDef {
  name: string;
  direction: [number, number, number];
  up: [number, number, number];
  position: [number, number, number];
  size: number;
}

const CUBE_SIZE = 1.6;
const HALF = CUBE_SIZE / 2;
const FACE_INSET = 0.001; // slight inset so hover planes sit on top of the cube

const FACES: FaceDef[] = [
  { name: 'TOP',    normal: [0, 1, 0],  up: [0, 0, -1], position: [0, HALF + FACE_INSET, 0],  rotation: [-Math.PI / 2, 0, 0], size: [CUBE_SIZE, CUBE_SIZE] },
  { name: 'BOTTOM', normal: [0, -1, 0], up: [0, 0, 1],  position: [0, -HALF - FACE_INSET, 0], rotation: [Math.PI / 2, 0, 0],  size: [CUBE_SIZE, CUBE_SIZE] },
  { name: 'FRONT',  normal: [0, 0, 1],  up: [0, 1, 0],  position: [0, 0, HALF + FACE_INSET],  rotation: [0, 0, 0],            size: [CUBE_SIZE, CUBE_SIZE] },
  { name: 'BACK',   normal: [0, 0, -1], up: [0, 1, 0],  position: [0, 0, -HALF - FACE_INSET], rotation: [0, Math.PI, 0],      size: [CUBE_SIZE, CUBE_SIZE] },
  { name: 'RIGHT',  normal: [1, 0, 0],  up: [0, 1, 0],  position: [HALF + FACE_INSET, 0, 0],  rotation: [0, Math.PI / 2, 0],  size: [CUBE_SIZE, CUBE_SIZE] },
  { name: 'LEFT',   normal: [-1, 0, 0], up: [0, 1, 0],  position: [-HALF - FACE_INSET, 0, 0], rotation: [0, -Math.PI / 2, 0], size: [CUBE_SIZE, CUBE_SIZE] },
];

// Edge hit-regions: thin rectangles along each edge of the cube
const E = HALF + FACE_INSET * 2;
const ET = 0.18; // edge thickness for hit region

const EDGES: EdgeDef[] = [
  // Top edges
  { name: 'Top-Front',  direction: [0, 1, 1],   up: [0, 1, 0],  position: [0, E, E],    rotation: [Math.PI / 4, 0, 0],               size: [CUBE_SIZE, ET] },
  { name: 'Top-Back',   direction: [0, 1, -1],  up: [0, 1, 0],  position: [0, E, -E],   rotation: [-Math.PI / 4, 0, 0],              size: [CUBE_SIZE, ET] },
  { name: 'Top-Right',  direction: [1, 1, 0],   up: [0, 1, 0],  position: [E, E, 0],    rotation: [0, 0, -Math.PI / 4],              size: [ET, CUBE_SIZE] },
  { name: 'Top-Left',   direction: [-1, 1, 0],  up: [0, 1, 0],  position: [-E, E, 0],   rotation: [0, 0, Math.PI / 4],               size: [ET, CUBE_SIZE] },
  // Bottom edges
  { name: 'Bottom-Front', direction: [0, -1, 1],  up: [0, -1, 0], position: [0, -E, E],   rotation: [-Math.PI / 4, 0, 0],             size: [CUBE_SIZE, ET] },
  { name: 'Bottom-Back',  direction: [0, -1, -1], up: [0, -1, 0], position: [0, -E, -E],  rotation: [Math.PI / 4, 0, 0],              size: [CUBE_SIZE, ET] },
  { name: 'Bottom-Right', direction: [1, -1, 0],  up: [0, -1, 0], position: [E, -E, 0],   rotation: [0, 0, Math.PI / 4],              size: [ET, CUBE_SIZE] },
  { name: 'Bottom-Left',  direction: [-1, -1, 0], up: [0, -1, 0], position: [-E, -E, 0],  rotation: [0, 0, -Math.PI / 4],             size: [ET, CUBE_SIZE] },
  // Vertical edges
  { name: 'Front-Right', direction: [1, 0, 1],   up: [0, 1, 0],  position: [E, 0, E],    rotation: [0, Math.PI / 4, 0],              size: [ET, CUBE_SIZE] },
  { name: 'Front-Left',  direction: [-1, 0, 1],  up: [0, 1, 0],  position: [-E, 0, E],   rotation: [0, -Math.PI / 4, 0],             size: [ET, CUBE_SIZE] },
  { name: 'Back-Right',  direction: [1, 0, -1],  up: [0, 1, 0],  position: [E, 0, -E],   rotation: [0, -Math.PI / 4, 0],             size: [ET, CUBE_SIZE] },
  { name: 'Back-Left',   direction: [-1, 0, -1], up: [0, 1, 0],  position: [-E, 0, -E],  rotation: [0, Math.PI / 4, 0],              size: [ET, CUBE_SIZE] },
];

const C = HALF + FACE_INSET * 3;
const CS = 0.22; // corner hit region size

const CORNERS: CornerDef[] = [
  { name: 'Top-Front-Right',  direction: [1, 1, 1],    up: [0, 1, 0], position: [C, C, C],    size: CS },
  { name: 'Top-Front-Left',   direction: [-1, 1, 1],   up: [0, 1, 0], position: [-C, C, C],   size: CS },
  { name: 'Top-Back-Right',   direction: [1, 1, -1],   up: [0, 1, 0], position: [C, C, -C],   size: CS },
  { name: 'Top-Back-Left',    direction: [-1, 1, -1],  up: [0, 1, 0], position: [-C, C, -C],  size: CS },
  { name: 'Bottom-Front-Right', direction: [1, -1, 1],  up: [0, -1, 0], position: [C, -C, C],   size: CS },
  { name: 'Bottom-Front-Left',  direction: [-1, -1, 1], up: [0, -1, 0], position: [-C, -C, C],  size: CS },
  { name: 'Bottom-Back-Right',  direction: [1, -1, -1], up: [0, -1, 0], position: [C, -C, -C],  size: CS },
  { name: 'Bottom-Back-Left',   direction: [-1, -1, -1],up: [0, -1, 0], position: [-C, -C, -C], size: CS },
];

// Helper: compute a quaternion that orients the camera looking from `direction` toward origin, with given up
function orientationQuaternion(direction: [number, number, number], up: [number, number, number]): THREE.Quaternion {
  const dir = new THREE.Vector3(...direction).normalize();
  const upVec = new THREE.Vector3(...up).normalize();
  const m = new THREE.Matrix4();
  m.lookAt(dir.multiplyScalar(5), new THREE.Vector3(0, 0, 0), upVec);
  return new THREE.Quaternion().setFromRotationMatrix(m);
}

// Closest face label based on camera direction
function closestFaceLabel(cameraQuaternion: THREE.Quaternion): string {
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(cameraQuaternion).normalize();
  // Camera looks at origin, so the face we see is opposite to the camera direction
  let best = '';
  let bestDot = -Infinity;
  for (const face of FACES) {
    const n = new THREE.Vector3(...face.normal);
    const dot = n.dot(forward.clone().negate());
    if (dot > bestDot) {
      bestDot = dot;
      best = face.name;
    }
  }
  // Capitalize first letter only
  return best.charAt(0) + best.slice(1).toLowerCase();
}

// ---- Inner scene components ----

/** The main textured cube body */
function CubeBody({ hoveredZone: _hoveredZone }: { hoveredZone: string | null }) {
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
function ViewCubeScene({
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

// ---- Navigation button SVG icons ----

function HomeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  );
}

function ArrowIcon({ rotation }: { rotation: number }) {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" style={{ transform: `rotate(${rotation}deg)` }}>
      <path d="M12 2l-8 14h16z" />
    </svg>
  );
}

function OrbitIcon({ rotation }: { rotation: number }) {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ transform: `rotate(${rotation}deg)` }}>
      <path d="M4 12a8 8 0 0 1 14-5" />
      <path d="M18 7l1.5-3.5L16 5" fill="currentColor" stroke="none" />
    </svg>
  );
}

function ZoomFitIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
    </svg>
  );
}

// ---- Public component ----

interface ViewCubeProps {
  /** Quaternion from the main camera, updated every frame */
  mainCameraQuaternion: THREE.Quaternion;
  /** Called when the user clicks a face/edge/corner to request a new orientation */
  onOrient: (targetQuaternion: THREE.Quaternion) => void;
  /** Go to home view */
  onHome?: () => void;
  /** Zoom to fit all objects */
  onZoomFit?: () => void;
}

export default function ViewCube({ mainCameraQuaternion, onOrient, onHome, onZoomFit }: ViewCubeProps) {
  const [label, setLabel] = useState('Front');

  useEffect(() => {
    const l = closestFaceLabel(mainCameraQuaternion);
    setLabel(l);
  }, [mainCameraQuaternion]);

  // Orbit helpers: rotate the current camera orientation by a small angle
  const orbitBy = useCallback((axis: 'x' | 'y', angleDeg: number) => {
    const angle = (angleDeg * Math.PI) / 180;
    const rotQ = new THREE.Quaternion();
    if (axis === 'y') {
      rotQ.setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle);
    } else {
      // Rotate around the camera's local X axis
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(mainCameraQuaternion);
      rotQ.setFromAxisAngle(right, angle);
    }
    const newQ = rotQ.clone().multiply(mainCameraQuaternion);
    onOrient(newQ);
  }, [mainCameraQuaternion, onOrient]);

  return (
    <div className="viewcube-wrapper">
      {/* Top row: home + orbit CW/CCW */}
      <div className="vc-nav-row vc-nav-top">
        <button className="vc-nav-btn" title="Go Home" onClick={onHome}>
          <HomeIcon />
        </button>
        <div className="vc-nav-spacer" />
        <button className="vc-nav-btn" title="Orbit Left" onClick={() => orbitBy('y', 15)}>
          <OrbitIcon rotation={0} />
        </button>
        <button className="vc-nav-btn" title="Orbit Right" onClick={() => orbitBy('y', -15)}>
          <OrbitIcon rotation={180} />
        </button>
      </div>

      {/* Middle row: left arrows, cube, right arrows */}
      <div className="vc-nav-row vc-nav-middle">
        <div className="vc-nav-col">
          <button className="vc-nav-btn" title="Orbit Up" onClick={() => orbitBy('x', 15)}>
            <ArrowIcon rotation={0} />
          </button>
          <button className="vc-nav-btn" title="Orbit Down" onClick={() => orbitBy('x', -15)}>
            <ArrowIcon rotation={180} />
          </button>
        </div>

        <div className="viewcube-container">
          <Canvas
            orthographic
            camera={{ zoom: 22, near: 0.1, far: 100, position: [0, 0, 5] }}
            style={{ width: 140, height: 140, background: 'transparent' }}
            gl={{ alpha: true, antialias: true }}
          >
            <ViewCubeScene
              mainCameraQuaternion={mainCameraQuaternion}
              onOrient={onOrient}
            />
          </Canvas>
        </div>

        <div className="vc-nav-col">
          <button className="vc-nav-btn" title="Orbit Left" onClick={() => orbitBy('y', 15)}>
            <ArrowIcon rotation={-90} />
          </button>
          <button className="vc-nav-btn" title="Orbit Right" onClick={() => orbitBy('y', -15)}>
            <ArrowIcon rotation={90} />
          </button>
        </div>
      </div>

      {/* Bottom row: zoom fit + label */}
      <div className="vc-nav-row vc-nav-bottom">
        <button className="vc-nav-btn" title="Zoom to Fit" onClick={onZoomFit}>
          <ZoomFitIcon />
        </button>
        <div className="viewcube-label">{label}</div>
      </div>
    </div>
  );
}
