/**
 * Dimension-pair computation extracted from SketchDimensionAnnotations.
 * Returns Vec2 pairs and a 2D text position for each dimension. This does NO
 * GPU work and allocates no GPU buffers (the caller writes into preallocated
 * Float32Arrays). It does allocate short-lived THREE.Vector3 scratch objects
 * for the 2D projection math — these are CPU-only and collected immediately.
 */
import type { Sketch, SketchEntity, SketchDimension } from '../../../../types/cad';
import { GeometryEngine } from '../../../../engine/GeometryEngine';
import { DimensionEngine } from '../../../../engine/DimensionEngine';
import { pointToLineDistance } from '../../../../engine/dimensionPlacement';
import { withArrowheads } from './annotationGeometry';
import type { Vec2 } from './annotationGeometry';
import * as THREE from 'three';

export interface DimAnnotationData {
  dimensionId: string;
  label: string;
  pairs: [Vec2, Vec2][];
  textPos2D: Vec2;
}

const OFFSET = 8;

function lineIntersection(a1: Vec2, a2: Vec2, b1: Vec2, b2: Vec2): Vec2 | null {
  const adx = a2.x - a1.x, ady = a2.y - a1.y;
  const bdx = b2.x - b1.x, bdy = b2.y - b1.y;
  const den = adx * bdy - ady * bdx;
  if (Math.abs(den) < 1e-8) return null;
  const t = ((b1.x - a1.x) * bdy - (b1.y - a1.y) * bdx) / den;
  return { x: a1.x + t * adx, y: a1.y + t * ady };
}

function fartherFromVertex(vertex: Vec2, start: Vec2, end: Vec2): Vec2 {
  const ds = Math.hypot(start.x - vertex.x, start.y - vertex.y);
  const de = Math.hypot(end.x - vertex.x, end.y - vertex.y);
  return de >= ds ? end : start;
}

function to2DLocal(
  p: { x: number; y: number; z: number },
  origin: THREE.Vector3,
  t1: THREE.Vector3,
  t2: THREE.Vector3,
): Vec2 {
  const dx = p.x - origin.x, dy = p.y - origin.y, dz = p.z - origin.z;
  return { x: dx * t1.x + dy * t1.y + dz * t1.z, y: dx * t2.x + dy * t2.y + dz * t2.z };
}

function resolveDimensionSegment(
  id: string,
  entityMap: Map<string, SketchEntity>,
  origin: THREE.Vector3,
  t1: THREE.Vector3,
  t2: THREE.Vector3,
): { start: Vec2; end: Vec2 } | null {
  if (id.includes('::vertex:')) {
    const [entityId, vertexPart] = id.split('::vertex:');
    const entity = entityMap.get(entityId);
    const idx = Number(vertexPart);
    if (!entity || !Number.isInteger(idx) || idx < 0 || idx >= entity.points.length) return null;
    const p = to2DLocal(entity.points[idx], origin, t1, t2);
    return { start: p, end: p };
  }
  if (id.includes('::center')) {
    const entity = entityMap.get(id.split('::center')[0]);
    if (!entity || entity.points.length === 0) return null;
    const p = to2DLocal(entity.points[0], origin, t1, t2);
    return { start: p, end: p };
  }
  const [entityId, edgePart] = id.split('::edge:');
  const entity = entityMap.get(entityId);
  if (!entity) return null;
  if (entity.type === 'rectangle' && edgePart !== undefined && entity.points.length >= 2) {
    const edgeIndex = Number(edgePart);
    if (!Number.isInteger(edgeIndex) || edgeIndex < 0 || edgeIndex > 3) return null;
    const p1 = new THREE.Vector3(entity.points[0].x, entity.points[0].y, entity.points[0].z);
    const p2 = new THREE.Vector3(entity.points[1].x, entity.points[1].y, entity.points[1].z);
    const delta = p2.clone().sub(p1);
    const dt1 = t1.clone().multiplyScalar(delta.dot(t1));
    const dt2 = t2.clone().multiplyScalar(delta.dot(t2));
    const corners = [p1, p1.clone().add(dt1), p1.clone().add(dt1).add(dt2), p1.clone().add(dt2)];
    const next = corners[(edgeIndex + 1) % 4];
    const cur = corners[edgeIndex];
    const co = (v: THREE.Vector3): Vec2 => {
      const d = v.clone().sub(origin);
      return { x: d.dot(t1), y: d.dot(t2) };
    };
    return { start: co(cur), end: co(next) };
  }
  if ((entity.type === 'line' || entity.type === 'construction-line' || entity.type === 'centerline') && entity.points.length >= 2) {
    return { start: to2DLocal(entity.points[0], origin, t1, t2), end: to2DLocal(entity.points[entity.points.length - 1], origin, t1, t2) };
  }
  return null;
}

