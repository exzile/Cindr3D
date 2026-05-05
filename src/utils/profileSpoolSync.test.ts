import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_MATERIAL_PROFILES, DEFAULT_PRINT_PROFILES, DEFAULT_PRINTER_PROFILES } from '../types/slicer';
import { useSlicerStore } from '../store/slicerStore';
import { useSpoolStore } from '../store/spoolStore';
import { useProfileSyncStore } from '../store/profileSyncStore';
import {
  applyProfileSpoolSyncPayload,
  buildProfileSpoolSyncPayload,
  markProfileSpoolSyncPending,
  normalizeProfileSyncUrl,
  pushProfileSpoolSync,
  resolveGitHubProfileSyncTarget,
} from './profileSpoolSync';

beforeEach(() => {
  vi.unstubAllGlobals();
  useSlicerStore.setState({
    printerProfiles: DEFAULT_PRINTER_PROFILES,
    materialProfiles: DEFAULT_MATERIAL_PROFILES,
    printProfiles: DEFAULT_PRINT_PROFILES,
    activePrinterProfileId: DEFAULT_PRINTER_PROFILES[0]?.id ?? '',
    activeMaterialProfileId: DEFAULT_MATERIAL_PROFILES[0]?.id ?? '',
    activePrintProfileId: DEFAULT_PRINT_PROFILES[0]?.id ?? '',
  });
  useSpoolStore.setState({
    spools: [],
    activeSpoolId: null,
    loadedSpoolByPrinterId: {},
    lowStockThresholdByMaterial: {},
  });
  useProfileSyncStore.setState({
    enabled: false,
    repoUrl: '',
    branch: 'main',
    syncPath: 'cindr3d-profile-sync.json',
    githubToken: '',
    autoPullOnStart: false,
    autoPushOnSave: false,
    hasPendingChanges: false,
    pendingPayloadJson: null,
    pendingUpdatedAt: null,
    lastSyncAt: null,
    lastSyncStatus: 'idle',
    lastSyncError: null,
  });
});

describe('profileSpoolSync', () => {
  it('normalizes repository URLs to raw GitHub sync files', () => {
    expect(normalizeProfileSyncUrl(
      'https://github.com/example/cindr-profiles',
      'main',
      'profiles/sync.json',
    )).toBe('https://raw.githubusercontent.com/example/cindr-profiles/main/profiles/sync.json');
  });

  it('resolves GitHub push targets from repository and blob URLs', () => {
    expect(resolveGitHubProfileSyncTarget(
      'https://github.com/example/cindr-profiles',
      'main',
      'profiles/sync.json',
    )).toEqual({
      owner: 'example',
      repo: 'cindr-profiles',
      branch: 'main',
      path: 'profiles/sync.json',
    });

    expect(resolveGitHubProfileSyncTarget(
      'https://github.com/example/cindr-profiles/blob/dev/data/sync.json',
      'main',
      'profiles/sync.json',
    )).toEqual({
      owner: 'example',
      repo: 'cindr-profiles',
      branch: 'dev',
      path: 'data/sync.json',
    });
  });

  it('builds a payload with profiles and spools', () => {
    const spoolId = useSpoolStore.getState().addSpool({
      brand: 'Generic',
      material: 'PLA',
      colorHex: 'ffffff',
      colorName: 'White',
      initialWeightG: 1000,
      usedWeightG: 10,
      diameterMm: 1.75,
      notes: '',
    });

    const payload = buildProfileSpoolSyncPayload();

    expect(payload.kind).toBe('profile-spool-sync');
    expect(payload.slicer.printProfiles.length).toBeGreaterThan(0);
    expect(payload.spools.spools[0].id).toBe(spoolId);
  });

  it('applies incoming payload as last writer wins', () => {
    const payload = buildProfileSpoolSyncPayload();
    payload.slicer.printProfiles = [
      { ...DEFAULT_PRINT_PROFILES[0], id: 'remote-print', name: 'Remote Print' },
    ];
    payload.slicer.activePrintProfileId = 'remote-print';
    payload.spools.spools = [{
      id: 'remote-spool',
      brand: 'Remote',
      material: 'PETG',
      colorHex: '00ffaa',
      colorName: 'Aqua',
      initialWeightG: 750,
      usedWeightG: 25,
      diameterMm: 1.75,
      notes: 'synced',
      addedAt: 1,
    }];

    applyProfileSpoolSyncPayload(payload);

    expect(useSlicerStore.getState().printProfiles).toHaveLength(1);
    expect(useSlicerStore.getState().activePrintProfileId).toBe('remote-print');
    expect(useSpoolStore.getState().spools[0].brand).toBe('Remote');
  });

  it('captures a pending payload when sync is enabled', () => {
    useProfileSyncStore.getState().setEnabled(true);
    useSlicerStore.getState().updatePrintProfile(DEFAULT_PRINT_PROFILES[0].id, { name: 'Pending Print' });

    markProfileSpoolSyncPending();

    const sync = useProfileSyncStore.getState();
    expect(sync.hasPendingChanges).toBe(true);
    expect(sync.pendingPayloadJson).toContain('Pending Print');
  });

  it('clears pending payloads after a successful sync marker', () => {
    useProfileSyncStore.getState().setEnabled(true);
    markProfileSpoolSyncPending();

    useProfileSyncStore.getState().markSync('pushed');

    expect(useProfileSyncStore.getState()).toMatchObject({
      hasPendingChanges: false,
      pendingPayloadJson: null,
      pendingUpdatedAt: null,
    });
  });

  it('pushes pending payloads through the GitHub contents API', async () => {
    useProfileSyncStore.setState({
      enabled: true,
      repoUrl: 'https://github.com/example/cindr-profiles',
      branch: 'main',
      syncPath: 'profiles/sync.json',
      githubToken: 'ghp_test',
    });
    markProfileSpoolSyncPending();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ type: 'file', sha: 'abc123' }),
      })
      .mockResolvedValueOnce({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    await pushProfileSpoolSync();

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://api.github.com/repos/example/cindr-profiles/contents/profiles/sync.json?ref=main',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer ghp_test' }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://api.github.com/repos/example/cindr-profiles/contents/profiles/sync.json',
      expect.objectContaining({
        method: 'PUT',
        body: expect.stringContaining('"sha":"abc123"'),
      }),
    );
    expect(useProfileSyncStore.getState().hasPendingChanges).toBe(false);

    vi.unstubAllGlobals();
  });
});
