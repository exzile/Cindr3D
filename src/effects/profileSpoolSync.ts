import { useProfileSyncStore } from '../store/profileSyncStore';
import { pullProfileSpoolSync } from '../utils/profileSpoolSync';

const sync = useProfileSyncStore.getState();

if (sync.enabled && sync.autoPullOnStart && sync.repoUrl.trim()) {
  void pullProfileSpoolSync().catch(() => {
    // Status is recorded in the sync store for the settings panel.
  });
}
