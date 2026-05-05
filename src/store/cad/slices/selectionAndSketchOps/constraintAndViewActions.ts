import { GeometryEngine } from '../../../../engine/GeometryEngine';
import { dimensionsToSolverConstraints, solveConstraints } from '../../../../engine/ConstraintSolver';
import type { SketchConstraint } from '../../../../types/cad';
import type { CADSliceContext } from '../../sliceContext';
import type { CADState } from '../../state';

export function createConstraintAndViewActions({ set, get }: CADSliceContext): Partial<CADState> {
  return {
    autoConstrainSketch: () => {
      const { activeSketch } = get();
      if (!activeSketch) return;
      const TOL = 0.5;
      const ANGLE_TOL = 0.01;
      const newConstraints: SketchConstraint[] = [];
      const lines = activeSketch.entities.filter(
        (e) => (e.type === 'line' || e.type === 'construction-line' || e.type === 'centerline') && e.points.length >= 2,
      );

      for (const e of lines) {
        const p0 = e.points[0];
        const p1 = e.points[e.points.length - 1];
        const dx = p1.x - p0.x;
        const dy = p1.y - p0.y;
        const dz = p1.z - p0.z;

        if (Math.abs(dy) < TOL && Math.abs(dz) < TOL) {
          const alreadyHas = activeSketch.constraints.some((c) => c.type === 'horizontal' && c.entityIds.includes(e.id));
          if (!alreadyHas) newConstraints.push({ id: crypto.randomUUID(), type: 'horizontal', entityIds: [e.id] });
        }
        if (Math.abs(dx) < TOL && Math.abs(dz) < TOL) {
          const alreadyHas = activeSketch.constraints.some((c) => c.type === 'vertical' && c.entityIds.includes(e.id));
          if (!alreadyHas) newConstraints.push({ id: crypto.randomUUID(), type: 'vertical', entityIds: [e.id] });
        }
      }

      const allPoints = activeSketch.entities.flatMap((e) =>
        e.points.map((p, idx) => ({ entityId: e.id, pointIndex: idx, x: p.x, y: p.y, z: p.z })),
      );
      for (let i = 0; i < allPoints.length; i++) {
        for (let j = i + 1; j < allPoints.length; j++) {
          const a = allPoints[i];
          const b = allPoints[j];
          if (a.entityId === b.entityId) continue;
          const dist = Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
          if (dist < TOL) {
            const alreadyHas = activeSketch.constraints.some(
              (c) => c.type === 'coincident' && c.entityIds.includes(a.entityId) && c.entityIds.includes(b.entityId),
            );
            if (!alreadyHas) {
              newConstraints.push({
                id: crypto.randomUUID(),
                type: 'coincident',
                entityIds: [a.entityId, b.entityId],
                pointIndices: [a.pointIndex, b.pointIndex],
              });
            }
          }
        }
      }

      for (let i = 0; i < lines.length; i++) {
        for (let j = i + 1; j < lines.length; j++) {
          const ea = lines[i], eb = lines[j];
          const a0 = ea.points[0], a1 = ea.points[ea.points.length - 1];
          const b0 = eb.points[0], b1 = eb.points[eb.points.length - 1];
          const da = { x: a1.x - a0.x, y: a1.y - a0.y, z: a1.z - a0.z };
          const db = { x: b1.x - b0.x, y: b1.y - b0.y, z: b1.z - b0.z };
          const lenA = Math.sqrt(da.x ** 2 + da.y ** 2 + da.z ** 2);
          const lenB = Math.sqrt(db.x ** 2 + db.y ** 2 + db.z ** 2);
          if (lenA < 0.001 || lenB < 0.001) continue;
          const dot = Math.abs((da.x * db.x + da.y * db.y + da.z * db.z) / (lenA * lenB));
          if (dot > 1 - ANGLE_TOL) {
            const alreadyHas = activeSketch.constraints.some(
              (c) => c.type === 'parallel' && c.entityIds.includes(ea.id) && c.entityIds.includes(eb.id),
            );
            if (!alreadyHas) newConstraints.push({ id: crypto.randomUUID(), type: 'parallel', entityIds: [ea.id, eb.id] });
          }
        }
      }

      const lineLengths = lines.map((e) => {
        const p0 = e.points[0], p1 = e.points[e.points.length - 1];
        return Math.sqrt((p1.x - p0.x) ** 2 + (p1.y - p0.y) ** 2 + (p1.z - p0.z) ** 2);
      });
      for (let i = 0; i < lines.length; i++) {
        for (let j = i + 1; j < lines.length; j++) {
          if (Math.abs(lineLengths[i] - lineLengths[j]) < TOL) {
            const alreadyHas = activeSketch.constraints.some(
              (c) => c.type === 'equal' && c.entityIds.includes(lines[i].id) && c.entityIds.includes(lines[j].id),
            );
            if (!alreadyHas) newConstraints.push({ id: crypto.randomUUID(), type: 'equal', entityIds: [lines[i].id, lines[j].id] });
          }
        }
      }

      if (newConstraints.length === 0) {
        get().setStatusMessage('AutoConstrain: no new constraints detected');
        return;
      }

      set((s) => ({
        activeSketch: s.activeSketch ? { ...s.activeSketch, constraints: [...s.activeSketch.constraints, ...newConstraints] } : null,
      }));
      get().setStatusMessage(`AutoConstrain: applied ${newConstraints.length} constraint${newConstraints.length === 1 ? '' : 's'}`);
    },

    sketchComputeDeferred: false,
    setSketchComputeDeferred: (v) => set({ sketchComputeDeferred: v }),
    solveSketch: () => {
      const { activeSketch } = get();
      if (!activeSketch) return;
      const { t1, t2 } = GeometryEngine.getSketchAxes(activeSketch);
      const origin = activeSketch.planeOrigin;
      const projectedEntities = activeSketch.entities.map((e) => ({
        ...e,
        points: e.points.map((pt) => {
          const dx = pt.x - origin.x, dy = pt.y - origin.y, dz = pt.z - origin.z;
          return { ...pt, x: dx * t1.x + dy * t1.y + dz * t1.z, y: dx * t2.x + dy * t2.y + dz * t2.z, z: 0 };
        }),
      }));
      const result = solveConstraints(projectedEntities, [
        ...(activeSketch.constraints ?? []),
        ...dimensionsToSolverConstraints(activeSketch.dimensions ?? []),
      ]);
      if (!result.solved) {
        set((s) => ({
          activeSketch: s.activeSketch ? { ...s.activeSketch, overConstrained: true } : null,
          statusMessage: `Over-constrained sketch (residual ${result.residual.toFixed(3)}) after ${result.iterations} iterations`,
        }));
        return;
      }
      const updatedEntities = activeSketch.entities.map((e) => ({
        ...e,
        points: e.points.map((pt, pi) => {
          const solvedPt = result.updatedPoints.get(`${e.id}-p${pi}`);
          if (!solvedPt) return pt;
          return {
            ...pt,
            x: origin.x + solvedPt.x * t1.x + solvedPt.y * t2.x,
            y: origin.y + solvedPt.x * t1.y + solvedPt.y * t2.y,
            z: origin.z + solvedPt.x * t1.z + solvedPt.y * t2.z,
          };
        }),
      }));
      set((s) => ({
        activeSketch: s.activeSketch ? { ...s.activeSketch, entities: updatedEntities, overConstrained: false } : null,
        statusMessage: `Constraints solved (${result.iterations} iteration${result.iterations === 1 ? '' : 's'})`,
      }));
    },

    constraintSelection: [],
    setConstraintSelection: (ids) => set({ constraintSelection: ids }),
    addToConstraintSelection: (id) => set((s) => ({ constraintSelection: [...s.constraintSelection, id] })),
    clearConstraintSelection: () => set({ constraintSelection: [] }),
    constraintOffsetValue: 10,
    setConstraintOffsetValue: (v) => set({ constraintOffsetValue: Math.max(0.001, v) }),
    constraintSurfacePlane: null,
    setConstraintSurfacePlane: (plane) => set({ constraintSurfacePlane: plane }),
    addSketchConstraint: (constraint) => {
      const { activeSketch } = get();
      if (!activeSketch) return;
      const exists = (activeSketch.constraints ?? []).some(
        (c) => c.type === constraint.type && c.entityIds.join(',') === constraint.entityIds.join(','),
      );
      if (exists) return;
      get().pushUndo();
      set({
        activeSketch: { ...activeSketch, constraints: [...(activeSketch.constraints ?? []), constraint] },
        statusMessage: `${constraint.type} constraint applied`,
      });
      if (!get().sketchComputeDeferred) get().solveSketch();
    },

    conicRho: 0.5,
    setConicRho: (r) => set({ conicRho: Math.max(0.01, Math.min(0.99, r)) }),
    tangentCircleRadius: 5,
    setTangentCircleRadius: (r) => set({ tangentCircleRadius: Math.max(0.01, r) }),
    blendCurveMode: 'g1' as 'g1' | 'g2',
    setBlendCurveMode: (mode) => set({ blendCurveMode: mode }),
    sketchChamferDist1: 2,
    setSketchChamferDist1: (d) => set({ sketchChamferDist1: Math.max(0.01, d) }),
    sketchChamferDist2: 2,
    setSketchChamferDist2: (d) => set({ sketchChamferDist2: Math.max(0.01, d) }),
    sketchChamferAngle: 45,
    setSketchChamferAngle: (a) => set({ sketchChamferAngle: Math.max(1, Math.min(89, a)) }),

    showSketchProfile: false,
    setShowSketchProfile: (show) =>
      set((s) => ({
        showSketchProfile: show,
        activeSketch: s.activeSketch ? { ...s.activeSketch, areProfilesShown: show } : null,
      })),
    sliceEnabled: false,
    setSliceEnabled: (enabled) => set({ sliceEnabled: enabled }),
    sketch3DMode: false,
    setSketch3DMode: (v) => set({ sketch3DMode: v }),
    toggleSketch3DMode: () => set((s) => ({ sketch3DMode: !s.sketch3DMode })),
    sketch3DActivePlane: null,
    setSketch3DActivePlane: (plane) => set({ sketch3DActivePlane: plane }),

    sectionEnabled: false,
    sectionAxis: 'y',
    sectionOffset: 0,
    sectionFlip: false,
    setSectionEnabled: (enabled) => set({ sectionEnabled: enabled }),
    setSectionAxis: (axis) => set({ sectionAxis: axis }),
    setSectionOffset: (offset) => set({ sectionOffset: offset }),
    setSectionFlip: (flip) => set({ sectionFlip: flip }),

    showComponentColors: false,
    setShowComponentColors: (v) => set({ showComponentColors: v }),
    canvasReferences: [],
    addCanvasReference: (ref) => set((state) => ({ canvasReferences: [...state.canvasReferences, ref] })),
    removeCanvasReference: (id) => set((state) => ({ canvasReferences: state.canvasReferences.filter((r) => r.id !== id) })),

    showSketchPoints: true,
    setShowSketchPoints: (v) => set((s) => ({ showSketchPoints: v, activeSketch: s.activeSketch ? { ...s.activeSketch, arePointsShown: v } : null })),
    showSketchDimensions: true,
    setShowSketchDimensions: (v) => set((s) => ({ showSketchDimensions: v, activeSketch: s.activeSketch ? { ...s.activeSketch, areDimensionsShown: v } : null })),
    showSketchConstraints: true,
    setShowSketchConstraints: (v) => set((s) => ({ showSketchConstraints: v, activeSketch: s.activeSketch ? { ...s.activeSketch, areConstraintsShown: v } : null })),
    showProjectedGeometries: true,
    setShowProjectedGeometries: (v) => set({ showProjectedGeometries: v }),
    showConstructionGeometries: true,
    setShowConstructionGeometries: (v) => set({ showConstructionGeometries: v }),

    gridLocked: false,
    setGridLocked: (locked) => set({ gridLocked: locked }),
    incrementalMove: false,
    setIncrementalMove: (enabled) => set({ incrementalMove: enabled }),
    moveIncrement: 1,
    setMoveIncrement: (value) => set({ moveIncrement: value }),
    rotateIncrement: 15,
    setRotateIncrement: (value) => set({ rotateIncrement: value }),

    visualStyle: 'shadedEdges',
    setVisualStyle: (style) => set({ visualStyle: style }),
    showEnvironment: false,
    setShowEnvironment: (show) => set({ showEnvironment: show }),
    showShadows: true,
    setShowShadows: (show) => set({ showShadows: show }),
    showReflections: true,
    setShowReflections: (show) => set({ showReflections: show }),
    showGroundPlane: true,
    setShowGroundPlane: (show) => set({ showGroundPlane: show }),
    groundPlaneOffset: 0,
    setGroundPlaneOffset: (v) => set({ groundPlaneOffset: v }),
    shadowSoftness: 2,
    setShadowSoftness: (v) => set({ shadowSoftness: v }),
    ambientOcclusionEnabled: false,
    setAmbientOcclusionEnabled: (enabled) => set({ ambientOcclusionEnabled: enabled }),
    environmentPreset: 'studio',
    setEnvironmentPreset: (preset) => set({ environmentPreset: preset }),

    entityVisSketchBodies: true,
    entityVisConstruction: true,
    entityVisOrigins: true,
    entityVisJoints: true,
    setEntityVisSketchBodies: (v) => set({ entityVisSketchBodies: v }),
    setEntityVisConstruction: (v) => set({ entityVisConstruction: v }),
    setEntityVisOrigins: (v) => set({ entityVisOrigins: v }),
    setEntityVisJoints: (v) => set({ entityVisJoints: v }),

    cameraProjection: 'perspective',
    setCameraProjection: (p) => set({ cameraProjection: p }),
    cameraTargetQuaternion: null,
    setCameraTargetQuaternion: (q) => set({ cameraTargetQuaternion: q }),
    cameraTargetOrbit: null,
    setCameraTargetOrbit: (v) => set({ cameraTargetOrbit: v }),
  };
}
