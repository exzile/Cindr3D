import { useEffect, useMemo } from 'react';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { useCADStore } from '../../../store/cadStore';
import { useComponentStore } from '../../../store/componentStore';
import { DimensionEngine } from '../../../engine/DimensionEngine';
import { GeometryEngine } from '../../../engine/GeometryEngine';
import { disposeLineGeometries } from '../../../utils/threeDisposal';
import type { Sketch } from '../../../types/cad';
import { isComponentVisible } from './componentVisibility';

const PENDING_DIMENSION_LINE_MAT = new THREE.LineBasicMaterial({
  color: 0x0078ff,
  depthTest: false,
  depthWrite: false,
  transparent: true,
  opacity: 1,
});
const PENDING_DIMENSION_CALLOUT_MAT = new THREE.LineBasicMaterial({
  color: 0x111111,
  depthTest: false,
  depthWrite: false,
  transparent: true,
  opacity: 1,
});
const DIMENSION_HOVER_MAT = new THREE.LineBasicMaterial({
  color: 0xfbbf24,
  depthTest: false,
  depthWrite: false,
  transparent: true,
  opacity: 1,
  linewidth: 2,
});
const PENDING_SELECTED_MAT = new THREE.LineBasicMaterial({
  color: 0x60a5fa,
  depthTest: false,
  depthWrite: false,
  transparent: true,
  opacity: 1,
  linewidth: 2,
});
const SELECTED_SKETCH_ENTITY_MAT = new THREE.LineBasicMaterial({
  color: 0xf59e0b,
  depthTest: false,
  depthWrite: false,
  transparent: true,
  opacity: 1,
  linewidth: 3,
});
const pendingDimensionLabelStyle: React.CSSProperties = {
  background: 'rgba(255, 255, 255, 0.94)',
  border: '1px solid rgba(96, 165, 250, 0.8)',
  borderRadius: 3,
  color: '#1f2937',
  fontSize: 11,
  fontWeight: 700,
  lineHeight: '14px',
  padding: '1px 5px',
  whiteSpace: 'nowrap',
};

/**
 * Renders one sketch's wire geometry. Caches the Three.js Group via useMemo so it is
 * only recreated when the sketch reference changes (Zustand does immutable updates),
 * and disposes all child line geometries on cleanup to prevent GPU memory leaks.
 * NOTE: SKETCH_MATERIAL is a shared module-level constant — never dispose it here.
 */
function SketchGeometry({ sketch }: { sketch: Sketch }) {
  const group = useMemo(() => GeometryEngine.createSketchGeometry(sketch), [sketch]);

  useEffect(() => {
    return () => disposeLineGeometries(group);
  }, [group]);

  return <primitive object={group} />;
}

/** Memoize the filtered sketch so visibility toggles don't produce
 *  a new object identity on every render, defeating SketchGeometry's useMemo. */
function ActiveSketchGeometry({
  sketch,
  showSketchPoints,
  showConstructionGeometries,
}: {
  sketch: Sketch;
  showSketchPoints: boolean;
  showConstructionGeometries: boolean;
}) {
  const filteredSketch = useMemo(() => {
    const entities = sketch.entities.filter((e) => {
      if (!showSketchPoints && e.type === 'point') return false;
      if (!showConstructionGeometries && e.isConstruction) return false;
      return true;
    });
    return entities.length === sketch.entities.length
      ? sketch
      : { ...sketch, entities };
  }, [sketch, showSketchPoints, showConstructionGeometries]);

  return (
    <SketchGeometry
      key={`active-${sketch.id}-e${sketch.entities.length}-pts${showSketchPoints ? 1 : 0}-cg${showConstructionGeometries ? 1 : 0}`}
      sketch={filteredSketch}
    />
  );
}

