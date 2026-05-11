import { Text } from '@react-three/drei';

/** Single Z label floating above the bed centre. */
export function AxisLabels() {
  return (
    <group>
      <Text position={[0, 0.35, 0]} fontSize={0.038} color="#3b82f6" anchorX="center" anchorY="middle">Z</Text>
    </group>
  );
}
