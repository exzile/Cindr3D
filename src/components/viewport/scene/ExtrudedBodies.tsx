import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { useCADStore } from '../../../store/cadStore';
import { shallow } from 'zustand/shallow';
import { useComponentStore } from '../../../store/componentStore';
import { liveBodyMeshes, bodyGeometryCache, bodyIdGeometryCache } from '../../../store/meshRegistry';
import { GeometryEngine } from '../../../engine/GeometryEngine';
import { csgSubtract } from '../../../engine/geometryEngine/core/solid/csg';
import type { BodyTopology, ModelEdge } from '../../../engine/geometryEngine/core/solid/edgeTypes';
import { modelEdgeId } from '../../../engine/geometryEngine/core/solid/edgeId';
import { extrudeProfileTopology } from '../../../engine/geometryEngine/core/solid/profileTopology';
import { getOcc } from '../../../engine/occ/loader';
import { migrateLegacyExtrudeFeatures } from '../../../engine/occ/legacyMigration';

const OCC_EXTRUDE_MIGRATION_PASS_VERSION = 3;
const CSG_CUT_OVERTRAVEL_MM = 0.05;

// A cut that doesn't reach the body's outer edges leaves every one of them
// geometrically UNCHANGED — but re-extracting topology from the CSG result
// reliably loses a few of them in the non-manifold soup around the hole. So
// after a cut we PRESERVE the pre-cut body's exact edges that are clear of the
// tool, and take only the NEW rim (edges touching the tool's volume) from the
// post-cut extraction. `mergeCutTopology` implements that. An edge is "clear"
// when no point of its polyline is inside the padded tool AABB.
function polylineHitsBox(poly: THREE.Vector3[], box: THREE.Box3): boolean {
  for (const p of poly) if (box.containsPoint(p)) return true;
  return false;
}

function clipSegmentToBox(
  a: THREE.Vector3,
  b: THREE.Vector3,
  box: THREE.Box3,
): [THREE.Vector3, THREE.Vector3] | null {
  const d = b.clone().sub(a);
  let t0 = 0;
  let t1 = 1;
  const clipAxis = (p: number, q: number): boolean => {
    if (Math.abs(p) < 1e-12) return q >= 0;
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };
  if (!clipAxis(-d.x, a.x - box.min.x)) return null;
  if (!clipAxis(d.x, box.max.x - a.x)) return null;
  if (!clipAxis(-d.y, a.y - box.min.y)) return null;
  if (!clipAxis(d.y, box.max.y - a.y)) return null;
  if (!clipAxis(-d.z, a.z - box.min.z)) return null;
  if (!clipAxis(d.z, box.max.z - a.z)) return null;
  if (t1 < t0) return null;
  return [a.clone().addScaledVector(d, t0), a.clone().addScaledVector(d, t1)];
}

function clipTopologyToBox(edges: ModelEdge[], box: THREE.Box3): ModelEdge[] {
  const out: ModelEdge[] = [];
  const epsSq = Math.max(box.min.distanceToSquared(box.max) * 1e-10, 1e-8);
  for (const edge of edges) {
    let run: THREE.Vector3[] = [];
    const flush = () => {
      if (run.length >= 2) {
        const polyline = run.map((p) => p.clone());
        out.push({ id: modelEdgeId(polyline), polyline, kind: edge.kind });
      }
      run = [];
    };
    for (let i = 0; i + 1 < edge.polyline.length; i++) {
      const clipped = clipSegmentToBox(edge.polyline[i], edge.polyline[i + 1], box);
      if (!clipped || clipped[0].distanceToSquared(clipped[1]) <= epsSq) {
        flush();
        continue;
      }
      if (run.length === 0) {
        run.push(clipped[0], clipped[1]);
      } else if (run[run.length - 1].distanceToSquared(clipped[0]) <= epsSq) {
        run.push(clipped[1]);
      } else {
        flush();
        run.push(clipped[0], clipped[1]);
      }
    }
    flush();
  }
  return out;
}

function edgeIsMostlyStraight(edge: ModelEdge): boolean {
  const poly = edge.polyline;
  if (poly.length <= 2) return true;
  const a = poly[0];
  const b = poly[poly.length - 1];
  const ab = b.clone().sub(a);
  const lenSq = ab.lengthSq();
  if (lenSq < 1e-12) return false;
  const tolSq = Math.max(lenSq * 1e-6, 1e-8);
  for (let i = 1; i + 1 < poly.length; i++) {
    const ap = poly[i].clone().sub(a);
    const t = THREE.MathUtils.clamp(ap.dot(ab) / lenSq, 0, 1);
    const closest = a.clone().addScaledVector(ab, t);
    if (poly[i].distanceToSquared(closest) > tolSq) return false;
  }
  return true;
}

