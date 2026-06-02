import type { Feature, Tool } from '../../../../types/cad';
import * as THREE from 'three';
import { GeometryEngine } from '../../../../engine/GeometryEngine';
import type { CADSliceContext } from '../../sliceContext';
import type { CADState } from '../../state';
import { getOccSync } from '../../../../engine/occ/loader';
import { occFillSurfaceWithInstance, type FillContinuity } from '../../../../engine/occ/ops/fillSurface';
import { createRegisteredOccMesh } from '../../../../engine/occ/registeredMesh';
import { BODY_MATERIAL, SURFACE_MATERIAL } from '../../../../components/viewport/scene/bodyMaterial';
import { errorMessage } from '../../../../utils/errorHandling';
import { addToast } from '../../../toastStore';
import { useComponentStore } from '../../../componentStore';

export function createSurfaceFeatureActions({ set, get }: CADSliceContext): Partial<CADState> {
  return {
    patchSelectedSketchId: null,
    setPatchSelectedSketchId: (id) => set({ patchSelectedSketchId: id }),
    patchContinuity: 'G0' as 'G0' | 'G1' | 'G2',
    setPatchContinuity: (v) => set({ patchContinuity: v }),
    startPatchTool: () => {
      const sketches = get().sketches.filter((s) => s.entities.length > 0);
      if (sketches.length === 0) {
        addToast('warning', 'Patch needs a sketch', 'Draw a closed profile sketch first');
        set({ statusMessage: 'Create a sketch first before using Patch' });
        return;
      }
      set({ activeTool: 'patch' as Tool, patchSelectedSketchId: null, statusMessage: 'Patch - select a closed profile sketch in the panel' });
    },
    cancelPatchTool: () => set({ activeTool: 'select', patchSelectedSketchId: null, patchContinuity: 'G0', statusMessage: 'Patch cancelled' }),
    commitPatch: () => {
      const { patchSelectedSketchId, patchContinuity, sketches, features, units } = get();
      if (!patchSelectedSketchId) {
        set({ statusMessage: 'No profile selected for Patch' });
        return;
      }
      const sketch = sketches.find((s) => s.id === patchSelectedSketchId);
      if (!sketch) {
        set({ statusMessage: 'Selected sketch not found' });
        return;
      }
      const featureId = crypto.randomUUID();
      const n = features.filter((f) => f.type === 'extrude' && f.bodyKind === 'surface' && f.params.patchSketchId !== undefined).length + 1;

      // Build boundary loop from sketch entities
      const boundaryLoop = sketch.entities.flatMap((e) =>
        e.points.map((p) => new THREE.Vector3(p.x, p.y, p.z)),
      );

      let mesh: THREE.Mesh | undefined;
      const occ = getOccSync();
      if (occ && boundaryLoop.length >= 3) {
        try {
          // One constraint entry per boundary point so fillSurface applies the
          // requested continuity to every edge of the closed boundary, not only the first.
          const edgeConstraints = boundaryLoop.map(() => ({ continuity: patchContinuity as FillContinuity }));
          const body = occFillSurfaceWithInstance(occ.oc, boundaryLoop, {
            sourceFeatureId: featureId,
            edgeConstraints,
          });
          if (body) mesh = createRegisteredOccMesh(occ.oc, body, BODY_MATERIAL, featureId);
        } catch (err) {
          console.warn(`[commitPatch] OCC fill failed (${errorMessage(err, 'unknown')}), using THREE fallback`);
        }
      }
      if (!mesh) mesh = GeometryEngine.patchSketch(sketch) ?? undefined;

      const feature: Feature = {
        id: featureId,
        name: `Patch ${n}`,
        type: 'extrude',
        sketchId: patchSelectedSketchId,
        params: { patchSketchId: patchSelectedSketchId, continuity: patchContinuity },
        visible: true,
        suppressed: false,
        timestamp: Date.now(),
        mesh,
        bodyKind: 'surface',
      };
      set({
        features: [...features, feature],
        activeTool: 'select',
        patchSelectedSketchId: null,
        patchContinuity: 'G0',
        statusMessage: `Patch surface created (${units})`,
      });

      // Register a browser body so the patch shows under "Bodies"
      const cs = useComponentStore.getState();
      const componentId = sketch.componentId ?? cs.activeComponentId ?? cs.rootComponentId;
      const bodyCount = Object.keys(cs.bodies).length + 1;
      const bodyId = cs.addBody(componentId, `Surface ${bodyCount}`);
      if (bodyId) {
        cs.addFeatureToBody(bodyId, featureId);
        if (mesh) cs.setBodyMesh(bodyId, mesh);
      }
    },
    ruledMode: 'two-curves' as 'two-curves' | 'extend-edge',
    setRuledMode: (m: 'two-curves' | 'extend-edge') => set({ ruledMode: m }),
    ruledSketchAId: null,
    setRuledSketchAId: (id) => set({ ruledSketchAId: id }),
    ruledSketchBId: null,
    setRuledSketchBId: (id) => set({ ruledSketchBId: id }),
    ruledAlignmentMode: 'direction' as 'direction' | 'tangent' | 'normal',
    setRuledAlignmentMode: (m: 'direction' | 'tangent' | 'normal') => set({ ruledAlignmentMode: m }),
    ruledAlignmentDistance: 0,
    setRuledAlignmentDistance: (d: number) => set({ ruledAlignmentDistance: d }),
    ruledExtendDistance: 10,
    setRuledExtendDistance: (d: number) => set({ ruledExtendDistance: d }),
    ruledExtendAxis: 'Z' as 'X' | 'Y' | 'Z',
    setRuledExtendAxis: (a: 'X' | 'Y' | 'Z') => set({ ruledExtendAxis: a }),
    startRuledSurfaceTool: () => {
      const sketches = get().sketches.filter((s) => s.entities.length > 0);
      const ruledMode = get().ruledMode;
      if (ruledMode === 'two-curves' && sketches.length < 2) {
        addToast('warning', 'Ruled Surface needs 2 sketches', 'Draw Curve A and Curve B sketches first');
        set({ statusMessage: 'Ruled Surface (Two Curves) requires at least 2 sketches' });
        return;
      }
      if (sketches.length === 0) {
        addToast('warning', 'Ruled Surface needs a sketch', 'Draw a curve sketch first');
        set({ statusMessage: 'Create a sketch first before using Ruled Surface' });
        return;
      }
      set({ activeTool: 'ruled-surface' as Tool, ruledSketchAId: null, ruledSketchBId: null, statusMessage: 'Ruled Surface - select curve sketches in the panel' });
    },
    cancelRuledSurfaceTool: () => set({ activeTool: 'select', ruledSketchAId: null, ruledSketchBId: null, statusMessage: 'Ruled Surface cancelled' }),
    commitRuledSurface: () => {
      const { ruledMode, ruledSketchAId, ruledSketchBId, ruledAlignmentMode, ruledAlignmentDistance, ruledExtendDistance, ruledExtendAxis, sketches, features, units } = get();

      // ── Extend-Edge mode ──────────────────────────────────────────────────
      if (ruledMode === 'extend-edge') {
        if (!ruledSketchAId) {
          set({ statusMessage: 'Select a curve sketch to extend' });
          return;
        }
        const sketchA = sketches.find((s) => s.id === ruledSketchAId);
        if (!sketchA) {
          set({ statusMessage: 'Selected sketch not found' });
          return;
        }
        // Collect edge points and extrude in the chosen axis direction
        const pts = sketchA.entities.flatMap((e) => e.points.map((p) => new THREE.Vector3(p.x, p.y, p.z)));
        const axisDir = ruledExtendAxis === 'X'
          ? new THREE.Vector3(1, 0, 0)
          : ruledExtendAxis === 'Y'
            ? new THREE.Vector3(0, 1, 0)
            : new THREE.Vector3(0, 0, 1);
        const geom = GeometryEngine.offsetCurveToSurface(pts, ruledExtendDistance, axisDir);
        // Use the shared SURFACE_MATERIAL singleton — never allocate a new material per feature.
        const extMesh = new THREE.Mesh(geom, SURFACE_MATERIAL);
        const n = features.filter((f) => f.type === 'loft' && f.bodyKind === 'surface').length + 1;
        const extFeatureId = crypto.randomUUID();
        const feature: Feature = {
          id: extFeatureId,
          name: `Ruled Surface ${n}`,
          type: 'loft',
          sketchId: ruledSketchAId,
          params: { ruledMode: 'extend-edge', ruledSketchAId, extendDistance: ruledExtendDistance, extendAxis: ruledExtendAxis },
          visible: true,
          suppressed: false,
          timestamp: Date.now(),
          mesh: extMesh,
          bodyKind: 'surface',
        };
        set({ features: [...features, feature], activeTool: 'select', ruledSketchAId: null, statusMessage: `Ruled Surface (extend) created (${units})` });

        // Register a browser body so the ruled surface shows under "Bodies"
        const csExt = useComponentStore.getState();
        const extCompId = sketchA.componentId ?? csExt.activeComponentId ?? csExt.rootComponentId;
        const extBodyCount = Object.keys(csExt.bodies).length + 1;
        const extBodyId = csExt.addBody(extCompId, `Surface ${extBodyCount}`);
        if (extBodyId) {
          csExt.addFeatureToBody(extBodyId, extFeatureId);
          csExt.setBodyMesh(extBodyId, extMesh);
        }
        return;
      }

      // ── Two-Curves mode ───────────────────────────────────────────────────
      if (!ruledSketchAId || !ruledSketchBId) {
        set({ statusMessage: 'Select two curve sketches for Ruled Surface' });
        return;
      }
      const sketchA = sketches.find((s) => s.id === ruledSketchAId);
      const sketchB = sketches.find((s) => s.id === ruledSketchBId);
      if (!sketchA || !sketchB) {
        set({ statusMessage: 'One or more selected sketches not found' });
        return;
      }
      const mesh = GeometryEngine.ruledSurface(sketchA, sketchB, ruledAlignmentMode, ruledAlignmentDistance);
      const ruledFeatureId = crypto.randomUUID();
      const feature: Feature = {
        id: ruledFeatureId,
        name: `Ruled Surface ${features.filter((f) => f.type === 'loft' && f.bodyKind === 'surface').length + 1}`,
        type: 'loft',
        sketchId: ruledSketchAId,
        params: { ruledSketchAId, ruledSketchBId, alignmentMode: ruledAlignmentMode, alignmentDistance: ruledAlignmentDistance },
        visible: true,
        suppressed: false,
        timestamp: Date.now(),
        mesh: mesh ?? undefined,
        bodyKind: 'surface',
      };
      set({
        features: [...features, feature],
        activeTool: 'select',
        ruledSketchAId: null,
        ruledSketchBId: null,
        statusMessage: `Ruled Surface created (${units})`,
      });

      // Register a browser body so the ruled surface shows under "Bodies"
      const cs = useComponentStore.getState();
      const componentId = sketchA.componentId ?? cs.activeComponentId ?? cs.rootComponentId;
      const bodyCount = Object.keys(cs.bodies).length + 1;
      const bodyId = cs.addBody(componentId, `Surface ${bodyCount}`);
      if (bodyId) {
        cs.addFeatureToBody(bodyId, ruledFeatureId);
        if (mesh) cs.setBodyMesh(bodyId, mesh);
      }
    },
  };
}
