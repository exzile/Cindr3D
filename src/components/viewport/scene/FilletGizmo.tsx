/**
 * FilletGizmo — Fillet-dialog config over the shared EdgeOpGizmo (radius
 * drag handle along the fillet's outward bisector).
 */

import { useCallback } from 'react';
import { useCADStore } from '../../../store/cadStore';
import EdgeOpGizmo from './edgeOp/EdgeOpGizmo';

export default function FilletGizmo() {
  const activeDialog = useCADStore((s) => s.activeDialog);
  const filletEdgeIds = useCADStore((s) => s.filletEdgeIds);

  // Read/write the store directly (no React subscription) — stable identities
  // so EdgeOpGizmo's drag-listener effect doesn't re-bind every render.
  const getLiveValue = useCallback(() => useCADStore.getState().filletLiveRadius, []);
  const setLiveValue = useCallback((v: number) => useCADStore.getState().setFilletLiveRadius(v), []);

  return (
    <EdgeOpGizmo
      enabled={activeDialog === 'fillet'}
      edgeIds={filletEdgeIds}
      getLiveValue={getLiveValue}
      setLiveValue={setLiveValue}
      handleColor={0xff8800}
    />
  );
}