function repairCutRimTopology(rim: ModelEdge[], toolBox: THREE.Box3): ModelEdge[] {
  if (rim.length < 6) return rim;

  type Seg = { edge: ModelEdge; a: THREE.Vector3; b: THREE.Vector3; used: boolean };
  type PlaneBucket = { axis: 0 | 1 | 2; coord: number; segs: Seg[] };
  type CircleFit = {
    axis: 0 | 1 | 2;
    centerA: number;
    centerB: number;
    radius: number;
    score: number;
    pointIdx: number[];
  };

  const segs: Seg[] = [];
  for (const edge of rim) {
    const poly = edge.polyline;
    for (let i = 0; i + 1 < poly.length; i++) {
      if (poly[i].distanceToSquared(poly[i + 1]) < 1e-12) continue;
      segs.push({ edge, a: poly[i], b: poly[i + 1], used: false });
    }
  }
  if (segs.length < 6) return rim;

  const diag = Math.max(toolBox.min.distanceTo(toolBox.max), 1);
  const planeTol = Math.max(diag * 2e-3, 1e-4);
  const radialTol = Math.max(diag * 8e-3, 5e-4);
  const radialTolSq = radialTol * radialTol;
  const buckets: PlaneBucket[] = [];
  const coordAt = (p: THREE.Vector3, axis: 0 | 1 | 2): number => axis === 0 ? p.x : axis === 1 ? p.y : p.z;
  const project = (p: THREE.Vector3, axis: 0 | 1 | 2): [number, number] => {
    if (axis === 0) return [p.y, p.z];
    if (axis === 1) return [p.x, p.z];
    return [p.x, p.y];
  };
  for (const seg of segs) {
    let axis: 0 | 1 | 2 = 0;
    let span = Math.abs(seg.a.x - seg.b.x);
    const spanY = Math.abs(seg.a.y - seg.b.y);
    const spanZ = Math.abs(seg.a.z - seg.b.z);
    if (spanY < span) { axis = 1; span = spanY; }
    if (spanZ < span) { axis = 2; span = spanZ; }
    if (span > planeTol) continue;
    const coord = (coordAt(seg.a, axis) + coordAt(seg.b, axis)) * 0.5;
    let bucket = buckets.find((b) => b.axis === axis && Math.abs(b.coord - coord) <= planeTol);
    if (!bucket) {
      bucket = { axis, coord, segs: [] };
      buckets.push(bucket);
    }
    bucket.segs.push(seg);
  }

  const fitCircle3 = (
    p1: [number, number],
    p2: [number, number],
    p3: [number, number],
  ): { ca: number; cb: number; r: number } | null => {
    const [x1, y1] = p1, [x2, y2] = p2, [x3, y3] = p3;
    const d = 2 * (x1 * (y2 - y3) + x2 * (y3 - y1) + x3 * (y1 - y2));
    if (Math.abs(d) < 1e-9) return null;
    const x1s = x1 * x1 + y1 * y1;
    const x2s = x2 * x2 + y2 * y2;
    const x3s = x3 * x3 + y3 * y3;
    const ca = (x1s * (y2 - y3) + x2s * (y3 - y1) + x3s * (y1 - y2)) / d;
    const cb = (x1s * (x3 - x2) + x2s * (x1 - x3) + x3s * (x2 - x1)) / d;
    const r = Math.hypot(x1 - ca, y1 - cb);
    return Number.isFinite(r) && r > radialTol * 2 ? { ca, cb, r } : null;
  };

  const bestCircleForBucket = (bucket: PlaneBucket): CircleFit | null => {
    const points: THREE.Vector3[] = [];
    for (const seg of bucket.segs) {
      if (seg.used) continue;
      points.push(seg.a, seg.b);
    }
    const unique: THREE.Vector3[] = [];
    const pointTolSq = planeTol * planeTol;
    for (const p of points) {
      if (!unique.some((u) => u.distanceToSquared(p) <= pointTolSq)) unique.push(p);
    }
    if (unique.length < 6) return null;
    const pts2 = unique.map((p) => project(p, bucket.axis));
    let best: CircleFit | null = null;
    for (let i = 0; i < pts2.length - 2; i++) {
      for (let j = i + 1; j < pts2.length - 1; j++) {
        for (let k = j + 1; k < pts2.length; k++) {
          const fit = fitCircle3(pts2[i], pts2[j], pts2[k]);
          if (!fit) continue;
          const pointIdx: number[] = [];
          for (let pi = 0; pi < pts2.length; pi++) {
            const [a, b] = pts2[pi];
            if (Math.abs(Math.hypot(a - fit.ca, b - fit.cb) - fit.r) <= radialTol) pointIdx.push(pi);
          }
          if (pointIdx.length < 6) continue;
          const score = pointIdx.length;
          if (!best || score > best.score) {
            best = { axis: bucket.axis, centerA: fit.ca, centerB: fit.cb, radius: fit.r, score, pointIdx };
          }
        }
      }
    }
    if (!best) return null;

    const inlier = new Set(best.pointIdx);
    let coveredSegs = 0;
    for (const seg of bucket.segs) {
      if (seg.used) continue;
      const [a0, b0] = project(seg.a, bucket.axis);
      const [a1, b1] = project(seg.b, bucket.axis);
      const r0 = Math.hypot(a0 - best.centerA, b0 - best.centerB);
      const r1 = Math.hypot(a1 - best.centerA, b1 - best.centerB);
      const len = Math.hypot(a1 - a0, b1 - b0);
      const midA = (a0 + a1) * 0.5 - best.centerA;
      const midB = (b0 + b1) * 0.5 - best.centerB;
      const tangentDot = Math.abs(((a1 - a0) * midA + (b1 - b0) * midB) / Math.max(len * best.radius, 1e-9));
      if (Math.abs(r0 - best.radius) <= radialTol
        && Math.abs(r1 - best.radius) <= radialTol
        && len <= best.radius * 0.45
        && tangentDot <= 0.35) {
        coveredSegs++;
      }
    }
    return coveredSegs >= 4 && inlier.size >= 6 ? best : null;
  };

  const repaired: ModelEdge[] = [];
  for (const bucket of buckets) {
    for (let guard = 0; guard < 6; guard++) {
      const fit = bestCircleForBucket(bucket);
      if (!fit) break;
      const circleSegs = bucket.segs.filter((seg) => {
        if (seg.used) return false;
        const [a0, b0] = project(seg.a, bucket.axis);
        const [a1, b1] = project(seg.b, bucket.axis);
        const r0 = Math.hypot(a0 - fit.centerA, b0 - fit.centerB);
        const r1 = Math.hypot(a1 - fit.centerA, b1 - fit.centerB);
        const len = Math.hypot(a1 - a0, b1 - b0);
        const midA = (a0 + a1) * 0.5 - fit.centerA;
        const midB = (b0 + b1) * 0.5 - fit.centerB;
        const tangentDot = Math.abs(((a1 - a0) * midA + (b1 - b0) * midB) / Math.max(len * fit.radius, 1e-9));
        return Math.abs(r0 - fit.radius) <= radialTol
          && Math.abs(r1 - fit.radius) <= radialTol
          && len <= fit.radius * 0.45
          && tangentDot <= 0.35;
      });
      if (circleSegs.length < 4) break;
      for (const seg of circleSegs) seg.used = true;
      for (const seg of bucket.segs) {
        if (seg.used) continue;
        const [a0, b0] = project(seg.a, bucket.axis);
        const [a1, b1] = project(seg.b, bucket.axis);
        const dx = a1 - a0;
        const dy = b1 - b0;
        const len = Math.hypot(dx, dy);
        if (len <= radialTol) continue;
        const r0 = Math.hypot(a0 - fit.centerA, b0 - fit.centerB);
        const r1 = Math.hypot(a1 - fit.centerA, b1 - fit.centerB);
        const nearCircle = Math.abs(r0 - fit.radius) <= radialTol * 3
          || Math.abs(r1 - fit.radius) <= radialTol * 3;
        const crossesCircle = Math.min(r0, r1) < fit.radius && Math.max(r0, r1) > fit.radius;
        if (nearCircle || crossesCircle) seg.used = true;
      }
      const rawPoints: THREE.Vector3[] = [];
      for (const seg of circleSegs) rawPoints.push(seg.a, seg.b);
      const unique: THREE.Vector3[] = [];
      for (const p of rawPoints) {
        if (!unique.some((u) => u.distanceToSquared(p) <= radialTolSq)) unique.push(p);
      }
      const ordered = unique
        .map((p) => {
          const [a, b] = project(p, bucket.axis);
          return { angle: Math.atan2(b - fit.centerB, a - fit.centerA), p };
        })
        .sort((a, b) => a.angle - b.angle);
      if (ordered.length < 4) continue;
      const gaps = ordered.map((item, i) => {
        const next = ordered[(i + 1) % ordered.length];
        const gap = i + 1 < ordered.length
          ? next.angle - item.angle
          : next.angle + Math.PI * 2 - item.angle;
        return gap;
      });
      const medianGap = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)] || 0;
      const maxGap = Math.max(...gaps);
      const maxGapIndex = gaps.indexOf(maxGap);
      const closeLoop = maxGap <= Math.max(medianGap * 2.6, Math.PI / 9);
      const arcOrder = closeLoop
        ? ordered
        : [...ordered.slice(maxGapIndex + 1), ...ordered.slice(0, maxGapIndex + 1)];
      const arcPoints = arcOrder.map(({ p }) => p);
      const chordLengths: number[] = [];
      for (let i = 0; i + 1 < arcPoints.length; i++) chordLengths.push(arcPoints[i].distanceTo(arcPoints[i + 1]));
      if (closeLoop && arcPoints.length > 2) chordLengths.push(arcPoints[arcPoints.length - 1].distanceTo(arcPoints[0]));
      const medianChord = [...chordLengths].sort((a, b) => a - b)[Math.floor(chordLengths.length / 2)] || radialTol;
      const maxChord = Math.max(medianChord * 3.5, radialTol * 4);
      const chains: THREE.Vector3[][] = [];
      let chain: THREE.Vector3[] = [];
      for (let i = 0; i < arcPoints.length; i++) {
        if (chain.length === 0) {
          chain.push(arcPoints[i]);
          continue;
        }
        if (chain[chain.length - 1].distanceTo(arcPoints[i]) > maxChord) {
          if (chain.length >= 4) chains.push(chain);
          chain = [arcPoints[i]];
        } else {
          chain.push(arcPoints[i]);
        }
      }
      if (closeLoop && chain.length && chains.length === 0 && chain[chain.length - 1].distanceTo(chain[0]) <= maxChord) {
        chain = [...chain, chain[0]];
      }
      if (chain.length >= 4) chains.push(chain);
      for (const pts of chains) {
        const polyline = pts.map((p) => p.clone());
        if (polyline.length >= 2) repaired.push({ id: modelEdgeId(polyline), polyline, kind: 'crease' });
      }
    }
  }

  if (repaired.length === 0) return rim;

  const passthrough = segs
    .filter((seg) => !seg.used)
    .map((seg) => ({ id: modelEdgeId([seg.a, seg.b]), polyline: [seg.a.clone(), seg.b.clone()], kind: seg.edge.kind }));
  return [...passthrough, ...repaired];
}

