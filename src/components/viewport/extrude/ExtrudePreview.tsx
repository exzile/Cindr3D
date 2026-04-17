import { useMemo, useEffect } from 'react';
import { GeometryEngine } from '../../../engine/GeometryEngine';
import type { ExtrudeDirection } from '../../../store/cadStore';
import { useCADStore } from '../../../store/cadStore';
import type { Sketch } from '../../../types/cad';
import { PREVIEW_MATERIAL, PREVIEW_MATERIAL_CUT } from './materials';

export default function ExtrudePreview({ sketch, distance, direction }: {
  sketch: Sketch;
  distance: number;
  direction: ExtrudeDirection;
}) {
  const operation  = useCADStore((s) => s.extrudeOperation);
  const startType  = useCADStore((s) => s.extrudeStartType);
  const startOffset = useCADStore((s) => s.extrudeStartOffset);
  const taperAngle = useCADStore((s) => s.extrudeTaperAngle);
  const distance2  = useCADStore((s) => s.extrudeDistance2);

  const isCut = operation === 'cut';
  const absDistance = Math.abs(distance);
  // Negative distance = user dragged in reverse direction
  const effectiveDirection: ExtrudeDirection =
    direction === 'two-sides' ? 'two-sides' : (distance < 0 ? 'negative' : direction);
  const effectiveOffset = startType === 'offset' ? startOffset : 0;

  const mesh = useMemo(() => {
    if (absDistance < 0.001) return null;
    // buildExtrudeFeatureMesh handles direction shifting, offset, and taper together
    const m = GeometryEngine.buildExtrudeFeatureMesh(
      sketch,
      absDistance,
      effectiveDirection,
      taperAngle,
      effectiveOffset,
      Math.abs(distance2),
    );
    if (!m) return null;
    m.material = isCut ? PREVIEW_MATERIAL_CUT : PREVIEW_MATERIAL;
    return m;
  }, [sketch, absDistance, effectiveDirection, taperAngle, effectiveOffset, distance2, isCut]);

  useEffect(() => {
    return () => { mesh?.geometry.dispose(); };
  }, [mesh]);

  if (!mesh) return null;
  return <primitive object={mesh} />;
}