function buildTwoLineAnnotation(
  firstId: string, secondId: string, position: Vec2,
  entityMap: Map<string, SketchEntity>, origin: THREE.Vector3, t1: THREE.Vector3, t2: THREE.Vector3,
): { pairs: [Vec2, Vec2][]; textPosition: Vec2 } | null {
  if (firstId === secondId) return null;
  const first = resolveDimensionSegment(firstId, entityMap, origin, t1, t2);
  const second = resolveDimensionSegment(secondId, entityMap, origin, t1, t2);
  if (!first || !second) return null;
  const fh = Math.abs(first.end.x - first.start.x) >= Math.abs(first.end.y - first.start.y);
  const sh = Math.abs(second.end.x - second.start.x) >= Math.abs(second.end.y - second.start.y);
  if (fh !== sh) return null;
  if (fh) {
    const y1 = (first.start.y + first.end.y) / 2;
    const y2 = (second.start.y + second.end.y) / 2;
    const x = position.x;
    const fx = Math.abs(first.start.x - x) <= Math.abs(first.end.x - x) ? first.start.x : first.end.x;
    const sx = Math.abs(second.start.x - x) <= Math.abs(second.end.x - x) ? second.start.x : second.end.x;
    return { pairs: [[{ x: fx, y: y1 }, { x, y: y1 }], [{ x: sx, y: y2 }, { x, y: y2 }], [{ x, y: Math.min(y1, y2) }, { x, y: Math.max(y1, y2) }]], textPosition: { x, y: (y1 + y2) / 2 } };
  }
  const x1 = (first.start.x + first.end.x) / 2;
  const x2 = (second.start.x + second.end.x) / 2;
  const y = position.y;
  const fy = Math.abs(first.start.y - y) <= Math.abs(first.end.y - y) ? first.start.y : first.end.y;
  const sy = Math.abs(second.start.y - y) <= Math.abs(second.end.y - y) ? second.start.y : second.end.y;
  return { pairs: [[{ x: x1, y: fy }, { x: x1, y }], [{ x: x2, y: sy }, { x: x2, y }], [{ x: Math.min(x1, x2), y }, { x: Math.max(x1, x2), y }]], textPosition: { x: (x1 + x2) / 2, y } };
}