function mergeCutTopology(
  preTopo: BodyTopology | undefined,
  postTopo: BodyTopology | undefined,
  toolBox: THREE.Box3,
  bodyBox?: THREE.Box3,
  toolTopo?: BodyTopology,
): BodyTopology | undefined {
  const authoredRim = toolTopo?.edges?.length && bodyBox
    ? clipTopologyToBox(toolTopo.edges, bodyBox)
    : [];
  if (!preTopo?.edges?.length) return authoredRim.length > 0 ? { edges: authoredRim } : postTopo;
  const survivors = preTopo.edges.filter((e) => !polylineHitsBox(e.polyline, toolBox));
  if (!postTopo?.edges?.length) return authoredRim.length > 0 ? { edges: [...survivors, ...authoredRim] } : preTopo;
  const postRim = postTopo.edges
    .filter((e) => polylineHitsBox(e.polyline, toolBox))
    .filter((e) => authoredRim.length === 0 || edgeIsMostlyStraight(e));
  const rim = authoredRim.length > 0
    ? [...authoredRim, ...postRim]
    : repairCutRimTopology(postRim, toolBox);
  // Nothing survived the clear-of-tool test (unexpected) → keep the post
  // extraction so we never end up with no edges at all.
  if (survivors.length === 0) return postTopo;
  return { edges: [...survivors, ...rim] };
}
import type { Feature, Sketch } from '../../../types/cad';
import { boxesHaveJoinableContact } from '../../../utils/geometry/boundsContact';
import { BODY_MATERIAL, SURFACE_MATERIAL, DIM_MATERIAL, componentColorMaterial } from './bodyMaterial';

