import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Module-level scratch objects — avoids per-feature heap allocations in the CSG loop.
const _boxCurrent = new THREE.Box3();
const _boxTool = new THREE.Box3();
import { useCADStore } from '../../../store/cadStore';
import { useComponentStore } from '../../../store/componentStore';
import { liveBodyMeshes } from '../../../store/meshRegistry';
import { GeometryEngine } from '../../../engine/GeometryEngine';
import type { Feature, Sketch } from '../../../types/cad';
import { boxesHaveJoinableContact } from '../../../utils/geometry/boundsContact';
import { BODY_MATERIAL, SURFACE_MATERIAL, DIM_MATERIAL, componentColorMaterial } from './bodyMaterial';

/**
 * Wraps a single body mesh and pulses an emissive highlight when its bodyId
 * matches the currently-selected body from the browser panel. Using a
 * MeshStandardMaterial clone so the pulse doesn't mutate the shared body
 * material. Cleanup disposes the clone on unmount/bodyId change.
 */
function BodyMesh({
  geometry,
  material,
  featureId,
  bodyId,
  pickable,
}: {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  featureId: string | undefined;
  bodyId: string | undefined;
  pickable: boolean;
}) {
  const selectedBodyId = useComponentStore((s) => s.selectedBodyId);
  const isSelected = !!bodyId && bodyId === selectedBodyId;
  const meshRef = useRef<THREE.Mesh | null>(null);

  // Build a one-off material clone when this mesh is the selected one — keeps
  // the shared body material pristine (no mutating emissive on everything).
  const animatedMat = useMemo(() => {
    if (!isSelected) return null;
    const m = material as THREE.MeshStandardMaterial;
    if (!(m instanceof THREE.MeshStandardMaterial)) return null;
    const clone = m.clone();
    clone.emissive = new THREE.Color(0x3b82f6);
    return clone;
  }, [isSelected, material]);

  useEffect(() => {
    return () => { animatedMat?.dispose(); };
  }, [animatedMat]);

  // Register this mesh in the live body-mesh registry so commitFillet can
  // obtain the rendered geometry for extrude features, which are not stored
  // in feature.mesh (they live only in the R3F scene via the CSG pipeline).
  // Key is the THREE.js mesh UUID — stable for the object's lifetime.
  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    liveBodyMeshes.set(mesh.uuid, mesh);
    return () => { liveBodyMeshes.delete(mesh.uuid); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // run once on mount/unmount — uuid is stable for the mesh's lifetime

  useFrame(({ clock, invalidate }) => {
    if (!isSelected) return;
    const mesh = meshRef.current;
    if (!mesh) return;
    const meshMat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    if (!(meshMat instanceof THREE.MeshStandardMaterial) || meshMat === material) return;
    // Pulse emissive intensity at 3 Hz so the selected body breathes visibly.
    const pulse = 0.3 + 0.3 * Math.sin(clock.elapsedTime * 6);
    meshMat.emissiveIntensity = pulse;
    invalidate();
  });

  return (
    <mesh
      ref={meshRef}
      geometry={geometry}
      material={animatedMat ?? material}
      castShadow
      receiveShadow
      onUpdate={(m) => {
        m.userData.pickable = pickable;
        m.userData.featureId = featureId;
        m.userData.bodyId = bodyId;
      }}
    />
  );
}

/** Revolve geometry item — memoized, disposes geometry on change/unmount. */
function RevolveItem({
  feature,
  sketch,
  material,
  bodyId,
}: {
  feature: Feature;
  sketch: Sketch | undefined;
  material: THREE.Material;
  bodyId: string | undefined;
}) {
  const angleDeg = (feature.params.angle as number) || 360;
  const angle2Deg = (feature.params.angle2 as number) ?? angleDeg;
  const revolveDirection = (feature.params.direction as 'one-side' | 'symmetric' | 'two-sides') || 'one-side';
  const { phiStart, sweep } = useMemo(
    () => GeometryEngine.resolveRevolveSweep(angleDeg, angle2Deg, revolveDirection),
    [angleDeg, angle2Deg, revolveDirection],
  );
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
      const revolved = GeometryEngine.revolveFaceBoundary(boundary, axis, sweep, isSurface, phiStart);
      if (revolved) revolved.material = material;
      return revolved;
    }
    if (!sketch) return null;
    const m = GeometryEngine.revolveSketch(sketch, sweep, axis, phiStart);
    if (!m) return null;
    // NOTE: round-4 axis fix — `revolveSketch` now applies the lathe→axis
    // rotation INTERNALLY (rotates the BufferGeometry so +Y aligns with `axis`).
    // The previous post-rotate-the-mesh path here was correct only when the
    // engine ignored the axis. Adding it now would compose with the engine's
    // rotation and double-flip X/Z revolves — drop it entirely.
    m.material = material;
    return m;
  }, [isFaceRevolve, feature.params.faceBoundary, sketch, sweep, phiStart, axis, isSurface, material]);
  useEffect(() => {
    /* eslint-disable react-hooks/immutability -- Three.js userData for raycasting */
    if (mesh) {
      mesh.userData.pickable = true;
      mesh.userData.featureId = feature.id;
      mesh.userData.bodyId = bodyId;
    }
    /* eslint-enable react-hooks/immutability */
    return () => { mesh?.geometry.dispose(); };
  }, [mesh, feature.id, bodyId]);
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
// Module-level WeakMap cache — per-sketch-object structural signature. Keyed
// on the Sketch object identity; because Zustand sketches are immutable
// (every edit produces a new Sketch object), a cached signature is
// invalidated naturally by garbage collection when the old sketch is
// replaced. Used by ExtrudedBodies to decide whether a sketch change is
// relevant to any extrude feature before re-running the CSG pipeline.
const _sketchSigCache = new WeakMap<Sketch, string>();
function sketchStructuralSig(s: Sketch): string {
  const cached = _sketchSigCache.get(s);
  if (cached !== undefined) return cached;
  const parts: string[] = [s.id];
  const po = s.planeOrigin;
  const pn = s.planeNormal;
  parts.push(
    String(po.x), String(po.y), String(po.z),
    String(pn.x), String(pn.y), String(pn.z),
  );
  for (const e of s.entities) {
    parts.push(e.id, e.type);
    for (const p of e.points) {
      parts.push(String(p.x), String(p.y), String(p.z));
    }
    if (e.radius != null) parts.push('r', String(e.radius));
    if (e.startAngle != null) parts.push('sa', String(e.startAngle));
    if (e.endAngle != null) parts.push('ea', String(e.endAngle));
  }
  const sig = parts.join('|');
  _sketchSigCache.set(s, sig);
  return sig;
}

