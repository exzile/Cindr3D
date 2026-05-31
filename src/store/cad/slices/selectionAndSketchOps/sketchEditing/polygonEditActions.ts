import * as THREE from 'three';
import { GeometryEngine } from '../../../../../engine/GeometryEngine';
import type { SketchConstraint, SketchEntity, SketchPoint } from '../../../../../types/cad';
import type { CADSliceContext } from '../../../sliceContext';
import type { CADState } from '../../../state';
import { upsertSketch } from '../../sketchLifecycle/helpers';

export function createPolygonEditActions({ set, get }: CADSliceContext): Partial<CADState> {
  return {
    editingPolygonConstraintId: null,
    setEditingPolygonConstraintId: (id) => set({ editingPolygonConstraintId: id }),

    regeneratePolygon: (constraintId, newSidesRaw) => {
      const { activeSketch, sketches } = get();
      if (!activeSketch) return;
      const con = activeSketch.constraints.find((c) => c.id === constraintId && c.type === 'polygon');
      if (!con) return;

      const sides = Math.max(3, Math.min(128, Math.round(newSidesRaw)));
      if (sides === con.entityIds.length) return; // nothing to change

      const { t1, t2 } = GeometryEngine.getSketchAxes(activeSketch);

      // Resolve center / size / base angle / kind from the stored metadata,
      // falling back to deriving them from the existing member-line vertices.
      let center: THREE.Vector3;
      let radius: number;
      let baseAngle: number;
      let kind: 'inscribed' | 'circumscribed' = 'inscribed';
      if (con.polygonMeta) {
        const m = con.polygonMeta;
        center = new THREE.Vector3(m.center.x, m.center.y, m.center.z);
        radius = m.radius;
        baseAngle = m.baseAngle;
        kind = m.kind ?? 'inscribed';
      } else {
        const memberLines = con.entityIds
          .map((id) => activeSketch.entities.find((e) => e.id === id))
          .filter((e): e is SketchEntity => !!e && e.points.length >= 1);
        if (memberLines.length < 3) return;
        const verts = memberLines.map((l) => new THREE.Vector3(l.points[0].x, l.points[0].y, l.points[0].z));
        center = new THREE.Vector3();
        for (const v of verts) center.add(v);
        center.divideScalar(verts.length);
        radius = verts.reduce((s, v) => s + v.distanceTo(center), 0) / verts.length;
        const d0 = verts[0].clone().sub(center);
        baseAngle = Math.atan2(d0.dot(t2), d0.dot(t1));
      }
      if (radius < 1e-6) return;

      // Regenerate vertices so the kind's defining circle stays fixed when the
      // side count changes: inscribed keeps the circumscribing circle (radius =
      // circumradius); circumscribed keeps the inscribed circle (radius = apothem,
      // circumradius = apothem / cos(π/n), edge midpoints anchored at baseAngle).
      const circumR = kind === 'circumscribed' ? radius / Math.cos(Math.PI / sides) : radius;
      const angleOffset = kind === 'circumscribed' ? -Math.PI / sides : 0;
      const verts: THREE.Vector3[] = [];
      for (let i = 0; i < sides; i++) {
        const a = baseAngle + angleOffset + (i / sides) * Math.PI * 2;
        verts.push(center.clone().addScaledVector(t1, Math.cos(a) * circumR).addScaledVector(t2, Math.sin(a) * circumR));
      }

      const newLineIds: string[] = [];
      const newLines: SketchEntity[] = [];
      for (let i = 0; i < sides; i++) {
        const a = verts[i];
        const b = verts[(i + 1) % sides];
        const id = crypto.randomUUID();
        newLineIds.push(id);
        const p1: SketchPoint = { id: crypto.randomUUID(), x: a.x, y: a.y, z: a.z };
        const p2: SketchPoint = { id: crypto.randomUUID(), x: b.x, y: b.y, z: b.z };
        newLines.push({ id, type: 'line', points: [p1, p2] });
      }

      // Drop the old member lines and any constraint that referenced them.
      const memberIdSet = new Set(con.entityIds);
      const remainingEntities = activeSketch.entities.filter((e) => !memberIdSet.has(e.id));
      const remainingConstraints = activeSketch.constraints.filter(
        (c) => c.id !== constraintId && c.entityIds.every((id) => !memberIdSet.has(id)),
      );

      const newConstraints: SketchConstraint[] = [];
      for (let i = 0; i < sides; i++) {
        newConstraints.push({
          id: crypto.randomUUID(), type: 'coincident',
          entityIds: [newLineIds[i], newLineIds[(i + 1) % sides]], pointIndices: [1, 0],
        });
      }
      for (let i = 1; i < sides; i++) {
        newConstraints.push({ id: crypto.randomUUID(), type: 'equal', entityIds: [newLineIds[0], newLineIds[i]] });
      }
      const newPolygonConstraintId = crypto.randomUUID();
      newConstraints.push({
        id: newPolygonConstraintId, type: 'polygon', entityIds: newLineIds,
        polygonMeta: { center: { x: center.x, y: center.y, z: center.z }, radius, baseAngle, kind },
      });

      get().pushUndo();
      const nextSketch = {
        ...activeSketch,
        entities: [...remainingEntities, ...newLines],
        constraints: [...remainingConstraints, ...newConstraints],
      };
      set({
        activeSketch: nextSketch,
        sketches: upsertSketch(sketches, nextSketch),
        editingPolygonConstraintId: newPolygonConstraintId,
        sketchPolygonSides: sides,
        statusMessage: `Polygon updated to ${sides} sides`,
      });
    },

    regenerateRectangle: (constraintId, widthRaw, heightRaw) => {
      const { activeSketch, sketches } = get();
      if (!activeSketch) return;
      const con = activeSketch.constraints.find((c) => c.id === constraintId && c.type === 'rectangle');
      if (!con) return;

      const width = Math.max(0.001, widthRaw);
      const height = Math.max(0.001, heightRaw);
      const { t1, t2 } = GeometryEngine.getSketchAxes(activeSketch);

      // Resolve center / rotation from metadata, else derive from the member-line
      // corner vertices (axis-aligned fallback).
      let center: THREE.Vector3;
      let rotation: number;
      if (con.rectangleMeta) {
        const m = con.rectangleMeta;
        center = new THREE.Vector3(m.center.x, m.center.y, m.center.z);
        rotation = m.rotation;
      } else {
        const corners = con.entityIds
          .map((id) => activeSketch.entities.find((e) => e.id === id))
          .filter((e): e is SketchEntity => !!e && e.points.length >= 1)
          .map((l) => new THREE.Vector3(l.points[0].x, l.points[0].y, l.points[0].z));
        if (corners.length < 4) return;
        center = new THREE.Vector3();
        for (const v of corners) center.add(v);
        center.divideScalar(corners.length);
        const d0 = corners[0].clone().sub(center);
        rotation = Math.atan2(d0.dot(t2), d0.dot(t1));
      }

      const baseDir = t1.clone().multiplyScalar(Math.cos(rotation)).add(t2.clone().multiplyScalar(Math.sin(rotation)));
      const perpDir = t1.clone().multiplyScalar(-Math.sin(rotation)).add(t2.clone().multiplyScalar(Math.cos(rotation)));
      const hw = width / 2;
      const hh = height / 2;
      const corners = [
        center.clone().addScaledVector(baseDir, -hw).addScaledVector(perpDir, -hh),
        center.clone().addScaledVector(baseDir, hw).addScaledVector(perpDir, -hh),
        center.clone().addScaledVector(baseDir, hw).addScaledVector(perpDir, hh),
        center.clone().addScaledVector(baseDir, -hw).addScaledVector(perpDir, hh),
      ];

      const newLineIds: string[] = [];
      const newLines: SketchEntity[] = [];
      for (let i = 0; i < 4; i++) {
        const a = corners[i];
        const b = corners[(i + 1) % 4];
        const id = crypto.randomUUID();
        newLineIds.push(id);
        const p1: SketchPoint = { id: crypto.randomUUID(), x: a.x, y: a.y, z: a.z };
        const p2: SketchPoint = { id: crypto.randomUUID(), x: b.x, y: b.y, z: b.z };
        newLines.push({ id, type: 'line', points: [p1, p2] });
      }

      const memberIdSet = new Set(con.entityIds);
      const remainingEntities = activeSketch.entities.filter((e) => !memberIdSet.has(e.id));
      const remainingConstraints = activeSketch.constraints.filter(
        (c) => c.id !== constraintId && c.entityIds.every((id) => !memberIdSet.has(id)),
      );

      const newConstraints: SketchConstraint[] = [];
      for (let i = 0; i < 4; i++) {
        newConstraints.push({
          id: crypto.randomUUID(), type: 'coincident',
          entityIds: [newLineIds[i], newLineIds[(i + 1) % 4]], pointIndices: [1, 0],
        });
      }
      const newRectConstraintId = crypto.randomUUID();
      newConstraints.push({
        id: newRectConstraintId, type: 'rectangle', entityIds: newLineIds,
        rectangleMeta: { center: { x: center.x, y: center.y, z: center.z }, width, height, rotation },
      });

      get().pushUndo();
      const nextSketch = {
        ...activeSketch,
        entities: [...remainingEntities, ...newLines],
        constraints: [...remainingConstraints, ...newConstraints],
      };
      set({
        activeSketch: nextSketch,
        sketches: upsertSketch(sketches, nextSketch),
        editingPolygonConstraintId: newRectConstraintId,
        statusMessage: `Rectangle updated to ${width.toFixed(2)} × ${height.toFixed(2)}`,
      });
    },

    regenerateSlot: (constraintId, lengthRaw, widthRaw) => {
      const { activeSketch, sketches } = get();
      if (!activeSketch) return;
      const con = activeSketch.constraints.find((c) => c.id === constraintId && c.type === 'slot');
      if (!con || !con.slotMeta) return;

      const length = Math.max(0.001, lengthRaw);
      const width = Math.max(0.001, widthRaw);
      const { t1, t2 } = GeometryEngine.getSketchAxes(activeSketch);
      const m = con.slotMeta;
      const center = new THREE.Vector3(m.center.x, m.center.y, m.center.z);
      const rotation = m.rotation;

      const axisDir = t1.clone().multiplyScalar(Math.cos(rotation)).add(t2.clone().multiplyScalar(Math.sin(rotation)));
      const perpDir = t1.clone().multiplyScalar(-Math.sin(rotation)).add(t2.clone().multiplyScalar(Math.cos(rotation)));
      const halfWidth = width / 2;
      const c1 = center.clone().addScaledVector(axisDir, -length / 2); // back cap centre
      const c2 = center.clone().addScaledVector(axisDir, length / 2);  // front cap centre
      const axisAngle = Math.atan2(axisDir.dot(t2), axisDir.dot(t1));

      const sp = (v: THREE.Vector3): SketchPoint => ({ id: crypto.randomUUID(), x: v.x, y: v.y, z: v.z });
      const sideA1 = c1.clone().addScaledVector(perpDir, halfWidth);
      const sideA2 = c2.clone().addScaledVector(perpDir, halfWidth);
      const sideB1 = c1.clone().addScaledVector(perpDir, -halfWidth);
      const sideB2 = c2.clone().addScaledVector(perpDir, -halfWidth);

      const lineA = crypto.randomUUID();
      const lineB = crypto.randomUUID();
      const arc1 = crypto.randomUUID();
      const arc2 = crypto.randomUUID();
      const newEntities: SketchEntity[] = [
        { id: lineA, type: 'line', points: [sp(sideA1), sp(sideA2)] },
        { id: lineB, type: 'line', points: [sp(sideB1), sp(sideB2)] },
        // Cap arcs anchored to the axis so they bulge outward (C4 convention).
        { id: arc1, type: 'arc', points: [sp(c1)], radius: halfWidth, startAngle: axisAngle + Math.PI / 2, endAngle: axisAngle + (3 * Math.PI) / 2 },
        { id: arc2, type: 'arc', points: [sp(c2)], radius: halfWidth, startAngle: axisAngle - Math.PI / 2, endAngle: axisAngle + Math.PI / 2 },
      ];
      const newIds = [lineA, lineB, arc1, arc2];

      const memberIdSet = new Set(con.entityIds);
      const remainingEntities = activeSketch.entities.filter((e) => !memberIdSet.has(e.id));
      const remainingConstraints = activeSketch.constraints.filter(
        (c) => c.id !== constraintId && c.entityIds.every((id) => !memberIdSet.has(id)),
      );

      const newSlotConstraintId = crypto.randomUUID();
      const slotConstraint: SketchConstraint = {
        id: newSlotConstraintId, type: 'slot', entityIds: newIds,
        slotMeta: { center: { x: center.x, y: center.y, z: center.z }, length, width, rotation },
      };

      get().pushUndo();
      const nextSketch = {
        ...activeSketch,
        entities: [...remainingEntities, ...newEntities],
        constraints: [...remainingConstraints, slotConstraint],
      };
      set({
        activeSketch: nextSketch,
        sketches: upsertSketch(sketches, nextSketch),
        editingPolygonConstraintId: newSlotConstraintId,
        statusMessage: `Slot updated to ${length.toFixed(2)} × ${width.toFixed(2)}`,
      });
    },
  };
}
