import { useMemo, useEffect } from 'react';
import { GeometryEngine } from '../../../engine/GeometryEngine';
import type { ExtrudeDirection } from '../../../store/cadStore';
import type { Sketch } from '../../../types/cad';
import { PREVIEW_MATERIAL, PREVIEW_MATERIAL_CUT } from './materials';

export default function ExtrudePreview({ sketch, distance, direction }: {
  sketch: Sketch;
  distance: number;
  direction: ExtrudeDirection;
}) {
  // Signed distance: negative = press-pulled INTO the body → cut preview.
  // Always extrude with positive depth, then offset backwards when reverse.
  const isCut = distance < 0;
  const absDistance = Math.abs(distance);
  const effectiveDirection: ExtrudeDirection = isCut ? 'reverse' : direction;

  const mesh = useMemo(() => {
    if (absDistance < 0.001) return null;
    const m = GeometryEngine.extrudeSketch(sketch, absDistance);
    if (!m) return null;
    m.material = isCut ? PREVIEW_MATERIAL_CUT : PREVIEW_MATERIAL;
    if (effectiveDirection !== 'normal') {
      const offset = effectiveDirection === 'symmetric' ? absDistance / 2 : absDistance;
      m.position.sub(GeometryEngine.getSketchExtrudeNormal(sketch).multiplyScalar(offset));
    }
    return m;
  }, [sketch, absDistance, effectiveDirection, isCut]);

  useEffect(() => {
    return () => { mesh?.geometry.dispose(); };
  }, [mesh]);

  if (!mesh) return null;
  return <primitive object={mesh} />;
}
