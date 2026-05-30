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
  // Single per-component animated material — not swapped when state changes.
  // Color/opacity are mutated per-frame so we never re-trigger the mesh memo
  // (which would re-triangulate the profile geometry on every hover tick).
  // Cloned from PROFILE_MATERIAL so the shared singleton stays pristine.
  const animatedMaterial = useMemo(() => {
    const m = PROFILE_MATERIAL.clone();
    m.transparent = true;
    return m;
  }, []);

  const meshRef = useRef<THREE.Mesh | null>(null);
  const settledIdleKeyRef = useRef<string | null>(null);

  // Mesh (geometry) is keyed ONLY on sketch identity + profile index. State
  // changes must not recreate the geometry — that was the source of the
  // expensive re-triangulation on every hover.
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
    if (hidden || state === 'idle') {
      const idleKey = `${hidden}:${state}`;
      if (settledIdleKeyRef.current === idleKey) return;

      const targetColor = PROFILE_MATERIAL.color.getHex();
      const targetOpacity = 0;
      const targetDepthTest = state === 'idle';
      const changed =
        m.color.getHex() !== targetColor ||
        Math.abs(m.opacity - targetOpacity) > 1e-4 ||
        m.depthTest !== targetDepthTest;

      settledIdleKeyRef.current = idleKey;
      if (!changed) return;
      m.color.setHex(targetColor);
      m.opacity = targetOpacity;
      m.depthTest = targetDepthTest;
      invalidate();
      return;
    }
    settledIdleKeyRef.current = null;

    // Resolve target color/opacity from state + hidden. Color is mutated in
    // place to avoid allocating a fresh THREE.Color each frame.
    let targetColor: number;
    let targetOpacity: number;
    let pulsing = false;
    if (state === 'selected') {
      targetColor = PROFILE_SELECTED_MATERIAL.color.getHex();
      const pulse = 0.5 + 0.5 * Math.sin(clock.elapsedTime * 6);
      targetOpacity = 0.34 + pulse * 0.24;
      pulsing = true;
    } else if (state === 'hover') {
      targetColor = PROFILE_HOVER_MATERIAL.color.getHex();
      const pulse = 0.5 + 0.5 * Math.sin(clock.elapsedTime * 6);
      targetOpacity = 0.24 + pulse * 0.22;
      pulsing = true;
    } else return;

    m.depthTest = false;
    // Only invalidate (request a re-render) when a value actually changed OR
    // a pulse is active — keeps frameloop="demand" from running every frame.
    const prevColor = m.color.getHex();
    const prevOpacity = m.opacity;
    const changed = pulsing || prevColor !== targetColor || Math.abs(prevOpacity - targetOpacity) > 1e-4;
    if (prevColor !== targetColor) m.color.setHex(targetColor);
    if (prevOpacity !== targetOpacity) m.opacity = targetOpacity;
    if (changed) invalidate();
  });

  useEffect(() => {
    return () => {
      mesh?.geometry.dispose();
    };
  }, [mesh]);

  useEffect(() => {
    return () => { animatedMaterial.dispose(); };
  }, [animatedMaterial]);

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