function buildTwoLineAngleAnnotation(
  firstId: string, secondId: string, position: Vec2,
  entityMap: Map<string, SketchEntity>, origin: THREE.Vector3, t1: THREE.Vector3, t2: THREE.Vector3,
): { pairs: [Vec2, Vec2][]; textPosition: Vec2; value: number } | null {
  const first = resolveDimensionSegment(firstId, entityMap, origin, t1, t2);
  const second = resolveDimensionSegment(secondId, entityMap, origin, t1, t2);
  if (!first || !second) return null;
  const fh = Math.abs(first.end.x - first.start.x) >= Math.abs(first.end.y - first.start.y);
  const sh = Math.abs(second.end.x - second.start.x) >= Math.abs(second.end.y - second.start.y);
  if (fh === sh) return null;
  const vertex = lineIntersection(first.start, first.end, second.start, second.end);
  if (!vertex) return null;
  const radius = Math.max(1, Math.hypot(position.x - vertex.x, position.y - vertex.y));
  const ray1 = fartherFromVertex(vertex, first.start, first.end);
  const ray2 = fartherFromVertex(vertex, second.start, second.end);
  const neg1 = { x: 2 * vertex.x - ray1.x, y: 2 * vertex.y - ray1.y };
  const neg2 = { x: 2 * vertex.x - ray2.x, y: 2 * vertex.y - ray2.y };
  const candidates = [
    DimensionEngine.computeAngleDimension(vertex, ray1, ray2, radius),
    DimensionEngine.computeAngleDimension(vertex, neg1, ray2, radius),
    DimensionEngine.computeAngleDimension(vertex, ray1, neg2, radius),
    DimensionEngine.computeAngleDimension(vertex, neg1, neg2, radius),
  ];
  const posAngle = Math.atan2(position.y - vertex.y, position.x - vertex.x);
  const angleDist = (a: number, b: number) => { const d = (((a - b) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2); return d > Math.PI ? Math.PI * 2 - d : d; };
  let ann = candidates[0]; let best = Infinity;
  for (const c of candidates) {
    const mid = ((c.annotationArc.startAngle + c.annotationArc.endAngle) / 2 + Math.PI * 4) % (Math.PI * 2);
    const dist = angleDist(posAngle, mid);
    if (dist < best) { best = dist; ann = c; }
  }
  const { cx, cy, r, startAngle, endAngle } = ann.annotationArc;
  const arcPairs: [Vec2, Vec2][] = [
    [vertex, { x: cx + r * Math.cos(startAngle), y: cy + r * Math.sin(startAngle) }],
    [vertex, { x: cx + r * Math.cos(endAngle), y: cy + r * Math.sin(endAngle) }],
  ];
  const SEGS = 24;
  for (let i = 0; i < SEGS; i++) {
    const a0 = startAngle + (i / SEGS) * (endAngle - startAngle);
    const a1 = startAngle + ((i + 1) / SEGS) * (endAngle - startAngle);
    arcPairs.push([{ x: cx + r * Math.cos(a0), y: cy + r * Math.sin(a0) }, { x: cx + r * Math.cos(a1), y: cy + r * Math.sin(a1) }]);
  }
  return { pairs: arcPairs, textPosition: ann.textPosition, value: ann.value };
}

function computeLinearAtPos(start: Vec2, end: Vec2, position: Vec2, orientation: 'horizontal' | 'vertical' | 'auto') {
  const resolved = orientation === 'auto' ? (Math.abs(end.x - start.x) >= Math.abs(end.y - start.y) ? 'horizontal' : 'vertical') : orientation;
  const base = resolved === 'horizontal' ? (start.y + end.y) / 2 : (start.x + end.x) / 2;
  const offset = resolved === 'horizontal' ? position.y - base : position.x - base;
  return DimensionEngine.computeLinearDimension(start, end, offset, resolved);
}

function computeAlignedAtPos(start: Vec2, end: Vec2, position: Vec2) {
  const dx = end.x - start.x, dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length < 1e-8) return null;
  const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  const nx = -dy / length, ny = dx / length;
  const offset = (position.x - mid.x) * nx + (position.y - mid.y) * ny;
  return DimensionEngine.computeAlignedDimension(start, end, offset);
}

