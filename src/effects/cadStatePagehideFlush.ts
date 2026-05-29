/**
 * cadStatePagehideFlush.ts
 *
 * Writes the current feature ID list to localStorage synchronously when the
 * page is unloaded (pagehide). This is used by the CAD persist config's
 * onRehydrateStorage to guard against the IDB async-write race condition:
 *
 *   1. User presses Ctrl+Z  →  zustand-persist starts an async IDB write
 *   2. User immediately hits Ctrl+R  →  page unloads before IDB commits
 *   3. New load reads stale IDB state (e.g. fillet still present after undo)
 *
 * The pagehide handler fires synchronously before the page is actually
 * unloaded, so localStorage always reflects the true last-known state.
 * onRehydrateStorage reads FLUSH_KEY and filters out IDB features that
 * should no longer exist.
 */
import { useCADStore } from '../store/cadStore';

export const PAGEHIDE_FLUSH_KEY = 'cad-pagehide-flush';

window.addEventListener('pagehide', () => {
  try {
    const features = useCADStore.getState().features;
    localStorage.setItem(
      PAGEHIDE_FLUSH_KEY,
      JSON.stringify({ featureIds: features.map((f) => f.id) }),
    );
  } catch {
    // localStorage unavailable or quota exceeded — silently skip.
  }
});
