import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useCADStore } from '../../../store/cadStore';
import { GeometryEngine } from '../../../engine/GeometryEngine';
import { disposeLineGeometries } from '../../../utils/threeDisposal';
import type { Sketch } from '../../../types/cad';

/**
 * Renders one sketch's wire geometry. Caches the Three.js Group via useMemo so it is
 * only recreated when the sketch reference changes (Zustand does immutable updates),
 * and disposes all child line geometries on cleanup to prevent GPU memory leaks.
 * NOTE: SKETCH_MATERIAL is a shared module-level constant — never dispose it here.
 */
function SketchGeometry({ sketch }: { sketch: Sketch }) {
  const group = useMemo(() => GeometryEngine.createSketchGeometry(sketch), [sketch]);

  useEffect(() => {
    return () => disposeLineGeometries(group);
  }, [group]);

  return <primitive object={group} />;
}

export default function SketchRenderer() {
  const activeSketch = useCADStore((s) => s.activeSketch);
  const features = useCADStore((s) => s.features);
  const sketches = useCADStore((s) => s.sketches);
  const showProfile = useCADStore((s) => s.showSketchProfile);
  const showSketchPoints = useCADStore((s) => s.showSketchPoints);

  const profileMaterial = useMemo(() => new THREE.MeshBasicMaterial({
    color: 0x3a7fcc, opacity: 0.25, transparent: true, side: THREE.DoubleSide, depthWrite: false,
  }), []);

  const profileMesh = useMemo(() => {
    if (!showProfile || !activeSketch) return null;
    return GeometryEngine.createSketchProfileMesh(activeSketch, profileMaterial);
  }, [showProfile, activeSketch, profileMaterial]);

  useEffect(() => {
    return () => {
      if (profileMesh) profileMesh.geometry.dispose();
    };
  }, [profileMesh]);

  return (
    <>
      {features.filter(f => f.type === 'sketch' && f.visible).map((feature) => {
        const sketch = sketches.find(s => s.id === feature.sketchId);
        if (!sketch) return null;
        return <SketchGeometry key={feature.id} sketch={sketch} />;
      })}
      {activeSketch && activeSketch.entities.length > 0 && (() => {
        const filteredEntities = activeSketch.entities.filter(e => {
          if (e.type === 'point' && !showSketchPoints) return false;
          return true;
        });
        const filteredSketch = filteredEntities.length === activeSketch.entities.length
          ? activeSketch
          : { ...activeSketch, entities: filteredEntities };
        return (
          <SketchGeometry
            key={`active-${activeSketch.id}-e${activeSketch.entities.length}-pts${showSketchPoints ? 1 : 0}`}
            sketch={filteredSketch}
          />
        );
      })()}
      {profileMesh && <primitive key={`profile-${activeSketch?.id}-${activeSketch?.entities.length}`} object={profileMesh} />}
    </>
  );
}
