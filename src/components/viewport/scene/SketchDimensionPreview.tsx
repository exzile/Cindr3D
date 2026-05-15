// SketchDimensionPreview.tsx
// Renders the Fusion-style ghost dimension that rubber-bands with the cursor
// while a placement is pending (store field `dimensionPreview`). It draws the
// same extension-line / dimension-line / arrowhead / value-label visuals as a
// committed dimension, but dimmed + dashed using the shared
// DIMENSION_PREVIEW_MATERIAL singleton.
//
// This is a pure VISUALIZATION concern (its own file per feedback_code_quality).
// It deliberately mirrors — does not import — the committed-dimension renderer's
// per-dimension math: extracting that 700-line memoised pipeline would be far
// more invasive than the focused, faithful ghost below.

import { useMemo, useEffect } from 'react';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { useCADStore } from '../../../store/cadStore';
import { DimensionEngine } from '../../../engine/DimensionEngine';
import { GeometryEngine } from '../../../engine/GeometryEngine';
import { DIMENSION_PREVIEW_MATERIAL } from '../../../engine/geometryEngine/materials';
import type { SketchEntity } from '../../../types/cad';

type Vec2 = { x: number; y: number };

const previewLabelStyle: React.CSSProperties = {
  background: 'rgba(255, 255, 255, 0.65)',
  border: '1px dashed rgba(37, 99, 235, 0.7)',
  borderRadius: 4,
  color: '#2563eb',
  fontSize: 11,
  fontWeight: 700,
  lineHeight: '14px',
  opacity: 0.75,
  padding: '1px 5px',
  pointerEvents: 'none',
  userSelect: 'none',
  whiteSpace: 'nowrap',
};

