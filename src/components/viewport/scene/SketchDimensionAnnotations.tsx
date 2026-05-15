// SketchDimensionAnnotations.tsx
// Renders dimension annotation geometry (extension lines, dimension lines,
// value labels) for the active sketch's SketchDimension entries.
// NOTE: SketchConstraint only carries geometric constraints; dimension data
// lives in sketch.dimensions (SketchDimension[]). This component is wired and
// ready — it will populate automatically once D28 adds dimension records.

import { useMemo, useEffect, useRef } from 'react';
import { Html } from '@react-three/drei';
import { useThree, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useCADStore } from '../../../store/cadStore';
import { DimensionEngine } from '../../../engine/DimensionEngine';
import { GeometryEngine } from '../../../engine/GeometryEngine';
import { pointToLineDistance } from '../../../engine/dimensionPlacement';
import type { SketchEntity } from '../../../types/cad';

// ── Module-level material singletons ──────────────────────────────────────────
const lineMat = new THREE.LineBasicMaterial({
  color: '#111111',
  depthTest: false,
  depthWrite: false,
  transparent: true,
  opacity: 0.95,
});
const labelStyle: React.CSSProperties = {
  background: 'rgba(255, 255, 255, 0.94)',
  border: '1px solid rgba(96, 165, 250, 0.65)',
  borderRadius: 4,
  color: '#1e3a8a',
  fontSize: 11,
  fontWeight: 700,
  lineHeight: '14px',
  padding: '1px 5px',
  whiteSpace: 'nowrap',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

type Vec2 = { x: number; y: number };

function toWorld(
  p: Vec2,
  origin: THREE.Vector3,
  t1: THREE.Vector3,
  t2: THREE.Vector3,
): THREE.Vector3 {
  return origin.clone().addScaledVector(t1, p.x).addScaledVector(t2, p.y);
}

function makeSegments(
  pairs: [Vec2, Vec2][],
  origin: THREE.Vector3,
  t1: THREE.Vector3,
  t2: THREE.Vector3,
): THREE.LineSegments {
  const verts: number[] = [];
  for (const [a, b] of pairs) {
    const wa = toWorld(a, origin, t1, t2);
    const wb = toWorld(b, origin, t1, t2);
    verts.push(wa.x, wa.y, wa.z, wb.x, wb.y, wb.z);
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3));
  return new THREE.LineSegments(geom, lineMat);
}

function withArrowheads(line: [Vec2, Vec2], size = 0.8): [Vec2, Vec2][] {
  const [start, end] = line;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length < 1e-8) return [line];
  const ux = dx / length;
  const uy = dy / length;
  const px = -uy;
  const py = ux;
  const arrowLength = Math.min(size, length * 0.35);
  const arrowWidth = arrowLength * 0.55;
  const makeHead = (tip: Vec2, direction: 1 | -1): [Vec2, Vec2][] => {
    const base = {
      x: tip.x - direction * ux * arrowLength,
      y: tip.y - direction * uy * arrowLength,
    };
    return [
      [tip, { x: base.x + px * arrowWidth, y: base.y + py * arrowWidth }],
      [tip, { x: base.x - px * arrowWidth, y: base.y - py * arrowWidth }],
    ];
  };
  return [line, ...makeHead(start, -1), ...makeHead(end, 1)];
}

