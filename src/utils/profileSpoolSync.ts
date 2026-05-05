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

export interface GitHubProfileSyncTarget {
  owner: string;
  repo: string;
  branch: string;
  path: string;
}

export function resolveGitHubProfileSyncTarget(
  repoUrl: string,
  branch: string,
  syncPath: string,
): GitHubProfileSyncTarget {
  const trimmed = repoUrl.trim();
  if (!trimmed) throw new Error('Enter a GitHub repository URL first.');
  const url = new URL(trimmed);
  if (url.hostname !== 'github.com' && url.hostname !== 'raw.githubusercontent.com') {
    throw new Error('Push sync currently supports GitHub repository URLs.');
  }

  const parts = url.pathname.split('/').filter(Boolean);
  if (url.hostname === 'raw.githubusercontent.com') {
    const [owner, repo, rawBranch, ...rawPath] = parts;
    if (!owner || !repo || !rawBranch || rawPath.length === 0) {
      throw new Error('Raw GitHub URL must include owner, repo, branch, and JSON path.');
    }
    return { owner, repo, branch: rawBranch, path: rawPath.join('/') };
  }

  const [owner, repo, blob, blobBranch, ...blobPath] = parts;
  if (!owner || !repo) throw new Error('GitHub URL must include owner and repository.');
  if (blob === 'blob' && blobBranch && blobPath.length > 0) {
    return { owner, repo, branch: blobBranch, path: blobPath.join('/') };
  }
  return {
    owner,
    repo,
    branch: branch.trim() || 'main',
    path: syncPath.replace(/^\/+/, '') || 'cindr3d-profile-sync.json',
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

function encodeBase64Utf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
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

export function serializeProfileSpoolSyncPayload(): string {
  return JSON.stringify(buildProfileSpoolSyncPayload(), null, 2);
}

export function markProfileSpoolSyncPending(): void {
  const sync = useProfileSyncStore.getState();
  if (!sync.enabled) return;
  if (sync.lastSyncStatus === 'pulling') return;
  if (sync.lastSyncStatus === 'pulled' && sync.lastSyncAt && Date.now() - sync.lastSyncAt < 1000) return;
  sync.markPendingPush(serializeProfileSpoolSyncPayload());
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

export async function pushProfileSpoolSync(): Promise<void> {
  const sync = useProfileSyncStore.getState();
  const target = resolveGitHubProfileSyncTarget(sync.repoUrl, sync.branch, sync.syncPath);
  const token = sync.githubToken.trim();
  if (!token) throw new Error('Enter a GitHub fine-grained token with Contents read/write access.');

  const payloadJson = sync.pendingPayloadJson ?? serializeProfileSpoolSyncPayload();
  const pendingUpdatedAt = sync.pendingUpdatedAt;
  const apiUrl = `https://api.github.com/repos/${target.owner}/${target.repo}/contents/${target.path}`;
  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  sync.markSync('pushing', null, { clearPending: false });
  try {
    const current = await fetch(`${apiUrl}?ref=${encodeURIComponent(target.branch)}`, { headers });
    let sha: string | undefined;
    if (current.ok) {
      const existing = await current.json() as { sha?: string; type?: string };
      if (existing.type && existing.type !== 'file') throw new Error('GitHub sync path is not a file.');
      sha = existing.sha;
    } else if (current.status !== 404) {
      throw new Error(`GitHub lookup failed (${current.status})`);
    }

    const response = await fetch(apiUrl, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        message: 'Sync Cindr3D profiles and spools',
        content: encodeBase64Utf8(payloadJson),
        branch: target.branch,
        ...(sha ? { sha } : {}),
      }),
    });
    if (!response.ok) throw new Error(`GitHub push failed (${response.status})`);

    const latest = useProfileSyncStore.getState();
    latest.markSync('pushed', null, {
      clearPending: latest.pendingUpdatedAt === pendingUpdatedAt,
    });
  } catch (err) {
    useProfileSyncStore.getState().markSync('error', (err as Error).message, { clearPending: false });
    throw err;
  }
}

export function downloadProfileSpoolSyncPayload(): void {
  const blob = new Blob([serializeProfileSpoolSyncPayload()], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'cindr3d-profile-sync.json';
  a.click();
  URL.revokeObjectURL(url);
  useProfileSyncStore.getState().markSync('pushed');
}
