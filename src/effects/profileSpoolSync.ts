import { useProfileSyncStore } from '../store/profileSyncStore';
import { useSlicerStore } from '../store/slicerStore';
import { useSpoolStore } from '../store/spoolStore';
import { markProfileSpoolSyncPending, pullProfileSpoolSync } from '../utils/profileSpoolSync';

const sync = useProfileSyncStore.getState();
let pendingTimer: ReturnType<typeof setTimeout> | null = null;

function queuePendingSyncPayload(): void {
  if (pendingTimer) clearTimeout(pendingTimer);
  pendingTimer = setTimeout(() => {
    pendingTimer = null;
    markProfileSpoolSyncPending();
  }, 250);
}

if (sync.enabled && sync.autoPullOnStart && sync.repoUrl.trim()) {
  void pullProfileSpoolSync().catch(() => {
    // Status is recorded in the sync store for the settings panel.
  });
}

useSlicerStore.subscribe(queuePendingSyncPayload);
useSpoolStore.subscribe(queuePendingSyncPayload);
