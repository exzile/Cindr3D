import * as THREE from "three";
import type {
  BodyTopology,
  ModelEdge,
} from "../../../../engine/geometryEngine/core/solid/edgeTypes";
import { modelEdgeId } from "../../../../engine/geometryEngine/core/solid/edgeId";

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

function projectClosedLoopToBoxFace(
  edge: ModelEdge,
  box: THREE.Box3,
): ModelEdge | null {
  const poly = edge.polyline;
  if (poly.length < 4 || poly[0].distanceToSquared(poly[poly.length - 1]) > 1e-10) {
    return null;
  }

  const diag = Math.max(box.min.distanceTo(box.max), 1);
  const planeTol = Math.max(diag * 1e-6, 1e-6);
  const insideTol = Math.max(diag * 2e-3, 1e-4);
  const axes = ['x', 'y', 'z'] as const;

  for (let axisIndex = 0; axisIndex < axes.length; axisIndex += 1) {
    const axis = axes[axisIndex];
    let min = Infinity;
    let max = -Infinity;
    for (const point of poly) {
      min = Math.min(min, point[axis]);
      max = Math.max(max, point[axis]);
    }
    if (max - min > planeTol) continue;

    const coord = (min + max) * 0.5;
    const target =
      coord < box.min[axis] ? box.min[axis] :
      coord > box.max[axis] ? box.max[axis] :
      undefined;
    if (target === undefined) continue;

    const otherAxes = axes.filter((candidate) => candidate !== axis);
    const overlapsFace = poly.some((point) =>
      otherAxes.every((other) =>
        point[other] >= box.min[other] - insideTol &&
        point[other] <= box.max[other] + insideTol,
      ),
    );
    if (!overlapsFace) continue;

    const projected = poly.map((point) => {
      const next = point.clone();
      next[axis] = target;
      return next;
    });
    return { id: modelEdgeId(projected), polyline: projected, kind: edge.kind };
  }

  return null;
}

