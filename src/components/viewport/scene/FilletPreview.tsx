/**
 * FilletPreview — Fillet-dialog config over the shared EdgeOpPreview. The
 * compute fn is the same computeFilletGeometry the commit uses, so the live
 * preview matches the committed result exactly.
 */

import { useCallback } from 'react';
import type * as THREE from 'three';
import { useCADStore } from '../../../store/cadStore';
import { computeFilletGeometry } from '../../../utils/geometry/filletGeometry';
import type { PickedEdge } from '../../../utils/geometry/edgeCutCore';
import EdgeOpPreview from './edgeOp/EdgeOpPreview';

export default function FilletPreview() {
  const activeDialog = useCADStore((s) => s.activeDialog);
  const filletEdgeIds = useCADStore((s) => s.filletEdgeIds);
  const filletLiveRadius = useCADStore((s) => s.filletLiveRadius);

  const compute = useCallback(
    (srcGeo: THREE.BufferGeometry, edges: PickedEdge[], value: number) =>
      computeFilletGeometry(srcGeo, edges, value, 4),
    [],
  );

  return (
    <EdgeOpPreview
      enabled={activeDialog === 'fillet'}
      edgeIds={filletEdgeIds}
      liveValue={filletLiveRadius}
      compute={compute}
    />
  );
}
