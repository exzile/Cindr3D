import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useCADStore } from '../../../store/cadStore';
import { useComponentStore } from '../../../store/componentStore';
import { GeometryEngine } from '../../../engine/GeometryEngine';
import type { Feature, Sketch } from '../../../types/cad';
import { BODY_MATERIAL, SURFACE_MATERIAL, DIM_MATERIAL } from './bodyMaterial';

/** Revolve geometry item — memoized, disposes LatheGeometry on change/unmount. */
function RevolveItem({ feature, sketch }: { feature: Feature; sketch: Sketch }) {
  const angle = ((feature.params.angle as number) || 360) * (Math.PI / 180);
  const axisKey = (feature.params.axis as 'X' | 'Y' | 'Z') || 'Y';
  const useCenterline = !!feature.params.useCenterline;
  const axis = useMemo(() => {
    if (useCenterline && feature.params.axisDirection) {
      const [ax, ay, az] = feature.params.axisDirection as number[];
      return new THREE.Vector3(ax, ay, az);
    }
    if (axisKey === 'X') return new THREE.Vector3(1, 0, 0);
    if (axisKey === 'Z') return new THREE.Vector3(0, 0, 1);
    return new THREE.Vector3(0, 1, 0);
  }, [axisKey, useCenterline, feature.params.axisDirection]);
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
  const rollbackIndex = useCADStore((s) => s.rollbackIndex);
  const activeComponentId = useComponentStore((s) => s.activeComponentId);
  const rootComponentId = useComponentStore((s) => s.rootComponentId);

  // When a non-root component is active, dim features that belong to other components.
  const editingInPlace = !!activeComponentId && activeComponentId !== rootComponentId;
  const getMaterial = (featureComponentId: string | undefined, isSurface = false) => {
    if (editingInPlace && featureComponentId !== activeComponentId) return DIM_MATERIAL;
    return isSurface ? SURFACE_MATERIAL : BODY_MATERIAL;
  };

  // D187 + D190: a feature is skipped when it is suppressed, hidden, or
  // rolled back past the marker.
  const isActive = (f: Feature) => {
    if (!f.visible || f.suppressed) return false;
    if (rollbackIndex >= 0) {
      const idx = features.indexOf(f);
      if (idx > rollbackIndex) return false;
    }
    return true;
  };

  const buildToolMesh = (feature: Feature, sketch: Sketch): THREE.Mesh | null => {
    const distance = (feature.params.distance as number) || 10;
    const direction = ((feature.params.direction as 'normal' | 'reverse' | 'symmetric') ?? 'normal');
    return GeometryEngine.buildExtrudeFeatureMesh(sketch, distance, direction);
  };

  const { bodies, featureIds, featureComponentIds } = useMemo(() => {
    // Features with a stored mesh (thin/taper extrude) are rendered directly — skip CSG.
    const extrudeFeatures = [...features]
      .filter((f) => f.type === 'extrude' && isActive(f) && !f.mesh)
      .sort((a, b) => a.timestamp - b.timestamp);

    const outBodies: THREE.BufferGeometry[] = [];
    const outIds: string[] = [];
    const outComponentIds: (string | undefined)[] = [];
    let currentGeom: THREE.BufferGeometry | null = null;
    let currentFeatureId: string | null = null;
    let currentComponentId: string | undefined;

    const commitCurrent = () => {
      if (currentGeom && currentFeatureId) {
        outBodies.push(currentGeom);
        outIds.push(currentFeatureId);
        outComponentIds.push(currentComponentId);
      }
      currentGeom = null;
      currentFeatureId = null;
      currentComponentId = undefined;
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
        currentComponentId = feature.componentId;
        continue;
      }

      if (op === 'cut') {
        const next = GeometryEngine.csgSubtract(currentGeom, toolGeom);
        currentGeom.dispose();
        toolGeom.dispose();
        currentGeom = next;
        currentFeatureId = feature.id;
        currentComponentId = feature.componentId;
      } else if (op === 'join') {
        const next = GeometryEngine.csgUnion(currentGeom, toolGeom);
        currentGeom.dispose();
        toolGeom.dispose();
        currentGeom = next;
        currentFeatureId = feature.id;
        currentComponentId = feature.componentId;
      }
    }
    commitCurrent();

    return { bodies: outBodies, featureIds: outIds, featureComponentIds: outComponentIds };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [features, sketches, rollbackIndex]);

  useEffect(() => {
    return () => {
      for (const g of bodies) g.dispose();
    };
  }, [bodies]);

  // Apply dim / restore materials on pre-built stored meshes in an effect,
  // never in render, so cleanup is guaranteed when Edit In Place exits.
  useEffect(() => {
    const storedMeshFeatures = features.filter((f) => isActive(f) && f.mesh);
    storedMeshFeatures.forEach((feature) => {
      const dim = editingInPlace && feature.componentId !== activeComponentId;
      const mesh = feature.mesh!;
      const isSurface = feature.bodyKind === 'surface';
      if (dim) {
        if (!mesh.userData._origMaterial) mesh.userData._origMaterial = mesh.material;
        mesh.material = DIM_MATERIAL;
      } else {
        if (mesh.userData._origMaterial) {
          mesh.material = mesh.userData._origMaterial as THREE.Material;
          mesh.userData._origMaterial = undefined;
        } else {
          mesh.material = isSurface ? SURFACE_MATERIAL : BODY_MATERIAL;
        }
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [features, editingInPlace, activeComponentId, rollbackIndex]);

  return (
    <>
      {bodies.map((geom, i) => (
        <mesh
          key={featureIds[i] ?? i}
          geometry={geom}
          material={getMaterial(featureComponentIds[i])}
          castShadow
          receiveShadow
          onUpdate={(m) => {
            m.userData.pickable = true;
            m.userData.featureId = featureIds[i];
          }}
        />
      ))}
      {features.filter((f) => f.type === 'revolve' && isActive(f)).map((feature) => {
        const sketch = sketches.find((s) => s.id === feature.sketchId);
        if (!sketch) return null;
        return <RevolveItem key={feature.id} feature={feature} sketch={sketch} />;
      })}
      {/* Render features that have a pre-built stored mesh (D30 Sweep, D66 Thin Extrude,
          D69 Taper Extrude, D73 Rib). All these set feature.mesh at commit time.
          Material assignment is done in a useEffect below — never in render. */}
      {features.filter((f) => isActive(f) && f.mesh).map((feature) => (
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