function clipTopologyToBox(edges: ModelEdge[], box: THREE.Box3): ModelEdge[] {
  const out: ModelEdge[] = [];
  const epsSq = Math.max(box.min.distanceToSquared(box.max) * 1e-10, 1e-8);
  for (const edge of edges) {
    const projectedLoop = projectClosedLoopToBoxFace(edge, box);
    if (projectedLoop) {
      out.push(projectedLoop);
      continue;
    }
    let run: THREE.Vector3[] = [];
    const flush = () => {
      if (run.length >= 2) {
        const polyline = run.map((p) => p.clone());
        out.push({ id: modelEdgeId(polyline), polyline, kind: edge.kind });
      }
      run = [];
    };
    for (let i = 0; i + 1 < edge.polyline.length; i++) {
      const clipped = clipSegmentToBox(
        edge.polyline[i],
        edge.polyline[i + 1],
        box,
      );
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

function repairCutRimTopology(
  rim: ModelEdge[],
  toolBox: THREE.Box3,
): ModelEdge[] {
  if (rim.length < 6) return rim;

  type Seg = {
    edge: ModelEdge;
    a: THREE.Vector3;
    b: THREE.Vector3;
    used: boolean;
  };
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
  const coordAt = (p: THREE.Vector3, axis: 0 | 1 | 2): number =>
    axis === 0 ? p.x : axis === 1 ? p.y : p.z;
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
    if (spanY < span) {
      axis = 1;
      span = spanY;
    }
    if (spanZ < span) {
      axis = 2;
      span = spanZ;
    }
    if (span > planeTol) continue;
    const coord = (coordAt(seg.a, axis) + coordAt(seg.b, axis)) * 0.5;
    let bucket = buckets.find(
      (b) => b.axis === axis && Math.abs(b.coord - coord) <= planeTol,
    );
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
    const [x1, y1] = p1,
      [x2, y2] = p2,
      [x3, y3] = p3;
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
      if (!unique.some((u) => u.distanceToSquared(p) <= pointTolSq))
        unique.push(p);
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
            if (
              Math.abs(Math.hypot(a - fit.ca, b - fit.cb) - fit.r) <= radialTol
            )
              pointIdx.push(pi);
          }
          if (pointIdx.length < 6) continue;
          const score = pointIdx.length;
          if (!best || score > best.score) {
            best = {
              axis: bucket.axis,
              centerA: fit.ca,
              centerB: fit.cb,
              radius: fit.r,
              score,
              pointIdx,
            };
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
      const tangentDot = Math.abs(
        ((a1 - a0) * midA + (b1 - b0) * midB) /
          Math.max(len * best.radius, 1e-9),
      );
      if (
        Math.abs(r0 - best.radius) <= radialTol &&
        Math.abs(r1 - best.radius) <= radialTol &&
        len <= best.radius * 0.45 &&
        tangentDot <= 0.35
      ) {
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
        const tangentDot = Math.abs(
          ((a1 - a0) * midA + (b1 - b0) * midB) /
            Math.max(len * fit.radius, 1e-9),
        );
        return (
          Math.abs(r0 - fit.radius) <= radialTol &&
          Math.abs(r1 - fit.radius) <= radialTol &&
          len <= fit.radius * 0.45 &&
          tangentDot <= 0.35
        );
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
        const nearCircle =
          Math.abs(r0 - fit.radius) <= radialTol * 3 ||
          Math.abs(r1 - fit.radius) <= radialTol * 3;
        const crossesCircle =
          Math.min(r0, r1) < fit.radius && Math.max(r0, r1) > fit.radius;
        if (nearCircle || crossesCircle) seg.used = true;
      }
      const rawPoints: THREE.Vector3[] = [];
      for (const seg of circleSegs) rawPoints.push(seg.a, seg.b);
      const unique: THREE.Vector3[] = [];
      for (const p of rawPoints) {
        if (!unique.some((u) => u.distanceToSquared(p) <= radialTolSq))
          unique.push(p);
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
        const gap =
          i + 1 < ordered.length
            ? next.angle - item.angle
            : next.angle + Math.PI * 2 - item.angle;
        return gap;
      });
      const medianGap =
        [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)] || 0;
      const maxGap = Math.max(...gaps);
      const maxGapIndex = gaps.indexOf(maxGap);
      const closeLoop = maxGap <= Math.max(medianGap * 2.6, Math.PI / 9);
      const arcOrder = closeLoop
        ? ordered
        : [
            ...ordered.slice(maxGapIndex + 1),
            ...ordered.slice(0, maxGapIndex + 1),
          ];
      const arcPoints = arcOrder.map(({ p }) => p);
      const chordLengths: number[] = [];
      for (let i = 0; i + 1 < arcPoints.length; i++)
        chordLengths.push(arcPoints[i].distanceTo(arcPoints[i + 1]));
      if (closeLoop && arcPoints.length > 2)
        chordLengths.push(
          arcPoints[arcPoints.length - 1].distanceTo(arcPoints[0]),
        );
      const medianChord =
        [...chordLengths].sort((a, b) => a - b)[
          Math.floor(chordLengths.length / 2)
        ] || radialTol;
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
      if (
        closeLoop &&
        chain.length &&
        chains.length === 0 &&
        chain[chain.length - 1].distanceTo(chain[0]) <= maxChord
      ) {
        chain = [...chain, chain[0]];
      }
      if (chain.length >= 4) chains.push(chain);
      for (const pts of chains) {
        const polyline = pts.map((p) => p.clone());
        if (polyline.length >= 2)
          repaired.push({
            id: modelEdgeId(polyline),
            polyline,
            kind: "crease",
          });
      }
    }
  }

  if (repaired.length === 0) return rim;

  const passthrough = segs
    .filter((seg) => !seg.used)
    .map((seg) => ({
      id: modelEdgeId([seg.a, seg.b]),
      polyline: [seg.a.clone(), seg.b.clone()],
      kind: seg.edge.kind,
    }));
  return [...passthrough, ...repaired];
}

export function mergeCutTopology(
  preTopo: BodyTopology | undefined,
  postTopo: BodyTopology | undefined,
  toolBox: THREE.Box3,
  bodyBox?: THREE.Box3,
  toolTopo?: BodyTopology,
): BodyTopology | undefined {
  const authoredRim =
    toolTopo?.edges?.length && bodyBox
      ? clipTopologyToBox(toolTopo.edges, bodyBox)
      : [];
  if (!preTopo?.edges?.length)
    return authoredRim.length > 0 ? { edges: authoredRim } : postTopo;
  const survivors = preTopo.edges.filter(
    (e) => !polylineHitsBox(e.polyline, toolBox),
  );
  if (!postTopo?.edges?.length)
    return authoredRim.length > 0
      ? { edges: [...survivors, ...authoredRim] }
      : preTopo;
  const postRim = postTopo.edges
    .filter((e) => polylineHitsBox(e.polyline, toolBox))
    .filter((e) => authoredRim.length === 0 || edgeIsMostlyStraight(e));
  const rim =
    authoredRim.length > 0
      ? [...authoredRim, ...postRim]
      : repairCutRimTopology(postRim, toolBox);
  // Nothing survived the clear-of-tool test (unexpected) → keep the post
  // extraction so we never end up with no edges at all.
  if (survivors.length === 0) return postTopo;
  return { edges: [...survivors, ...rim] };
}