export default function ExtrudedBodies() {
  const features = useCADStore((s) => s.features);
  const sketches = useCADStore((s) => s.sketches);
  const rollbackIndex = useCADStore((s) => s.rollbackIndex);
  const activeComponentId = useComponentStore((s) => s.activeComponentId);
  const rootComponentId = useComponentStore((s) => s.rootComponentId);
  const components = useComponentStore((s) => s.components);
  const showComponentColors = useCADStore((s) => s.showComponentColors);

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
  // Evict cache entries for bodies that have been removed from the store —
  // otherwise their cloned MeshStandardMaterial would leak for the lifetime of
  // ExtrudedBodies. Runs whenever the bodies map changes.
  useEffect(() => {
    const cache = materialCache.current;
    for (const bodyId of Array.from(cache.keys())) {
      if (!bodiesById[bodyId]) {
        cache.get(bodyId)!.mat.dispose();
        cache.delete(bodyId);
      }
    }
  }, [bodiesById]);

  const getMaterial = useCallback(
    (featureComponentId: string | undefined, bodyId: string | undefined, isSurface = false): THREE.Material => {
      const effectiveComponentId = featureComponentId ?? (bodyId ? bodiesById[bodyId]?.componentId : undefined);
      const shouldDim = editingInPlace && effectiveComponentId !== activeComponentId;
      const componentColor = effectiveComponentId ? components[effectiveComponentId]?.color : undefined;
      const componentMaterial = showComponentColors && componentColor && !isSurface
        ? componentColorMaterial(componentColor)
        : null;
      const fallback: THREE.Material = componentMaterial ?? (isSurface ? SURFACE_MATERIAL : BODY_MATERIAL);
      if (componentMaterial) return shouldDim ? DIM_MATERIAL : componentMaterial;
      if (!bodyId) return shouldDim ? DIM_MATERIAL : fallback;
      const body = bodiesById[bodyId];
      if (!body || !body.material) return shouldDim ? DIM_MATERIAL : fallback;
      const m = body.material;
      // CTX-7: per-body display opacity (independent of material.opacity)
      const displayOpacity = body.opacity ?? 1;
      // Skip override when body uses default aluminum + no display opacity override.
      // Color compared case-insensitively so picker output (#b0b8c0) matches the
      // canonical default (#B0B8C0) — otherwise we'd needlessly clone a fresh
      // MeshStandardMaterial for every default-aluminum body just on a case mismatch.
      if (!shouldDim && m.id === 'aluminum' && m.color.toLowerCase() === '#b0b8c0' && m.opacity === 1 && displayOpacity === 1) return fallback;
      const finalOpacity = m.opacity * displayOpacity * (shouldDim ? DIM_MATERIAL.opacity : 1);
      const key = `${m.color}|${m.metalness}|${m.roughness}|${m.opacity}|${displayOpacity}|${shouldDim ? 'dim' : 'normal'}`;
      const cached = materialCache.current.get(bodyId);
      if (cached && cached.key === key) return cached.mat;
      if (cached) cached.mat.dispose();
      const mat = new THREE.MeshStandardMaterial({
        color: m.color,
        metalness: m.metalness,
        roughness: m.roughness,
        opacity: finalOpacity,
        transparent: finalOpacity < 1,
      });
      materialCache.current.set(bodyId, { mat, key });
      return mat;
    },
    [editingInPlace, activeComponentId, bodiesById, components, showComponentColors],
  );

  const resolveBodyId = useCallback(
    (featureId: string | undefined, bodyId: string | undefined): string | undefined => {
      if (bodyId && bodiesById[bodyId]) return bodyId;
      if (!featureId) return undefined;
      const bodies = Object.values(bodiesById);
      return bodies.find((body) => body.featureIds.includes(featureId))?.id
        ?? (bodies.length === 1 ? bodies[0].id : undefined);
    },
    [bodiesById],
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
    const distance2 = (feature.params.distance2 as number) || distance;
    const direction = ((feature.params.direction as 'positive' | 'negative' | 'symmetric' | 'two-sides') ?? 'positive');
    const profileIndex = feature.params.profileIndex as number | undefined;
    const profileIndices = Array.isArray(feature.params.profileIndices)
      ? feature.params.profileIndices as number[]
      : null;
    const taperAngle = (feature.params.taperAngle as number) ?? 0;
    const startOffset = (feature.params.startType as string) === 'offset'
      ? ((feature.params.startOffset as number) ?? 0)
      : 0;
    if (profileIndices && profileIndices.length > 1) {
      const geometries: THREE.BufferGeometry[] = [];
      for (const index of profileIndices) {
        const profileSketch = GeometryEngine.createProfileSketch(sketch, index);
        if (!profileSketch) continue;
        const mesh = GeometryEngine.buildExtrudeFeatureMesh(profileSketch, distance, direction, taperAngle, startOffset, distance2, (feature.params.taperAngle2 as number) ?? taperAngle);
        if (!mesh) continue;
        geometries.push(GeometryEngine.bakeMeshWorldGeometry(mesh));
        mesh.geometry.dispose();
      }
      const merged = geometries.length > 0 ? mergeGeometries(geometries, false) : null;
      geometries.forEach((geometry) => geometry.dispose());
      return merged ? new THREE.Mesh(merged) : null;
    }
    const sketchForOp = profileIndex !== undefined
      ? GeometryEngine.createProfileSketch(sketch, profileIndex)
      : sketch;
    if (!sketchForOp) return null;
    const taperAngle2 = (feature.params.taperAngle2 as number) ?? taperAngle;
    return GeometryEngine.buildExtrudeFeatureMesh(sketchForOp, distance, direction, taperAngle, startOffset, distance2, taperAngle2);
  };

  // Content-based signature of the sketches actually referenced by active
  // extrude features. Editing an unrelated sketch (e.g. a sketch driving a
  // different tool) leaves this string stable, so the expensive CSG
  // pipeline below doesn't re-run. Uses a module-level WeakMap so the
  // per-sketch part of the signature is computed ONCE per sketch object —
  // subsequent re-renders just do N cheap Map lookups.
  const relevantSketchesSig = useMemo(() => {
    const usedIds = new Set<string>();
    for (const f of features) {
      if (f.type === 'extrude' && isActive(f) && !f.mesh && f.sketchId) usedIds.add(f.sketchId);
    }
    const parts: string[] = [];
    for (const s of sketches) {
      if (!usedIds.has(s.id)) continue;
      parts.push(sketchStructuralSig(s));
    }
    return parts.join('~');
    // isActive is stable over this effect scope; features is the real signal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [features, sketches]);

  const { bodies, featureIds, featureComponentIds, featureBodyIds } = useMemo(() => {
    // Features with a stored mesh (thin/taper extrude) are rendered directly — skip CSG.
    const extrudeFeatures = [...features]
      .filter((f) => f.type === 'extrude' && isActive(f) && !f.mesh)
      .sort((a, b) => a.timestamp - b.timestamp);

    const outBodies: THREE.BufferGeometry[] = [];
    const outIds: string[] = [];
    const outComponentIds: (string | undefined)[] = [];
    const outBodyIds: (string | undefined)[] = [];
    let currentGeom: THREE.BufferGeometry | null = null;
    let currentFeatureId: string | null = null;
    let currentComponentId: string | undefined;
    let currentBodyId: string | undefined;
    let currentExtraBodyIds: string[] = [];

    const targetsBody = (feature: Feature, bodyId: string | undefined): boolean => {
      const participants = Array.isArray(feature.params.participantBodyIds)
        ? feature.params.participantBodyIds as string[]
        : [];
      return participants.length === 0 || (!!bodyId && participants.includes(bodyId));
    };

    const applyBooleanToCommittedBodies = (
      feature: Feature,
      toolGeom: THREE.BufferGeometry,
      operation: 'cut' | 'intersect',
    ): number => {
      let changed = 0;
      for (let i = 0; i < outBodies.length; i++) {
        if (!targetsBody(feature, outBodyIds[i])) continue;
        const toolForBody = toolGeom.clone();
        const next = operation === 'cut'
          ? GeometryEngine.csgSubtract(outBodies[i], toolForBody)
          : GeometryEngine.csgIntersect(outBodies[i], toolForBody);
        outBodies[i].dispose();
        toolForBody.dispose();
        outBodies[i] = next;
        outIds[i] = feature.id;
        changed += 1;
      }
      return changed;
    };

    const commitCurrent = () => {
      if (currentGeom && currentFeatureId) {
        // Split disconnected pieces: each connected component becomes its own
        // body in the viewport (and, via commitExtrude, its own row in the
        // Bodies browser). The split order is deterministic (sorted by
        // centroid) so commit-time and render-time agree on which piece
        // corresponds to which bodyId.
        const parts = GeometryEngine.splitByConnectedComponents(currentGeom);
        if (parts.length > 1 && parts[0] !== currentGeom) {
          // Multi-part — the original currentGeom is safe to dispose because
          // splitByConnectedComponents returned freshly-allocated buffers.
          currentGeom.dispose();
        }
        const bodyIdsForParts = [currentBodyId, ...currentExtraBodyIds];
        for (let i = 0; i < parts.length; i++) {
          outBodies.push(parts[i]);
          outIds.push(currentFeatureId);
          outComponentIds.push(currentComponentId);
          // When there are more parts than stored bodyIds (e.g. a CSG cut
          // later split a single body) fall back to the primary bodyId so
          // nothing becomes un-pickable.
          outBodyIds.push(resolveBodyId(currentFeatureId, bodyIdsForParts[i] ?? currentBodyId));
        }
      }
      currentGeom = null;
      currentFeatureId = null;
      currentComponentId = undefined;
      currentBodyId = undefined;
      currentExtraBodyIds = [];
    };

    for (const feature of extrudeFeatures) {
      const sketch = sketches.find((s) => s.id === feature.sketchId);
      if (!sketch) continue;
      const toolMesh = buildToolMesh(feature, sketch);
      if (!toolMesh) continue;

      const toolGeom = GeometryEngine.bakeMeshWorldGeometry(toolMesh);
      toolMesh.geometry.dispose();

      const op = (feature.params.operation as 'new-body' | 'join' | 'cut' | 'intersect') ?? 'new-body';

      if (!currentGeom || op === 'new-body') {
        commitCurrent();
        currentGeom = toolGeom;
        currentFeatureId = feature.id;
        currentComponentId = feature.componentId ?? (feature.bodyId ? bodiesById[feature.bodyId]?.componentId : undefined);
        currentBodyId = feature.bodyId;
        currentExtraBodyIds = (feature.params.extraBodyIds as string[] | undefined) ?? [];
        continue;
      }

      if (op === 'cut') {
        const committedTargets = applyBooleanToCommittedBodies(feature, toolGeom, 'cut');
        if (!targetsBody(feature, currentBodyId) && committedTargets > 0) {
          toolGeom.dispose();
          continue;
        }
        const next = GeometryEngine.csgSubtract(currentGeom, toolGeom);
        currentGeom.dispose();
        toolGeom.dispose();
        currentGeom = next;
        currentFeatureId = feature.id;
        // Keep the original body's component/body association — cut features
        // have no componentId/bodyId of their own.
      } else if (op === 'intersect') {
        const committedTargets = applyBooleanToCommittedBodies(feature, toolGeom, 'intersect');
        if (!targetsBody(feature, currentBodyId) && committedTargets > 0) {
          toolGeom.dispose();
          continue;
        }
        const next = GeometryEngine.csgIntersect(currentGeom, toolGeom);
        currentGeom.dispose();
        toolGeom.dispose();
        currentGeom = next;
        currentFeatureId = feature.id;
      } else if (op === 'join') {
        // Fusion 360 parity: only merge bodies that actually overlap.
        // If the join geometry doesn't contact the current body through volume
        // or a shared face, start a new separate body.
        _boxCurrent.setFromBufferAttribute(currentGeom.attributes.position as THREE.BufferAttribute);
        _boxTool.setFromBufferAttribute(toolGeom.attributes.position as THREE.BufferAttribute);
        if (!boxesHaveJoinableContact(_boxCurrent, _boxTool)) {
          commitCurrent();
          currentGeom = toolGeom;
          currentFeatureId = feature.id;
          currentComponentId = feature.componentId ?? (feature.bodyId ? bodiesById[feature.bodyId]?.componentId : undefined);
          currentBodyId = feature.bodyId;
          currentExtraBodyIds = (feature.params.extraBodyIds as string[] | undefined) ?? [];
        } else {
          const next = GeometryEngine.csgUnion(currentGeom, toolGeom);
          currentGeom.dispose();
          toolGeom.dispose();
          currentGeom = next;
          currentFeatureId = feature.id;
          // Keep the original body's component/body association for joined bodies.
        }
      }
    }
    commitCurrent();

    return { bodies: outBodies, featureIds: outIds, featureComponentIds: outComponentIds, featureBodyIds: outBodyIds };
  // `relevantSketchesSig` is the content signature of only the sketches
  // referenced by active extrude features — so unrelated sketch edits
  // (renaming a measurement sketch, drawing in a non-extrude sketch, etc.)
  // leave this stable and do not rebuild every body.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [features, relevantSketchesSig, rollbackIndex, bodiesById]);

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
      const bodyId = resolveBodyId(feature.id, feature.bodyId);
      mesh.userData._origMaterial = undefined;
      mesh.userData.bodyId = bodyId;
      mesh.material = getMaterial(feature.componentId, bodyId, isSurface);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [features, editingInPlace, activeComponentId, rollbackIndex, bodiesById, getMaterial, resolveBodyId]);

  return (
    <>
      {bodies.map((geom, i) => {
        const fId = featureIds[i];
        const bodyId = featureBodyIds[i];
        const bodySelectable = bodyId ? (bodiesById[bodyId]?.selectable !== false) : true;
        return (
          <BodyMesh
            // Always include the index — when a feature's split produces more
            // parts than allocated extraBodyIds, the fallback reuses the primary
            // bodyId for multiple entries and React would drop all but one
            // sibling if they shared a key.
            key={`${fId}::${bodyId ?? 'x'}::${i}`}
            geometry={geom}
            material={getMaterial(featureComponentIds[i], bodyId)}
            featureId={fId}
            bodyId={bodyId}
            pickable={bodySelectable}
          />
        );
      })}
      {features.filter((f) => f.type === 'revolve' && isActive(f) && !f.mesh).map((feature) => {
        const bodyId = resolveBodyId(feature.id, feature.bodyId);
        const material = getMaterial(feature.componentId, bodyId, feature.bodyKind === 'surface');
        if (feature.params.faceRevolve) {
          return <RevolveItem key={feature.id} feature={feature} sketch={undefined} material={material} bodyId={bodyId} />;
        }
        const sketch = sketches.find((s) => s.id === feature.sketchId);
        if (!sketch) return null;
        return <RevolveItem key={feature.id} feature={feature} sketch={sketch} material={material} bodyId={bodyId} />;
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
            const bodyId = resolveBodyId(feature.id, feature.bodyId);
            m.userData.featureId = feature.id;
            m.userData.bodyId = bodyId;
          }}
        />
      ))}
    </>
  );
}
