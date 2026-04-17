import { useCallback, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useCADStore } from '../../../store/cadStore';
import { useComponentStore } from '../../../store/componentStore';
import { GeometryEngine } from '../../../engine/GeometryEngine';
import type { Feature, Sketch } from '../../../types/cad';
import { BODY_MATERIAL, SURFACE_MATERIAL, DIM_MATERIAL } from './bodyMaterial';

/** Revolve geometry item — memoized, disposes geometry on change/unmount. */
function RevolveItem({ feature, sketch }: { feature: Feature; sketch: Sketch | undefined }) {
  const angle = ((feature.params.angle as number) || 360) * (Math.PI / 180);
  const axisKey = (feature.params.axis as 'X' | 'Y' | 'Z') || 'Y';
  const isFaceRevolve = !!feature.params.faceRevolve;
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
    if (isFaceRevolve) {
      const flat = feature.params.faceBoundary as number[];
      if (!flat || flat.length < 9) return null;
      const boundary: THREE.Vector3[] = [];
      for (let i = 0; i < flat.length; i += 3) {
        boundary.push(new THREE.Vector3(flat[i], flat[i + 1], flat[i + 2]));
      }
      return GeometryEngine.revolveFaceBoundary(boundary, axis, angle, isSurface);
    }
    if (!sketch) return null;
    const m = GeometryEngine.revolveSketch(sketch, angle, axis);
    if (!m) return null;
    // LatheGeometry revolves around local +Y. Post-rotate so lathe-Y aligns with world axis.
    if (axisKey === 'X') m.rotation.set(0, 0, -Math.PI / 2);
    else if (axisKey === 'Z') m.rotation.set(Math.PI / 2, 0, 0);
    m.material = isSurface ? SURFACE_MATERIAL : BODY_MATERIAL;
    return m;
  }, [isFaceRevolve, feature.params.faceBoundary, sketch, angle, axis, axisKey, isSurface]);
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

  const bodiesById = useComponentStore((s) => s.bodies);

  // When a non-root component is active, dim features that belong to other components.
  const editingInPlace = !!activeComponentId && activeComponentId !== rootComponentId;

  // Per-body cloned MeshStandardMaterial cache. Cloned materials are disposed
  // when the appearance changes or the component unmounts. Singletons
  // (BODY_MATERIAL / SURFACE_MATERIAL / DIM_MATERIAL) are NEVER disposed.
  const materialCache = useRef<Map<string, { mat: THREE.MeshStandardMaterial; key: string }>>(new Map());
  useEffect(() => {
    const cache = materialCache.current;
    return () => {
      cache.forEach(({ mat }) => mat.dispose());
      cache.clear();
    };
  }, []);

  const getMaterial = useCallback(
    (featureComponentId: string | undefined, bodyId: string | undefined, isSurface = false): THREE.Material => {
      if (editingInPlace && featureComponentId !== activeComponentId) return DIM_MATERIAL;
      const fallback: THREE.Material = isSurface ? SURFACE_MATERIAL : BODY_MATERIAL;
      if (!bodyId) return fallback;
      const body = bodiesById[bodyId];
      if (!body || !body.material) return fallback;
      const m = body.material;
      // Skip override when body still uses the default aluminum so we keep the
      // singleton and don't allocate a clone for every untouched body.
      if (m.id === 'aluminum' && m.color === '#B0B8C0' && m.opacity === 1) return fallback;
      const key = `${m.color}|${m.metalness}|${m.roughness}|${m.opacity}`;
      const cached = materialCache.current.get(bodyId);
      if (cached && cached.key === key) return cached.mat;
      if (cached) cached.mat.dispose();
      const mat = new THREE.MeshStandardMaterial({
        color: m.color,
        metalness: m.metalness,
        roughness: m.roughness,
        opacity: m.opacity,
        transparent: m.opacity < 1,
      });
      materialCache.current.set(bodyId, { mat, key });
      return mat;
    },
    [editingInPlace, activeComponentId, bodiesById],
  );

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
    const profileIndex = feature.params.profileIndex as number | undefined;
    const taperAngle = (feature.params.taperAngle as number) ?? 0;
    const startOffset = (feature.params.startType as string) === 'offset'
      ? ((feature.params.startOffset as number) ?? 0)
      : 0;
    const sketchForOp = profileIndex !== undefined
      ? GeometryEngine.createProfileSketch(sketch, profileIndex)
      : sketch;
    if (!sketchForOp) return null;
    return GeometryEngine.buildExtrudeFeatureMesh(sketchForOp, distance, direction, taperAngle, startOffset);
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

  // Apply dim / appearance materials on pre-built stored meshes in an effect,
  // never in render, so cleanup is guaranteed when Edit In Place exits.
  useEffect(() => {
    const storedMeshFeatures = features.filter((f) => isActive(f) && f.mesh);
    storedMeshFeatures.forEach((feature) => {
      const mesh = feature.mesh!;
      const isSurface = feature.bodyKind === 'surface';
      mesh.userData._origMaterial = undefined;
      mesh.material = getMaterial(feature.componentId, feature.bodyId, isSurface);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [features, editingInPlace, activeComponentId, rollbackIndex, bodiesById, getMaterial]);

  return (
    <>
      {bodies.map((geom, i) => {
        const fId = featureIds[i];
        const bodyId = fId ? features.find((f) => f.id === fId)?.bodyId : undefined;
        return (
          <mesh
            key={fId ?? i}
            geometry={geom}
            material={getMaterial(featureComponentIds[i], bodyId)}
            castShadow
            receiveShadow
            onUpdate={(m) => {
              m.userData.pickable = true;
              m.userData.featureId = fId;
              m.userData.bodyId = bodyId;
            }}
          />
        );
      })}
      {features.filter((f) => f.type === 'revolve' && isActive(f)).map((feature) => {
        if (feature.params.faceRevolve) {
          return <RevolveItem key={feature.id} feature={feature} sketch={undefined} />;
        }
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
