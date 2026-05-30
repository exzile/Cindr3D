import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { useCADStore } from '../../../store/cadStore';
import { useComponentStore } from '../../../store/componentStore';

interface ShadowMapHost {
  shadowMap: {
    autoUpdate: boolean;
    needsUpdate: boolean;
  };
}

function setShadowMapAutoUpdate(renderer: ShadowMapHost, autoUpdate: boolean): void {
  renderer.shadowMap.autoUpdate = autoUpdate;
}

function requestShadowMapUpdate(renderer: ShadowMapHost): void {
  renderer.shadowMap.needsUpdate = true;
}

/**
 * Calls R3F's `invalidate()` whenever store state that affects 3D rendering
 * changes - features, sketches, selection, rollback, bodies, etc.
 *
 * Required because Canvas uses `frameloop="demand"`: Three.js only renders a
 * frame when explicitly requested. OrbitControls handles camera-interaction
 * frames; this component handles the "scene content changed" case so new
 * geometry / material / selection highlights appear immediately without waiting
 * for the next mouse move.
 *
 * Shadow map strategy: THREE.js by default re-renders the shadow map on every
 * frame where any shadow-casting light is present, even when only the camera
 * moved and no casters changed. With `frameloop="demand"` this means every
 * camera-orbit frame pays a full 1024x1024 shadow map render.
 * Fix: disable `shadowMap.autoUpdate` at mount so the shadow map is only
 * re-rendered when scene content actually changes (controlled below).
 */
export default function SceneInvalidator() {
  const { invalidate, gl } = useThree();

  // Disable automatic per-frame shadow map re-renders.
  // Shadows only need updating when geometry / lights / visibility changes,
  // not when the camera moves.  We set needsUpdate manually below.
  useEffect(() => {
    const previousAutoUpdate = gl.shadowMap.autoUpdate;
    setShadowMapAutoUpdate(gl, false);
    requestShadowMapUpdate(gl); // render once on mount
    return () => {
      setShadowMapAutoUpdate(gl, previousAutoUpdate);
    };
  }, [gl]);

  // Geometric content
  const features      = useCADStore((s) => s.features);
  const sketches      = useCADStore((s) => s.sketches);
  const rollbackIndex = useCADStore((s) => s.rollbackIndex);

  // Selection / highlight
  const selectedEntityIds    = useCADStore((s) => s.selectedEntityIds);
  const selectedFeatureId    = useCADStore((s) => s.selectedFeatureId);
  const activeTool           = useCADStore((s) => s.activeTool);
  const activeSketch         = useCADStore((s) => s.activeSketch);
  const activeAnalysis       = useCADStore((s) => s.activeAnalysis);
  const visualStyle          = useCADStore((s) => s.visualStyle);
  const showReflections      = useCADStore((s) => s.showReflections);

  // Component visibility / appearances
  const bodies               = useComponentStore((s) => s.bodies);
  const activeComponentId    = useComponentStore((s) => s.activeComponentId);

  useEffect(() => {
    invalidate();
    // Mark shadow map dirty whenever scene content changes so the next frame
    // re-renders it.  Camera-only frames (orbit/pan/zoom) skip this path and
    // therefore skip the expensive 1024x1024 shadow map render.
    requestShadowMapUpdate(gl);
  }, [
    invalidate,
    gl,
    features,
    sketches,
    rollbackIndex,
    selectedEntityIds,
    selectedFeatureId,
    activeTool,
    activeSketch,
    activeAnalysis,
    visualStyle,
    showReflections,
    bodies,
    activeComponentId,
  ]);

  return null;
}
