import { useEffect, useRef, useMemo, useState } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useCADStore } from '../../../store/cadStore';

// ─── Module-level constants (built once, reused) ─────────────────────────────

const PLANE_SIZE = 40;
const HALF_PS = PLANE_SIZE / 2;
const GRID_DIVISIONS = 10;

/** LineSegments positions for a 10×10 grid on the Z=0 plane */
const PLANE_GRID_POSITIONS = (() => {
  const step = PLANE_SIZE / GRID_DIVISIONS;
  const pts: number[] = [];
  for (let i = 0; i <= GRID_DIVISIONS; i++) {
    const t = -HALF_PS + i * step;
    pts.push(-HALF_PS, t, 0,  HALF_PS, t, 0); // horizontal
    pts.push(t, -HALF_PS, 0,  t, HALF_PS, 0); // vertical
  }
  return new Float32Array(pts);
})();

/** Border quad for the plane edge */
const BORDER_POSITIONS = new Float32Array([
  -HALF_PS, -HALF_PS, 0,
   HALF_PS, -HALF_PS, 0,
   HALF_PS,  HALF_PS, 0,
  -HALF_PS,  HALF_PS, 0,
]);

/** Pre-built face-hover ring (radius 8, 64 segments) */
const FACE_RING_POSITIONS = (() => {
  const pts: number[] = [];
  for (let i = 0; i <= 64; i++) {
    const a = (i / 64) * Math.PI * 2;
    pts.push(Math.cos(a) * 8, Math.sin(a) * 8, 0);
  }
  return new Float32Array(pts);
})();

// ─── Types ───────────────────────────────────────────────────────────────────

interface PlaneConfig {
  id: string;
  plane: 'XY' | 'XZ' | 'YZ';
  color: string;
  gridColor: string;
  hoverColor: string;
  position: [number, number, number];
  rotation: [number, number, number];
}

// ─── Sub-component: one glass plane with guaranteed grid lines ────────────────

function PlaneGlassPanel({
  plane: p,
  isHovered,
  onHoverIn,
  onHoverOut,
  onClick,
}: {
  plane: PlaneConfig;
  isHovered: boolean;
  onHoverIn: () => void;
  onHoverOut: () => void;
  onClick: () => void;
}) {
  // Build the THREE.LineSegments object once — imperative so it definitely renders
  const gridLines = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      'position',
      new THREE.BufferAttribute(PLANE_GRID_POSITIONS.slice(), 3),
    );
    const mat = new THREE.LineBasicMaterial({
      color: new THREE.Color(p.gridColor),
      transparent: true,
      opacity: 0.70,
      depthWrite: false,
    });
    return new THREE.LineSegments(geo, mat);
  // Only rebuild when the plane changes (never in practice)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.id]);

  // Reactively update color + opacity on hover without rebuilding geometry
  useEffect(() => {
    const mat = gridLines.material as THREE.LineBasicMaterial;
    mat.color.set(isHovered ? p.hoverColor : p.gridColor);
    mat.opacity = isHovered ? 0.95 : 0.70;
    mat.needsUpdate = true;
  }, [isHovered, gridLines, p.gridColor, p.hoverColor]);

  // Dispose GPU resources when component unmounts
  useEffect(() => {
    return () => {
      gridLines.geometry.dispose();
      (gridLines.material as THREE.LineBasicMaterial).dispose();
    };
  }, [gridLines]);

  return (
    <group>
      {/* Glass fill — phong so scene lights create a subtle sheen */}
      <mesh
        position={p.position}
        rotation={p.rotation}
        onPointerOver={(e) => { e.stopPropagation(); onHoverIn(); }}
        onPointerOut={(e) => { e.stopPropagation(); onHoverOut(); }}
        onClick={(e) => { e.stopPropagation(); onClick(); }}
      >
        <planeGeometry args={[PLANE_SIZE, PLANE_SIZE]} />
        <meshPhongMaterial
          color={isHovered ? p.hoverColor : p.gridColor}
          emissive={p.color}
          emissiveIntensity={isHovered ? 0.40 : 0.20}
          transparent
          opacity={isHovered ? 0.48 : 0.24}
          shininess={160}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>

      {/* Grid lines — rendered via primitive so THREE.LineSegments is used directly */}
      <primitive object={gridLines} position={p.position} rotation={p.rotation} />

      {/* Bright border */}
      <lineLoop position={p.position} rotation={p.rotation}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[BORDER_POSITIONS, 3]} />
        </bufferGeometry>
        <lineBasicMaterial
          color={isHovered ? '#ffffff' : p.hoverColor}
          transparent
          opacity={isHovered ? 1.0 : 0.90}
        />
      </lineLoop>
    </group>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

