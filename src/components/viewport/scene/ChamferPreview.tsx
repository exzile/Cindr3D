/**
 * ChamferPreview — Chamfer-dialog config over the shared EdgeOpPreview. The
 * worker runs the same computeChamferGeometry the commit uses, so the live
 * preview matches the committed result exactly. The gizmo/dialog drive the
 * primary (equal-distance) setback; the dialog's two-distance / angle modes
 * are resolved at commit time.
 */

import { useCADStore } from "../../../store/cadStore";
import EdgeOpPreview from "./edgeOp/EdgeOpPreview";

export default function ChamferPreview() {
  const activeDialog = useCADStore((s) => s.activeDialog);
  const chamferEdgeIds = useCADStore((s) => s.chamferEdgeIds);
  const chamferLiveDistance = useCADStore((s) => s.chamferLiveDistance);
  const chamferPreviewParams = useCADStore((s) => s.chamferPreviewParams);

  return (
    <EdgeOpPreview
      enabled={activeDialog === "chamfer"}
      edgeIds={chamferEdgeIds}
      liveValue={chamferLiveDistance}
      params={chamferPreviewParams}
      toolType="chamfer"
    />
  );
}
