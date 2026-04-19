import { useMemo, useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { GeometryEngine } from '../../../engine/GeometryEngine';
import type { Sketch } from '../../../types/cad';
import { PROFILE_MATERIAL, PROFILE_HOVER_MATERIAL, PROFILE_SELECTED_MATERIAL } from './materials';

/**
 * Renders a single sketch profile as a translucent fill mesh.
 *
 * Click and hover are handled by ExtrudeTool via native DOM event listeners
 * (R3F's <primitive> onClick is unreliable for dynamically-created meshes).
 * This component is purely visual — it renders the mesh, animates opacity
 * based on state, and sets userData.profileKey for the DOM raycaster to find.
 */
export default function SketchProfile({
  sketch, profileIndex, state, hidden = false,
}: {
  sketch: Sketch;
  profileIndex?: number;
  state: 'idle' | 'hover' | 'selected';
  /**
   * When true the mesh renders with opacity 0 but stays in the scene so the
   * DOM profile picker can still raycast it for toggle/deselect clicks. Used
   * by ExtrudeTool to hide selected overlays while the solid preview is up.
   */
  hidden?: boolean;
}) {
  const material =
    state === 'selected' ? PROFILE_SELECTED_MATERIAL :
    state === 'hover'    ? PROFILE_HOVER_MATERIAL    :
                           PROFILE_MATERIAL;

  const animatedMaterial = useMemo(() => material.clone(), [material]);
  const meshRef = useRef<THREE.Mesh | null>(null);

  const mesh = useMemo(() => {
    const created = GeometryEngine.createSketchProfileMesh(sketch, animatedMaterial, profileIndex);
    if (created) {
      created.userData.pickable = true;
      created.userData.sketchId = sketch.id;
      created.userData.profileIndex = profileIndex;
      created.userData.profileKey = profileIndex === undefined ? sketch.id : `${sketch.id}::${profileIndex}`;
    }
    return created;
  }, [sketch, animatedMaterial, profileIndex]);

  useFrame(({ clock, invalidate }) => {
    const m = meshRef.current?.material;
    if (!(m instanceof THREE.MeshBasicMaterial)) return;
    if (hidden) {
      m.opacity = 0; // fully transparent but still pickable
      return;
    }
    if (state === 'hover') {
      const pulse = 0.5 + 0.5 * Math.sin(clock.elapsedTime * 6);
      m.opacity = 0.24 + pulse * 0.22;
      invalidate(); // keep pulsing in frameloop="demand" mode
    } else if (state === 'selected') {
      m.opacity = 0.48;
    } else {
      m.opacity = 0.18;
    }
  });

  useEffect(() => {
    return () => {
      mesh?.geometry.dispose();
      animatedMaterial.dispose();
    };
  }, [mesh, animatedMaterial]);

  if (!mesh) return null;

  // Selected/hovered profiles render ON TOP of idle ones so that clicking a
  // large profile (like the outer rectangle containing circles) shows the
  // entire selection — not a bunch of circle-shaped holes where the smaller
  // idle profiles overdraw it. Idle profiles also draw in area-descending
  // order (larger first) so the smaller profile fills appear on top when
  // everything is idle.
  const ro = state === 'selected' ? 1200 : state === 'hover' ? 1100 : 1000;

  return (
    <primitive
      ref={meshRef}
      object={mesh}
      renderOrder={ro}
    />
  );
}