// Module-level scratch objects reused across renders — avoids per-feature heap allocations.
const _boxCurrent = new THREE.Box3();
const _boxTool = new THREE.Box3();

type PersistHydrationApi = {
  persist?: {
    hasHydrated: () => boolean;
    onFinishHydration: (cb: () => void) => (() => void) | void;
  };
};

function storeHasHydrated(store: PersistHydrationApi): boolean {
  return store.persist?.hasHydrated() ?? true;
}

function useSceneStoresHydrated(): boolean {
  const [hydrated, setHydrated] = useState(
    () => storeHasHydrated(useCADStore as unknown as PersistHydrationApi) &&
      storeHasHydrated(useComponentStore as unknown as PersistHydrationApi),
  );

  useEffect(() => {
    if (hydrated) return undefined;

    const cadStore = useCADStore as unknown as PersistHydrationApi;
    const componentStore = useComponentStore as unknown as PersistHydrationApi;
    const check = () => {
      if (storeHasHydrated(cadStore) && storeHasHydrated(componentStore)) {
        setHydrated(true);
      }
    };
    const disposers: Array<() => void> = [];

    if (!storeHasHydrated(cadStore)) {
      const unsub = cadStore.persist?.onFinishHydration(check);
      if (typeof unsub === 'function') disposers.push(unsub);
    }
    if (!storeHasHydrated(componentStore)) {
      const unsub = componentStore.persist?.onFinishHydration(check);
      if (typeof unsub === 'function') disposers.push(unsub);
    }

    check();
    return () => {
      for (const dispose of disposers) dispose();
    };
  }, [hydrated]);

  return hydrated;
}

