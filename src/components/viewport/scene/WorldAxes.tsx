import { useThemeStore } from '../../../store/themeStore';
import { useCADStore } from '../../../store/cadStore';

const AXIS_LEN = 500;

// Module-level position buffers. Inline `new Float32Array(...)` in JSX
// re-allocated on every render and R3F rebuilt the GPU buffer, orphaning
// the old one (see memory/r3f_critical_patterns.md).
const X_AXIS_POSITIONS = new Float32Array([-AXIS_LEN, 0, 0, AXIS_LEN, 0, 0]);
const Y_AXIS_POSITIONS = new Float32Array([0, -AXIS_LEN, 0, 0, AXIS_LEN, 0]);
const Z_AXIS_POSITIONS = new Float32Array([0, 0, -AXIS_LEN, 0, 0, AXIS_LEN]);

export default function WorldAxes() {
  const themeColors = useThemeStore((s) => s.colors);
  const entityVisOrigins = useCADStore((s) => s.entityVisOrigins);

  if (!entityVisOrigins) return null;

  return (
    <group>
      {/* X axis — Red */}
      <line>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[X_AXIS_POSITIONS, 3]} />
        </bufferGeometry>
        <lineBasicMaterial color={themeColors.axisRed} linewidth={2} />
      </line>
      {/* Y axis — Green (vertical/up). themeStore: axisGreen = Y */}
      <line>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[Y_AXIS_POSITIONS, 3]} />
        </bufferGeometry>
        <lineBasicMaterial color={themeColors.axisGreen} linewidth={2} />
      </line>
      {/* Z axis — Blue (depth). themeStore: axisBlue = Z */}
      <line>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[Z_AXIS_POSITIONS, 3]} />
        </bufferGeometry>
        <lineBasicMaterial color={themeColors.axisBlue} linewidth={2} />
      </line>
    </group>
  );
}
