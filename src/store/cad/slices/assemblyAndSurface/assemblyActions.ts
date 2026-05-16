import * as THREE from 'three';
import type {
  ContactSetEntry,
  Feature,
  InterferenceResult,
  JointOriginRecord,
} from '../../../../types/cad';
import { GeometryEngine } from '../../../../engine/GeometryEngine';
import { BODY_MATERIAL } from '../../../../components/viewport/scene/bodyMaterial';
import { useComponentStore } from '../../../componentStore';
import type { CADSliceContext } from '../../sliceContext';
import type { CADState } from '../../state';

export function createAssemblyActions({ set, get }: CADSliceContext): Partial<CADState> {
  return {
    jointOrigins: [],
    showJointOriginDialog: false,
    jointOriginPickedPoint: null,
    jointDialogPickedOrigin: null,
    jointDialogPickMode: false,
    setJointDialogPickedOrigin: (p) => set({ jointDialogPickedOrigin: p }),
    setJointDialogPickMode: (v) => set({ jointDialogPickMode: v }),
    openJointOriginDialog: () =>
      set({ activeDialog: 'joint-origin', showJointOriginDialog: true, jointOriginPickedPoint: null }),
    closeJointOriginDialog: () =>
      set({ activeDialog: null, showJointOriginDialog: false, jointOriginPickedPoint: null }),
    setJointOriginPoint: (p) => set({ jointOriginPickedPoint: p }),
    commitJointOrigin: (params) => {
      const { jointOrigins, jointOriginPickedPoint } = get();
      const n = jointOrigins.length + 1;
      const record: JointOriginRecord = {
        id: crypto.randomUUID(),
        name: params.name || `Joint Origin ${n}`,
        componentId: params.componentId,
        position: jointOriginPickedPoint ?? [0, 0, 0],
        normal: [0, 1, 0],
      };
      set({
        jointOrigins: [...jointOrigins, record],
        activeDialog: null,
        showJointOriginDialog: false,
        jointOriginPickedPoint: null,
      });
    },

    showInterferenceDialog: false,
    interferenceResults: [],
    openInterferenceDialog: () => set({ activeDialog: 'interference', showInterferenceDialog: true }),
    closeInterferenceDialog: () => set({ activeDialog: null, showInterferenceDialog: false }),
    computeInterference: () => {
      const { features } = get();
      const solidFeatures = features.filter(
        (f) => f.mesh && f.visible && (!f.bodyKind || f.bodyKind === 'solid') && (f.mesh as THREE.Mesh).isMesh,
      );
      const results: InterferenceResult[] = [];
      for (let i = 0; i < solidFeatures.length; i++) {
        for (let j = i + 1; j < solidFeatures.length; j++) {
          const fA = solidFeatures[i];
          const fB = solidFeatures[j];
          const meshA = fA.mesh as THREE.Mesh;
          const meshB = fB.mesh as THREE.Mesh;
          const boxA = new THREE.Box3().setFromObject(meshA);
          const boxB = new THREE.Box3().setFromObject(meshB);
          let hasInterference = false;
          let intersectionCurveCount = 0;
          if (boxA.intersectsBox(boxB)) {
            const curves = GeometryEngine.computeMeshIntersectionCurve(meshA, meshB, 1e-3);
            hasInterference = curves.length > 0;
            intersectionCurveCount = curves.length;
          }
          results.push({
            bodyAName: fA.name,
            bodyBName: fB.name,
            hasInterference,
            intersectionCurveCount,
          });
        }
      }
      set({ interferenceResults: results });
    },
    commitInterferenceBodies: () => {
      const { features } = get();
      const solidFeatures = features.filter(
        (f) => f.mesh && f.visible && (!f.bodyKind || f.bodyKind === 'solid') && (f.mesh as THREE.Mesh).isMesh,
      );
      // Collect the new interference solids first; only pushUndo + commit if
      // at least one pair produced a real intersection volume so a no-op run
      // doesn't leave an empty snapshot on the undo stack.
      const newFeatures: Feature[] = [];
      let baseIndex = features.filter((f) => f.name.startsWith('Interference')).length;
      for (let i = 0; i < solidFeatures.length; i++) {
        for (let j = i + 1; j < solidFeatures.length; j++) {
          const fA = solidFeatures[i];
          const fB = solidFeatures[j];
          const meshA = fA.mesh as THREE.Mesh;
          const meshB = fB.mesh as THREE.Mesh;
          const boxA = new THREE.Box3().setFromObject(meshA);
          const boxB = new THREE.Box3().setFromObject(meshB);
          if (!boxA.intersectsBox(boxB)) continue;
          // Clone-then-bake so the world-baked intermediates are owned here and
          // disposed after CSG — never the shared feature geometry singletons.
          let geomA: THREE.BufferGeometry | null = null;
          let geomB: THREE.BufferGeometry | null = null;
          let result: THREE.BufferGeometry | null = null;
          try {
            geomA = GeometryEngine.bakeMeshWorldGeometry(meshA);
            geomB = GeometryEngine.bakeMeshWorldGeometry(meshB);
            result = GeometryEngine.csgIntersect(geomA, geomB);
            const posAttr = result.getAttribute('position') as THREE.BufferAttribute | undefined;
            const vertCount = posAttr ? posAttr.count : 0;
            // Guard tiny / edge-kiss results the same way the extrude overlap
            // rule does (>6 verts ⇒ a real volume, not a coincident face/edge).
            if (vertCount > 6) {
              baseIndex += 1;
              const mesh = new THREE.Mesh(result, BODY_MATERIAL);
              mesh.castShadow = true;
              mesh.receiveShadow = true;
              const interferenceFeature: Feature = {
                id: crypto.randomUUID(),
                name: `Interference ${baseIndex} (${fA.name}∩${fB.name})`,
                type: 'combine',
                params: {
                  featureKind: 'interference',
                  operation: 'intersect',
                  sourceIds: [fA.id, fB.id],
                },
                mesh,
                bodyKind: 'solid',
                visible: true,
                suppressed: false,
                timestamp: Date.now(),
              };
              mesh.userData.pickable = true;
              mesh.userData.featureId = interferenceFeature.id;
              newFeatures.push(interferenceFeature);
              result = null; // ownership transferred to the feature mesh
            }
          } catch (err) {
            // A single non-manifold / degenerate pair must not abort the rest.
            get().setStatusMessage(
              `Interference body (${fA.name}∩${fB.name}) skipped: ${
                err instanceof Error ? err.message : 'CSG error'
              }`,
            );
          } finally {
            geomA?.dispose();
            geomB?.dispose();
            result?.dispose();
          }
        }
      }
      if (newFeatures.length === 0) {
        get().setStatusMessage('Interference: no overlapping volumes to create bodies from');
        return;
      }
      get().pushUndo();
      set((state) => ({
        features: [...state.features, ...newFeatures],
        statusMessage: `Created ${newFeatures.length} interference ${
          newFeatures.length === 1 ? 'body' : 'bodies'
        }`,
      }));
    },

    showMirrorComponentDialog: false,
    openMirrorComponentDialog: () => set({ activeDialog: 'mirror-component', showMirrorComponentDialog: true }),
    closeMirrorComponentDialog: () => set({ activeDialog: null, showMirrorComponentDialog: false }),

    showDuplicateWithJointsDialog: false,
    duplicateWithJointsTargetId: null,
    openDuplicateWithJointsDialog: (componentId) =>
      set({
        activeDialog: 'duplicate-with-joints',
        showDuplicateWithJointsDialog: true,
        duplicateWithJointsTargetId: componentId,
      }),
    closeDuplicateWithJointsDialog: () =>
      set({ activeDialog: null, showDuplicateWithJointsDialog: false, duplicateWithJointsTargetId: null }),

    showBOMDialog: false,
    openBOMDialog: () => set({ activeDialog: 'bom', showBOMDialog: true }),
    closeBOMDialog: () => set({ activeDialog: null, showBOMDialog: false }),
    getBOMEntries: () => {
      const componentStore = useComponentStore.getState();
      const { components, bodies } = componentStore;
      const nameCounts: Record<string, number> = {};

      for (const comp of Object.values(components)) {
        if (comp.parentId === null) continue;
        nameCounts[comp.name] = (nameCounts[comp.name] ?? 0) + 1;
      }

      const seenNames = new Set<string>();
      const entries: import('../../../../components/dialogs/assembly/BOMDialog').BOMEntry[] = [];
      let partNumber = 1;

      for (const comp of Object.values(components)) {
        if (comp.parentId === null || seenNames.has(comp.name)) continue;
        seenNames.add(comp.name);

        let material = '\u2014';
        if (comp.bodyIds.length > 0) {
          const firstBody = bodies[comp.bodyIds[0]];
          if (firstBody?.material?.name) material = firstBody.material.name;
        }

        let estimatedMass = '\u2014';
        for (const bodyId of comp.bodyIds) {
          const body = bodies[bodyId];
          if (!body?.mesh) continue;
          const box = new THREE.Box3().setFromObject(body.mesh);
          const size = new THREE.Vector3();
          box.getSize(size);
          const volumeCm3 = size.x * size.y * size.z * 0.001;
          const massG = volumeCm3;
          estimatedMass = `${massG.toFixed(1)} g`;
          break;
        }

        entries.push({
          partNumber,
          name: comp.name,
          quantity: nameCounts[comp.name] ?? 1,
          material,
          estimatedMass,
          description: '',
        });
        partNumber++;
      }

      return entries.sort((a, b) => a.partNumber - b.partNumber);
    },

    contactSets: [],
    showContactSetsDialog: false,
    openContactSetsDialog: () => set({ activeDialog: 'contact-sets', showContactSetsDialog: true }),
    closeContactSetsDialog: () => set({ activeDialog: null, showContactSetsDialog: false }),
    addContactSet: (comp1Id, comp2Id) => {
      const { contactSets } = get();
      const componentStore = useComponentStore.getState();
      const comp1 = componentStore.components[comp1Id];
      const comp2 = componentStore.components[comp2Id];
      const entry: ContactSetEntry = {
        id: crypto.randomUUID(),
        name: `Contact ${comp1?.name ?? comp1Id}\u2013${comp2?.name ?? comp2Id}`,
        component1Id: comp1Id,
        component2Id: comp2Id,
        enabled: true,
      };
      set({ contactSets: [...contactSets, entry] });
    },
    toggleContactSet: (id) =>
      set((state) => ({
        contactSets: state.contactSets.map((cs) => (cs.id === id ? { ...cs, enabled: !cs.enabled } : cs)),
      })),
    removeContactSet: (id) =>
      set((state) => ({
        contactSets: state.contactSets.filter((cs) => cs.id !== id),
      })),
    enableAllContactSets: () =>
      set((state) => ({
        contactSets: state.contactSets.map((cs) => ({ ...cs, enabled: true })),
      })),
    disableAllContactSets: () =>
      set((state) => ({
        contactSets: state.contactSets.map((cs) => ({ ...cs, enabled: false })),
      })),

    showInsertComponentDialog: false,
    openInsertComponentDialog: () => set({ activeDialog: 'insert-component', showInsertComponentDialog: true }),
    closeInsertComponentDialog: () => set({ activeDialog: null, showInsertComponentDialog: false }),
    commitInsertComponent: (params) => {
      const { features } = get();
      const n = features.filter((f) => f.type === 'import').length + 1;
      const componentStore = useComponentStore.getState();
      componentStore.addComponent(componentStore.rootComponentId, params.name);
      const feature: Feature = {
        id: crypto.randomUUID(),
        name: params.name || `Inserted Component ${n}`,
        type: 'import',
        params: {
          sourceUrl: params.sourceUrl,
          scale: params.scale,
          posX: params.position[0],
          posY: params.position[1],
          posZ: params.position[2],
        },
        visible: true,
        suppressed: false,
        timestamp: Date.now(),
      };
      get().addFeature(feature);
      set({ activeDialog: null, showInsertComponentDialog: false });
      get().setStatusMessage(`Inserted component: ${params.name} (mesh loading deferred)`);
    },
  };
}