function DimensionHoverHighlight({ sketch, hoverId }: { sketch: Sketch; hoverId: string }) {
  const line = useMemo(() => {
    const entityMap = new Map(sketch.entities.map((e) => [e.id, e]));
    const { t1, t2 } = GeometryEngine.getSketchAxes(sketch);

    const resolveEntityPoints = (id: string): [THREE.Vector3, THREE.Vector3] | null => {
      if (id.includes('::vertex:')) {
        const [entityId, vertexPart] = id.split('::vertex:');
        const entity = entityMap.get(entityId);
        const index = Number(vertexPart);
        if (!entity || !Number.isInteger(index) || index < 0 || index >= entity.points.length) return null;
        const point = entity.points[index];
        const p = new THREE.Vector3(point.x, point.y, point.z);
        return [p, p];
      }
      if (id.includes('::center')) {
        const entityId = id.split('::center')[0];
        const entity = entityMap.get(entityId);
        if (!entity || !entity.points[0]) return null;
        const point = entity.points[0];
        const p = new THREE.Vector3(point.x, point.y, point.z);
        return [p, p];
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
        const corners = [p1.clone(), p1.clone().add(dt1), p1.clone().add(dt1).add(dt2), p1.clone().add(dt2)];
        return [corners[edgeIndex], corners[(edgeIndex + 1) % 4]];
      }
      if (entity.points.length >= 2) {
        return [
          new THREE.Vector3(entity.points[0].x, entity.points[0].y, entity.points[0].z),
          new THREE.Vector3(entity.points[entity.points.length - 1].x, entity.points[entity.points.length - 1].y, entity.points[entity.points.length - 1].z),
        ];
      }
      return null;
    };

    const pts = resolveEntityPoints(hoverId);
    if (!pts) return null;
    const [start, end] = pts;
    if (start.distanceTo(end) < 1e-8) {
      // point — render a small cross
      const dx = t1.clone().multiplyScalar(1.5);
      const dy = t2.clone().multiplyScalar(1.5);
      const verts = new Float32Array([
        ...(start.clone().sub(dx)).toArray(), ...(start.clone().add(dx)).toArray(),
        ...(start.clone().sub(dy)).toArray(), ...(start.clone().add(dy)).toArray(),
      ]);
      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.BufferAttribute(verts, 3));
      const seg = new THREE.LineSegments(geom, DIMENSION_HOVER_MAT);
      seg.renderOrder = 1300;
      return seg;
    }
    const geom = new THREE.BufferGeometry().setFromPoints([start, end]);
    const seg = new THREE.LineSegments(geom, DIMENSION_HOVER_MAT);
    seg.renderOrder = 1300;
    return seg;
  }, [sketch, hoverId]);

  useEffect(() => () => { line?.geometry?.dispose(); }, [line]);
  if (!line) return null;
  return <primitive object={line} />;
}

function SelectedSketchEntitiesHighlight({ sketch, selectedIds }: { sketch: Sketch; selectedIds: string[] }) {
  const group = useMemo(() => {
    const highlightGroup = new THREE.Group();
    highlightGroup.renderOrder = 1350;
    const selected = new Set(selectedIds);
    const axes = GeometryEngine.getSketchAxes(sketch);
    const selectedSketch: Sketch = {
      ...sketch,
      entities: sketch.entities.filter((entity) => selected.has(entity.id)),
    };
    const geometryGroup = GeometryEngine.createSketchGeometry(selectedSketch);
    geometryGroup.traverse((object) => {
      const line = object as THREE.Line | THREE.LineSegments;
      if (line.isLine) {
        line.material = SELECTED_SKETCH_ENTITY_MAT;
        line.renderOrder = 1350;
      }
    });
    highlightGroup.add(geometryGroup);

    for (const entity of selectedSketch.entities) {
      if (entity.type !== 'point' || !entity.points[0]) continue;
      const point = entity.points[0];
      const size = 0.65;
      const { t1, t2 } = axes;
      const positions = new Float32Array([
        point.x - t1.x * size, point.y - t1.y * size, point.z - t1.z * size,
        point.x + t1.x * size, point.y + t1.y * size, point.z + t1.z * size,
        point.x - t2.x * size, point.y - t2.y * size, point.z - t2.z * size,
        point.x + t2.x * size, point.y + t2.y * size, point.z + t2.z * size,
      ]);
      const pointGeometry = new THREE.BufferGeometry();
      pointGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const marker = new THREE.LineSegments(pointGeometry, SELECTED_SKETCH_ENTITY_MAT);
      marker.renderOrder = 1350;
      highlightGroup.add(marker);
    }

    return highlightGroup;
  }, [selectedIds, sketch]);

  useEffect(() => () => disposeLineGeometries(group), [group]);
  return <primitive object={group} />;
}

