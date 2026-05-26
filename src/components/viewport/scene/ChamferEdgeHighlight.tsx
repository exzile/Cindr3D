/**
 * ChamferEdgeHighlight — Chamfer-dialog config over the shared
 * EdgeOpEdgeHighlight. It uses the same `featureId|meshUuid:...` edge-ID
 * format as fillet so primitive/body edge selections resolve on commit.
 */

import { useCADStore } from '../../../store/cadStore';
import EdgeOpEdgeHighlight from './edgeOp/EdgeOpEdgeHighlight';

export default function ChamferEdgeHighlight() {
  const activeDialog = useCADStore((s) => s.activeDialog);
  const chamferEdgeIds = useCADStore((s) => s.chamferEdgeIds);
  const addChamferEdge = useCADStore((s) => s.addChamferEdge);
  const removeChamferEdge = useCADStore((s) => s.removeChamferEdge);

  return (
    <EdgeOpEdgeHighlight
      enabled={activeDialog === 'chamfer'}
      edgeIds={chamferEdgeIds}
      addEdge={addChamferEdge}
      removeEdge={removeChamferEdge}
      selectedColor={0xaa44ff}
    />
  );
}
