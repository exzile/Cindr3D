import { useProfileSyncStore } from '../store/profileSyncStore';
import { useSlicerStore } from '../store/slicerStore';
import { useSpoolStore, type Spool } from '../store/spoolStore';
import type { MaterialProfile, PrintProfile, PrinterProfile } from '../types/slicer';

export const PROFILE_SYNC_VERSION = 1;

export interface ProfileSpoolSyncPayload {
  version: number;
  app: 'cindr3d';
  kind: 'profile-spool-sync';
  exportedAt: string;
  slicer: {
    activePrinterProfileId: string;
    activeMaterialProfileId: string;
    activePrintProfileId: string;
    printerProfiles: PrinterProfile[];
    materialProfiles: MaterialProfile[];
    printProfiles: PrintProfile[];
  };
  spools: {
    spools: Spool[];
    activeSpoolId: string | null;
    loadedSpoolByPrinterId: Record<string, string | null>;
    lowStockThresholdByMaterial: Record<string, number>;
  };
}

export function normalizeProfileSyncUrl(repoUrl: string, branch: string, syncPath: string): string {
  const trimmed = repoUrl.trim();
  if (!trimmed) throw new Error('Enter a repository or raw sync URL first.');
  const path = syncPath.replace(/^\/+/, '') || 'cindr3d-profile-sync.json';
  const selectedBranch = branch.trim() || 'main';
  const url = new URL(trimmed);

  if (url.hostname === 'raw.githubusercontent.com') return url.href;

  if (url.hostname === 'github.com') {
    const parts = url.pathname.split('/').filter(Boolean);
    const [owner, repo, blob, blobBranch, ...blobPath] = parts;
    if (!owner || !repo) throw new Error('GitHub URL must include owner and repository.');
    if (blob === 'blob' && blobBranch && blobPath.length > 0) {
      return `https://raw.githubusercontent.com/${owner}/${repo}/${blobBranch}/${blobPath.join('/')}`;
    }
    return `https://raw.githubusercontent.com/${owner}/${repo}/${selectedBranch}/${path}`;
  }

  if (url.pathname.endsWith('.json')) return url.href;
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/${path}`;
  return url.href;
}

export function buildProfileSpoolSyncPayload(): ProfileSpoolSyncPayload {
  const slicer = useSlicerStore.getState();
  const spool = useSpoolStore.getState();
  return {
    version: PROFILE_SYNC_VERSION,
    app: 'cindr3d',
    kind: 'profile-spool-sync',
    exportedAt: new Date().toISOString(),
    slicer: {
      activePrinterProfileId: slicer.activePrinterProfileId,
      activeMaterialProfileId: slicer.activeMaterialProfileId,
      activePrintProfileId: slicer.activePrintProfileId,
      printerProfiles: slicer.printerProfiles,
      materialProfiles: slicer.materialProfiles,
      printProfiles: slicer.printProfiles,
    },
    spools: {
      spools: spool.spools,
      activeSpoolId: spool.activeSpoolId,
      loadedSpoolByPrinterId: spool.loadedSpoolByPrinterId,
      lowStockThresholdByMaterial: spool.lowStockThresholdByMaterial,
    },
  };
}

export function applyProfileSpoolSyncPayload(raw: unknown): void {
  if (!raw || typeof raw !== 'object') throw new Error('Sync payload is not a JSON object.');
  const payload = raw as Partial<ProfileSpoolSyncPayload>;
  if (payload.app !== 'cindr3d' || payload.kind !== 'profile-spool-sync') {
    throw new Error('Sync payload is not a Cindr3D profile/spool sync file.');
  }
  if (!payload.slicer || !payload.spools) throw new Error('Sync payload is missing profile or spool data.');
  const slicer = payload.slicer;
  const spools = payload.spools;
  if (!Array.isArray(slicer.printerProfiles) || !Array.isArray(slicer.materialProfiles) || !Array.isArray(slicer.printProfiles)) {
    throw new Error('Sync payload has invalid slicer profiles.');
  }
  if (!Array.isArray(spools.spools)) throw new Error('Sync payload has invalid spool inventory.');

  useSlicerStore.setState({
    printerProfiles: slicer.printerProfiles,
    materialProfiles: slicer.materialProfiles,
    printProfiles: slicer.printProfiles,
    activePrinterProfileId: slicer.activePrinterProfileId,
    activeMaterialProfileId: slicer.activeMaterialProfileId,
    activePrintProfileId: slicer.activePrintProfileId,
  });
  useSpoolStore.setState({
    spools: spools.spools,
    activeSpoolId: spools.activeSpoolId ?? null,
    loadedSpoolByPrinterId: spools.loadedSpoolByPrinterId ?? {},
    lowStockThresholdByMaterial: spools.lowStockThresholdByMaterial ?? {},
  });
}

export async function pullProfileSpoolSync(): Promise<ProfileSpoolSyncPayload> {
  const sync = useProfileSyncStore.getState();
  const url = normalizeProfileSyncUrl(sync.repoUrl, sync.branch, sync.syncPath);
  sync.markSync('pulling');
  try {
    const response = await fetch(url, { cache: 'no-cache' });
    if (!response.ok) throw new Error(`Pull failed (${response.status})`);
    const payload = await response.json() as ProfileSpoolSyncPayload;
    applyProfileSpoolSyncPayload(payload);
    useProfileSyncStore.getState().markSync('pulled');
    return payload;
  } catch (err) {
    useProfileSyncStore.getState().markSync('error', (err as Error).message);
    throw err;
  }
}

export function downloadProfileSpoolSyncPayload(): void {
  const payload = buildProfileSpoolSyncPayload();
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'cindr3d-profile-sync.json';
  a.click();
  URL.revokeObjectURL(url);
  useProfileSyncStore.getState().markSync('pushed');
}