// ── Per-annotation data collected in useMemo ─────────────────────────────────
interface AnnData {
  dimensionId: string;
  segments: THREE.LineSegments;
  textPos: THREE.Vector3;
  label: string;
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function SketchDimensionAnnotations() {
  const activeSketch = useCADStore((s) => s.activeSketch);
  const removeDimension = useCADStore((s) => s.removeDimension);
  const pendingNewDimensionId = useCADStore((s) => s.pendingNewDimensionId);
  const sketchDimEditId = useCADStore((s) => s.sketchDimEditId);
  const openSketchDimEdit = useCADStore((s) => s.openSketchDimEdit);
  const updateSketchDimEditScreen = useCADStore((s) => s.updateSketchDimEditScreen);
  const { camera, gl } = useThree();
  const closeContextMenuRef = useRef<(() => void) | null>(null);
  const draggingDimRef = useRef<{
    dimensionId: string;
    startScreenX: number;
    startScreenY: number;
    startPosition: { x: number; y: number };
    moved: boolean;
    // Cached once on first move — avoids repeated raycasts and layout reads
    sketchPlane: THREE.Plane | null;
    canvasRect: DOMRect | null;
    startSketchPos: { x: number; y: number } | null;
  } | null>(null);
  const raycasterRef = useRef(new THREE.Raycaster());
  const pendingMousePos = useRef<{ x: number; y: number } | null>(null);

  const annotations = useMemo<AnnData[]>(() => {
    if (!activeSketch?.dimensions?.length) return [];

    const { t1, t2 } = GeometryEngine.getSketchAxes(activeSketch);
    const origin = activeSketch.planeOrigin ?? new THREE.Vector3(0, 0, 0);

    const entityMap = new Map<string, SketchEntity>();
    for (const e of activeSketch.entities) entityMap.set(e.id, e);

    const OFFSET = 8; // perpendicular offset for dimension lines (model units)
    const result: AnnData[] = [];

    const to2DLocal = (p: { x: number; y: number; z: number }): Vec2 => {
      const d = new THREE.Vector3(p.x, p.y, p.z).sub(origin);
      return { x: d.dot(t1), y: d.dot(t2) };
    };

    const resolveDimensionSegment = (id: string) => {
      // Vertex / center picks return a degenerate segment (start === end = the point).
      if (id.includes('::vertex:')) {
        const [entityId, vertexPart] = id.split('::vertex:');
        const entity = entityMap.get(entityId);
        const idx = Number(vertexPart);
        if (!entity || !Number.isInteger(idx) || idx < 0 || idx >= entity.points.length) return null;
        const p = to2DLocal(entity.points[idx]);
        return { start: p, end: p };
      }
      if (id.includes('::center')) {
        const entityId = id.split('::center')[0];
        const entity = entityMap.get(entityId);
        if (!entity || entity.points.length === 0) return null;
        const p = to2DLocal(entity.points[0]);
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
        const corners = [
          p1.clone(),
          p1.clone().add(dt1),
          p1.clone().add(dt1).add(dt2),
          p1.clone().add(dt2),
        ];
        return {
          start: { x: corners[edgeIndex].clone().sub(origin).dot(t1), y: corners[edgeIndex].clone().sub(origin).dot(t2) },
          end: { x: corners[(edgeIndex + 1) % corners.length].clone().sub(origin).dot(t1), y: corners[(edgeIndex + 1) % corners.length].clone().sub(origin).dot(t2) },
        };
      }
      if (
        (entity.type === 'line' || entity.type === 'construction-line' || entity.type === 'centerline') &&
        entity.points.length >= 2
      ) {
        return {
          start: to2DLocal(entity.points[0]),
          end: to2DLocal(entity.points[entity.points.length - 1]),
        };
      }
      return null;
    };
    const lineIntersection = (a1: Vec2, a2: Vec2, b1: Vec2, b2: Vec2) => {
      const adx = a2.x - a1.x;
      const ady = a2.y - a1.y;
      const bdx = b2.x - b1.x;
      const bdy = b2.y - b1.y;
      const denominator = adx * bdy - ady * bdx;
      if (Math.abs(denominator) < 1e-8) return null;
      const t = ((b1.x - a1.x) * bdy - (b1.y - a1.y) * bdx) / denominator;
      return { x: a1.x + t * adx, y: a1.y + t * ady };
    };
    const fartherFromVertex = (vertex: Vec2, start: Vec2, end: Vec2) => {
      const startDistance = Math.hypot(start.x - vertex.x, start.y - vertex.y);
      const endDistance = Math.hypot(end.x - vertex.x, end.y - vertex.y);
      return endDistance >= startDistance ? end : start;
    };
    const buildTwoLineAnnotation = (firstId: string, secondId: string, position: Vec2) => {
      if (firstId === secondId) return null;
      const first = resolveDimensionSegment(firstId);
      const second = resolveDimensionSegment(secondId);
      if (!first || !second) return null;
      const firstHorizontal = Math.abs(first.end.x - first.start.x) >= Math.abs(first.end.y - first.start.y);
      const secondHorizontal = Math.abs(second.end.x - second.start.x) >= Math.abs(second.end.y - second.start.y);
      if (firstHorizontal !== secondHorizontal) return null;
      if (firstHorizontal) {
        const y1 = (first.start.y + first.end.y) / 2;
        const y2 = (second.start.y + second.end.y) / 2;
        const x = position.x;
        const lowY = Math.min(y1, y2);
        const highY = Math.max(y1, y2);
        // Use the endpoint of each entity nearest to the dimension line x position
        const firstNearX = Math.abs(first.start.x - x) <= Math.abs(first.end.x - x) ? first.start.x : first.end.x;
        const secondNearX = Math.abs(second.start.x - x) <= Math.abs(second.end.x - x) ? second.start.x : second.end.x;
        return {
          pairs: [
            [{ x: firstNearX, y: y1 }, { x, y: y1 }],
            [{ x: secondNearX, y: y2 }, { x, y: y2 }],
            [{ x, y: lowY }, { x, y: highY }],
          ] as [Vec2, Vec2][],
          textPosition: { x, y: (lowY + highY) / 2 },
        };
      }
      const x1 = (first.start.x + first.end.x) / 2;
      const x2 = (second.start.x + second.end.x) / 2;
      const y = position.y;
      const lowX = Math.min(x1, x2);
      const highX = Math.max(x1, x2);
      // Use the endpoint of each entity nearest to the dimension line y position
      const firstNearY = Math.abs(first.start.y - y) <= Math.abs(first.end.y - y) ? first.start.y : first.end.y;
      const secondNearY = Math.abs(second.start.y - y) <= Math.abs(second.end.y - y) ? second.start.y : second.end.y;
      return {
        pairs: [
          [{ x: x1, y: firstNearY }, { x: x1, y }],
          [{ x: x2, y: secondNearY }, { x: x2, y }],
          [{ x: lowX, y }, { x: highX, y }],
        ] as [Vec2, Vec2][],
        textPosition: { x: (lowX + highX) / 2, y },
      };
    };
    const buildTwoLineAngleAnnotation = (firstId: string, secondId: string, position: Vec2) => {
      const first = resolveDimensionSegment(firstId);
      const second = resolveDimensionSegment(secondId);
      if (!first || !second) return null;
      const firstHorizontal = Math.abs(first.end.x - first.start.x) >= Math.abs(first.end.y - first.start.y);
      const secondHorizontal = Math.abs(second.end.x - second.start.x) >= Math.abs(second.end.y - second.start.y);
      if (firstHorizontal === secondHorizontal) return null;
      const vertex = lineIntersection(first.start, first.end, second.start, second.end);
      if (!vertex) return null;
      const radius = Math.max(1, Math.hypot(position.x - vertex.x, position.y - vertex.y));
      const ray1 = fartherFromVertex(vertex, first.start, first.end);
      const ray2 = fartherFromVertex(vertex, second.start, second.end);
      // Mirror each ray through the vertex to get all 4 sectors around the intersection.
      const neg1 = { x: 2 * vertex.x - ray1.x, y: 2 * vertex.y - ray1.y };
      const neg2 = { x: 2 * vertex.x - ray2.x, y: 2 * vertex.y - ray2.y };
      const candidates = [
        DimensionEngine.computeAngleDimension(vertex, ray1, ray2, radius),
        DimensionEngine.computeAngleDimension(vertex, neg1, ray2, radius),
        DimensionEngine.computeAngleDimension(vertex, ray1, neg2, radius),
        DimensionEngine.computeAngleDimension(vertex, neg1, neg2, radius),
      ];
      // Pick the candidate whose arc midpoint is nearest to the label position.
      const posAngle = Math.atan2(position.y - vertex.y, position.x - vertex.x);
      const angleDist = (a: number, b: number) => {
        const d = ((a - b) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
        return d > Math.PI ? Math.PI * 2 - d : d;
      };
      let ann = candidates[0];
      let best = Infinity;
      for (const c of candidates) {
        const mid = ((c.annotationArc.startAngle + c.annotationArc.endAngle) / 2 + Math.PI * 4) % (Math.PI * 2);
        const dist = angleDist(posAngle, mid);
        if (dist < best) { best = dist; ann = c; }
      }
      const arcPairs: [Vec2, Vec2][] = [];
      const { cx, cy, r, startAngle, endAngle } = ann.annotationArc;
      arcPairs.push(
        [vertex, { x: cx + r * Math.cos(startAngle), y: cy + r * Math.sin(startAngle) }],
        [vertex, { x: cx + r * Math.cos(endAngle), y: cy + r * Math.sin(endAngle) }],
      );
      const SEGS = 24;
      for (let i = 0; i < SEGS; i++) {
        const a0 = startAngle + (i / SEGS) * (endAngle - startAngle);
        const a1 = startAngle + ((i + 1) / SEGS) * (endAngle - startAngle);
        arcPairs.push([
          { x: cx + r * Math.cos(a0), y: cy + r * Math.sin(a0) },
          { x: cx + r * Math.cos(a1), y: cy + r * Math.sin(a1) },
        ]);
      }
      return { pairs: arcPairs, textPosition: ann.textPosition, value: ann.value };
    };
    const computeLinearAnnotationAtPosition = (start: Vec2, end: Vec2, position: Vec2, orientation: 'horizontal' | 'vertical' | 'auto') => {
      const resolvedOrientation = orientation === 'auto'
        ? (Math.abs(end.x - start.x) >= Math.abs(end.y - start.y) ? 'horizontal' : 'vertical')
        : orientation;
      const base = resolvedOrientation === 'horizontal'
        ? (start.y + end.y) / 2
        : (start.x + end.x) / 2;
      const offset = resolvedOrientation === 'horizontal' ? position.y - base : position.x - base;
      return DimensionEngine.computeLinearDimension(start, end, offset, resolvedOrientation);
    };
    const computeAlignedAnnotationAtPosition = (start: Vec2, end: Vec2, position: Vec2) => {
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const length = Math.hypot(dx, dy);
      if (length < 1e-8) return null;
      const midpoint = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
      const normal = { x: -dy / length, y: dx / length };
      const offset = (position.x - midpoint.x) * normal.x + (position.y - midpoint.y) * normal.y;
      return DimensionEngine.computeAlignedDimension(start, end, offset);
    };

    for (const dim of activeSketch.dimensions) {
      try {
        const ents = dim.entityIds.map((id) => entityMap.get(id)).filter(Boolean) as SketchEntity[];

        if (dim.type === 'linear' || dim.type === 'aligned' || dim.type === 'angular') {
          if ((dim.type === 'linear' || dim.type === 'aligned') && dim.entityIds.length >= 2) {
            // Two-point dimension: both entityIds resolve to degenerate segments (vertex/center picks).
            const seg0 = resolveDimensionSegment(dim.entityIds[0]);
            const seg1 = resolveDimensionSegment(dim.entityIds[1]);
            const isDegen = (s: { start: Vec2; end: Vec2 } | null) =>
              s != null && Math.hypot(s.end.x - s.start.x, s.end.y - s.start.y) < 1e-8;
            if (isDegen(seg0) && isDegen(seg1)) {
              const ann = dim.type === 'linear'
                ? computeLinearAnnotationAtPosition(seg0!.start, seg1!.start, dim.position, dim.orientation ?? 'auto')
                : computeAlignedAnnotationAtPosition(seg0!.start, seg1!.start, dim.position);
              if (!ann) continue;
              const segs = makeSegments(
                [ann.extensionLine1, ann.extensionLine2, ...withArrowheads(ann.dimensionLine)],
                origin, t1, t2,
              );
              result.push({
                dimensionId: dim.id,
                segments: segs,
                textPos: toWorld(ann.textPosition, origin, t1, t2),
                label: DimensionEngine.formatDimensionValue(dim.value, 'mm', 2),
              });
              continue;
            }
            // Point↔line perpendicular distance: aligned dim, exactly one
            // degenerate (point) segment + one real line. Render the aligned
            // annotation between the point and its perpendicular foot.
            if (dim.type === 'aligned' && seg0 && seg1 && (isDegen(seg0) !== isDegen(seg1))) {
              const pointSeg = isDegen(seg0) ? seg0 : seg1;
              const lineSeg = isDegen(seg0) ? seg1 : seg0;
              const { foot } = pointToLineDistance(pointSeg.start, lineSeg.start, lineSeg.end);
              const ann = computeAlignedAnnotationAtPosition(pointSeg.start, foot, dim.position);
              if (!ann) continue;
              const segs = makeSegments(
                [ann.extensionLine1, ann.extensionLine2, ...withArrowheads(ann.dimensionLine)],
                origin, t1, t2,
              );
              result.push({
                dimensionId: dim.id,
                segments: segs,
                textPos: toWorld(ann.textPosition, origin, t1, t2),
                label: DimensionEngine.formatDimensionValue(dim.value, 'mm', 2),
              });
              continue;
            }
            const twoLineAnn = buildTwoLineAnnotation(dim.entityIds[0], dim.entityIds[1], dim.position);
            if (twoLineAnn) {
              const pairs = [
                ...twoLineAnn.pairs.slice(0, -1),
                ...withArrowheads(twoLineAnn.pairs[twoLineAnn.pairs.length - 1]),
              ];
              const segs = makeSegments(pairs, origin, t1, t2);
              result.push({
                dimensionId: dim.id,
                segments: segs,
                textPos: toWorld(twoLineAnn.textPosition, origin, t1, t2),
                label: DimensionEngine.formatDimensionValue(dim.value, 'mm', 2),
              });
              continue;
            }
          }
          if (dim.type === 'angular' && dim.entityIds.length >= 2) {
            const angleAnn = buildTwoLineAngleAnnotation(dim.entityIds[0], dim.entityIds[1], dim.position);
            if (angleAnn) {
              const segs = makeSegments(angleAnn.pairs, origin, t1, t2);
              result.push({
                dimensionId: dim.id,
                segments: segs,
                textPos: toWorld(angleAnn.textPosition, origin, t1, t2),
                label: `${angleAnn.value.toFixed(2)}°`,
              });
              continue;
            }
          }
          // Need two reference points from entityIds
          const pts: Vec2[] = [];
          const singleSegment = resolveDimensionSegment(dim.entityIds[0]);
          if (singleSegment) {
            pts.push(singleSegment.start, singleSegment.end);
          } else {
            for (const e of ents) {
              if (e.points[0]) pts.push({ x: e.points[0].x, y: e.points[0].y });
              if (pts.length === 2) break;
            }
          }
          // Fall back to stored position if we can't find two points
          if (pts.length < 2) {
            pts.push(dim.position, { x: dim.position.x + dim.value, y: dim.position.y });
          }

          if (dim.type === 'linear') {
            // CORR-1: use stored orientation (horizontal / vertical / auto)
            const ann = computeLinearAnnotationAtPosition(pts[0], pts[1], dim.position, dim.orientation ?? 'auto');
            const segs = makeSegments(
              [ann.extensionLine1, ann.extensionLine2, ...withArrowheads(ann.dimensionLine)],
              origin, t1, t2,
            );
            result.push({
              dimensionId: dim.id,
              segments: segs,
              textPos: toWorld(ann.textPosition, origin, t1, t2),
              label: DimensionEngine.formatDimensionValue(dim.value, 'mm', 2),
            });
          } else if (dim.type === 'aligned') {
            const ann = computeAlignedAnnotationAtPosition(pts[0], pts[1], dim.position);
            if (!ann) continue;
            const segs = makeSegments(
              [ann.extensionLine1, ann.extensionLine2, ...withArrowheads(ann.dimensionLine)],
              origin, t1, t2,
            );
            result.push({
              dimensionId: dim.id,
              segments: segs,
              textPos: toWorld(ann.textPosition, origin, t1, t2),
              label: DimensionEngine.formatDimensionValue(dim.value, 'mm', 2),
            });
          } else {
            // angular — use vertex + two ray endpoints from first three entity points
            const allPts: Vec2[] = ents.flatMap((e) =>
              e.points.slice(0, 2).map((p) => ({ x: p.x, y: p.y })),
            );
            const vertex = allPts[0] ?? dim.position;
            const ray1End = allPts[1] ?? { x: dim.position.x + OFFSET, y: dim.position.y };
            const ray2End = allPts[2] ?? { x: dim.position.x, y: dim.position.y + OFFSET };
            const ann = DimensionEngine.computeAngleDimension(vertex, ray1End, ray2End, OFFSET);
            // Approximate the arc as segments
            const arcPairs: [Vec2, Vec2][] = [];
            const { cx, cy, r, startAngle, endAngle } = ann.annotationArc;
            const SEGS = 16;
            for (let i = 0; i < SEGS; i++) {
              const a0 = startAngle + (i / SEGS) * (endAngle - startAngle);
              const a1 = startAngle + ((i + 1) / SEGS) * (endAngle - startAngle);
              arcPairs.push([
                { x: cx + r * Math.cos(a0), y: cy + r * Math.sin(a0) },
                { x: cx + r * Math.cos(a1), y: cy + r * Math.sin(a1) },
              ]);
            }
            const segs = makeSegments(arcPairs, origin, t1, t2);
            result.push({
              dimensionId: dim.id,
              segments: segs,
              textPos: toWorld(ann.textPosition, origin, t1, t2),
              label: `${ann.value.toFixed(1)}°`,
            });
          }
        } else if (dim.type === 'radial' || dim.type === 'diameter') {
          // Circle/arc entity: center = points[0], radius from entity.radius
          const circEnt = ents[0];
          if (!circEnt?.points[0]) continue;
          const center2d = to2DLocal(circEnt.points[0]);
          const cx = center2d.x;
          const cy = center2d.y;
          const r = circEnt.radius ?? dim.value / (dim.type === 'diameter' ? 2 : 1);

          if (dim.type === 'diameter') {
            const start = { x: cx - r, y: cy };
            const end = { x: cx + r, y: cy };
            const segs = makeSegments(withArrowheads([start, end]), origin, t1, t2);
            result.push({
              dimensionId: dim.id,
              segments: segs,
              textPos: toWorld(dim.position, origin, t1, t2),
              label: `⌀${DimensionEngine.formatDimensionValue(dim.value, 'mm', 2)}`,
            });
          } else {
            // radial — leader from center toward stored text position with arrowhead at circle edge.
            const text2d: Vec2 = dim.position ?? { x: cx + r * 0.6, y: cy + 1 };
            const dir = { x: text2d.x - cx, y: text2d.y - cy };
            const len = Math.hypot(dir.x, dir.y) || 1;
            const edgePt: Vec2 = { x: cx + (dir.x / len) * r, y: cy + (dir.y / len) * r };
            const segs = makeSegments(withArrowheads([{ x: cx, y: cy }, edgePt]), origin, t1, t2);
            result.push({
              dimensionId: dim.id,
              segments: segs,
              textPos: toWorld(text2d, origin, t1, t2),
              label: `R${DimensionEngine.formatDimensionValue(r, 'mm', 2)}`,
            });
          }
        } else if (dim.type === 'arc-length') {
          const circEnt2 = ents[0];
          if (!circEnt2?.points[0] || circEnt2.radius == null) continue;
          const ac = to2DLocal(circEnt2.points[0]);
          const acx = ac.x;
          const acy = ac.y;
          const ar = circEnt2.radius;
          const aStart = circEnt2.startAngle ?? 0;
          let aEnd = circEnt2.endAngle ?? 2 * Math.PI;
          while (aEnd <= aStart) aEnd += 2 * Math.PI;
          const annR = ar + OFFSET;
          const ARC_SEGS = 24;
          const arcPairs: [Vec2, Vec2][] = [];
          for (let i = 0; i < ARC_SEGS; i++) {
            const a0 = aStart + (i / ARC_SEGS) * (aEnd - aStart);
            const a1 = aStart + ((i + 1) / ARC_SEGS) * (aEnd - aStart);
            arcPairs.push([
              { x: acx + annR * Math.cos(a0), y: acy + annR * Math.sin(a0) },
              { x: acx + annR * Math.cos(a1), y: acy + annR * Math.sin(a1) },
            ]);
          }
          // Radial extension lines at arc endpoints
          arcPairs.push(
            [
              { x: acx + ar * Math.cos(aStart), y: acy + ar * Math.sin(aStart) },
              { x: acx + annR * Math.cos(aStart), y: acy + annR * Math.sin(aStart) },
            ],
            [
              { x: acx + ar * Math.cos(aEnd), y: acy + ar * Math.sin(aEnd) },
              { x: acx + annR * Math.cos(aEnd), y: acy + annR * Math.sin(aEnd) },
            ],
          );
          const segs = makeSegments(arcPairs, origin, t1, t2);
          result.push({
            dimensionId: dim.id,
            segments: segs,
            textPos: toWorld(dim.position, origin, t1, t2),
            label: DimensionEngine.formatDimensionValue(dim.value, 'mm', 2),
          });
        }
      } catch {
        // Skip malformed dimensions silently
      }
    }

    return result;
  }, [activeSketch]);

  // When a new dimension is committed via fireAndEdit, open the inline editor.
  // Read directly from the store (not the memoized annotations) to avoid a timing
  // dependency on the annotations memo having re-run first.
  useEffect(() => {
    if (!pendingNewDimensionId) return;
    const sketch = useCADStore.getState().activeSketch;
    const dim = sketch?.dimensions?.find((d) => d.id === pendingNewDimensionId);
    if (!dim) return;
    const { t1, t2 } = GeometryEngine.getSketchAxes(sketch!);
    const originVec = (sketch!.planeOrigin ?? new THREE.Vector3(0, 0, 0)) as THREE.Vector3;
    const worldPos = originVec.clone()
      .addScaledVector(t1, dim.position.x)
      .addScaledVector(t2, dim.position.y);
    const vec = worldPos.clone().project(camera);
    const rect = gl.domElement.getBoundingClientRect();
    openSketchDimEdit(pendingNewDimensionId, dim.value.toFixed(2), true);
    updateSketchDimEditScreen(
      Math.round((vec.x + 1) / 2 * rect.width + rect.left),
      Math.round((1 - vec.y) / 2 * rect.height + rect.top),
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingNewDimensionId]);

  // Keep screen coordinates current whenever the active edit ID or annotations change
  useEffect(() => {
    if (!sketchDimEditId) return;
    const ann = annotations.find((a) => a.dimensionId === sketchDimEditId);
    if (!ann) return;
    const vec = ann.textPos.clone().project(camera);
    const rect = gl.domElement.getBoundingClientRect();
    updateSketchDimEditScreen(
      Math.round((vec.x + 1) / 2 * rect.width + rect.left),
      Math.round((1 - vec.y) / 2 * rect.height + rect.top),
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sketchDimEditId, annotations]);

  const openDimensionContextMenu = (
    dimensionId: string,
    event: React.MouseEvent<HTMLDivElement> | { stopPropagation: () => void; nativeEvent: MouseEvent },
  ) => {
    event.stopPropagation();
    const nativeEvent = 'nativeEvent' in event ? event.nativeEvent : event;
    nativeEvent.preventDefault();
    closeContextMenuRef.current?.();

    const x = nativeEvent.clientX;
    const y = nativeEvent.clientY;

    const menu = document.createElement('div');
    menu.style.cssText = `
      position:fixed;left:${x}px;top:${y}px;z-index:100000;
      min-width:140px;padding:4px;background:#fff;
      border:1px solid rgba(15,23,42,0.18);
      box-shadow:0 8px 24px rgba(15,23,42,0.18);border-radius:6px;
    `;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Delete Dimension';
    btn.style.cssText = `
      width:100%;border:0;background:transparent;color:#991b1b;
      cursor:pointer;font-size:12px;font-family:inherit;
      padding:6px 8px;text-align:left;
    `;

    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      menu.remove();
      window.removeEventListener('pointerdown', onOutside);
      window.removeEventListener('keydown', onEscape);
      if (closeContextMenuRef.current === close) closeContextMenuRef.current = null;
    };
    const onOutside = (e: PointerEvent) => {
      if (!menu.contains(e.target as Node)) close();
    };
    const onEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };

    btn.addEventListener('click', () => {
      useCADStore.getState().pushUndo?.();
      removeDimension(dimensionId);
      useCADStore.setState({ statusMessage: 'Dimension deleted' });
      close();
    });
    btn.addEventListener('mouseover', () => { btn.style.background = '#fef2f2'; });
    btn.addEventListener('mouseout', () => { btn.style.background = 'transparent'; });

    menu.addEventListener('contextmenu', (e) => e.preventDefault());
    menu.appendChild(btn);
    document.body.appendChild(menu);
    closeContextMenuRef.current = close;

    // Defer attaching outside-click listener so this same right-click doesn't close it.
    setTimeout(() => {
      if (closed) return;
      window.addEventListener('pointerdown', onOutside);
      window.addEventListener('keydown', onEscape);
    }, 0);
  };

  useEffect(() => () => {
    closeContextMenuRef.current?.();
  }, []);

  const toSketchCoord = (cx: number, cy: number, rect: DOMRect, plane: THREE.Plane, t1: THREE.Vector3, t2: THREE.Vector3, origin: THREE.Vector3) => {
    const ndc = new THREE.Vector2(((cx - rect.left) / rect.width) * 2 - 1, -((cy - rect.top) / rect.height) * 2 + 1);
    raycasterRef.current.setFromCamera(ndc, camera);
    const hit = new THREE.Vector3();
    if (!raycasterRef.current.ray.intersectPlane(plane, hit)) return null;
    const d = hit.sub(origin);
    return { x: d.dot(t1), y: d.dot(t2) };
  };

  const applyDragMove = (clientX: number, clientY: number) => {
    const drag = draggingDimRef.current;
    if (!drag?.sketchPlane || !drag.canvasRect || !drag.startSketchPos) return;
    const state = useCADStore.getState();
    if (!state.activeSketch) return;
    const { t1, t2 } = GeometryEngine.getSketchAxes(state.activeSketch);
    const origin = (state.activeSketch.planeOrigin ?? new THREE.Vector3(0, 0, 0)) as THREE.Vector3;
    const currSk = toSketchCoord(clientX, clientY, drag.canvasRect, drag.sketchPlane, t1, t2, origin);
    if (!currSk) return;
    const newPos = {
      x: drag.startPosition.x + (currSk.x - drag.startSketchPos.x),
      y: drag.startPosition.y + (currSk.y - drag.startSketchPos.y),
    };
    const nextSketch = {
      ...state.activeSketch,
      dimensions: state.activeSketch.dimensions.map((d) => d.id === drag.dimensionId ? { ...d, position: newPos } : d),
    };
    useCADStore.setState({ activeSketch: nextSketch, sketches: state.sketches.map((s) => (s.id === nextSketch.id ? nextSketch : s)) });
  };

  // Consume the latest pending mouse position once per animation frame — caps store
  // writes to the render rate regardless of how fast pointer events arrive.
  useFrame(() => {
    const pos = pendingMousePos.current;
    if (!pos) return;
    pendingMousePos.current = null;
    applyDragMove(pos.x, pos.y);
  });


  // Dispose each LineSegments' BufferGeometry when annotations are rebuilt or
  // the component unmounts. The shared dashed material is a singleton — leave it.
  useEffect(() => {
    return () => {
      for (const ann of annotations) {
        ann.segments.geometry?.dispose?.();
      }
    };
  }, [annotations]);

  if (!activeSketch || annotations.length === 0) return null;

  return (
    <group renderOrder={999}>
      {annotations.map((ann, i) => (
        <group key={i}>
          <primitive
            object={ann.segments}
            onContextMenu={(event: { stopPropagation: () => void; nativeEvent: MouseEvent }) =>
              openDimensionContextMenu(ann.dimensionId, event)
            }
          />
          {ann.dimensionId !== sketchDimEditId && (
            <Html position={ann.textPos} center style={{ pointerEvents: 'auto' }}>
              <div
                style={{ ...labelStyle, cursor: 'grab', userSelect: 'none' }}
                onContextMenu={(event) => openDimensionContextMenu(ann.dimensionId, event)}
                onPointerDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  const dim = activeSketch.dimensions.find((d) => d.id === ann.dimensionId);
                  if (!dim) return;
                  draggingDimRef.current = {
                    dimensionId: ann.dimensionId,
                    startScreenX: event.clientX,
                    startScreenY: event.clientY,
                    startPosition: { ...dim.position },
                    moved: false,
                    sketchPlane: null,
                    canvasRect: null,
                    startSketchPos: null,
                  };
                  event.currentTarget.setPointerCapture(event.pointerId);
                }}
                onPointerMove={(event) => {
                  const drag = draggingDimRef.current;
                  if (!drag) return;
                  const ddx = event.clientX - drag.startScreenX;
                  const ddy = event.clientY - drag.startScreenY;
                  if (!drag.moved && Math.hypot(ddx, ddy) < 3) return;
                  if (!drag.moved) {
                    useCADStore.getState().pushUndo?.();
                    drag.moved = true;
                    // Cache plane, rect, and start sketch position once per drag
                    const sketch = useCADStore.getState().activeSketch;
                    if (sketch) {
                      const { t1, t2 } = GeometryEngine.getSketchAxes(sketch);
                      const origin = (sketch.planeOrigin ?? new THREE.Vector3(0, 0, 0)) as THREE.Vector3;
                      drag.sketchPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(
                        t1.clone().cross(t2).normalize(), origin,
                      );
                      drag.canvasRect = gl.domElement.getBoundingClientRect();
                      drag.startSketchPos = toSketchCoord(
                        drag.startScreenX, drag.startScreenY,
                        drag.canvasRect, drag.sketchPlane, t1, t2, origin,
                      );
                    }
                  }
                  // Only store the latest position — useFrame consumes it once per render tick
                  pendingMousePos.current = { x: event.clientX, y: event.clientY };
                }}
                onPointerUp={(event) => {
                  event.stopPropagation();
                  const wasDragging = draggingDimRef.current?.moved ?? false;
                  draggingDimRef.current = null;
                  event.currentTarget.releasePointerCapture(event.pointerId);
                  if (wasDragging) return;
                  // Single click without drag — no action (edit requires double-click)
                }}
                onDoubleClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  draggingDimRef.current = null;
                  const dim = activeSketch.dimensions.find((d) => d.id === ann.dimensionId);
                  openSketchDimEdit(
                    ann.dimensionId,
                    dim ? String(dim.value) : ann.label.replace(/[^0-9.+-]/g, ''),
                    false,
                  );
                }}
              >
                {ann.label}
              </div>
            </Html>
          )}
        </group>
      ))}
    </group>
  );
}