function PendingDimensionHighlight({
  sketch,
  pendingIds,
  dimensionOffset,
  dimensionOrientation,
  activeDimensionType,
  isEditing,
}: {
  sketch: Sketch;
  pendingIds: string[];
  dimensionOffset: number;
  dimensionOrientation: 'horizontal' | 'vertical' | 'auto';
  activeDimensionType: string;
  isEditing: boolean;
}) {
  const { group, labels } = useMemo(() => {
    const highlightGroup = new THREE.Group();
    const previewLabels: Array<{ id: string; position: THREE.Vector3; text: string }> = [];
    highlightGroup.renderOrder = 1200;
    if (pendingIds.length === 0) return { group: highlightGroup, labels: previewLabels };

    // When the editor is open for an existing dim, just highlight the entity lines.
    if (isEditing) {
      const entityMap = new Map(sketch.entities.map((e) => [e.id, e]));
      const { t1, t2 } = GeometryEngine.getSketchAxes(sketch);
      for (const pendingId of pendingIds) {
        const baseId = pendingId.split('::')[0];
        const entity = entityMap.get(baseId);
        if (!entity || entity.points.length < 2) continue;
        if (entity.type === 'rectangle' && pendingId.includes('::edge:')) {
          const edgeIndex = Number(pendingId.split('::edge:')[1]);
          const p1 = new THREE.Vector3(entity.points[0].x, entity.points[0].y, entity.points[0].z);
          const p2 = new THREE.Vector3(entity.points[1].x, entity.points[1].y, entity.points[1].z);
          const delta = p2.clone().sub(p1);
          const dt1 = t1.clone().multiplyScalar(delta.dot(t1));
          const dt2 = t2.clone().multiplyScalar(delta.dot(t2));
          const corners = [p1.clone(), p1.clone().add(dt1), p1.clone().add(dt1).add(dt2), p1.clone().add(dt2)];
          const geom = new THREE.BufferGeometry().setFromPoints([corners[edgeIndex], corners[(edgeIndex + 1) % 4]]);
          const line = new THREE.Line(geom, PENDING_SELECTED_MAT);
          line.renderOrder = 1250;
          highlightGroup.add(line);
        } else {
          const start = new THREE.Vector3(entity.points[0].x, entity.points[0].y, entity.points[0].z);
          const end = new THREE.Vector3(entity.points[entity.points.length - 1].x, entity.points[entity.points.length - 1].y, entity.points[entity.points.length - 1].z);
          const geom = new THREE.BufferGeometry().setFromPoints([start, end]);
          const line = new THREE.Line(geom, PENDING_SELECTED_MAT);
          line.renderOrder = 1250;
          highlightGroup.add(line);
        }
      }
      return { group: highlightGroup, labels: previewLabels };
    }

    const entityMap = new Map(sketch.entities.map((entity) => [entity.id, entity]));
    const { t1, t2 } = GeometryEngine.getSketchAxes(sketch);
    const origin = sketch.planeOrigin ?? new THREE.Vector3(0, 0, 0);

    const to2D = (worldPoint: THREE.Vector3) => {
      const delta = worldPoint.clone().sub(origin);
      return { x: delta.dot(t1), y: delta.dot(t2) };
    };
    const toWorld = (point: { x: number; y: number }) => (
      origin.clone().addScaledVector(t1, point.x).addScaledVector(t2, point.y)
    );
    const addSegment = (
      start: THREE.Vector3,
      end: THREE.Vector3,
      material: THREE.LineBasicMaterial,
    ) => {
      const geometry = new THREE.BufferGeometry().setFromPoints([start, end]);
      const line = new THREE.Line(geometry, material);
      line.renderOrder = 1200;
      highlightGroup.add(line);
    };
    const add2DSegment = (
      start: { x: number; y: number },
      end: { x: number; y: number },
      material: THREE.LineBasicMaterial,
    ) => addSegment(toWorld(start), toWorld(end), material);
    const lineIntersection = (
      a1: { x: number; y: number },
      a2: { x: number; y: number },
      b1: { x: number; y: number },
      b2: { x: number; y: number },
    ) => {
      const adx = a2.x - a1.x;
      const ady = a2.y - a1.y;
      const bdx = b2.x - b1.x;
      const bdy = b2.y - b1.y;
      const denominator = adx * bdy - ady * bdx;
      if (Math.abs(denominator) < 1e-8) return null;
      const t = ((b1.x - a1.x) * bdy - (b1.y - a1.y) * bdx) / denominator;
      return { x: a1.x + t * adx, y: a1.y + t * ady };
    };
    const fartherFromVertex = (
      vertex: { x: number; y: number },
      start: { x: number; y: number },
      end: { x: number; y: number },
    ) => {
      const startDistance = Math.hypot(start.x - vertex.x, start.y - vertex.y);
      const endDistance = Math.hypot(end.x - vertex.x, end.y - vertex.y);
      return endDistance >= startDistance ? end : start;
    };
    const addLinearPreview = (id: string, start: THREE.Vector3, end: THREE.Vector3) => {
      const p1 = to2D(start);
      const p2 = to2D(end);
      const annotation = activeDimensionType === 'aligned'
        ? DimensionEngine.computeAlignedDimension(p1, p2, dimensionOffset)
        : DimensionEngine.computeLinearDimension(p1, p2, dimensionOffset, dimensionOrientation);
      add2DSegment(annotation.extensionLine1[0], annotation.extensionLine1[1], PENDING_DIMENSION_CALLOUT_MAT);
      add2DSegment(annotation.extensionLine2[0], annotation.extensionLine2[1], PENDING_DIMENSION_CALLOUT_MAT);
      add2DSegment(annotation.dimensionLine[0], annotation.dimensionLine[1], PENDING_DIMENSION_CALLOUT_MAT);

      const dimStart = annotation.dimensionLine[0];
      const dimEnd = annotation.dimensionLine[1];
      const axis = new THREE.Vector2(dimEnd.x - dimStart.x, dimEnd.y - dimStart.y);
      const axisLength = axis.length();
      if (axisLength > 1e-6) {
        axis.normalize();
        const normal = new THREE.Vector2(-axis.y, axis.x);
        const arrow = Math.min(2, Math.max(0.8, axisLength * 0.08));
        const addArrow = (tip: { x: number; y: number }, direction: THREE.Vector2) => {
          const back = direction.clone().multiplyScalar(arrow);
          const wing = normal.clone().multiplyScalar(arrow * 0.45);
          add2DSegment(tip, { x: tip.x + back.x + wing.x, y: tip.y + back.y + wing.y }, PENDING_DIMENSION_CALLOUT_MAT);
          add2DSegment(tip, { x: tip.x + back.x - wing.x, y: tip.y + back.y - wing.y }, PENDING_DIMENSION_CALLOUT_MAT);
        };
        addArrow(dimStart, axis);
        addArrow(dimEnd, axis.clone().multiplyScalar(-1));
      }

      previewLabels.push({
        id,
        position: toWorld(annotation.textPosition),
        text: DimensionEngine.formatDimensionValue(annotation.value, 'mm', 2),
      });
    };
    const resolvePendingSegment = (pendingId: string) => {
      if (pendingId.includes('::vertex:')) {
        const [entityId, vertexPart] = pendingId.split('::vertex:');
        const entity = entityMap.get(entityId);
        const index = Number(vertexPart);
        if (!entity || !Number.isInteger(index) || index < 0 || index >= entity.points.length) return null;
        const point = entity.points[index];
        const position = new THREE.Vector3(point.x, point.y, point.z);
        return { id: pendingId, start: position, end: position };
      }

      if (pendingId.includes('::center')) {
        const entityId = pendingId.split('::center')[0];
        const entity = entityMap.get(entityId);
        if (!entity || !entity.points[0]) return null;
        const point = entity.points[0];
        const position = new THREE.Vector3(point.x, point.y, point.z);
        return { id: pendingId, start: position, end: position };
      }

      const [entityId, edgePart] = pendingId.split('::edge:');
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
        return { id: pendingId, start: corners[edgeIndex], end: corners[(edgeIndex + 1) % corners.length] };
      }

      if (
        (entity.type === 'line' || entity.type === 'construction-line' || entity.type === 'centerline') &&
        entity.points.length >= 2
      ) {
        const startPoint = entity.points[0];
        const endPoint = entity.points[entity.points.length - 1];
        return {
          id: pendingId,
          start: new THREE.Vector3(startPoint.x, startPoint.y, startPoint.z),
          end: new THREE.Vector3(endPoint.x, endPoint.y, endPoint.z),
        };
      }

      return null;
    };
    const addTwoLinePreview = (
      first: { id: string; start: THREE.Vector3; end: THREE.Vector3 },
      second: { id: string; start: THREE.Vector3; end: THREE.Vector3 },
    ) => {
      const firstStart = to2D(first.start);
      const firstEnd = to2D(first.end);
      const secondStart = to2D(second.start);
      const secondEnd = to2D(second.end);
      const firstHorizontal = Math.abs(firstEnd.x - firstStart.x) >= Math.abs(firstEnd.y - firstStart.y);
      const secondHorizontal = Math.abs(secondEnd.x - secondStart.x) >= Math.abs(secondEnd.y - secondStart.y);
      if (firstHorizontal !== secondHorizontal) return false;

      addSegment(first.start, first.end, PENDING_DIMENSION_LINE_MAT);
      addSegment(second.start, second.end, PENDING_DIMENSION_LINE_MAT);

      if (firstHorizontal) {
        const y1 = (firstStart.y + firstEnd.y) / 2;
        const y2 = (secondStart.y + secondEnd.y) / 2;
        const x = Math.min(firstStart.x, firstEnd.x, secondStart.x, secondEnd.x) - Math.abs(dimensionOffset);
        const lowY = Math.min(y1, y2);
        const highY = Math.max(y1, y2);
        const firstNearX = Math.abs(firstStart.x - x) <= Math.abs(firstEnd.x - x) ? firstStart.x : firstEnd.x;
        const secondNearX = Math.abs(secondStart.x - x) <= Math.abs(secondEnd.x - x) ? secondStart.x : secondEnd.x;
        add2DSegment({ x: firstNearX, y: y1 }, { x, y: y1 }, PENDING_DIMENSION_CALLOUT_MAT);
        add2DSegment({ x: secondNearX, y: y2 }, { x, y: y2 }, PENDING_DIMENSION_CALLOUT_MAT);
        add2DSegment({ x, y: lowY }, { x, y: highY }, PENDING_DIMENSION_CALLOUT_MAT);
        const arrow = Math.min(2, Math.max(0.8, Math.abs(highY - lowY) * 0.08));
        add2DSegment({ x, y: lowY }, { x: x - arrow * 0.45, y: lowY + arrow }, PENDING_DIMENSION_CALLOUT_MAT);
        add2DSegment({ x, y: lowY }, { x: x + arrow * 0.45, y: lowY + arrow }, PENDING_DIMENSION_CALLOUT_MAT);
        add2DSegment({ x, y: highY }, { x: x - arrow * 0.45, y: highY - arrow }, PENDING_DIMENSION_CALLOUT_MAT);
        add2DSegment({ x, y: highY }, { x: x + arrow * 0.45, y: highY - arrow }, PENDING_DIMENSION_CALLOUT_MAT);
        previewLabels.push({
          id: `${first.id}-${second.id}`,
          position: toWorld({ x, y: (lowY + highY) / 2 }),
          text: DimensionEngine.formatDimensionValue(Math.abs(y2 - y1), 'mm', 2),
        });
        return true;
      }

      const x1 = (firstStart.x + firstEnd.x) / 2;
      const x2 = (secondStart.x + secondEnd.x) / 2;
      const y = Math.max(firstStart.y, firstEnd.y, secondStart.y, secondEnd.y) + Math.abs(dimensionOffset);
      const lowX = Math.min(x1, x2);
      const highX = Math.max(x1, x2);
      const firstNearY = Math.abs(firstStart.y - y) <= Math.abs(firstEnd.y - y) ? firstStart.y : firstEnd.y;
      const secondNearY = Math.abs(secondStart.y - y) <= Math.abs(secondEnd.y - y) ? secondStart.y : secondEnd.y;
      add2DSegment({ x: x1, y: firstNearY }, { x: x1, y }, PENDING_DIMENSION_CALLOUT_MAT);
      add2DSegment({ x: x2, y: secondNearY }, { x: x2, y }, PENDING_DIMENSION_CALLOUT_MAT);
      add2DSegment({ x: lowX, y }, { x: highX, y }, PENDING_DIMENSION_CALLOUT_MAT);
      const arrow = Math.min(2, Math.max(0.8, Math.abs(highX - lowX) * 0.08));
      add2DSegment({ x: lowX, y }, { x: lowX + arrow, y: y - arrow * 0.45 }, PENDING_DIMENSION_CALLOUT_MAT);
      add2DSegment({ x: lowX, y }, { x: lowX + arrow, y: y + arrow * 0.45 }, PENDING_DIMENSION_CALLOUT_MAT);
      add2DSegment({ x: highX, y }, { x: highX - arrow, y: y - arrow * 0.45 }, PENDING_DIMENSION_CALLOUT_MAT);
      add2DSegment({ x: highX, y }, { x: highX - arrow, y: y + arrow * 0.45 }, PENDING_DIMENSION_CALLOUT_MAT);
      previewLabels.push({
        id: `${first.id}-${second.id}`,
        position: toWorld({ x: (lowX + highX) / 2, y }),
        text: DimensionEngine.formatDimensionValue(Math.abs(x2 - x1), 'mm', 2),
      });
      return true;
    };
    const addAnglePreview = (
      first: { id: string; start: THREE.Vector3; end: THREE.Vector3 },
      second: { id: string; start: THREE.Vector3; end: THREE.Vector3 },
    ) => {
      const firstStart = to2D(first.start);
      const firstEnd = to2D(first.end);
      const secondStart = to2D(second.start);
      const secondEnd = to2D(second.end);
      const firstHorizontal = Math.abs(firstEnd.x - firstStart.x) >= Math.abs(firstEnd.y - firstStart.y);
      const secondHorizontal = Math.abs(secondEnd.x - secondStart.x) >= Math.abs(secondEnd.y - secondStart.y);
      if (firstHorizontal === secondHorizontal) return false;
      const vertex = lineIntersection(firstStart, firstEnd, secondStart, secondEnd);
      if (!vertex) return false;

      addSegment(first.start, first.end, PENDING_DIMENSION_LINE_MAT);
      addSegment(second.start, second.end, PENDING_DIMENSION_LINE_MAT);

      const radius = Math.max(1, Math.abs(dimensionOffset) * 2);
      const annotation = DimensionEngine.computeAngleDimension(
        vertex,
        fartherFromVertex(vertex, firstStart, firstEnd),
        fartherFromVertex(vertex, secondStart, secondEnd),
        radius,
      );
      const { cx, cy, r, startAngle, endAngle } = annotation.annotationArc;
      const radialStart = { x: cx + r * Math.cos(startAngle), y: cy + r * Math.sin(startAngle) };
      const radialEnd = { x: cx + r * Math.cos(endAngle), y: cy + r * Math.sin(endAngle) };
      add2DSegment(vertex, radialStart, PENDING_DIMENSION_CALLOUT_MAT);
      add2DSegment(vertex, radialEnd, PENDING_DIMENSION_CALLOUT_MAT);
      const segmentCount = 24;
      for (let i = 0; i < segmentCount; i += 1) {
        const a0 = startAngle + (i / segmentCount) * (endAngle - startAngle);
        const a1 = startAngle + ((i + 1) / segmentCount) * (endAngle - startAngle);
        add2DSegment(
          { x: cx + r * Math.cos(a0), y: cy + r * Math.sin(a0) },
          { x: cx + r * Math.cos(a1), y: cy + r * Math.sin(a1) },
          PENDING_DIMENSION_CALLOUT_MAT,
        );
      }
      previewLabels.push({
        id: `${first.id}-${second.id}-angle`,
        position: toWorld(annotation.textPosition),
        text: `${annotation.value.toFixed(2)}°`,
      });
      return true;
    };

    const resolvedSegments = pendingIds.map(resolvePendingSegment).filter(Boolean) as Array<{
      id: string;
      start: THREE.Vector3;
      end: THREE.Vector3;
    }>;
    if (resolvedSegments.length >= 2 && addTwoLinePreview(resolvedSegments[0], resolvedSegments[1])) {
      return { group: highlightGroup, labels: previewLabels };
    };
    if (resolvedSegments.length >= 2 && addAnglePreview(resolvedSegments[0], resolvedSegments[1])) {
      return { group: highlightGroup, labels: previewLabels };
    };

    for (const pendingId of pendingIds) {
      const segment = resolvePendingSegment(pendingId);
      if (!segment) continue;
      addSegment(segment.start, segment.end, PENDING_DIMENSION_LINE_MAT);
      addLinearPreview(pendingId, segment.start, segment.end);
    }

    return { group: highlightGroup, labels: previewLabels };
  }, [activeDimensionType, dimensionOffset, dimensionOrientation, isEditing, pendingIds, sketch]);

  useEffect(() => {
    return () => disposeLineGeometries(group);
  }, [group]);

  return (
    <group>
      <primitive object={group} />
      {labels.map((label) => (
        <Html key={label.id} position={label.position} center style={{ pointerEvents: 'none' }}>
          <div style={pendingDimensionLabelStyle}>{label.text}</div>
        </Html>
      ))}
    </group>
  );
}