function toWorld(
  p: Vec2,
  origin: THREE.Vector3,
  t1: THREE.Vector3,
  t2: THREE.Vector3,
): THREE.Vector3 {
  return origin.clone().addScaledVector(t1, p.x).addScaledVector(t2, p.y);
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

function lineIntersection(a1: Vec2, a2: Vec2, b1: Vec2, b2: Vec2): Vec2 | null {
  const adx = a2.x - a1.x;
  const ady = a2.y - a1.y;
  const bdx = b2.x - b1.x;
  const bdy = b2.y - b1.y;
  const denominator = adx * bdy - ady * bdx;
  if (Math.abs(denominator) < 1e-8) return null;
  const t = ((b1.x - a1.x) * bdy - (b1.y - a1.y) * bdx) / denominator;
  return { x: a1.x + t * adx, y: a1.y + t * ady };
}

function fartherFromVertex(vertex: Vec2, start: Vec2, end: Vec2): Vec2 {
  const startDistance = Math.hypot(start.x - vertex.x, start.y - vertex.y);
  const endDistance = Math.hypot(end.x - vertex.x, end.y - vertex.y);
  return endDistance >= startDistance ? end : start;
}

export default function SketchDimensionPreview() {
  const dimensionPreview = useCADStore((s) => s.dimensionPreview);
  const activeSketch = useCADStore((s) => s.activeSketch);

  const ghost = useMemo<{
    segments: THREE.LineSegments;
    textPos: THREE.Vector3;
    label: string;
  } | null>(() => {
    if (!dimensionPreview || !activeSketch) return null;

    const { t1, t2 } = GeometryEngine.getSketchAxes(activeSketch);
    const origin = (activeSketch.planeOrigin ?? new THREE.Vector3(0, 0, 0)) as THREE.Vector3;

    const entityMap = new Map<string, SketchEntity>();
    for (const e of activeSketch.entities) entityMap.set(e.id, e);

    const to2DLocal = (p: { x: number; y: number; z: number }): Vec2 => {
      const d = new THREE.Vector3(p.x, p.y, p.z).sub(origin);
      return { x: d.dot(t1), y: d.dot(t2) };
    };

    // Mirror SketchDimensionAnnotations.resolveDimensionSegment for the entity
    // id forms the dimension tool produces (line / rect-edge / vertex / center).
    const resolveSegment = (id: string): { start: Vec2; end: Vec2 } | null => {
      if (id.includes('::vertex:')) {
        const [entityId, vertexPart] = id.split('::vertex:');
        const entity = entityMap.get(entityId);
        const idx = Number(vertexPart);
        if (!entity || !Number.isInteger(idx) || idx < 0 || idx >= entity.points.length) return null;
        const p = to2DLocal(entity.points[idx]);
        return { start: p, end: p };
      }
      if (id.includes('::center')) {
        const entity = entityMap.get(id.split('::center')[0]);
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
          start: {
            x: corners[edgeIndex].clone().sub(origin).dot(t1),
            y: corners[edgeIndex].clone().sub(origin).dot(t2),
          },
          end: {
            x: corners[(edgeIndex + 1) % corners.length].clone().sub(origin).dot(t1),
            y: corners[(edgeIndex + 1) % corners.length].clone().sub(origin).dot(t2),
          },
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

    const isDegen = (s: { start: Vec2; end: Vec2 } | null) =>
      s != null && Math.hypot(s.end.x - s.start.x, s.end.y - s.start.y) < 1e-8;

    const computeLinearAt = (
      start: Vec2,
      end: Vec2,
      position: Vec2,
      orientation: 'horizontal' | 'vertical' | 'auto',
    ) => {
      const resolved = orientation === 'auto'
        ? (Math.abs(end.x - start.x) >= Math.abs(end.y - start.y) ? 'horizontal' : 'vertical')
        : orientation;
      const base = resolved === 'horizontal' ? (start.y + end.y) / 2 : (start.x + end.x) / 2;
      const offset = resolved === 'horizontal' ? position.y - base : position.x - base;
      return DimensionEngine.computeLinearDimension(start, end, offset, resolved);
    };
    const computeAlignedAt = (start: Vec2, end: Vec2, position: Vec2) => {
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const length = Math.hypot(dx, dy);
      if (length < 1e-8) return null;
      const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
      const normal = { x: -dy / length, y: dx / length };
      const offset = (position.x - mid.x) * normal.x + (position.y - mid.y) * normal.y;
      return DimensionEngine.computeAlignedDimension(start, end, offset);
    };

    let pairs: [Vec2, Vec2][] = [];
    let textPos2D: Vec2 = dimensionPreview.position;
    let label = DimensionEngine.formatDimensionValue(dimensionPreview.value, 'mm', 2);

    try {
      const dim = dimensionPreview;
      const seg0 = resolveSegment(dim.entityIds[0]);
      const seg1 = dim.entityIds[1] ? resolveSegment(dim.entityIds[1]) : null;

      if (dim.type === 'angular' && seg0 && seg1) {
        const vertex = lineIntersection(seg0.start, seg0.end, seg1.start, seg1.end);
        if (vertex) {
          const radius = Math.max(1, Math.hypot(dim.position.x - vertex.x, dim.position.y - vertex.y));
          const ray1 = fartherFromVertex(vertex, seg0.start, seg0.end);
          const ray2 = fartherFromVertex(vertex, seg1.start, seg1.end);
          const neg1 = { x: 2 * vertex.x - ray1.x, y: 2 * vertex.y - ray1.y };
          const neg2 = { x: 2 * vertex.x - ray2.x, y: 2 * vertex.y - ray2.y };
          const candidates = [
            DimensionEngine.computeAngleDimension(vertex, ray1, ray2, radius),
            DimensionEngine.computeAngleDimension(vertex, neg1, ray2, radius),
            DimensionEngine.computeAngleDimension(vertex, ray1, neg2, radius),
            DimensionEngine.computeAngleDimension(vertex, neg1, neg2, radius),
          ];
          const posAngle = Math.atan2(dim.position.y - vertex.y, dim.position.x - vertex.x);
          const angleDist = (a: number, b: number) => {
            const d = ((a - b) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
            return d > Math.PI ? Math.PI * 2 - d : d;
          };
          let ann = candidates[0];
          let best = Infinity;
          for (const c of candidates) {
            const mid = ((c.annotationArc.startAngle + c.annotationArc.endAngle) / 2 + Math.PI * 4) % (Math.PI * 2);
            const d = angleDist(posAngle, mid);
            if (d < best) { best = d; ann = c; }
          }
          const { cx, cy, r, startAngle, endAngle } = ann.annotationArc;
          pairs.push(
            [vertex, { x: cx + r * Math.cos(startAngle), y: cy + r * Math.sin(startAngle) }],
            [vertex, { x: cx + r * Math.cos(endAngle), y: cy + r * Math.sin(endAngle) }],
          );
          const SEGS = 24;
          for (let i = 0; i < SEGS; i++) {
            const a0 = startAngle + (i / SEGS) * (endAngle - startAngle);
            const a1 = startAngle + ((i + 1) / SEGS) * (endAngle - startAngle);
            pairs.push([
              { x: cx + r * Math.cos(a0), y: cy + r * Math.sin(a0) },
              { x: cx + r * Math.cos(a1), y: cy + r * Math.sin(a1) },
            ]);
          }
          textPos2D = ann.textPosition;
          label = `${ann.value.toFixed(2)}°`;
        }
      } else if ((dim.type === 'linear' || dim.type === 'aligned') && seg0 && seg1) {
        // Two-entity: degenerate point picks measure point→point; two real
        // lines measure between their parallel midlines (mirrors annotations).
        if (isDegen(seg0) && isDegen(seg1)) {
          const ann = dim.type === 'linear'
            ? computeLinearAt(seg0.start, seg1.start, dim.position, dim.orientation ?? 'auto')
            : computeAlignedAt(seg0.start, seg1.start, dim.position);
          if (ann) {
            pairs = [ann.extensionLine1, ann.extensionLine2, ...withArrowheads(ann.dimensionLine)];
            textPos2D = ann.textPosition;
          }
        } else {
          const firstHorizontal = Math.abs(seg0.end.x - seg0.start.x) >= Math.abs(seg0.end.y - seg0.start.y);
          const secondHorizontal = Math.abs(seg1.end.x - seg1.start.x) >= Math.abs(seg1.end.y - seg1.start.y);
          if (firstHorizontal === secondHorizontal) {
            if (firstHorizontal) {
              const y1 = (seg0.start.y + seg0.end.y) / 2;
              const y2 = (seg1.start.y + seg1.end.y) / 2;
              const x = dim.position.x;
              const lowY = Math.min(y1, y2);
              const highY = Math.max(y1, y2);
              const firstNearX = Math.abs(seg0.start.x - x) <= Math.abs(seg0.end.x - x) ? seg0.start.x : seg0.end.x;
              const secondNearX = Math.abs(seg1.start.x - x) <= Math.abs(seg1.end.x - x) ? seg1.start.x : seg1.end.x;
              pairs = [
                [{ x: firstNearX, y: y1 }, { x, y: y1 }],
                [{ x: secondNearX, y: y2 }, { x, y: y2 }],
                ...withArrowheads([{ x, y: lowY }, { x, y: highY }]),
              ];
              textPos2D = { x, y: (lowY + highY) / 2 };
            } else {
              const x1 = (seg0.start.x + seg0.end.x) / 2;
              const x2 = (seg1.start.x + seg1.end.x) / 2;
              const y = dim.position.y;
              const lowX = Math.min(x1, x2);
              const highX = Math.max(x1, x2);
              const firstNearY = Math.abs(seg0.start.y - y) <= Math.abs(seg0.end.y - y) ? seg0.start.y : seg0.end.y;
              const secondNearY = Math.abs(seg1.start.y - y) <= Math.abs(seg1.end.y - y) ? seg1.start.y : seg1.end.y;
              pairs = [
                [{ x: x1, y: firstNearY }, { x: x1, y }],
                [{ x: x2, y: secondNearY }, { x: x2, y }],
                ...withArrowheads([{ x: lowX, y }, { x: highX, y }]),
              ];
              textPos2D = { x: (lowX + highX) / 2, y };
            }
          }
        }
      } else if ((dim.type === 'linear' || dim.type === 'aligned') && seg0) {
        // Single-line linear/aligned ghost.
        const ann = dim.type === 'linear'
          ? computeLinearAt(seg0.start, seg0.end, dim.position, dim.orientation ?? 'auto')
          : computeAlignedAt(seg0.start, seg0.end, dim.position);
        if (ann) {
          pairs = [ann.extensionLine1, ann.extensionLine2, ...withArrowheads(ann.dimensionLine)];
          textPos2D = ann.textPosition;
        }
      }
    } catch {
      return null;
    }

    if (pairs.length === 0) return null;

    const verts: number[] = [];
    for (const [a, b] of pairs) {
      const wa = toWorld(a, origin, t1, t2);
      const wb = toWorld(b, origin, t1, t2);
      verts.push(wa.x, wa.y, wa.z, wb.x, wb.y, wb.z);
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3));
    const segments = new THREE.LineSegments(geom, DIMENSION_PREVIEW_MATERIAL);
    segments.computeLineDistances(); // required for the dashed material
    return { segments, textPos: toWorld(textPos2D, origin, t1, t2), label };
  }, [dimensionPreview, activeSketch]);

  // Dispose the ghost geometry when the preview rebuilds / unmounts. The shared
  // dashed material is a tagged singleton — never dispose it.
  useEffect(() => {
    return () => {
      ghost?.segments.geometry?.dispose?.();
    };
  }, [ghost]);

  if (!ghost) return null;

  return (
    <group renderOrder={1000}>
      <primitive object={ghost.segments} />
      <Html position={ghost.textPos} center style={{ pointerEvents: 'none' }}>
        <div style={previewLabelStyle}>{ghost.label}</div>
      </Html>
    </group>
  );
}
