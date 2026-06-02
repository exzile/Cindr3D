/**
 * Ghost-preview meshes for Surface Create tools: Sweep, Loft, Patch, Ruled Surface.
 * Each component rebuilds a THREE mesh when its inputs change and disposes on cleanup.
 * Singleton materials — never disposed. Mirrors the RevolveTool preview pattern.
 */
import { useMemo, useEffect } from 'react';
import * as THREE from 'three';
import { useCADStore } from '../../../store/cadStore';
import { GeometryEngine } from '../../../engine/GeometryEngine';

// Module-level singleton — shared by all surface previews, never disposed.
const _surfacePreviewMat = new THREE.MeshPhysicalMaterial({
  color: 0x0d9488,
  transparent: true,
  opacity: 0.32,
  side: THREE.DoubleSide,
  depthWrite: false,
});
_surfacePreviewMat.userData['shared'] = true;

// ── Patch ──────────────────────────────────────────────────────────────────────
function PatchPreview() {
  const activeTool  = useCADStore((s) => s.activeTool);
  const sketches    = useCADStore((s) => s.sketches);
  const profileId   = useCADStore((s) => s.patchSelectedSketchId);

  const mesh = useMemo(() => {
    if (activeTool !== 'patch' || !profileId) return null;
    const sketch = sketches.find((s) => s.id === profileId);
    if (!sketch) return null;
    const m = GeometryEngine.patchSketch(sketch);
    if (!m) return null;
    m.material = _surfacePreviewMat;
    return m;
  }, [activeTool, profileId, sketches]);

  useEffect(() => {
    return () => { mesh?.geometry.dispose(); };
  }, [mesh]);

  if (!mesh) return null;
  return <primitive object={mesh} />;
}

// ── Ruled Surface ─────────────────────────────────────────────────────────────
function RuledSurfacePreview() {
  const activeTool      = useCADStore((s) => s.activeTool);
  const sketches        = useCADStore((s) => s.sketches);
  const sketchAId       = useCADStore((s) => s.ruledSketchAId);
  const sketchBId       = useCADStore((s) => s.ruledSketchBId);
  const alignmentMode   = useCADStore((s) => s.ruledAlignmentMode);
  const alignmentDist   = useCADStore((s) => s.ruledAlignmentDistance);

  const mesh = useMemo(() => {
    if (activeTool !== 'ruled-surface' || !sketchAId || !sketchBId) return null;
    const sketchA = sketches.find((s) => s.id === sketchAId);
    const sketchB = sketches.find((s) => s.id === sketchBId);
    if (!sketchA || !sketchB) return null;
    const m = GeometryEngine.ruledSurface(sketchA, sketchB, alignmentMode, alignmentDist);
    if (!m) return null;
    m.material = _surfacePreviewMat;
    return m;
  }, [activeTool, sketchAId, sketchBId, sketches, alignmentMode, alignmentDist]);

  useEffect(() => {
    return () => { mesh?.geometry.dispose(); };
  }, [mesh]);

  if (!mesh) return null;
  return <primitive object={mesh} />;
}

// ── Sweep ─────────────────────────────────────────────────────────────────────
function SweepPreview() {
  const activeTool  = useCADStore((s) => s.activeTool);
  const sketches    = useCADStore((s) => s.sketches);
  const profileId   = useCADStore((s) => s.sweepProfileSketchId);
  const pathId      = useCADStore((s) => s.sweepPathSketchId);
  const bodyKind    = useCADStore((s) => s.sweepBodyKind);

  const mesh = useMemo(() => {
    if (activeTool !== 'sweep' || !profileId || !pathId || profileId === pathId) return null;
    const profile = sketches.find((s) => s.id === profileId);
    const path    = sketches.find((s) => s.id === pathId);
    if (!profile || !path) return null;
    const m = GeometryEngine.sweepSketchInternal(profile, path, bodyKind === 'surface');
    if (!m) return null;
    m.material = _surfacePreviewMat;
    return m;
  }, [activeTool, profileId, pathId, sketches, bodyKind]);

  useEffect(() => {
    return () => { mesh?.geometry.dispose(); };
  }, [mesh]);

  if (!mesh) return null;
  return <primitive object={mesh} />;
}

// ── Loft ─────────────────────────────────────────────────────────────────────
function LoftPreview() {
  const activeTool  = useCADStore((s) => s.activeTool);
  const sketches    = useCADStore((s) => s.sketches);
  const profileIds  = useCADStore((s) => s.loftProfileSketchIds);
  const bodyKind    = useCADStore((s) => s.loftBodyKind);

  const mesh = useMemo(() => {
    if (activeTool !== 'loft') return null;
    const validIds = profileIds.filter(Boolean);
    if (validIds.length < 2) return null;
    const profiles = validIds
      .map((id) => sketches.find((s) => s.id === id))
      .filter((s): s is NonNullable<typeof s> => s !== undefined && s.entities.length > 0);
    if (profiles.length < 2) return null;
    const m = GeometryEngine.loftSketches(profiles, bodyKind === 'surface');
    if (!m) return null;
    m.material = _surfacePreviewMat;
    return m;
  }, [activeTool, profileIds, sketches, bodyKind]);

  useEffect(() => {
    return () => { mesh?.geometry.dispose(); };
  }, [mesh]);

  if (!mesh) return null;
  return <primitive object={mesh} />;
}

// ── Combined export ───────────────────────────────────────────────────────────
export function SurfaceCreatePreviews() {
  return (
    <>
      <PatchPreview />
      <RuledSurfacePreview />
      <SweepPreview />
      <LoftPreview />
    </>
  );
}
