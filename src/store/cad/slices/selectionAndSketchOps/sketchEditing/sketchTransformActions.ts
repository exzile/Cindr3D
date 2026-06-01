import { GeometryEngine } from '../../../../../engine/GeometryEngine';
import { buildSketchMirrorResult } from '../../../../../engine/sketchMirror';
import type { SketchConstraint, SketchEntity, SketchPoint } from '../../../../../types/cad';
import type { CADSliceContext } from '../../../sliceContext';
import type { CADState } from '../../../state';

export function createSketchTransformActions({ set, get }: CADSliceContext): Partial<CADState> {
  return {
    sketchMoveDx: 10,
    sketchMoveDy: 0,
    sketchMoveCopy: false,
    setSketchMove: (params) =>
      set((state) => ({
        sketchMoveDx: params.dx ?? state.sketchMoveDx,
        sketchMoveDy: params.dy ?? state.sketchMoveDy,
        sketchMoveCopy: params.copy ?? state.sketchMoveCopy,
      })),
    commitSketchMove: () => {
      const { activeSketch, sketchMoveDx: dx, sketchMoveDy: dy, sketchMoveCopy: copy } = get();
      if (!activeSketch || activeSketch.entities.length === 0) return;
      const { t1, t2 } = GeometryEngine.getSketchAxes(activeSketch);
      const offsetX = t1.x * dx + t2.x * dy;
      const offsetY = t1.y * dx + t2.y * dy;
      const offsetZ = t1.z * dx + t2.z * dy;
      const translatePts = (ents: SketchEntity[]): SketchEntity[] =>
        ents.map((e) => ({
          ...e,
          id: crypto.randomUUID(),
          points: e.points.map((p) => ({ ...p, id: crypto.randomUUID(), x: p.x + offsetX, y: p.y + offsetY, z: p.z + offsetZ })),
        }));
      const translated = translatePts(activeSketch.entities);
      set({
        activeSketch: { ...activeSketch, entities: copy ? [...activeSketch.entities, ...translated] : translated },
        statusMessage: copy ? `Copy moved by (${dx}, ${dy})` : `Sketch moved by (${dx}, ${dy})`,
      });
    },

    sketchScaleFactor: 2,
    setSketchScaleFactor: (f) => set({ sketchScaleFactor: Math.max(0.001, f) }),
    commitSketchScale: () => {
      const { activeSketch, sketchScaleFactor: factor } = get();
      if (!activeSketch || activeSketch.entities.length === 0) return;
      let cx = 0, cy2 = 0, cz = 0, n = 0;
      for (const e of activeSketch.entities) {
        for (const p of e.points) { cx += p.x; cy2 += p.y; cz += p.z; n++; }
      }
      if (n === 0) return;
      cx /= n; cy2 /= n; cz /= n;
      const scaled = activeSketch.entities.map((e) => ({
        ...e,
        id: crypto.randomUUID(),
        points: e.points.map((p) => ({
          ...p,
          id: crypto.randomUUID(),
          x: cx + (p.x - cx) * factor,
          y: cy2 + (p.y - cy2) * factor,
          z: cz + (p.z - cz) * factor,
        })),
        radius: e.radius !== undefined ? Math.abs(e.radius * factor) : undefined,
      }));
      set({
        activeSketch: { ...activeSketch, entities: scaled },
        statusMessage: `Sketch scaled by ${factor}x`,
      });
    },

    sketchRotateAngle: 90,
    setSketchRotateAngle: (a) => set({ sketchRotateAngle: a }),
    commitSketchRotate: () => {
      const { activeSketch, sketchRotateAngle: angleDeg } = get();
      if (!activeSketch || activeSketch.entities.length === 0) return;
      const { t1, t2 } = GeometryEngine.getSketchAxes(activeSketch);
      let cx = 0, cy2 = 0, cz = 0, n = 0;
      for (const e of activeSketch.entities) {
        for (const p of e.points) { cx += p.x; cy2 += p.y; cz += p.z; n++; }
      }
      if (n === 0) return;
      cx /= n; cy2 /= n; cz /= n;
      const angle = (angleDeg * Math.PI) / 180;
      const cosA = Math.cos(angle), sinA = Math.sin(angle);
      const rotPt = (p: SketchPoint): SketchPoint => {
        const lx = (p.x - cx) * t1.x + (p.y - cy2) * t1.y + (p.z - cz) * t1.z;
        const ly = (p.x - cx) * t2.x + (p.y - cy2) * t2.y + (p.z - cz) * t2.z;
        const rx = lx * cosA - ly * sinA;
        const ry = lx * sinA + ly * cosA;
        return { ...p, id: crypto.randomUUID(), x: cx + t1.x * rx + t2.x * ry, y: cy2 + t1.y * rx + t2.y * ry, z: cz + t1.z * rx + t2.z * ry };
      };
      const rotated = activeSketch.entities.map((e) => ({
        ...e,
        id: crypto.randomUUID(),
        points: e.points.map(rotPt),
      }));
      set({
        activeSketch: { ...activeSketch, entities: rotated },
        statusMessage: `Sketch rotated ${angleDeg} degrees`,
      });
    },

    sketchOffsetDistance: 2,
    setSketchOffsetDistance: (d) => set({ sketchOffsetDistance: Math.max(0.001, Math.abs(d)) }),

    sketchMirrorAxis: 'vertical',
    sketchMirrorObjectIds: [],
    sketchMirrorLineId: null,
    sketchMirrorSelectionMode: 'objects',
    setSketchMirrorAxis: (axis) => set({ sketchMirrorAxis: axis }),
    setSketchMirrorObjectIds: (ids) => set({ sketchMirrorObjectIds: Array.from(new Set(ids)) }),
    toggleSketchMirrorObjectId: (id) =>
      set((state) => {
        const current = state.sketchMirrorObjectIds ?? [];
        return {
          sketchMirrorObjectIds: current.includes(id)
            ? current.filter((existing) => existing !== id)
            : [...current, id],
        };
      }),
    setSketchMirrorLineId: (id) => set({ sketchMirrorLineId: id, sketchMirrorAxis: id ?? 'vertical' }),
    setSketchMirrorSelectionMode: (mode) => set({ sketchMirrorSelectionMode: mode }),
    clearSketchMirrorSelections: () => set({ sketchMirrorObjectIds: [], sketchMirrorLineId: null, sketchMirrorAxis: 'vertical' }),
    commitSketchMirror: () => {
      const { activeSketch, sketchMirrorAxis, sketchMirrorObjectIds = [], sketchMirrorLineId } = get();
      if (!activeSketch || activeSketch.entities.length === 0) return;
      const mirror = buildSketchMirrorResult(activeSketch, {
        axis: sketchMirrorAxis,
        lineId: sketchMirrorLineId,
        objectIds: sketchMirrorObjectIds,
      });
      if (!mirror) {
        set({ statusMessage: 'Mirror: select objects and a valid mirror line' });
        return;
      }
      const { mirrored, idMap, reflectLocal, mirrorPoint, label } = mirror;

      const mirroredConstraints = activeSketch.constraints
        .filter((constraint) => (
          constraint.entityIds.length > 0
          && constraint.entityIds.every((id) => idMap.has(id))
        ))
        .map((constraint) => ({
          ...constraint,
          id: crypto.randomUUID(),
          entityIds: constraint.entityIds.map((id) => idMap.get(id)!),
          polygonMeta: constraint.polygonMeta
            ? {
                ...constraint.polygonMeta,
                center: mirrorPoint({ id: crypto.randomUUID(), ...constraint.polygonMeta.center }),
              }
            : undefined,
        }));

      const mirroredDimensions = activeSketch.dimensions
        .filter((dimension) => (
          dimension.entityIds.length > 0
          && dimension.entityIds.every((id) => idMap.has(id))
        ))
        .map((dimension) => {
          const position = reflectLocal(dimension.position.x, dimension.position.y);
          return {
            ...dimension,
            id: crypto.randomUUID(),
            entityIds: dimension.entityIds.map((id) => idMap.get(id)!),
            position: { x: position.lx, y: position.ly },
          };
        });

      // One mirror constraint per original↔mirrored pair so the overlay can
      // render the reflection-arrow glyph on both sides.
      const pairConstraints: SketchConstraint[] = [];
      for (const [origId, mirId] of idMap) {
        pairConstraints.push({
          id: crypto.randomUUID(),
          type: 'mirror',
          entityIds: sketchMirrorLineId
            ? [origId, mirId, sketchMirrorLineId]
            : [origId, mirId],
        });
      }

      const mirroredIds = mirrored.map((entity) => entity.id);
      set({
        activeSketch: {
          ...activeSketch,
          entities: [...activeSketch.entities, ...mirrored],
          constraints: [...activeSketch.constraints, ...mirroredConstraints, ...pairConstraints],
          dimensions: [...activeSketch.dimensions, ...mirroredDimensions],
        },
        selectedEntityIds: mirroredIds,
        sketchMirrorObjectIds: mirroredIds,
        statusMessage: `Mirror: ${mirrored.length} entities added (${label})`,
      });
    },
  };
}
