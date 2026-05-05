import { useProfileSyncStore } from '../store/profileSyncStore';
import { useSlicerStore } from '../store/slicerStore';
import { useSpoolStore } from '../store/spoolStore';
import { markProfileSpoolSyncPending, pullProfileSpoolSync, pushProfileSpoolSync } from '../utils/profileSpoolSync';

const sync = useProfileSyncStore.getState();
let pendingTimer: ReturnType<typeof setTimeout> | null = null;
let autoPushInFlight = false;

async function pushPendingProfileSyncIfConfigured(): Promise<void> {
  const latest = useProfileSyncStore.getState();
  if (!latest.enabled || !latest.autoPushOnSave || !latest.repoUrl.trim() || !latest.githubToken.trim()) return;
  if (autoPushInFlight || !latest.hasPendingChanges) return;
  autoPushInFlight = true;
  try {
    await pushProfileSpoolSync();
  } catch {
    // Status is recorded in the sync store for the settings panel.
  } finally {
    autoPushInFlight = false;
    const afterPush = useProfileSyncStore.getState();
    if (afterPush.autoPushOnSave && afterPush.hasPendingChanges) {
      void pushPendingProfileSyncIfConfigured();
    }
  }
}

function queuePendingSyncPayload(): void {
  if (pendingTimer) clearTimeout(pendingTimer);
  pendingTimer = setTimeout(() => {
    pendingTimer = null;
    markProfileSpoolSyncPending();
    void pushPendingProfileSyncIfConfigured();
  }, 250);
}

if (sync.enabled && sync.autoPullOnStart && sync.repoUrl.trim()) {
  void pullProfileSpoolSync().catch(() => {
    // Status is recorded in the sync store for the settings panel.
  });
}

useSlicerStore.subscribe(queuePendingSyncPayload);
useSpoolStore.subscribe(queuePendingSyncPayload);