function computeDimPairs(
  dim: SketchDimension,
  entityMap: Map<string, SketchEntity>,
  origin: THREE.Vector3,
  t1: THREE.Vector3,
  t2: THREE.Vector3,
): { pairs: [Vec2, Vec2][]; textPos2D: Vec2; label: string } | null {
  const ents = dim.entityIds.map((id) => entityMap.get(id)).filter(Boolean) as SketchEntity[];

  if (dim.type === 'linear' || dim.type === 'aligned' || dim.type === 'angular') {
    if ((dim.type === 'linear' || dim.type === 'aligned') && dim.entityIds.length >= 2) {
      const seg0 = resolveDimensionSegment(dim.entityIds[0], entityMap, origin, t1, t2);
      const seg1 = resolveDimensionSegment(dim.entityIds[1], entityMap, origin, t1, t2);
      const isDegen = (s: { start: Vec2; end: Vec2 } | null) =>
        s != null && Math.hypot(s.end.x - s.start.x, s.end.y - s.start.y) < 1e-8;
      if (isDegen(seg0) && isDegen(seg1)) {
        const ann = dim.type === 'linear'
          ? computeLinearAtPos(seg0!.start, seg1!.start, dim.position, dim.orientation ?? 'auto')
          : computeAlignedAtPos(seg0!.start, seg1!.start, dim.position);
        if (!ann) return null;
        return { pairs: [ann.extensionLine1, ann.extensionLine2, ...withArrowheads(ann.dimensionLine)], textPos2D: ann.textPosition, label: DimensionEngine.formatDimensionValue(dim.value, 'mm', 2) };
      }
      if (dim.type === 'aligned' && seg0 && seg1 && isDegen(seg0) !== isDegen(seg1)) {
        const pt = isDegen(seg0) ? seg0! : seg1!;
        const ln = isDegen(seg0) ? seg1! : seg0!;
        const { foot } = pointToLineDistance(pt.start, ln.start, ln.end);
        const ann = computeAlignedAtPos(pt.start, foot, dim.position);
        if (!ann) return null;
        return { pairs: [ann.extensionLine1, ann.extensionLine2, ...withArrowheads(ann.dimensionLine)], textPos2D: ann.textPosition, label: DimensionEngine.formatDimensionValue(dim.value, 'mm', 2) };
      }
      const tl = buildTwoLineAnnotation(dim.entityIds[0], dim.entityIds[1], dim.position, entityMap, origin, t1, t2);
      if (tl) {
        const pairs = [...tl.pairs.slice(0, -1), ...withArrowheads(tl.pairs[tl.pairs.length - 1])];
        return { pairs, textPos2D: tl.textPosition, label: DimensionEngine.formatDimensionValue(dim.value, 'mm', 2) };
      }
    }
    if (dim.type === 'angular' && dim.entityIds.length >= 2) {
      const aa = buildTwoLineAngleAnnotation(dim.entityIds[0], dim.entityIds[1], dim.position, entityMap, origin, t1, t2);
      if (aa) return { pairs: aa.pairs, textPos2D: aa.textPosition, label: `${aa.value.toFixed(2)}°` };
    }
    // Fallback: resolve segment or use entity points
    const pts: Vec2[] = [];
    const seg = resolveDimensionSegment(dim.entityIds[0], entityMap, origin, t1, t2);
    if (seg) { pts.push(seg.start, seg.end); }
    else { for (const e of ents) { if (e.points[0]) pts.push({ x: e.points[0].x, y: e.points[0].y }); if (pts.length === 2) break; } }
    if (pts.length < 2) { pts.push(dim.position, { x: dim.position.x + dim.value, y: dim.position.y }); }
    if (dim.type === 'linear') {
      const ann = computeLinearAtPos(pts[0], pts[1], dim.position, dim.orientation ?? 'auto');
      return { pairs: [ann.extensionLine1, ann.extensionLine2, ...withArrowheads(ann.dimensionLine)], textPos2D: ann.textPosition, label: DimensionEngine.formatDimensionValue(dim.value, 'mm', 2) };
    }
    if (dim.type === 'aligned') {
      const ann = computeAlignedAtPos(pts[0], pts[1], dim.position);
      if (!ann) return null;
      return { pairs: [ann.extensionLine1, ann.extensionLine2, ...withArrowheads(ann.dimensionLine)], textPos2D: ann.textPosition, label: DimensionEngine.formatDimensionValue(dim.value, 'mm', 2) };
    }
    // angular fallback
    const allPts: Vec2[] = ents.flatMap((e) => e.points.slice(0, 2).map((p) => ({ x: p.x, y: p.y })));
    const vertex = allPts[0] ?? dim.position;
    const r1End = allPts[1] ?? { x: dim.position.x + OFFSET, y: dim.position.y };
    const r2End = allPts[2] ?? { x: dim.position.x, y: dim.position.y + OFFSET };
    const ann = DimensionEngine.computeAngleDimension(vertex, r1End, r2End, OFFSET);
    const { cx, cy, r, startAngle, endAngle } = ann.annotationArc;
    const arcPairs: [Vec2, Vec2][] = [];
    const SEGS = 16;
    for (let i = 0; i < SEGS; i++) {
      const a0 = startAngle + (i / SEGS) * (endAngle - startAngle);
      const a1 = startAngle + ((i + 1) / SEGS) * (endAngle - startAngle);
      arcPairs.push([{ x: cx + r * Math.cos(a0), y: cy + r * Math.sin(a0) }, { x: cx + r * Math.cos(a1), y: cy + r * Math.sin(a1) }]);
    }
    return { pairs: arcPairs, textPos2D: ann.textPosition, label: `${ann.value.toFixed(1)}°` };
  }

  if (dim.type === 'radial' || dim.type === 'diameter') {
    const circEnt = ents[0];
    if (!circEnt?.points[0]) return null;
    const center2d = to2DLocal(circEnt.points[0], origin, t1, t2);
    const cx = center2d.x, cy = center2d.y;
    const rad = circEnt.radius ?? dim.value / (dim.type === 'diameter' ? 2 : 1);
    if (dim.type === 'diameter') {
      return { pairs: withArrowheads([{ x: cx - rad, y: cy }, { x: cx + rad, y: cy }]), textPos2D: dim.position, label: `⌀${DimensionEngine.formatDimensionValue(dim.value, 'mm', 2)}` };
    }
    const text2d: Vec2 = dim.position ?? { x: cx + rad * 0.6, y: cy + 1 };
    const dx = text2d.x - cx, dy = text2d.y - cy;
    const len = Math.hypot(dx, dy) || 1;
    const edgePt: Vec2 = { x: cx + (dx / len) * rad, y: cy + (dy / len) * rad };
    return { pairs: withArrowheads([{ x: cx, y: cy }, edgePt]), textPos2D: text2d, label: `R${DimensionEngine.formatDimensionValue(rad, 'mm', 2)}` };
  }

  if (dim.type === 'arc-length') {
    const circEnt2 = ents[0];
    if (!circEnt2?.points[0] || circEnt2.radius == null) return null;
    const ac = to2DLocal(circEnt2.points[0], origin, t1, t2);
    const ar = circEnt2.radius;
    const aStart = circEnt2.startAngle ?? 0;
    let aEnd = circEnt2.endAngle ?? 2 * Math.PI;
    while (aEnd <= aStart) aEnd += 2 * Math.PI;
    const annR = ar + OFFSET;
    const arcPairs: [Vec2, Vec2][] = [];
    const ARC_SEGS = 24;
    for (let i = 0; i < ARC_SEGS; i++) {
      const a0 = aStart + (i / ARC_SEGS) * (aEnd - aStart);
      const a1 = aStart + ((i + 1) / ARC_SEGS) * (aEnd - aStart);
      arcPairs.push([{ x: ac.x + annR * Math.cos(a0), y: ac.y + annR * Math.sin(a0) }, { x: ac.x + annR * Math.cos(a1), y: ac.y + annR * Math.sin(a1) }]);
    }
    arcPairs.push(
      [{ x: ac.x + ar * Math.cos(aStart), y: ac.y + ar * Math.sin(aStart) }, { x: ac.x + annR * Math.cos(aStart), y: ac.y + annR * Math.sin(aStart) }],
      [{ x: ac.x + ar * Math.cos(aEnd), y: ac.y + ar * Math.sin(aEnd) }, { x: ac.x + annR * Math.cos(aEnd), y: ac.y + annR * Math.sin(aEnd) }],
    );
    return { pairs: arcPairs, textPos2D: dim.position, label: DimensionEngine.formatDimensionValue(dim.value, 'mm', 2) };
  }

  if (dim.type === 'linear-diameter') {
    const circEntLd = ents[0];
    if (!circEntLd?.points[0]) return null;
    const c = to2DLocal(circEntLd.points[0], origin, t1, t2);
    const rad = circEntLd.radius ?? dim.value / 2;
    const ann = DimensionEngine.computeLinearDiameterDimension(c.x, c.y, rad, OFFSET);
    return { pairs: [ann.extensionLine1, ann.extensionLine2, ...withArrowheads(ann.dimensionLine)], textPos2D: dim.position, label: `⌀${DimensionEngine.formatDimensionValue(dim.value, 'mm', 2)}` };
  }

  if (dim.type === 'ellipse-major' || dim.type === 'ellipse-minor') {
    const ellipseEnt = ents[0];
    if (!ellipseEnt?.points[0] || !ellipseEnt.majorRadius || !ellipseEnt.minorRadius) return null;
    const ec = to2DLocal(ellipseEnt.points[0], origin, t1, t2);
    const isMajor = dim.type === 'ellipse-major';
    const axisRadius = isMajor ? ellipseEnt.majorRadius : ellipseEnt.minorRadius;
    const axisAngle = (ellipseEnt.rotation ?? 0) + (isMajor ? 0 : Math.PI / 2);
    const axisEnd: Vec2 = { x: ec.x + axisRadius * Math.cos(axisAngle), y: ec.y + axisRadius * Math.sin(axisAngle) };
    const ann = DimensionEngine.computeEllipseDimension(ec.x, ec.y, axisEnd, dim.type, OFFSET);
    return { pairs: withArrowheads(ann.dimensionLine), textPos2D: dim.position, label: `${isMajor ? 'Ra' : 'Rb'}=${DimensionEngine.formatDimensionValue(dim.value, 'mm', 2)}` };
  }

  if (dim.type === 'concentric-gap' && ents.length >= 2) {
    const cg1 = ents[0], cg2 = ents[1];
    if (!cg1?.points[0] || !cg2?.points[0]) return null;
    const c1 = to2DLocal(cg1.points[0], origin, t1, t2);
    const ann = DimensionEngine.computeConcentricGapDimension(c1.x, c1.y, cg1.radius ?? 0, cg2.radius ?? 0, Math.PI / 4);
    return { pairs: withArrowheads(ann.dimensionLine), textPos2D: dim.position, label: DimensionEngine.formatDimensionValue(dim.value, 'mm', 2) };
  }

  return null;
}

/**
 * Compute annotation pairs and labels for all dimensions in a sketch.
 * Pure function — no THREE allocations beyond scratch vectors for coordinate
 * conversion. Safe to call every animation frame during constraint solving.
 */
export function computeAnnotationData(sketch: Sketch): DimAnnotationData[] {
  if (!sketch.dimensions?.length) return [];
  const { t1, t2 } = GeometryEngine.getSketchAxes(sketch);
  const origin = (sketch.planeOrigin ?? new THREE.Vector3(0, 0, 0)) as THREE.Vector3;
  const entityMap = new Map<string, SketchEntity>();
  for (const e of sketch.entities) entityMap.set(e.id, e);

  const result: DimAnnotationData[] = [];
  for (const dim of sketch.dimensions) {
    try {
      const data = computeDimPairs(dim, entityMap, origin, t1, t2);
      if (data) result.push({ dimensionId: dim.id, ...data });
    } catch {
      // Skip malformed dimensions silently
    }
  }
  return result;
}
