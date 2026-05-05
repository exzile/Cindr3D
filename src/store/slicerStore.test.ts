import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_MATERIAL_PROFILES, DEFAULT_PRINT_PROFILES, DEFAULT_PRINTER_PROFILES } from '../types/slicer';
import { useSlicerStore } from './slicerStore';
import type { SlicerStore } from './slicer/types';

function resetSlicerProfiles() {
  useSlicerStore.setState({
    printerProfiles: DEFAULT_PRINTER_PROFILES.map((profile) => ({ ...profile })),
    materialProfiles: DEFAULT_MATERIAL_PROFILES.map((profile) => ({ ...profile })),
    printProfiles: DEFAULT_PRINT_PROFILES.map((profile) => ({ ...profile })),
    profileSnapshots: [],
    activePrinterProfileId: DEFAULT_PRINTER_PROFILES[0]?.id ?? '',
    activeMaterialProfileId: DEFAULT_MATERIAL_PROFILES[0]?.id ?? '',
    activePrintProfileId: DEFAULT_PRINT_PROFILES[0]?.id ?? '',
  } as Partial<SlicerStore>);
}

describe('slicer profile snapshots', () => {
  beforeEach(() => {
    resetSlicerProfiles();
  });

  it('captures the previous printer profile before saving updates', () => {
    const original = useSlicerStore.getState().printerProfiles[0];

    useSlicerStore.getState().updatePrinterProfile(original.id, { name: 'Updated Printer' });

    const snapshot = useSlicerStore.getState().profileSnapshots[0];
    expect(snapshot).toMatchObject({
      kind: 'printer',
      profileId: original.id,
      profileName: original.name,
    });
    expect(snapshot.profile).toMatchObject({ name: original.name });
    expect(useSlicerStore.getState().printerProfiles[0].name).toBe('Updated Printer');
  });

  it('keeps only the newest snapshots for each profile', () => {
    const original = useSlicerStore.getState().printProfiles[0];

    for (let i = 0; i < 30; i += 1) {
      useSlicerStore.getState().updatePrintProfile(original.id, { name: `Print Profile ${i}` });
    }

    const snapshots = useSlicerStore.getState().profileSnapshots.filter(
      (snapshot) => snapshot.kind === 'print' && snapshot.profileId === original.id,
    );

    expect(snapshots).toHaveLength(25);
    expect(snapshots[0].profile).toMatchObject({ name: 'Print Profile 4' });
    expect(snapshots.at(-1)?.profile).toMatchObject({ name: 'Print Profile 28' });
  });

  it('captures material profiles independently from print profiles', () => {
    const material = useSlicerStore.getState().materialProfiles[0];
    const print = useSlicerStore.getState().printProfiles[0];

    useSlicerStore.getState().updateMaterialProfile(material.id, { name: 'Matte PLA' });
    useSlicerStore.getState().updatePrintProfile(print.id, { name: 'Fine Detail' });

    expect(useSlicerStore.getState().profileSnapshots.map((snapshot) => snapshot.kind)).toEqual([
      'material',
      'print',
    ]);
  });

  it('restores a full profile snapshot while preserving the current version', () => {
    const original = useSlicerStore.getState().printerProfiles[0];
    useSlicerStore.getState().updatePrinterProfile(original.id, { name: 'Changed Printer' });
    const snapshotId = useSlicerStore.getState().profileSnapshots[0].id;

    useSlicerStore.getState().restoreProfileSnapshot(snapshotId);

    expect(useSlicerStore.getState().printerProfiles[0].name).toBe(original.name);
    expect(useSlicerStore.getState().profileSnapshots.at(-1)?.profile).toMatchObject({
      name: 'Changed Printer',
    });
  });

  it('restores one nested profile key from a snapshot', () => {
    const original = useSlicerStore.getState().printerProfiles[0];
    useSlicerStore.getState().updatePrinterProfile(original.id, {
      buildVolume: { ...original.buildVolume, x: original.buildVolume.x + 20 },
      name: 'Changed Printer',
    });
    const snapshotId = useSlicerStore.getState().profileSnapshots[0].id;

    useSlicerStore.getState().restoreProfileSnapshotKey(snapshotId, 'buildVolume.x');

    const restored = useSlicerStore.getState().printerProfiles[0];
    expect(restored.buildVolume.x).toBe(original.buildVolume.x);
    expect(restored.buildVolume.y).toBe(original.buildVolume.y);
    expect(restored.name).toBe('Changed Printer');
  });
});
