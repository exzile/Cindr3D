/**
 * FillEdgePicker — edge picking for the Fill Surface dialog.
 *
 * When the 'fill' dialog is open, allows the user to click BRep edges to
 * define the boundary loop. Each picked edge's ID and endpoint coordinates
 * are stored in fillBoundaryEdgeData so commitFill can:
 *   (a) assemble a 3-D boundary polygon for the OCC/THREE fill solver, and
 *   (b) resolve the OCC TopoDS_Edge reference for G1/G2 continuity constraints
 *       when BRepOffsetAPI_MakeFilling is used.
 */

import { useCallback } from 'react';
import { useCADStore } from '../../../store/cadStore';
import { globalBRepBodyRegistry } from '../../../engine/occ/globalRegistry';
import EdgeOpEdgeHighlight from './edgeOp/EdgeOpEdgeHighlight';

export default function FillEdgePicker() {
  const activeDialog = useCADStore((s) => s.activeDialog);
  const fillBoundaryEdgeIds = useCADStore((s) => s.fillBoundaryEdgeIds);
  const addFillBoundaryEdge = useCADStore((s) => s.addFillBoundaryEdge);

  const removeFillEdge = useCallback((edgeId: string) => {
    // Remove is handled by the store via the fillBoundaryEdgeIds filter in closeFillDialog.
    // Here we just re-open with the remaining IDs. For now, clicking a selected edge
    // removes it from the list — replicate by rebuilding the list without this ID.
    useCADStore.setState((s) => ({
      fillBoundaryEdgeIds: s.fillBoundaryEdgeIds.filter((id) => id !== edgeId),
      fillBoundaryEdgeData: s.fillBoundaryEdgeData.filter((e) => e.id !== edgeId),
    }));
  }, []);

  const addEdge = useCallback((edgeId: string) => {
    // Extract endpoint coordinates from the OCC body tessellation.
    // Edge ID format: "occ:<bodyId>:<edgeNum>"
    let a: [number, number, number] | undefined;
    let b: [number, number, number] | undefined;

    const parts = edgeId.split(':');
    if (parts.length >= 3 && parts[0] === 'occ') {
      const bodyId = parts[1];
      const edgeNum = Number(parts[2]);
      const body = globalBRepBodyRegistry.get(bodyId);
      const polyline = body?._tessellation?.edgePolylines?.get(edgeNum);
      if (polyline && polyline.length >= 6) {
        a = [polyline[0], polyline[1], polyline[2]];
        b = [polyline[polyline.length - 3], polyline[polyline.length - 2], polyline[polyline.length - 1]];
      }
    }

    addFillBoundaryEdge(edgeId, a, b);
  }, [addFillBoundaryEdge]);

  return (
    <EdgeOpEdgeHighlight
      enabled={activeDialog === 'fill'}
      edgeIds={fillBoundaryEdgeIds}
      addEdge={addEdge}
      removeEdge={removeFillEdge}
      selectedColor={0x00d4ff}
      allowCurvedEdges
    />
  );
}
