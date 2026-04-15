import { useEffect, useRef, useState } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useCADStore } from '../../../store/cadStore';

// Pre-built unit circle (radius 8) positions for the face-hover ring — module-level
// so we don't rebuild a Float32Array on every pointermove that updates faceHit state.
const FACE_RING_POSITIONS = (() => {
  const pts: number[] = [];
  for (let i = 0; i <= 64; i++) {
    const a = (i / 64) * Math.PI * 2;
    pts.push(Math.cos(a) * 8, Math.sin(a) * 8, 0);
  }
  return new Float32Array(pts);
})();

/** Interactive plane selection for "Create Sketch" — shows 3 origin planes the user can click */
export default function SketchPlaneSelector() {
  const selecting = useCADStore((s) => s.sketchPlaneSelecting);
  const startSketch = useCADStore((s) => s.startSketch);
  const startSketchOnFace = useCADStore((s) => s.startSketchOnFace);
  const setSketchPlaneSelecting = useCADStore((s) => s.setSketchPlaneSelecting);
  const setStatusMessage = useCADStore((s) => s.setStatusMessage);
  const [hovered, setHovered] = useState<string | null>(null);
  // Highlighted face hit (world-space normal + click point)
  const [faceHit, setFaceHit] = useState<{ point: THREE.Vector3; normal: THREE.Vector3 } | null>(null);
  // Mirror faceHit into a ref so the pointermove handler can read it without
  // becoming a useEffect dep (which would cause listener re-attachment on every hover).
  const faceHitRef = useRef(faceHit);
  useEffect(() => { faceHitRef.current = faceHit; }, [faceHit]);
  // Stable scratch objects for the hot-path raycasting handlers
  const _mouse = useRef(new THREE.Vector2());
  const _normalMatrix = useRef(new THREE.Matrix3());
  const _pickableMeshes = useRef<THREE.Mesh[]>([]);
  const { gl, camera, raycaster, scene } = useThree();

  // Change cursor when hovering a plane or a face
  useEffect(() => {
    if (!selecting) return;
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

  // Face raycasting against pickable meshes
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
      if (_pickableMeshes.current.length === 0) {
        refreshPickableMeshes();
      }

      updateMouseFromEvent(event);
      raycaster.setFromCamera(_mouse.current, camera);
      const hits = raycaster.intersectObjects(_pickableMeshes.current, false);
      if (hits.length > 0 && hits[0].face) {
        const hit = hits[0];
        // Transform face normal from local to world space (reusing scratch matrix)
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
      // Re-raycast on click (faceHit may be stale or null if pointer didn't move)
      refreshPickableMeshes();
      updateMouseFromEvent(event);
      raycaster.setFromCamera(_mouse.current, camera);
      const hits = raycaster.intersectObjects(_pickableMeshes.current, false);
      if (hits.length > 0 && hits[0].face) {
        const hit = hits[0];
        const normal = hit.face!.normal.clone()
          .applyMatrix3(_normalMatrix.current.getNormalMatrix(hit.object.matrixWorld))
          .normalize();
        // Stop event propagation so the origin-plane meshes don't also fire
        event.stopPropagation();
        startSketchOnFace(normal, hit.point.clone());
        setFaceHit(null);
      }
    };

    const canvas = gl.domElement;
    canvas.addEventListener('pointermove', handlePointerMove);
    // Use capture phase so we run BEFORE R3F's onClick handlers on the origin planes
    canvas.addEventListener('click', handleClick, true);
    return () => {
      canvas.removeEventListener('pointermove', handlePointerMove);
      canvas.removeEventListener('click', handleClick, true);
      setFaceHit(null);
      _pickableMeshes.current.length = 0;
    };
  }, [selecting, gl, camera, raycaster, scene, startSketchOnFace, setStatusMessage]);

  if (!selecting) return null;

  const PLANE_SIZE = 40;
  const HALF_PS = PLANE_SIZE / 2;

  const planes: { id: string; plane: 'XY' | 'XZ' | 'YZ'; color: string; hoverColor: string; position: [number, number, number]; rotation: [number, number, number]; labelPos: [number, number, number]; }[] = [
    {
      id: 'xy', plane: 'XY',
      color: '#4488ff', hoverColor: '#66aaff',
      position: [0, 0, 0],
      rotation: [-Math.PI / 2, 0, 0],
      labelPos: [HALF_PS + 3, 0, HALF_PS + 3],
    },
    {
      id: 'xz', plane: 'XZ',
      color: '#44cc44', hoverColor: '#66ee66',
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      labelPos: [HALF_PS + 3, HALF_PS + 3, 0],
    },
    {
      id: 'yz', plane: 'YZ',
      color: '#ff4444', hoverColor: '#ff6666',
      position: [0, 0, 0],
      rotation: [0, Math.PI / 2, 0],
      labelPos: [0, HALF_PS + 3, HALF_PS + 3],
    },
  ];

  return (
    <group>
      {planes.map((p) => {
        const isHovered = hovered === p.id;
        return (
          <group key={p.id}>
            {/* Clickable plane */}
            <mesh
              position={p.position}
              rotation={p.rotation}
              onPointerOver={(e) => { e.stopPropagation(); setHovered(p.id); }}
              onPointerOut={(e) => { e.stopPropagation(); setHovered(null); }}
              onClick={(e) => { e.stopPropagation(); startSketch(p.plane); }}
            >
              <planeGeometry args={[PLANE_SIZE, PLANE_SIZE]} />
              <meshBasicMaterial
                color={isHovered ? p.hoverColor : p.color}
                transparent
                opacity={isHovered ? 0.35 : 0.15}
                side={THREE.DoubleSide}
                depthWrite={false}
              />
            </mesh>

            {/* Plane border */}
            <lineLoop
              position={p.position}
              rotation={p.rotation}
            >
              <bufferGeometry>
                <bufferAttribute
                  attach="attributes-position"
                  args={[new Float32Array([
                    -HALF_PS, -HALF_PS, 0,
                     HALF_PS, -HALF_PS, 0,
                     HALF_PS,  HALF_PS, 0,
                    -HALF_PS,  HALF_PS, 0,
                  ]), 3]}
                />
              </bufferGeometry>
              <lineBasicMaterial
                color={isHovered ? p.hoverColor : p.color}
                transparent
                opacity={isHovered ? 0.8 : 0.4}
              />
            </lineLoop>
          </group>
        );
      })}

      {/* Face hover highlight — yellow translucent disc oriented to the face */}
      {faceHit && (() => {
        // Quaternion that rotates the disc's local +Z (its face normal) to the world face normal
        const q = new THREE.Quaternion().setFromUnitVectors(
          new THREE.Vector3(0, 0, 1),
          faceHit.normal,
        );
        // Push the disc out slightly along the normal so it doesn't z-fight the face
        const offset = faceHit.normal.clone().multiplyScalar(0.05);
        const pos = faceHit.point.clone().add(offset);
        return (
          <group position={pos} quaternion={q}>
            <mesh>
              <circleGeometry args={[8, 32]} />
              <meshBasicMaterial
                color={0xffcc33}
                transparent
                opacity={0.45}
                side={THREE.DoubleSide}
                depthWrite={false}
              />
            </mesh>
            {/* Border ring — uses pre-built positions hoisted at module scope */}
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
