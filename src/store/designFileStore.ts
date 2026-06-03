import { create } from 'zustand';

export type DesignRecentFileSource = 'picker' | 'folder' | 'upload' | 'save';

export interface DesignRecentFile {
  id: string;
  name: string;
  displayPath?: string;
  source: DesignRecentFileSource;
  openedAt: number;
}

interface DesignFileStore {
  currentDesignFile: string | null;
  fileHandle: FileSystemFileHandle | null;
  recentFiles: DesignRecentFile[];
  setCurrentDesignFile: (next: string | null) => void;
  setFileHandle: (handle: FileSystemFileHandle | null) => void;
  addRecentFile: (file: Omit<DesignRecentFile, 'openedAt'> & { openedAt?: number }) => void;
  clearRecentFiles: () => void;
}

const RECENTS_STORAGE_KEY = 'cindr3d-design-recent-files';
const MAX_RECENT_FILES = 12;
const recentFileHandles = new Map<string, FileSystemFileHandle>();

function loadRecentFiles(): DesignRecentFile[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENTS_STORAGE_KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is DesignRecentFile => (
        typeof entry?.id === 'string'
        && typeof entry?.name === 'string'
        && typeof entry?.source === 'string'
        && typeof entry?.openedAt === 'number'
      ))
      .slice(0, MAX_RECENT_FILES);
  } catch {
    return [];
  }
}

function saveRecentFiles(files: DesignRecentFile[]) {
  try {
    localStorage.setItem(RECENTS_STORAGE_KEY, JSON.stringify(files));
  } catch {
    // Recent files are convenience metadata; failure should never block file IO.
  }
}

function pruneRecentFileHandles(files: DesignRecentFile[]) {
  const retainedIds = new Set(files.map((file) => file.id));
  for (const id of recentFileHandles.keys()) {
    if (!retainedIds.has(id)) recentFileHandles.delete(id);
  }
}

export function designFileBaseName(filename: string): string {
  return filename.replace(/\.(dznd|json)$/i, '') || 'design';
}

export function designRecentFileId(source: DesignRecentFileSource, name: string, displayPath?: string): string {
  return `${source}:${displayPath ?? name}`.toLowerCase();
}

export function attachDesignRecentFileHandle(id: string, handle: FileSystemFileHandle) {
  recentFileHandles.set(id, handle);
}

export function getDesignRecentFileHandle(id: string): FileSystemFileHandle | null {
  return recentFileHandles.get(id) ?? null;
}

export const useDesignFileStore = create<DesignFileStore>((set) => ({
  currentDesignFile: null,
  fileHandle: null,
  recentFiles: loadRecentFiles(),

  setCurrentDesignFile: (next) => set({ currentDesignFile: next }),
  setFileHandle: (handle) => set({ fileHandle: handle }),

  addRecentFile: (file) => set((state) => {
    const nextFile: DesignRecentFile = {
      ...file,
      openedAt: file.openedAt ?? Date.now(),
    };
    const next = [
      nextFile,
      ...state.recentFiles.filter((entry) => entry.id !== nextFile.id),
    ].slice(0, MAX_RECENT_FILES);
    saveRecentFiles(next);
    pruneRecentFileHandles(next);
    return { recentFiles: next };
  }),

  clearRecentFiles: () => {
    saveRecentFiles([]);
    recentFileHandles.clear();
    set({ recentFiles: [] });
  },
}));
