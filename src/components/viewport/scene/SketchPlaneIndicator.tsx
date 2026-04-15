import * as THREE from 'three';
import { useCADStore } from '../../../store/cadStore';

export default function SketchPlaneIndicator() {
  const activeSketch = useCADStore((s) => s.activeSketch);

  if (!activeSketch) return null;

  if (activeSketch.plane === 'custom') {
    const quat = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 0, 1),
      activeSketch.planeNormal.clone().normalize(),
    );
    return (
      <mesh position={activeSketch.planeOrigin} quaternion={quat}>
        <planeGeometry args={[200, 200]} />
        <meshBasicMaterial
          color={0x4488ff}
          transparent
          opacity={0.05}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
    );
  }

  // Rotations must produce a mesh whose normal matches the sketch plane normal:
  //   PlaneGeometry default faces +Z (vertical wall). Rotating by -90° around X
  //   makes it horizontal (faces +Y). Rotating by +90° around Y makes it face +X.
  const planeRotation: [number, number, number] = (() => {
    switch (activeSketch.plane) {
      case 'XY': return [-Math.PI / 2, 0, 0];
      case 'XZ': return [0, 0, 0];
      case 'YZ': return [0, Math.PI / 2, 0];
      default:   return [-Math.PI / 2, 0, 0];
    }
  })();

  return (
    <mesh rotation={planeRotation} position={[0, 0, 0]}>
      <planeGeometry args={[200, 200]} />
      <meshBasicMaterial
        color={0x4488ff}
        transparent
        opacity={0.05}
        side={THREE.DoubleSide}
        depthWrite={false}
      />
    </mesh>
  );
}
