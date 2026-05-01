import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useCADStore } from '../../../store/cadStore';
import { useComponentStore } from '../../../store/componentStore';
import { GeometryEngine } from '../../../engine/GeometryEngine';
import { disposeLineGeometries } from '../../../utils/threeDisposal';
import type { Sketch } from '../../../types/cad';
import { isComponentVisible } from './componentVisibility';

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

/** Memoize the filtered sketch so visibility toggles don't produce
 *  a new object identity on every render, defeating SketchGeometry's useMemo. */
function ActiveSketchGeometry({
  sketch,
  showSketchPoints,
  showConstructionGeometries,
}: {
  sketch: Sketch;
  showSketchPoints: boolean;
  showConstructionGeometries: boolean;
}) {
  const filteredSketch = useMemo(() => {
    const entities = sketch.entities.filter((e) => {
      if (!showSketchPoints && e.type === 'point') return false;
      if (!showConstructionGeometries && e.isConstruction) return false;
      return true;
    });
    return entities.length === sketch.entities.length
      ? sketch
      : { ...sketch, entities };
  }, [sketch, showSketchPoints, showConstructionGeometries]);

  return (
    <SketchGeometry
      key={`active-${sketch.id}-e${sketch.entities.length}-pts${showSketchPoints ? 1 : 0}-cg${showConstructionGeometries ? 1 : 0}`}
      sketch={filteredSketch}
    />
  );
}

export default function SketchRenderer() {
  const activeSketch = useCADStore((s) => s.activeSketch);
  const features = useCADStore((s) => s.features);
  const sketches = useCADStore((s) => s.sketches);
  const showProfile = useCADStore((s) => s.showSketchProfile);
  const showSketchPoints = useCADStore((s) => s.showSketchPoints);
  const showConstructionGeometries = useCADStore((s) => s.showConstructionGeometries);
  const entityVisSketchBodies = useCADStore((s) => s.entityVisSketchBodies);
  const rollbackIndex = useCADStore((s) => s.rollbackIndex);
  const components = useComponentStore((s) => s.components);
  const activeSketchComponentVisible = !activeSketch || isComponentVisible(components, activeSketch.componentId);

  const profileMaterial = useMemo(() => new THREE.MeshBasicMaterial({
    color: 0x3a7fcc, opacity: 0.25, transparent: true, side: THREE.DoubleSide, depthWrite: false,
  }), []);

  const profileMesh = useMemo(() => {
    if (!showProfile || !activeSketch || !activeSketchComponentVisible) return null;
    return GeometryEngine.createSketchProfileMesh(activeSketch, profileMaterial);
  }, [showProfile, activeSketch, activeSketchComponentVisible, profileMaterial]);

  useEffect(() => {
    return () => {
      if (profileMesh) profileMesh.geometry.dispose();
    };
  }, [profileMesh]);

  // Dispose the per-component profileMaterial on unmount. Without this the
  // MeshBasicMaterial leaks GPU state every time SketchRenderer remounts
  // (e.g. after dialog open/close cycles that toggle the viewport tree).
  useEffect(() => {
    return () => {
      profileMaterial.dispose();
    };
  }, [profileMaterial]);

  return (
    <>
      {entityVisSketchBodies && features.filter((f, i) => {
        // D187 suppress + D190 rollback + visibility
        if (f.type !== 'sketch' || !f.visible || f.suppressed) return false;
        if (rollbackIndex >= 0 && i > rollbackIndex) return false;
        return true;
      }).map((feature) => {
        const sketch = sketches.find(s => s.id === feature.sketchId);
        if (!sketch) return null;
        if (!isComponentVisible(components, sketch.componentId ?? feature.componentId)) return null;
        return <SketchGeometry key={feature.id} sketch={sketch} />;
      })}
      {activeSketch && activeSketchComponentVisible && activeSketch.entities.length > 0 && (
        <ActiveSketchGeometry
          sketch={activeSketch}
          showSketchPoints={showSketchPoints}
          showConstructionGeometries={showConstructionGeometries}
        />
      )}
      {profileMesh && <primitive key={`profile-${activeSketch?.id}-${activeSketch?.entities.length}`} object={profileMesh} />}
    </>
  );
}