/** Interactive plane selector for "Create Sketch" — shows 3 origin planes */
export default function SketchPlaneSelector() {
  const selecting = useCADStore((s) => s.sketchPlaneSelecting);
  const startSketch = useCADStore((s) => s.startSketch);
  const startSketchOnFace = useCADStore((s) => s.startSketchOnFace);
  const setSketchPlaneSelecting = useCADStore((s) => s.setSketchPlaneSelecting);
  const setStatusMessage = useCADStore((s) => s.setStatusMessage);

  const [hovered, setHovered] = useState<string | null>(null);
  const [faceHit, setFaceHit] = useState<{ point: THREE.Vector3; normal: THREE.Vector3 } | null>(null);
  const faceHitRef = useRef(faceHit);
  useEffect(() => { faceHitRef.current = faceHit; }, [faceHit]);

  const _mouse = useRef(new THREE.Vector2());
  const _normalMatrix = useRef(new THREE.Matrix3());
  const _pickableMeshes = useRef<THREE.Mesh[]>([]);
  const { gl, camera, raycaster, scene } = useThree();

  // Cursor
  useEffect(() => {
    if (!selecting) return;
    // eslint-disable-next-line react-hooks/immutability
    gl.domElement.style.cursor = (hovered || faceHit) ? 'pointer' : 'crosshair';
    return () => { gl.domElement.style.cursor = 'auto'; };
  }, [selecting, hovered, faceHit, gl]);

  // Escape to cancel
  useEffect(() => {
    if (!selecting) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSketchPlaneSelecting(false);
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [selecting, setSketchPlaneSelecting]);

  // Face raycasting
  useEffect(() => {
    if (!selecting) return;

    const refreshPickableMeshes = () => {
      const out = _pickableMeshes.current;
      out.length = 0;
      scene.traverse((obj) => {
        const m = obj as THREE.Mesh;
        if (m.isMesh && obj.userData?.pickable) out.push(m);
      });
    };

    refreshPickableMeshes();

    const updateMouseFromEvent = (event: { clientX: number; clientY: number }) => {
      const rect = gl.domElement.getBoundingClientRect();
      _mouse.current.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (_pickableMeshes.current.length === 0) refreshPickableMeshes();
      updateMouseFromEvent(event);
      raycaster.setFromCamera(_mouse.current, camera);
      const hits = raycaster.intersectObjects(_pickableMeshes.current, false);
      if (hits.length > 0 && hits[0].face) {
        const hit = hits[0];
        const normal = hit.face!.normal.clone()
          .applyMatrix3(_normalMatrix.current.getNormalMatrix(hit.object.matrixWorld))
          .normalize();
        setFaceHit({ point: hit.point.clone(), normal });
        setStatusMessage(`Face: normal (${normal.x.toFixed(2)}, ${normal.y.toFixed(2)}, ${normal.z.toFixed(2)})`);
      } else if (faceHitRef.current) {
        setFaceHit(null);
      }
    };

    const handleClick = (event: MouseEvent) => {
      if (event.button !== 0) return;
      refreshPickableMeshes();
      updateMouseFromEvent(event);
      raycaster.setFromCamera(_mouse.current, camera);
      const hits = raycaster.intersectObjects(_pickableMeshes.current, false);
      if (hits.length > 0 && hits[0].face) {
        const hit = hits[0];
        const normal = hit.face!.normal.clone()
          .applyMatrix3(_normalMatrix.current.getNormalMatrix(hit.object.matrixWorld))
          .normalize();
        event.stopPropagation();
        startSketchOnFace(normal, hit.point.clone());
        setFaceHit(null);
      }
    };

    const canvas = gl.domElement;
    canvas.addEventListener('pointermove', handlePointerMove);
    canvas.addEventListener('click', handleClick, true);
    return () => {
      canvas.removeEventListener('pointermove', handlePointerMove);
      canvas.removeEventListener('click', handleClick, true);
      setFaceHit(null);
      _pickableMeshes.current.length = 0;
    };
  }, [selecting, gl, camera, raycaster, scene, startSketchOnFace, setStatusMessage]);

  if (!selecting) return null;

  const planes: PlaneConfig[] = [
    {
      id: 'xy', plane: 'XY',
      color: '#1144bb', gridColor: '#4477ff', hoverColor: '#88bbff',
      position: [0, 0, 0], rotation: [-Math.PI / 2, 0, 0],
    },
    {
      id: 'xz', plane: 'XZ',
      color: '#0d6b0d', gridColor: '#22cc22', hoverColor: '#66ee66',
      position: [0, 0, 0], rotation: [0, 0, 0],
    },
    {
      id: 'yz', plane: 'YZ',
      color: '#991111', gridColor: '#ee2222', hoverColor: '#ff7777',
      position: [0, 0, 0], rotation: [0, Math.PI / 2, 0],
    },
  ];

  return (
    <group>
      {planes.map((p) => (
        <PlaneGlassPanel
          key={p.id}
          plane={p}
          isHovered={hovered === p.id}
          onHoverIn={() => setHovered(p.id)}
          onHoverOut={() => setHovered(null)}
          onClick={() => startSketch(p.plane)}
        />
      ))}

      {/* Face hover highlight */}
      {faceHit && (() => {
        const q = new THREE.Quaternion().setFromUnitVectors(
          new THREE.Vector3(0, 0, 1),
          faceHit.normal,
        );
        const pos = faceHit.point.clone().add(faceHit.normal.clone().multiplyScalar(0.05));
        return (
          <group position={pos} quaternion={q}>
            <mesh>
              <circleGeometry args={[8, 32]} />
              <meshBasicMaterial color={0xffcc33} transparent opacity={0.45} side={THREE.DoubleSide} depthWrite={false} />
            </mesh>
            <lineLoop>
              <bufferGeometry>
                <bufferAttribute attach="attributes-position" args={[FACE_RING_POSITIONS, 3]} />
              </bufferGeometry>
              <lineBasicMaterial color={0xffcc33} transparent opacity={0.9} />
            </lineLoop>
          </group>
        );
      })()}
    </group>
  );
}
