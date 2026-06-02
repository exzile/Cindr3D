/**
 * FillEdgePicker — edge picking for the Fill Surface dialog.
 *
 * When the 'fill' dialog is open, allows the user to click BRep edges to
 * define the boundary loop. Each picked edge's ID, endpoint coordinates,
 * and first adjacent face ptr are stored in fillBoundaryEdgeData so commitFill can:
 *   (a) assemble a 3-D boundary polygon for the OCC/THREE fill solver,
 *   (b) resolve the OCC TopoDS_Edge VIEW for G1/G2 continuity constraints, and
 *   (c) resolve the adjacent TopoDS_Face VIEW for true face-tangency (Add_3).
 */

import { useCallback } from 'react';
import { useCADStore } from '../../../store/cadStore';
import { globalBRepBodyRegistry } from '../../../engine/occ/globalRegistry';
import { getOccSync } from '../../../engine/occ/loader';
import { occDeref } from '../../../engine/occ/brepBody';
import EdgeOpEdgeHighlight from './edgeOp/EdgeOpEdgeHighlight';

/**
 * Find the pointer key of the first face in `body.faceIds` that contains `edgePtr`.
 * Uses a TopExp_Explorer to iterate edges within each face and matches by ptr.
 * Returns undefined when OCC is unavailable or no adjacent face is found.
 */
function findAdjacentFacePtr(bodyId: string, edgePtr: number): number | undefined {
  const occ = getOccSync();
  if (!occ) return undefined;
  const body = globalBRepBodyRegistry.get(bodyId);
  if (!body) return undefined;
  const edgeHandle = body.edgeIds.get(edgePtr);
  if (!edgeHandle) return undefined;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const oc = occ.oc as any;
  try {
    // Dereference the edge to get its ptr for comparison
    const edgeShapeView = occDeref(occ.oc, edgeHandle, oc.TopoDS_Shape);
    const edgeShapePtr: number = edgeShapeView?.ptr ?? 0;

    // Iterate faces and find the first one containing our edge
    for (const [facePtr, faceHandle] of body.faceIds) {
      const faceShapeView = occDeref(occ.oc, faceHandle, oc.TopoDS_Shape);
      if (!faceShapeView) continue;

      let found = false;
      let exp: { More(): boolean; Current(): { ptr?: number }; Next(): void; delete(): void } | undefined;
      try {
        exp = new oc.TopExp_Explorer_2(
          faceShapeView,
          oc.TopAbs_ShapeEnum.TopAbs_EDGE,
          oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
        );
        while (exp.More()) {
          const cur = exp.Current();
          if (cur?.ptr && (cur.ptr === edgeShapePtr || cur.ptr === edgePtr)) {
            found = true;
            break;
          }
          exp.Next();
        }
      } finally {
        exp?.delete();
      }
      if (found) return facePtr;
    }
  } catch {
    // OCC topology query failed — return undefined gracefully
  }
  return undefined;
}

export default function FillEdgePicker() {
  const activeDialog = useCADStore((s) => s.activeDialog);
  const fillBoundaryEdgeIds = useCADStore((s) => s.fillBoundaryEdgeIds);
  const addFillBoundaryEdge = useCADStore((s) => s.addFillBoundaryEdge);

  const removeFillEdge = useCallback((edgeId: string) => {
    useCADStore.setState((s) => ({
      fillBoundaryEdgeIds: s.fillBoundaryEdgeIds.filter((id) => id !== edgeId),
      fillBoundaryEdgeData: s.fillBoundaryEdgeData.filter((e) => e.id !== edgeId),
    }));
  }, []);

  const addEdge = useCallback((edgeId: string) => {
    // Extract endpoint coordinates from the OCC body tessellation.
    // Edge ID format: "occ:<bodyId>:<edgePtr>"
    let a: [number, number, number] | undefined;
    let b: [number, number, number] | undefined;
    let adjacentFacePtr: number | undefined;

    const parts = edgeId.split(':');
    if (parts.length >= 3 && parts[0] === 'occ') {
      const bodyId = parts[1];
      const edgePtr = Number(parts[2]);
      const body = globalBRepBodyRegistry.get(bodyId);
      const polyline = body?._tessellation?.edgePolylines?.get(edgePtr);
      if (polyline && polyline.length >= 6) {
        a = [polyline[0], polyline[1], polyline[2]];
        b = [polyline[polyline.length - 3], polyline[polyline.length - 2], polyline[polyline.length - 1]];
      }
      // Find adjacent face for G1/G2 face-tangency at commit time
      adjacentFacePtr = findAdjacentFacePtr(bodyId, edgePtr);
    }

    addFillBoundaryEdge(edgeId, a, b, adjacentFacePtr);
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
