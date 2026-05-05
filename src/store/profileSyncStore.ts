import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface ProfileSyncStore {
  enabled: boolean;
  repoUrl: string;
  branch: string;
  syncPath: string;
  autoPullOnStart: boolean;
  lastSyncAt: number | null;
  lastSyncStatus: 'idle' | 'pulling' | 'pushed' | 'pulled' | 'error';
  lastSyncError: string | null;
  setEnabled: (enabled: boolean) => void;
  setRepoUrl: (repoUrl: string) => void;
  setBranch: (branch: string) => void;
  setSyncPath: (syncPath: string) => void;
  setAutoPullOnStart: (autoPullOnStart: boolean) => void;
  markSync: (status: ProfileSyncStore['lastSyncStatus'], error?: string | null) => void;
}

export const useProfileSyncStore = create<ProfileSyncStore>()(
  persist(
    (set) => ({
      enabled: false,
      repoUrl: '',
      branch: 'main',
      syncPath: 'cindr3d-profile-sync.json',
      autoPullOnStart: false,
      lastSyncAt: null,
      lastSyncStatus: 'idle',
      lastSyncError: null,
      setEnabled: (enabled) => set({ enabled }),
      setRepoUrl: (repoUrl) => set({ repoUrl }),
      setBranch: (branch) => set({ branch: branch.trim() || 'main' }),
      setSyncPath: (syncPath) => set({ syncPath: syncPath.trim() || 'cindr3d-profile-sync.json' }),
      setAutoPullOnStart: (autoPullOnStart) => set({ autoPullOnStart }),
      markSync: (status, error = null) => set({
        lastSyncAt: Date.now(),
        lastSyncStatus: status,
        lastSyncError: error,
      }),
    }),
    {
      name: 'cindr3d-profile-sync',
      version: 1,
    },
  ),
);
