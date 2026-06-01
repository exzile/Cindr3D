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
      // Reuse the original constraintId so editingPolygonConstraintId stays valid
      // and the <Html> editor portal keeps its DOM identity — no remount flash.
      newConstraints.push({
        id: constraintId, type: 'polygon', entityIds: newLineIds,
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
        editingPolygonConstraintId: constraintId,
        sketchPolygonSides: sides,
        statusMessage: `Polygon updated to ${sides} sides`,
      });
    },

  };
}