function featureNeedsBody(feature: Feature, bodiesById: ReturnType<typeof useComponentStore.getState>['bodies']): boolean {
  if (feature.type !== 'extrude' || feature.suppressed) return false;
  const operation =
    (feature.params?.operation as string | undefined) ??
    (feature.params?.extrudeOperation as string | undefined) ??
    'new-body';
  if (operation !== 'new-body') return false;
  if (feature.bodyId && bodiesById[feature.bodyId]) return false;
  return !Object.values(bodiesById).some((body) => body.featureIds.includes(feature.id));
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

  // Register this mesh in the live body-mesh registry so commitFillet can
  // obtain the rendered geometry for extrude features, which are not stored
  // in feature.mesh (they live only in the R3F scene via the CSG pipeline).
  // Key is the THREE.js mesh UUID — stable for the object's lifetime.
  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    liveBodyMeshes.set(mesh.uuid, mesh);
    return () => { liveBodyMeshes.delete(mesh.uuid); };
  // geometry + featureId in deps so the registry is refreshed whenever the
  // body's rendered geometry changes or its feature association changes.
  // The mesh object (and its uuid) stays the same across both updates.
  }, [geometry, featureId]);

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

/** React.memo wrapper for BodyMesh — skips re-renders when geometry identity is unchanged.
 *  Internal useComponentStore subscription still fires when selection changes. */
