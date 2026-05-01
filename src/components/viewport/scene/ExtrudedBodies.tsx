import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useCADStore } from '../../../store/cadStore';
import { useComponentStore } from '../../../store/componentStore';
import { GeometryEngine } from '../../../engine/GeometryEngine';
import type { Feature, Sketch } from '../../../types/cad';
import { BODY_MATERIAL, SURFACE_MATERIAL, DIM_MATERIAL } from './bodyMaterial';
import { isComponentVisible } from './componentVisibility';

// Module-level scratch objects — avoids per-feature heap allocations in the CSG loop.
const _boxCurrent = new THREE.Box3();
const _boxTool = new THREE.Box3();
const JOIN_CONTACT_EPSILON = 1e-3;

function boxesTouchOrOverlap(a: THREE.Box3, b: THREE.Box3, eps = JOIN_CONTACT_EPSILON): boolean {
  return (
    a.max.x + eps >= b.min.x && b.max.x + eps >= a.min.x &&
    a.max.y + eps >= b.min.y && b.max.y + eps >= a.min.y &&
    a.max.z + eps >= b.min.z && b.max.z + eps >= a.min.z
  );
}

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
    // NOTE: round-4 axis fix — `revolveSketch` now applies the lathe→axis
    // rotation INTERNALLY (rotates the BufferGeometry so +Y aligns with `axis`).
    // The previous post-rotate-the-mesh path here was correct only when the
    // engine ignored the axis. Adding it now would compose with the engine's
    // rotation and double-flip X/Z revolves — drop it entirely.
    m.material = isSurface ? SURFACE_MATERIAL : BODY_MATERIAL;
    return m;
  }, [isFaceRevolve, feature.params.faceBoundary, sketch, angle, axis, isSurface]);
  useEffect(() => {
    /* eslint-disable react-hooks/immutability -- Three.js userData for raycasting */
    if (mesh) {
      mesh.userData.pickable = true;
      mesh.userData.featureId = feature.id;
    }
    /* eslint-enable react-hooks/immutability */
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

  const bodiesById = useComponentStore((s) => s.bodies);

  // When a non-root component is active, dim features that belong to other components.
  const editingInPlace = !!activeComponentId && activeComponentId !== rootComponentId && !!components[activeComponentId];

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
      const fallback: THREE.Material = isSurface ? SURFACE_MATERIAL : BODY_MATERIAL;
      const body = bodyId ? bodiesById[bodyId] : undefined;
      const ownerComponentId = body?.componentId ?? featureComponentId;
      if (editingInPlace && ownerComponentId && ownerComponentId !== activeComponentId) return DIM_MATERIAL;
      if (!bodyId) return fallback;
      if (!body || !body.material) return fallback;
      const m = body.material;
      // CTX-7: per-body display opacity (independent of material.opacity)
      const displayOpacity = body.opacity ?? 1;
      // Skip override when body uses a built-in default + no display opacity override.
      // Color compared case-insensitively so picker output (#b0b8c0) matches the
      // canonical default (#B0B8C0) — otherwise we'd needlessly clone a fresh
      // MeshStandardMaterial for every default-aluminum body just on a case mismatch.
      const materialColor = m.color.toLowerCase();
      const isBuiltInDefault =
        (m.id === 'aluminum' && materialColor === '#b0b8c0') ||
        (m.id === 'default-blue' && materialColor === '#4f8fd8') ||
        (m.id === 'warm-plastic' && materialColor === '#f2a23a');
      if (isBuiltInDefault && m.opacity === 1 && displayOpacity === 1) return fallback;
      const finalOpacity = m.opacity * displayOpacity;
      const key = `${m.color}|${m.metalness}|${m.roughness}|${m.opacity}|${displayOpacity}`;
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
    const distance2 = (feature.params.distance2 as number) || distance;
    const direction = ((feature.params.direction as 'positive' | 'negative' | 'symmetric' | 'two-sides') ?? 'positive');
    const profileIndex = feature.params.profileIndex as number | undefined;
    const profileIndices = feature.params.profileIndices as number[] | undefined;
    const taperAngle = (feature.params.taperAngle as number) ?? 0;
    const startOffset = (feature.params.startType as string) === 'offset'
      ? ((feature.params.startOffset as number) ?? 0)
      : 0;
    const taperAngle2 = (feature.params.taperAngle2 as number) ?? taperAngle;
    if (profileIndices && profileIndices.length > 1) {
      let merged: THREE.BufferGeometry | null = null;
      for (const index of profileIndices) {
        const profileSketch = GeometryEngine.createProfileSketch(sketch, index);
        if (!profileSketch) continue;
        const mesh = GeometryEngine.buildExtrudeFeatureMesh(
          profileSketch,
          distance,
          direction,
          taperAngle,
          startOffset,
          distance2,
          taperAngle2,
        );
        if (!mesh) continue;
        const geom = GeometryEngine.bakeMeshWorldGeometry(mesh);
        mesh.geometry.dispose();
        if (!merged) {
          merged = geom;
        } else {
          const next = GeometryEngine.csgUnion(merged, geom);
          merged.dispose();
          geom.dispose();
          merged = next;
        }
      }
      return merged ? new THREE.Mesh(merged) : null;
    }
    const sketchForOp = profileIndex !== undefined
      ? GeometryEngine.createProfileSketch(sketch, profileIndex)
      : sketch;
    if (!sketchForOp) return null;
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
          outBodyIds.push(bodyIdsForParts[i] ?? currentBodyId);
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
        currentComponentId = feature.componentId;
        currentBodyId = feature.bodyId;
        currentExtraBodyIds = (feature.params.extraBodyIds as string[] | undefined) ?? [];
        continue;
      }

      if (op === 'cut') {
        const next = GeometryEngine.csgSubtract(currentGeom, toolGeom);
        currentGeom.dispose();
        toolGeom.dispose();
        currentGeom = next;
        currentFeatureId = feature.id;
        // Keep the original body's component/body association — cut features
        // have no componentId/bodyId of their own.
      } else if (op === 'intersect') {
        const next = GeometryEngine.csgIntersect(currentGeom, toolGeom);
        currentGeom.dispose();
        toolGeom.dispose();
        currentGeom = next;
        currentFeatureId = feature.id;
      } else if (op === 'join') {
        // Fusion 360 parity: only merge bodies that actually overlap.
        // If the join geometry doesn't intersect the current body (e.g. an
        // offset extrusion floating in space), start a new separate body.
        _boxCurrent.setFromBufferAttribute(currentGeom.attributes.position as THREE.BufferAttribute);
        _boxTool.setFromBufferAttribute(toolGeom.attributes.position as THREE.BufferAttribute);
        if (!boxesTouchOrOverlap(_boxCurrent, _boxTool)) {
          commitCurrent();
          currentGeom = toolGeom;
          currentFeatureId = feature.id;
          currentComponentId = feature.componentId;
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
  }, [features, relevantSketchesSig, rollbackIndex]);

  useEffect(() => {
    return () => {
      for (const g of bodies) g.dispose();
    };
  }, [bodies]);

  // Apply dim / appearance materials on pre-built stored meshes in an effect,
  // never in render, so cleanup is guaranteed when Edit In Place exits.
  useEffect(() => {
    const storedMeshFeatures = features.filter((f) => {
      if (!isActive(f) || !f.mesh) return false;
      const ownerComponentId = f.bodyId ? bodiesById[f.bodyId]?.componentId : undefined;
      return isComponentVisible(components, ownerComponentId ?? f.componentId);
    });
    storedMeshFeatures.forEach((feature) => {
      const mesh = feature.mesh!;
      const isSurface = feature.bodyKind === 'surface';
      mesh.userData._origMaterial = undefined;
      mesh.material = getMaterial(feature.componentId, feature.bodyId, isSurface);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [features, editingInPlace, activeComponentId, rollbackIndex, bodiesById, components, getMaterial]);

  return (
    <>
      {bodies.map((geom, i) => {
        const fId = featureIds[i];
        const bodyId = featureBodyIds[i];
        const body = bodyId ? bodiesById[bodyId] : undefined;
        const ownerComponentId = body?.componentId ?? featureComponentIds[i];
        if (!isComponentVisible(components, ownerComponentId)) return null;
        if (bodyId && body?.visible === false) return null;
        const bodySelectable = bodyId ? (body?.selectable !== false) : true;
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
      {features.filter((f) => f.type === 'revolve' && isActive(f)).map((feature) => {
        const body = feature.bodyId ? bodiesById[feature.bodyId] : undefined;
        if (!isComponentVisible(components, body?.componentId ?? feature.componentId)) return null;
        if (feature.bodyId && body?.visible === false) return null;
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
        !isComponentVisible(
          components,
          (feature.bodyId ? bodiesById[feature.bodyId]?.componentId : undefined) ?? feature.componentId,
        ) || (feature.bodyId && bodiesById[feature.bodyId]?.visible === false)
          ? null
          : (
            <primitive
              key={feature.id}
              object={feature.mesh!}
              onUpdate={(m: THREE.Object3D) => {
                m.userData.pickable = true;
                m.userData.featureId = feature.id;
              }}
            />
          )
      ))}
    </>
  );
}
