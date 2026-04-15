import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useCADStore } from '../../../store/cadStore';
import { GeometryEngine } from '../../../engine/GeometryEngine';
import type { Feature, Sketch } from '../../../types/cad';
import { BODY_MATERIAL, SURFACE_MATERIAL } from './bodyMaterial';

/** Revolve geometry item — memoized, disposes LatheGeometry on change/unmount. */
function RevolveItem({ feature, sketch }: { feature: Feature; sketch: Sketch }) {
  const angle = ((feature.params.angle as number) || 360) * (Math.PI / 180);
  const axisKey = (feature.params.axis as 'X' | 'Y' | 'Z') || 'Y';
  const axis = useMemo(() => {
    if (axisKey === 'X') return new THREE.Vector3(1, 0, 0);
    if (axisKey === 'Z') return new THREE.Vector3(0, 0, 1);
    return new THREE.Vector3(0, 1, 0);
  }, [axisKey]);
  const isSurface = feature.bodyKind === 'surface';
  const mesh = useMemo(() => {
    const m = GeometryEngine.revolveSketch(sketch, angle, axis);
    if (!m) return null;
    // LatheGeometry revolves around local +Y. Post-rotate so the mesh's
    // lathe-Y aligns with the requested world axis.
    if (axisKey === 'X') m.rotation.set(0, 0, -Math.PI / 2);
    else if (axisKey === 'Z') m.rotation.set(Math.PI / 2, 0, 0);
    // Apply surface material for surface body kind
    m.material = isSurface ? SURFACE_MATERIAL : BODY_MATERIAL;
    return m;
  }, [sketch, angle, axis, axisKey, isSurface]);
  useEffect(() => {
    if (mesh) {
      mesh.userData.pickable = true;
      mesh.userData.featureId = feature.id;
    }
    return () => { mesh?.geometry.dispose(); };
  }, [mesh, feature.id]);
  if (!mesh) return null;
  return <primitive object={mesh} />;
}

/**
 * Walks extrude features in timeline order, applying CSG boolean ops.
 *
 *   new-body: push current brush, start a fresh one
 *   join:     union tool geometry onto current brush
 *   cut:      subtract tool geometry from current brush
 *
 * Each resulting body becomes a single pickable mesh. This keeps the scene
 * tree flat (one mesh per body) so press-pull face picking continues to work.
 */
export default function ExtrudedBodies() {
  const features = useCADStore((s) => s.features);
  const sketches = useCADStore((s) => s.sketches);

  const buildToolMesh = (feature: Feature, sketch: Sketch): THREE.Mesh | null => {
    const distance = (feature.params.distance as number) || 10;
    const direction = ((feature.params.direction as 'normal' | 'reverse' | 'symmetric') ?? 'normal');
    return GeometryEngine.buildExtrudeFeatureMesh(sketch, distance, direction);
  };

  const { bodies, featureIds } = useMemo(() => {
    // Features with a stored mesh (thin/taper extrude) are rendered directly — skip CSG.
    const extrudeFeatures = [...features]
      .filter((f) => f.type === 'extrude' && f.visible && !f.mesh)
      .sort((a, b) => a.timestamp - b.timestamp);

    const outBodies: THREE.BufferGeometry[] = [];
    const outIds: string[] = [];
    let currentGeom: THREE.BufferGeometry | null = null;
    let currentFeatureId: string | null = null;

    const commitCurrent = () => {
      if (currentGeom && currentFeatureId) {
        outBodies.push(currentGeom);
        outIds.push(currentFeatureId);
      }
      currentGeom = null;
      currentFeatureId = null;
    };

    for (const feature of extrudeFeatures) {
      const sketch = sketches.find((s) => s.id === feature.sketchId);
      if (!sketch) continue;
      const toolMesh = buildToolMesh(feature, sketch);
      if (!toolMesh) continue;

      const toolGeom = GeometryEngine.bakeMeshWorldGeometry(toolMesh);
      toolMesh.geometry.dispose();

      const op = (feature.params.operation as 'new-body' | 'join' | 'cut') ?? 'new-body';

      if (!currentGeom || op === 'new-body') {
        commitCurrent();
        currentGeom = toolGeom;
        currentFeatureId = feature.id;
        continue;
      }

      if (op === 'cut') {
        const next = GeometryEngine.csgSubtract(currentGeom, toolGeom);
        currentGeom.dispose();
        toolGeom.dispose();
        currentGeom = next;
        currentFeatureId = feature.id;
      } else if (op === 'join') {
        const next = GeometryEngine.csgUnion(currentGeom, toolGeom);
        currentGeom.dispose();
        toolGeom.dispose();
        currentGeom = next;
        currentFeatureId = feature.id;
      }
    }
    commitCurrent();

    return { bodies: outBodies, featureIds: outIds };
  }, [features, sketches]);

  useEffect(() => {
    return () => {
      for (const g of bodies) g.dispose();
    };
  }, [bodies]);

  return (
    <>
      {bodies.map((geom, i) => (
        <mesh
          key={featureIds[i] ?? i}
          geometry={geom}
          material={BODY_MATERIAL}
          castShadow
          receiveShadow
          onUpdate={(m) => {
            m.userData.pickable = true;
            m.userData.featureId = featureIds[i];
          }}
        />
      ))}
      {features.filter((f) => f.type === 'revolve' && f.visible).map((feature) => {
        const sketch = sketches.find((s) => s.id === feature.sketchId);
        if (!sketch) return null;
        return <RevolveItem key={feature.id} feature={feature} sketch={sketch} />;
      })}
      {/* Render features that have a pre-built stored mesh (D30 Sweep, D66 Thin Extrude,
          D69 Taper Extrude, D73 Rib). All these set feature.mesh at commit time. */}
      {features.filter((f) => f.visible && f.mesh).map((feature) => (
        <primitive
          key={feature.id}
          object={feature.mesh!}
          onUpdate={(m: THREE.Object3D) => {
            m.userData.pickable = true;
            m.userData.featureId = feature.id;
          }}
        />
      ))}
    </>
  );
}
