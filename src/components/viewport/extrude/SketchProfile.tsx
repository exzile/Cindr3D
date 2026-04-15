import { useMemo, useEffect } from 'react';
import { type ThreeEvent } from '@react-three/fiber';
import { GeometryEngine } from '../../../engine/GeometryEngine';
import type { Sketch } from '../../../types/cad';
import { PROFILE_MATERIAL, PROFILE_HOVER_MATERIAL, PROFILE_SELECTED_MATERIAL } from './materials';

export default function SketchProfile({
  sketch, state, onSelect, onHover, onUnhover,
}: {
  sketch: Sketch;
  state: 'idle' | 'hover' | 'selected';
  onSelect: () => void;
  onHover: () => void;
  onUnhover: () => void;
}) {
  const material =
    state === 'selected' ? PROFILE_SELECTED_MATERIAL :
    state === 'hover'    ? PROFILE_HOVER_MATERIAL    :
                           PROFILE_MATERIAL;

  const mesh = useMemo(
    () => GeometryEngine.createSketchProfileMesh(sketch, material),
    [sketch, material],
  );

  useEffect(() => {
    if (mesh) {
      // Tag pickable so the unified ExtrudeTool raycaster catches it and
      // routes click → setSelectedId(sketch.id). Distinguishes from body faces
      // via userData.sketchId.
      mesh.userData.pickable = true;
      mesh.userData.sketchId = sketch.id;
    }
    return () => { mesh?.geometry.dispose(); };
  }, [mesh, sketch.id]);

  if (!mesh) return null;

  return (
    <primitive
      object={mesh}
      renderOrder={1000}
      onClick={(e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); onSelect(); }}
      onPointerOver={(e: ThreeEvent<PointerEvent>) => { e.stopPropagation(); onHover(); }}
      onPointerOut={() => onUnhover()}
    />
  );
}
