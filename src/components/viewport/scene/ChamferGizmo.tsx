/**
 * ChamferGizmo — Chamfer-dialog config over the shared EdgeOpGizmo (distance
 * drag handle along the chamfer's outward bisector).
 */

import { useCallback } from 'react';
import { useCADStore } from '../../../store/cadStore';
import EdgeOpGizmo from './edgeOp/EdgeOpGizmo';

export default function ChamferGizmo() {
  const activeDialog = useCADStore((s) => s.activeDialog);
  const chamferEdgeIds = useCADStore((s) => s.chamferEdgeIds);

  const getLiveValue = useCallback(() => useCADStore.getState().chamferLiveDistance, []);
  const setLiveValue = useCallback((v: number) => useCADStore.getState().setChamferLiveDistance(v), []);

  return (
    <EdgeOpGizmo
      enabled={activeDialog === 'chamfer'}
      edgeIds={chamferEdgeIds}
      getLiveValue={getLiveValue}
      setLiveValue={setLiveValue}
      handleColor={0x00bcd4}
    />
  );
}