const BodyMeshMemo = memo(BodyMesh, (prev, next) =>
  prev.geometry === next.geometry &&
  prev.material === next.material &&
  prev.featureId === next.featureId &&
  prev.bodyId === next.bodyId &&
  prev.pickable === next.pickable,
);

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
    return () => {
      const toDispose = mesh;
      // Defer by one tick so R3F finishes its current render cycle before
      // the GPU buffers are freed (prevents one-frame blank on geometry swap).
      setTimeout(() => { toDispose?.geometry.dispose(); }, 0);
    };
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
  const sceneStoresHydrated = useSceneStoresHydrated();
  const features = useCADStore((s) => s.features, shallow);
  const sketches = useCADStore((s) => s.sketches);
  const rollbackIndex = useCADStore((s) => s.rollbackIndex);
  const activeComponentId = useComponentStore((s) => s.activeComponentId);
  const rootComponentId = useComponentStore((s) => s.rootComponentId);
  const components = useComponentStore((s) => s.components);
  const showComponentColors = useCADStore((s) => s.showComponentColors);

  const bodiesById = useComponentStore((s) => s.bodies);
  const lastOccMigrationKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!sceneStoresHydrated) return;
    const componentStore = useComponentStore.getState();
    const parentId = componentStore.activeComponentId ?? componentStore.rootComponentId;
    const missing = features.filter((feature) => featureNeedsBody(feature, componentStore.bodies));
    for (const feature of missing) {
      const label = `${feature.bodyKind === 'surface' ? 'Surface' : 'Body'} ${Object.keys(componentStore.bodies).length + 1}`;
      const bodyId = componentStore.addBody(parentId, label);
      if (bodyId) componentStore.addFeatureToBody(bodyId, feature.id);
    }
  }, [sceneStoresHydrated, features, bodiesById]);

  useEffect(() => {
    if (!sceneStoresHydrated) return undefined;

    const migrationKey = `${OCC_EXTRUDE_MIGRATION_PASS_VERSION}|${features
      .filter((feature) => feature.type === 'extrude' && !feature.suppressed)
      .map((feature) => {
        const brepBodyId = feature.mesh instanceof THREE.Mesh
          ? feature.mesh.userData.brepBodyId ?? ''
          : '';
        return `${feature.id}:${feature.timestamp}:${feature.visible}:${feature.params.operation ?? feature.params.extrudeOperation ?? ''}:${brepBodyId}`;
      })
      .join('|')}`;
    if (!migrationKey || migrationKey === lastOccMigrationKeyRef.current) return undefined;

    let cancelled = false;
    getOcc()
      .then((occ) => {
        if (cancelled) return;
        const migrated = migrateLegacyExtrudeFeatures(features, sketches, occ);
        const changed = migrated.some((feature, index) => feature !== features[index]);
        lastOccMigrationKeyRef.current = migrationKey;
        if (changed) {
          useCADStore.setState({ features: migrated });
        }
      })
      .catch((error) => {
        console.warn('[ExtrudedBodies] OCC migration failed before rendering extrudes', error);
      });

    return () => {
      cancelled = true;
    };
  }, [sceneStoresHydrated, features, sketches]);

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

  // Non-destructive OCC edge modification: when a fillet/chamfer feature has been committed
  // with a mesh (Phase 0 — it stores the result on its own node), the parent
  // feature must be hidden so the two bodies don't overlap. A downstream
  // edge modification is "active" only when it has a computed mesh; while it's pending
  // (just added, OCC not yet run) the parent stays visible for replay.
  const hasActiveDownstreamEdgeModification = (featureId: string): boolean =>
    features.some(
      (f) =>
        (f.type === 'fillet' || f.type === 'chamfer') &&
        (f.parentFeatureId === featureId || f.params.parentFeatureId === featureId) &&
        f.visible && !f.suppressed &&
        f.mesh != null,
    );

  const buildToolMesh = (feature: Feature, sketch: Sketch): THREE.Mesh | null => {
    let distance = (feature.params.distance as number) || 10;
    let distance2 = (feature.params.distance2 as number) || distance;
    const direction = ((feature.params.direction as 'positive' | 'negative' | 'symmetric' | 'two-sides') ?? 'positive');
    const profileIndex = feature.params.profileIndex as number | undefined;
    const profileIndices = Array.isArray(feature.params.profileIndices)
      ? feature.params.profileIndices as number[]
      : null;
    const taperAngle = (feature.params.taperAngle as number) ?? 0;
    let startOffset = (feature.params.startType as string) === 'offset'
      ? ((feature.params.startOffset as number) ?? 0)
      : 0;
    const operation =
      (feature.params.operation as string | undefined) ??
      (feature.params.extrudeOperation as string | undefined);
    if (operation === 'cut') {
      const overtravel = Math.max(CSG_CUT_OVERTRAVEL_MM, Math.abs(distance) * 1e-4);
      if (direction === 'positive') {
        startOffset -= overtravel;
        distance += overtravel * 2;
      } else if (direction === 'negative') {
        startOffset += overtravel;
        distance += overtravel * 2;
      } else if (direction === 'symmetric') {
        distance += overtravel * 2;
      } else {
        distance += overtravel;
        distance2 += Math.max(CSG_CUT_OVERTRAVEL_MM, Math.abs(distance2) * 1e-4);
      }
    }
    if (profileIndices && profileIndices.length > 1) {
      const geometries: THREE.BufferGeometry[] = [];
      // Exact per-profile edges from the sketch loops (already WORLD space).
      const accEdges: { id: string; polyline: THREE.Vector3[]; kind: string }[] = [];
      for (const index of profileIndices) {
        const profileSketch = GeometryEngine.createProfileSketch(sketch, index);
        if (!profileSketch) continue;
        const mesh = GeometryEngine.buildExtrudeFeatureMesh(profileSketch, distance, direction, taperAngle, startOffset, distance2, (feature.params.taperAngle2 as number) ?? taperAngle);
        if (!mesh) continue;
        const pt = extrudeProfileTopology(profileSketch, distance, direction, startOffset, distance2, taperAngle);
        for (const e of pt.edges) accEdges.push({ id: `${index}:${e.id}`, kind: e.kind, polyline: e.polyline });
        geometries.push(GeometryEngine.bakeMeshWorldGeometry(mesh));
        mesh.geometry.dispose();
      }
      const merged = geometries.length > 0 ? mergeGeometries(geometries, false) : null;
      geometries.forEach((geometry) => geometry.dispose());
      if (!merged) return null;
      const mm = new THREE.Mesh(merged);
      if (accEdges.length > 0) mm.userData.topoWorld = { edges: accEdges };
      return mm;
    }
    const sketchForOp = profileIndex !== undefined
      ? GeometryEngine.createProfileSketch(sketch, profileIndex)
      : sketch;
    if (!sketchForOp) return null;
    const taperAngle2 = (feature.params.taperAngle2 as number) ?? taperAngle;
    const m = GeometryEngine.buildExtrudeFeatureMesh(sketchForOp, distance, direction, taperAngle, startOffset, distance2, taperAngle2);
    if (m) {
      const pt = extrudeProfileTopology(sketchForOp, distance, direction, startOffset, distance2, taperAngle2);
      if (pt.edges.length > 0) {
        m.userData.topoWorld = pt;
      }
    }
    return m;
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
      if (f.type === 'extrude' && isActive(f) && !f.mesh && !hasActiveDownstreamEdgeModification(f.id) && f.sketchId) usedIds.add(f.sketchId);
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
    if (!sceneStoresHydrated) {
      return {
        bodies: [],
        featureIds: [],
        featureComponentIds: [],
        featureBodyIds: [],
      };
    }

    // Features with a stored mesh (thin/taper extrude) are rendered directly — skip CSG.
    const extrudeFeatures = [...features]
      .filter((f) => f.type === 'extrude' && isActive(f) && !f.mesh && !hasActiveDownstreamEdgeModification(f.id))
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
        if (operation === 'cut') {
          const toolForBody = toolGeom.clone();
          try {
            const next = csgSubtract(outBodies[i], toolForBody);
            outBodies[i].dispose();
            outBodies[i] = next;
          } catch (error) {
            console.warn('[ExtrudedBodies] Legacy committed-body cut fallback failed; keeping body unchanged', error);
          } finally {
            toolForBody.dispose();
          }
        }
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
        // Exact extrude topology, if present (pure extrude, never run through
        // a boolean — a CSG op replaces currentGeom with a soup that has no
        // userData.topology). Preserved verbatim for the common single-body
        // case; CSG/multi-part bodies fall back to soup-region extraction.
        const exactTopo = (currentGeom.userData as { topology?: unknown }).topology;
        const parts = GeometryEngine.splitByConnectedComponents(currentGeom);
        if (parts.length > 1 && parts[0] !== currentGeom) {
          // Multi-part — the original currentGeom is safe to dispose because
          // splitByConnectedComponents returned freshly-allocated buffers.
          currentGeom.dispose();
        }
        const bodyIdsForParts = [currentBodyId, ...currentExtraBodyIds];
        for (let i = 0; i < parts.length; i++) {
          if (exactTopo && parts.length === 1) {
            // Single pure-extrude body → use its exact ExtrudeGeometry edges
            // (zero soup-residual hole lines).
            parts[i].userData.topology = exactTopo;
          } else {
            parts[i].userData.topology = { edges: [] };
          }
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
      // Exact profile-derived topology is already in WORLD space and can be
      // attached verbatim. Locally extracted mesh topology is transformed by
      // matrixWorld to match the baked geometry.
      const tw = toolMesh.userData.topoWorld as
        | { edges: { id: string; polyline: THREE.Vector3[]; kind: string }[] }
        | undefined;
      const lt = toolMesh.userData.localTopo as
        | { edges: { id: string; polyline: THREE.Vector3[]; kind: string }[] }
        | undefined;
      if (tw) {
        toolGeom.userData.topology = tw;
      } else if (lt) {
        toolMesh.updateMatrixWorld(true);
        const m4 = toolMesh.matrixWorld;
        toolGeom.userData.topology = {
          edges: lt.edges.map((e) => ({
            id: e.id,
            kind: e.kind,
            polyline: e.polyline.map((p) => p.clone().applyMatrix4(m4)),
          })),
        };
      }
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
        // Pre-cut exact topology + the tool's world AABB, captured BEFORE the
        // boolean disposes them. A through/blind cut clear of the outer edges
        // leaves them unchanged, so they are preserved verbatim below.
        const preCutTopo = (currentGeom.userData as { topology?: BodyTopology }).topology;
        const bodyBox = new THREE.Box3().setFromBufferAttribute(
          currentGeom.attributes.position as THREE.BufferAttribute,
        );
        const toolTopo = (toolGeom.userData as { topology?: BodyTopology }).topology;
        const toolBox = new THREE.Box3().setFromBufferAttribute(
          toolGeom.attributes.position as THREE.BufferAttribute,
        );
        // Pad by ~0.5% of the tool's diagonal so an outer edge that merely
        // grazes the tool is still treated as cut-affected (taken from the
        // post extraction), never falsely "preserved".
        toolBox.expandByScalar(Math.max(toolBox.min.distanceTo(toolBox.max) * 5e-3, 1e-4));
        // Legacy/no-mesh cut features have no OCC body; apply the mesh fallback
        // so a failed OCC cut still removes material in the viewport.
        let next = currentGeom;
        try {
          next = csgSubtract(currentGeom, toolGeom);
          currentGeom.dispose();
        } catch (error) {
          console.warn('[ExtrudedBodies] Legacy cut fallback failed; keeping body unchanged', error);
        } finally {
          toolGeom.dispose();
        }
        const merged = mergeCutTopology(
          preCutTopo,
          (next.userData as { topology?: BodyTopology }).topology,
          toolBox,
          bodyBox,
          toolTopo,
        );
        if (merged) next.userData.topology = merged;
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
        // Legacy !f.mesh features have no OCC body; skip the boolean — body unchanged.
        toolGeom.dispose();
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
          // Legacy !f.mesh features have no OCC body; merge geometries (overlapping,
          // not true union) as a best-effort fallback for migration failures.
          const merged = mergeGeometries([currentGeom, toolGeom], false);
          currentGeom.dispose();
          toolGeom.dispose();
          currentGeom = merged ?? currentGeom;
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
  }, [sceneStoresHydrated, features, relevantSketchesSig, rollbackIndex, bodiesById]);

  useEffect(() => {
    return () => {
      for (const g of bodies) g.dispose();
    };
  }, [bodies]);

  // Keep the persistent geometry caches in sync so the slicer can read real
  // geometry even when this viewport is unmounted (e.g. navigated to /prepare).
  useEffect(() => {
    if (!sceneStoresHydrated) return;
    // Evict stale entries for features/bodies that no longer exist.
    const liveFeatureIds = new Set(featureIds.filter(Boolean));
    const liveBodyIds = new Set(featureBodyIds.filter(Boolean));
    for (const [fId, geo] of bodyGeometryCache) {
      if (!liveFeatureIds.has(fId)) { geo.dispose(); bodyGeometryCache.delete(fId); }
    }
    for (const [bId, geo] of bodyIdGeometryCache) {
      if (!liveBodyIds.has(bId)) { geo.dispose(); bodyIdGeometryCache.delete(bId); }
    }

    // featureId-keyed cache (used by commitFillet and other ops that target a feature)
    bodies.forEach((geom, i) => {
      const fId = featureIds[i];
      if (!fId) return;
      bodyGeometryCache.get(fId)?.dispose();
      bodyGeometryCache.set(fId, geom.clone());
    });

    // bodyId-keyed cache (used by slicer "Add from CAD" which lists Bodies).
    // Multiple disconnected pieces that share the same bodyId are merged.
    const byBodyId = new Map<string, THREE.BufferGeometry[]>();
    featureBodyIds.forEach((bId, i) => {
      if (!bId) return;
      const arr = byBodyId.get(bId);
      if (arr) arr.push(bodies[i]);
      else byBodyId.set(bId, [bodies[i]]);
    });
    for (const [bId, geoms] of byBodyId) {
      bodyIdGeometryCache.get(bId)?.dispose();
      const merged = geoms.length === 1 ? geoms[0].clone() : (() => {
        const m = mergeGeometries(geoms, false);
        return m ?? geoms[0].clone();
      })();
      bodyIdGeometryCache.set(bId, merged);
    }
  }, [sceneStoresHydrated, bodies, featureIds, featureBodyIds]);

  // Register stored-mesh features (fillet/chamfer/sweep/etc.) in liveBodyMeshes
  // so downstream tools and export/slicer caches can locate their geometry.
  // BodyMesh handles its own registration; <primitive>-rendered meshes do not,
  // so we mirror the same pattern here for them.
  useEffect(() => {
    if (!sceneStoresHydrated) return undefined;
    const stored: Array<{ uuid: string }> = [];
    for (const f of features) {
      if (!isActive(f) || !f.mesh) continue;
      const m = f.mesh as THREE.Mesh;
      // Stamp userData eagerly so collectPickable / EdgeOpEdgeHighlight's
      // featureId filter can find this mesh before R3F's <primitive> onUpdate
      // fires on the next animation frame. Without this the mesh is in the scene
      // but invisible to the edge picker until the first R3F reconcile after mount.
      m.userData.pickable = true;
      m.userData.featureId = f.id;
      m.userData.bodyId = resolveBodyId(f.id, f.bodyId);
      liveBodyMeshes.set(m.uuid, m);
      stored.push({ uuid: m.uuid });
    }
    return () => { stored.forEach(({ uuid }) => liveBodyMeshes.delete(uuid)); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneStoresHydrated, features, rollbackIndex]);

  // Apply dim / appearance materials on pre-built stored meshes in an effect,
  // never in render, so cleanup is guaranteed when Edit In Place exits.
  useEffect(() => {
    if (!sceneStoresHydrated) return;
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
  }, [sceneStoresHydrated, features, editingInPlace, activeComponentId, rollbackIndex, bodiesById, getMaterial, resolveBodyId]);

  // Memoised filtered lists — avoid re-allocating on every render when only unrelated
  // state changes (e.g. visibility toggles, status messages that bump features ref).
  // isActive / hasActiveDownstreamEdgeModification close over features + rollbackIndex,
  // so those two are the only deps needed.
  const revolveFeaturesFiltered = useMemo(
    () => features.filter((f) => f.type === 'revolve' && isActive(f) && !f.mesh && !hasActiveDownstreamEdgeModification(f.id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [features, rollbackIndex],
  );
  const storedMeshFeaturesFiltered = useMemo(
    () => features.filter((f) => isActive(f) && f.mesh && !hasActiveDownstreamEdgeModification(f.id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [features, rollbackIndex],
  );

  if (!sceneStoresHydrated) return null;

  return (
    <>
      {bodies.map((geom, i) => {
        const fId = featureIds[i];
        const bodyId = featureBodyIds[i];
        const bodySelectable = bodyId ? (bodiesById[bodyId]?.selectable !== false) : true;
        return (
          <BodyMeshMemo
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
      {revolveFeaturesFiltered.map((feature) => {
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
      {storedMeshFeaturesFiltered.map((feature) => (
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
