/**
 * FilletPreview — Fillet-dialog config over the shared EdgeOpPreview. The
 * worker runs the same computeFilletGeometry the commit uses, so the live
 * preview matches the committed result exactly.
 */

import { useCADStore } from "../../../store/cadStore";
import EdgeOpPreview from "./edgeOp/EdgeOpPreview";

export default function FilletPreview() {
  const activeDialog = useCADStore((s) => s.activeDialog);
  const filletEdgeIds = useCADStore((s) => s.filletEdgeIds);
  const filletLiveRadius = useCADStore((s) => s.filletLiveRadius);
  const filletPreviewParams = useCADStore((s) => s.filletPreviewParams);

  return (
    <EdgeOpPreview
      enabled={activeDialog === "fillet"}
      edgeIds={filletEdgeIds}
      liveValue={filletLiveRadius}
      params={filletPreviewParams}
      toolType="fillet"
    />
  );
}
