import { useThemeStore } from '../../../store/themeStore';

export default function WorldAxes() {
  const themeColors = useThemeStore((s) => s.colors);
  const AXIS_LEN = 500;

  return (
    <group>
      {/* X axis — Red */}
      <line>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            args={[new Float32Array([-AXIS_LEN, 0, 0, AXIS_LEN, 0, 0]), 3]}
          />
        </bufferGeometry>
        <lineBasicMaterial color={themeColors.axisRed} linewidth={2} />
      </line>
      {/* Y axis — Green (vertical/up). themeStore: axisGreen = Y */}
      <line>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            args={[new Float32Array([0, -AXIS_LEN, 0, 0, AXIS_LEN, 0]), 3]}
          />
        </bufferGeometry>
        <lineBasicMaterial color={themeColors.axisGreen} linewidth={2} />
      </line>
      {/* Z axis — Blue (depth). themeStore: axisBlue = Z */}
      <line>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            args={[new Float32Array([0, 0, -AXIS_LEN, 0, 0, AXIS_LEN]), 3]}
          />
        </bufferGeometry>
        <lineBasicMaterial color={themeColors.axisBlue} linewidth={2} />
      </line>
    </group>
  );
}
