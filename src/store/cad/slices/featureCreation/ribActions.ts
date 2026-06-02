import type { Feature, Tool } from '../../../../types/cad';
import { GeometryEngine } from '../../../../engine/GeometryEngine';
import type { CADSliceContext } from '../../sliceContext';
import type { CADState } from '../../state';
import { addToast } from '../../../toastStore';
import { useComponentStore } from '../../../componentStore';
import { getOccSync } from '../../../../engine/occ/loader';
import { occRibWithInstance } from '../../../../engine/occ/ops/rib';
import { createRegisteredOccMesh } from '../../../../engine/occ/registeredMesh';
import { BODY_MATERIAL } from '../../../../components/viewport/scene/bodyMaterial';

export function createRibActions({ set, get }: CADSliceContext): Partial<CADState> {
  return {
    ribSelectedSketchId: null,
    setRibSelectedSketchId: (id) => set({ ribSelectedSketchId: id }),
    ribThickness: 2,
    setRibThickness: (t) => set({ ribThickness: Math.max(0.01, t) }),
    ribHeight: 10,
    setRibHeight: (h) => set({ ribHeight: Math.max(0.01, h) }),
    ribDirection: 'normal',
    setRibDirection: (d) => set({ ribDirection: d }),
    startRibTool: () => {
      const sketches = get().sketches.filter((s) => s.entities.length > 0);
      if (sketches.length === 0) {
        addToast('warning', 'Rib needs a sketch', 'Draw a profile sketch first');
        set({ statusMessage: 'Create a sketch first before adding a rib' });
        return;
      }
      set({ activeTool: 'rib' as Tool, ribSelectedSketchId: null, statusMessage: 'Rib - pick a profile sketch in the panel' });
    },
    cancelRibTool: () => set({ activeTool: 'select', ribSelectedSketchId: null, statusMessage: 'Rib cancelled' }),
    commitRib: () => {
      const { ribSelectedSketchId, ribThickness, ribHeight, ribDirection, sketches, features, units } = get();
      if (!ribSelectedSketchId) {
        set({ statusMessage: 'No profile selected for rib' });
        return;
      }
      const sketch = sketches.find((s) => s.id === ribSelectedSketchId);
      if (!sketch) {
        set({ statusMessage: 'Selected sketch not found' });
        return;
      }
      get().pushUndo();

      const featureId = crypto.randomUUID();

      // ── OCC path ────────────────────────────────────────────────────────────
      // Produces a real BRep solid: filletable, join/cut-able, edge-selectable.
      // Falls back to the THREE mesh path if OCC is not loaded yet.
      let ribMesh: Feature['mesh'] | undefined;
      const occ = getOccSync();
      if (occ) {
        try {
          const occBody = occRibWithInstance(
            occ.oc,
            sketch,
            ribHeight,
            ribThickness,
            ribDirection as 'normal' | 'flip' | 'symmetric',
            { id: featureId, sourceFeatureId: featureId },
          );
          if (occBody) {
            ribMesh = createRegisteredOccMesh(occ.oc, occBody, BODY_MATERIAL, featureId);
          }
        } catch (err) {
          console.warn('[commitRib] OCC failed, falling back to THREE mesh:', err);
        }
      }

      // ── THREE fallback ──────────────────────────────────────────────────────
      if (!ribMesh) {
        const signedHeight = ribDirection === 'flip' ? -ribHeight : ribHeight;
        ribMesh = GeometryEngine.extrudeThinSketch(sketch, Math.abs(signedHeight), ribThickness, 'center') ?? undefined;
      }

      const feature: Feature = {
        id: featureId,
        name: `Rib ${features.filter((f) => f.type === 'rib').length + 1}`,
        type: 'rib',
        sketchId: ribSelectedSketchId,
        params: { thickness: ribThickness, height: ribHeight, direction: ribDirection },
        visible: true,
        suppressed: false,
        timestamp: Date.now(),
        mesh: ribMesh,
      };
      set({
        features: [...features, feature],
        activeTool: 'select',
        ribSelectedSketchId: null,
        statusMessage: `Rib created: ${ribThickness}mm thick, ${ribHeight}${units} tall`,
      });

      // Register a browser body so the rib shows under "Bodies"
      const cs = useComponentStore.getState();
      const componentId = sketch.componentId ?? cs.activeComponentId ?? cs.rootComponentId;
      const bodyCount = Object.keys(cs.bodies).length + 1;
      const bodyId = cs.addBody(componentId, `Body ${bodyCount}`);
      if (bodyId) {
        cs.addFeatureToBody(bodyId, feature.id);
        if (ribMesh) cs.setBodyMesh(bodyId, ribMesh as import('three').Mesh);
      }
    },
  };
}
