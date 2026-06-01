import { GeometryEngine } from '../../../../engine/GeometryEngine';
import { solveConstraints } from '../../../../engine/ConstraintSolver';
import { buildSketchSolveInputs } from '../../../../engine/sketchSolveInputs';
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
      // B10: solve after adding so auto constraints actually drive geometry.
      get().solveSketch();
      get().setStatusMessage(`AutoConstrain: applied ${newConstraints.length} constraint${newConstraints.length === 1 ? '' : 's'}`);
    },

    sketchComputeDeferred: false,
    setSketchComputeDeferred: (v) => set({ sketchComputeDeferred: v }),
    sketchConstrainedEntityIds: [],
    solveSketch: (opts) => {
      const { activeSketch } = get();
      if (!activeSketch) return;
      const { t1, t2 } = GeometryEngine.getSketchAxes(activeSketch);
      const origin = activeSketch.planeOrigin;
      // Solver inputs (projected entities + geometric + non-driven dimension
      // constraints) are built by the shared `buildSketchSolveInputs` so the
      // trial over-constraint check in engine/overConstraintCheck.ts can run
      // the exact same assembly — prediction must match reality.
      const { entities: projectedEntities, constraints } = buildSketchSolveInputs(activeSketch);

      // Handle-drag: pin the point the user is dragging so the solver treats it
      // as the driving target and moves coincident/constrained geometry to match
      // it, instead of relaxing the dragged point back. The synthetic `fix`
      // constraint lives only for this solve — it is never stored on the sketch.
      if (opts?.fixedPoint) {
        constraints.push({
          type: 'fix',
          entityIds: [opts.fixedPoint.entityId],
          pointIndices: [opts.fixedPoint.pointIndex],
        });
      }

      // Plan B: connected-component partitioning. Entities that share no constraint
      // can be solved independently. For N isolated polygons this reduces complexity
      // from O((N·k)³) → N × O(k³), keeping per-drag cost flat as the sketch fills.
      const parent = new Map<string, string>();
      const find = (x: string): string => {
        if (!parent.has(x)) parent.set(x, x);
        let root = x;
        while (parent.get(root) !== root) root = parent.get(root)!;
        let cur = x;
        while (cur !== root) { const nxt = parent.get(cur)!; parent.set(cur, root); cur = nxt; }
        return root;
      };
      const union = (a: string, b: string) => { parent.set(find(a), find(b)); };

      for (const e of projectedEntities) find(e.id);
      for (const c of constraints) {
        for (let i = 1; i < c.entityIds.length; i++) union(c.entityIds[0], c.entityIds[i]);
      }

      const compEntities = new Map<string, typeof projectedEntities>();
      const compConstraints = new Map<string, typeof constraints>();
      for (const e of projectedEntities) {
        const root = find(e.id);
        if (!compEntities.has(root)) { compEntities.set(root, []); compConstraints.set(root, []); }
        compEntities.get(root)!.push(e);
      }
      for (const c of constraints) {
        if (c.entityIds.length === 0) continue;
        const root = find(c.entityIds[0]);
        compConstraints.get(root)?.push(c);
      }

      // Solve each component; merge results.
      const allUpdatedPoints = new Map<string, { x: number; y: number }>();
      const allUpdatedScalars = new Map<string, number>();
      let anyOverConstrained = false;
      let anyGenuineConflictResidual = 0;
      let allFullyConstrained = compEntities.size > 0;
      // B6.c: track which entity IDs are in fully-constrained components for DOF coloring.
      const constrainedEntityIds: string[] = [];

      for (const [root, compEnts] of compEntities) {
        const compCons = compConstraints.get(root) ?? [];
        const result = solveConstraints(compEnts, compCons);
        // B6/B7: genuine conflict = rank >= nParams AND residual high
        if (!result.solved) {
          const isGenuineConflict = result.nParams > 0 && result.rank >= result.nParams;
          if (isGenuineConflict) { anyOverConstrained = true; anyGenuineConflictResidual = result.residual; }
        }
        const compFullyConstrained = result.nParams > 0 && result.rank >= result.nParams && result.solved;
        if (!compFullyConstrained) allFullyConstrained = false;
        // B6.c: entities in fully-constrained components get the constrained color.
        if (compFullyConstrained) {
          for (const e of compEnts) constrainedEntityIds.push(e.id);
        }
        for (const [k, v] of result.updatedPoints) allUpdatedPoints.set(k, v);
        for (const [k, v] of result.updatedScalars) allUpdatedScalars.set(k, v);
      }

      if (anyOverConstrained) {
        set((s) => ({
          activeSketch: s.activeSketch ? { ...s.activeSketch, overConstrained: true } : null,
          sketchConstrainedEntityIds: [],
          statusMessage: `Over-constrained sketch (conflicting constraints, residual ${anyGenuineConflictResidual.toFixed(3)})`,
        }));
        return;
      }

      const updatedEntities = activeSketch.entities.map((e) => {
        const updatedPoints = e.points.map((pt, pi) => {
          const solvedPt = allUpdatedPoints.get(`${e.id}-p${pi}`);
          if (!solvedPt) return pt;
          return {
            ...pt,
            x: origin.x + solvedPt.x * t1.x + solvedPt.y * t2.x,
            y: origin.y + solvedPt.x * t1.y + solvedPt.y * t2.y,
            z: origin.z + solvedPt.x * t1.z + solvedPt.y * t2.z,
          };
        });
        // B1: apply solved scalar DOFs (radius / startAngle / endAngle) back to the entity.
        let updated: typeof e = { ...e, points: updatedPoints };
        const newRadius = allUpdatedScalars.get(`${e.id}::radius`);
        if (newRadius !== undefined && newRadius > 0) updated = { ...updated, radius: newRadius };
        const newSA = allUpdatedScalars.get(`${e.id}::startAngle`);
        if (newSA !== undefined) updated = { ...updated, startAngle: newSA };
        const newEA = allUpdatedScalars.get(`${e.id}::endAngle`);
        if (newEA !== undefined) updated = { ...updated, endAngle: newEA };
        return updated;
      });
      set((s) => ({
        activeSketch: s.activeSketch
          ? { ...s.activeSketch, entities: updatedEntities, overConstrained: false, fullyConstrained: allFullyConstrained }
          : null,
        sketchConstrainedEntityIds: constrainedEntityIds,
        statusMessage: 'Constraints solved',
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
      // B8: include pointIndices in the dedupe key so p0↔p1 and p1↔p0 are distinct.
      const constraintKey = `${constraint.type}|${constraint.entityIds.join(',')}|${(constraint.pointIndices ?? []).join(',')}`;
      const exists = (activeSketch.constraints ?? []).some(
        (c) => `${c.type}|${c.entityIds.join(',')}|${(c.pointIndices ?? []).join(',')}` === constraintKey,
      );
      if (exists) return;

      // B7.a: trial solve to classify the constraint BEFORE committing.
      // Build solver inputs for the sketch before and after adding the constraint.
      const { entities: solverEnts, constraints: consBefore } = buildSketchSolveInputs(activeSketch);
      const trialSketch = { ...activeSketch, constraints: [...(activeSketch.constraints ?? []), constraint] };
      const { constraints: consAfter } = buildSketchSolveInputs(trialSketch);

      // Union-find over consAfter to identify the affected component.
      const trialPar = new Map<string, string>();
      const trialFind = (x: string): string => {
        if (!trialPar.has(x)) trialPar.set(x, x);
        let r = x;
        while (trialPar.get(r) !== r) r = trialPar.get(r)!;
        let c = x;
        while (c !== r) { const n = trialPar.get(c)!; trialPar.set(c, r); c = n; }
        return r;
      };
      for (const e of solverEnts) trialFind(e.id);
      for (const con of consAfter) {
        for (let i = 1; i < con.entityIds.length; i++) trialPar.set(trialFind(con.entityIds[0]), trialFind(con.entityIds[i]));
      }

      // Collect entities in the affected component(s) (those linked to the new constraint's entities).
      const affectedRoots = new Set(
        constraint.entityIds.filter(id => solverEnts.some(e => e.id === id)).map(id => trialFind(id)),
      );
      if (affectedRoots.size > 0) {
        const compEnts = solverEnts.filter(e => affectedRoots.has(trialFind(e.id)));
        const compConsBefore = consBefore.filter(c => c.entityIds.some(id => affectedRoots.has(trialFind(id))));
        const compConsAfter = consAfter.filter(c => c.entityIds.some(id => affectedRoots.has(trialFind(id))));
        // forceRank ensures Plan-C's rank-skip doesn't mask redundant/conflict cases.
        const rBefore = solveConstraints(compEnts, compConsBefore, { forceRank: true });
        const rAfter = solveConstraints(compEnts, compConsAfter, { forceRank: true });

        if (rAfter.rank === rBefore.rank) {
          if (rAfter.residual >= 1e-6) {
            // Constraint is inconsistent with existing constraints — reject it.
            set({ statusMessage: 'Conflicting constraint — would over-constrain the sketch' });
            return;
          }
          // Constraint is already satisfied (redundant) — warn but allow it through.
          get().pushUndo();
          set({
            activeSketch: { ...activeSketch, constraints: [...(activeSketch.constraints ?? []), constraint] },
            statusMessage: 'Redundant constraint — already satisfied',
          });
          if (!get().sketchComputeDeferred) get().solveSketch();
          return;
        }
      }

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