export default function SketchRenderer() {
  const activeSketch = useCADStore((s) => s.activeSketch);
  const features = useCADStore((s) => s.features);
  const sketches = useCADStore((s) => s.sketches);
  const showProfile = useCADStore((s) => s.showSketchProfile);
  const showSketchPoints = useCADStore((s) => s.showSketchPoints);
  const showConstructionGeometries = useCADStore((s) => s.showConstructionGeometries);
  const entityVisSketchBodies = useCADStore((s) => s.entityVisSketchBodies);
  const pendingDimensionEntityIds = useCADStore((s) => s.pendingDimensionEntityIds);
  const dimensionHoverEntityId = useCADStore((s) => s.dimensionHoverEntityId);
  const selectedEntityIds = useCADStore((s) => s.selectedEntityIds);
  const sketchDimEditId = useCADStore((s) => s.sketchDimEditId);
  const activeDimensionType = useCADStore((s) => s.activeDimensionType);
  const dimensionOffset = useCADStore((s) => s.dimensionOffset);
  const dimensionOrientation = useCADStore((s) => s.dimensionOrientation);
  const rollbackIndex = useCADStore((s) => s.rollbackIndex);
  const components = useComponentStore((s) => s.components);
  const activeSketchComponentVisible = !activeSketch || isComponentVisible(components, activeSketch.componentId);

  const profileMaterial = useMemo(() => new THREE.MeshBasicMaterial({
    color: 0x3a7fcc, opacity: 0.25, transparent: true, side: THREE.DoubleSide, depthWrite: false,
  }), []);

  const profileMesh = useMemo(() => {
    if (!showProfile || !activeSketch || !activeSketchComponentVisible) return null;
    return GeometryEngine.createSketchProfileMesh(activeSketch, profileMaterial);
  }, [showProfile, activeSketch, activeSketchComponentVisible, profileMaterial]);

  useEffect(() => {
    return () => {
      if (profileMesh) profileMesh.geometry.dispose();
    };
  }, [profileMesh]);

  // Dispose the per-component profileMaterial on unmount. Without this the
  // MeshBasicMaterial leaks GPU state every time SketchRenderer remounts
  // (e.g. after dialog open/close cycles that toggle the viewport tree).
  useEffect(() => {
    return () => {
      profileMaterial.dispose();
    };
  }, [profileMaterial]);

  return (
    <>
      {entityVisSketchBodies && features.filter((f, i) => {
        // D187 suppress + D190 rollback + visibility
        if (f.type !== 'sketch' || !f.visible || f.suppressed) return false;
        if (rollbackIndex >= 0 && i > rollbackIndex) return false;
        return true;
      }).map((feature) => {
        const sketch = sketches.find(s => s.id === feature.sketchId);
        if (!sketch) return null;
        if (!isComponentVisible(components, sketch.componentId ?? feature.componentId)) return null;
        return <SketchGeometry key={feature.id} sketch={sketch} />;
      })}
      {activeSketch && activeSketchComponentVisible && activeSketch.entities.length > 0 && (
        <>
          <ActiveSketchGeometry
            sketch={activeSketch}
            showSketchPoints={showSketchPoints}
            showConstructionGeometries={showConstructionGeometries}
          />
          {dimensionHoverEntityId && !pendingDimensionEntityIds.includes(dimensionHoverEntityId) && (
            <DimensionHoverHighlight sketch={activeSketch} hoverId={dimensionHoverEntityId} />
          )}
          {selectedEntityIds.length > 0 && (
            <SelectedSketchEntitiesHighlight sketch={activeSketch} selectedIds={selectedEntityIds} />
          )}
          {pendingDimensionEntityIds.length > 0 && (
            <PendingDimensionHighlight
              sketch={activeSketch}
              pendingIds={pendingDimensionEntityIds}
              dimensionOffset={dimensionOffset}
              dimensionOrientation={dimensionOrientation}
              activeDimensionType={activeDimensionType}
              isEditing={!!sketchDimEditId}
            />
          )}
        </>
      )}
      {profileMesh && <primitive key={`profile-${activeSketch?.id}-${activeSketch?.entities.length}`} object={profileMesh} />}
    </>
  );
}
