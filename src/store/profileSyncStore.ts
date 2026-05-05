import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface ProfileSyncStore {
  enabled: boolean;
  repoUrl: string;
  branch: string;
  syncPath: string;
  githubToken: string;
  autoPullOnStart: boolean;
  autoPushOnSave: boolean;
  hasPendingChanges: boolean;
  pendingPayloadJson: string | null;
  pendingUpdatedAt: number | null;
  lastSyncAt: number | null;
  lastSyncStatus: 'idle' | 'pulling' | 'pushing' | 'pushed' | 'pulled' | 'error';
  lastSyncError: string | null;
  setEnabled: (enabled: boolean) => void;
  setRepoUrl: (repoUrl: string) => void;
  setBranch: (branch: string) => void;
  setSyncPath: (syncPath: string) => void;
  setGithubToken: (githubToken: string) => void;
  setAutoPullOnStart: (autoPullOnStart: boolean) => void;
  setAutoPushOnSave: (autoPushOnSave: boolean) => void;
  markPendingPush: (payloadJson: string) => void;
  markSync: (
    status: ProfileSyncStore['lastSyncStatus'],
    error?: string | null,
    options?: { clearPending?: boolean },
  ) => void;
}

export const useProfileSyncStore = create<ProfileSyncStore>()(
  persist(
    (set) => ({
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
      setEnabled: (enabled) => set({ enabled }),
      setRepoUrl: (repoUrl) => set({ repoUrl }),
      setBranch: (branch) => set({ branch: branch.trim() || 'main' }),
      setSyncPath: (syncPath) => set({ syncPath: syncPath.trim() || 'cindr3d-profile-sync.json' }),
      setGithubToken: (githubToken) => set({ githubToken }),
      setAutoPullOnStart: (autoPullOnStart) => set({ autoPullOnStart }),
      setAutoPushOnSave: (autoPushOnSave) => set({ autoPushOnSave }),
      markPendingPush: (payloadJson) => set({
        hasPendingChanges: true,
        pendingPayloadJson: payloadJson,
        pendingUpdatedAt: Date.now(),
      }),
      markSync: (status, error = null, options) => set(() => {
        const clearPending = options?.clearPending ?? (status === 'pushed' || status === 'pulled');
        return {
          lastSyncAt: Date.now(),
          lastSyncStatus: status,
          lastSyncError: error,
          ...(clearPending ? { hasPendingChanges: false, pendingPayloadJson: null, pendingUpdatedAt: null } : {}),
        };
      }),
    }),
    {
      name: 'cindr3d-profile-sync',
      version: 1,
    },
  ),
);
