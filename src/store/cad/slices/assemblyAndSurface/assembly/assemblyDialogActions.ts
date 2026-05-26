import * as THREE from 'three';
import type { ContactSetEntry, Feature } from '../../../../../types/cad';
import { useComponentStore } from '../../../../componentStore';
import type { CADSliceContext } from '../../../sliceContext';
import type { CADState } from '../../../state';

export function createAssemblyDialogActions({ set, get }: CADSliceContext): Partial<CADState> {
  return {
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
      const entries: import('../../../../../components/dialogs/assembly/BOMDialog').BOMEntry[] = [];
      let partNumber = 1;

      for (const comp of Object.values(components)) {
        if (comp.parentId === null || seenNames.has(comp.name)) continue;
        seenNames.add(comp.name);

        let material = '-';
        if (comp.bodyIds.length > 0) {
          const firstBody = bodies[comp.bodyIds[0]];
          if (firstBody?.material?.name) material = firstBody.material.name;
        }

        let estimatedMass = '-';
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
        name: `Contact ${comp1?.name ?? comp1Id}-${comp2?.name ?? comp2Id}`,
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
