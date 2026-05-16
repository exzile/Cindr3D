/**
 * FilletEdgeHighlight — Fillet-dialog config over the shared
 * EdgeOpEdgeHighlight (edge picking + pulsing highlight + crosshair cursor).
 */

import { useCADStore } from '../../../store/cadStore';
import EdgeOpEdgeHighlight from './edgeOp/EdgeOpEdgeHighlight';

export default function FilletEdgeHighlight() {
  const activeDialog = useCADStore((s) => s.activeDialog);
  const filletEdgeIds = useCADStore((s) => s.filletEdgeIds);
  const addFilletEdge = useCADStore((s) => s.addFilletEdge);
  const removeFilletEdge = useCADStore((s) => s.removeFilletEdge);

  return (
    <EdgeOpEdgeHighlight
      enabled={activeDialog === 'fillet'}
      edgeIds={filletEdgeIds}
      addEdge={addFilletEdge}
      removeEdge={removeFilletEdge}
      selectedColor={0xff6600}
    />
  );
}
