/**
 * ChamferPreview — Chamfer-dialog config over the shared EdgeOpPreview. The
 * compute fn is the same computeChamferGeometry the commit uses, so the live
 * preview matches the committed result exactly. The gizmo/dialog drive the
 * primary (equal-distance) setback; the dialog's two-distance / angle modes
 * are resolved at commit time.
 */

import { useCallback } from 'react';
import type * as THREE from 'three';
import { useCADStore } from '../../../store/cadStore';
import { computeChamferGeometry } from '../../../utils/geometry/chamferGeometry';
import type { PickedEdge } from '../../../utils/geometry/edgeCutCore';
import EdgeOpPreview from './edgeOp/EdgeOpPreview';

export default function ChamferPreview() {
  const activeDialog = useCADStore((s) => s.activeDialog);
  const chamferEdgeIds = useCADStore((s) => s.chamferEdgeIds);
  const chamferLiveDistance = useCADStore((s) => s.chamferLiveDistance);

  const compute = useCallback(
    (srcGeo: THREE.BufferGeometry, edges: PickedEdge[], value: number) =>
      computeChamferGeometry(srcGeo, edges, value),
    [],
  );

  return (
    <EdgeOpPreview
      enabled={activeDialog === 'chamfer'}
      edgeIds={chamferEdgeIds}
      liveValue={chamferLiveDistance}
      compute={compute}
    />
  );
}
