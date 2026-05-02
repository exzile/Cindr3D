// SketchDimensionAnnotations.tsx
// Renders dimension annotation geometry (extension lines, dimension lines,
// value labels) for the active sketch's SketchDimension entries.
// NOTE: SketchConstraint only carries geometric constraints; dimension data
// lives in sketch.dimensions (SketchDimension[]). This component is wired and
// ready — it will populate automatically once D28 adds dimension records.

import { useMemo, useEffect } from 'react';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { useCADStore } from '../../../store/cadStore';
import { DimensionEngine } from '../../../engine/DimensionEngine';
import { GeometryEngine } from '../../../engine/GeometryEngine';
import type { SketchEntity } from '../../../types/cad';

// ── Module-level material singletons ──────────────────────────────────────────
const lineMat = new THREE.LineBasicMaterial({
  color: '#2563eb',
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

// ── Per-annotation data collected in useMemo ─────────────────────────────────
interface AnnData {
  segments: THREE.LineSegments;
  textPos: THREE.Vector3;
  label: string;
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function SketchDimensionAnnotations() {
  const activeSketch = useCADStore((s) => s.activeSketch);

  const annotations = useMemo<AnnData[]>(() => {
    if (!activeSketch?.dimensions?.length) return [];

    const { t1, t2 } = GeometryEngine.getSketchAxes(activeSketch);
    const origin = activeSketch.planeOrigin ?? new THREE.Vector3(0, 0, 0);

    const entityMap = new Map<string, SketchEntity>();
    for (const e of activeSketch.entities) entityMap.set(e.id, e);

    const OFFSET = 8; // perpendicular offset for dimension lines (model units)
    const result: AnnData[] = [];

    for (const dim of activeSketch.dimensions) {
      try {
        const ents = dim.entityIds.map((id) => entityMap.get(id)).filter(Boolean) as SketchEntity[];

        if (dim.type === 'linear' || dim.type === 'angular') {
          // Need two reference points from entityIds
          const pts: Vec2[] = [];
          for (const e of ents) {
            if (e.points[0]) pts.push({ x: e.points[0].x, y: e.points[0].y });
            if (pts.length === 2) break;
          }
          // Fall back to stored position if we can't find two points
          if (pts.length < 2) {
            pts.push(dim.position, { x: dim.position.x + dim.value, y: dim.position.y });
          }

          if (dim.type === 'linear') {
            // CORR-1: use stored orientation (horizontal / vertical / auto)
            const ann = DimensionEngine.computeLinearDimension(pts[0], pts[1], OFFSET, dim.orientation ?? 'auto');
            const segs = makeSegments(
              [ann.extensionLine1, ann.extensionLine2, ann.dimensionLine],
              origin, t1, t2,
            );
            result.push({
              segments: segs,
              textPos: toWorld(ann.textPosition, origin, t1, t2),
              label: DimensionEngine.formatDimensionValue(ann.value, 'mm', 2),
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
              segments: segs,
              textPos: toWorld(ann.textPosition, origin, t1, t2),
              label: `${ann.value.toFixed(1)}°`,
            });
          }
        } else if (dim.type === 'radial' || dim.type === 'diameter') {
          // Circle/arc entity: center = points[0], radius from entity.radius
          const circEnt = ents[0];
          if (!circEnt?.points[0]) continue;
          const cx = circEnt.points[0].x;
          const cy = circEnt.points[0].y;
          const r = circEnt.radius ?? dim.value / (dim.type === 'diameter' ? 2 : 1);

          if (dim.type === 'diameter') {
            const tick = Math.max(0.8, r * 0.08);
            const start = { x: cx - r, y: cy };
            const end = { x: cx + r, y: cy };
            const segs = makeSegments(
              [
                [start, end],
                [{ x: start.x, y: cy - tick }, { x: start.x, y: cy + tick }],
                [{ x: end.x, y: cy - tick }, { x: end.x, y: cy + tick }],
              ],
              origin, t1, t2,
            );
            const ann = { value: dim.value, textPosition: dim.position };
            result.push({
              segments: segs,
              textPos: toWorld(ann.textPosition, origin, t1, t2),
              label: `⌀${DimensionEngine.formatDimensionValue(ann.value, 'mm', 2)}`,
            });
            result[result.length - 1].label = `DIA ${DimensionEngine.formatDimensionValue(dim.value, 'mm', 2)}`;
          } else {
            // radial — show a line from center to edge
            const edgePt: Vec2 = { x: cx + r, y: cy };
            const segs = makeSegments([[{ x: cx, y: cy }, edgePt]], origin, t1, t2);
            result.push({
              segments: segs,
              textPos: toWorld(
                { x: cx + r * 0.6, y: cy + 1 },
                origin, t1, t2,
              ),
              label: `R${DimensionEngine.formatDimensionValue(r, 'mm', 2)}`,
            });
          }
        }
      } catch {
        // Skip malformed dimensions silently
      }
    }

    return result;
  }, [activeSketch]);

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
          <primitive object={ann.segments} />
          <Html position={ann.textPos} center style={{ pointerEvents: 'none' }}>
            <div style={labelStyle}>{ann.label}</div>
          </Html>
        </group>
      ))}
    </group>
  );
}
