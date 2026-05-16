/**
 * ChamferEdgeHighlight — Chamfer-dialog config over the shared
 * EdgeOpEdgeHighlight. Now uses the same `featureId|meshUuid:…` edge-ID
 * format as fillet (the old bespoke copy used the legacy prefix-less format
 * and so could not resolve primitive bodies on commit).
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
      selectedColor={0xaacc00}
    />
  );
}
