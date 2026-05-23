import { useCADStore } from "../../../store/cadStore";
import { DialogShell } from "../common/DialogShell";
import type { Feature } from "../../../types/cad";
import { resolveChamferDistances } from "../../../utils/geometry/chamferGeometry";
import type { ChamferParams } from "./chamferDialog/types";
import { ChamferAdvancedOptions } from "./chamferDialog/ChamferAdvancedOptions";
import { ChamferModeFields } from "./chamferDialog/ChamferModeFields";
import { ChamferPickHeader } from "./chamferDialog/ChamferPickHeader";
import { useChamferDialogState } from "./chamferDialog/useChamferDialogState";
import { EdgeSelectionList } from "./edgeDialog/EdgeSelectionList";

export type {
  ChamferMode,
  ChamferCornerType,
  ChamferParams,
} from "./chamferDialog/types";

interface ChamferDialogProps {
  open: boolean;
  selectedEdgeCount: number;
  edgeIds: string[];
  onRemoveEdge: (id: string) => void;
  onClose: () => void;
  onConfirm: (params: ChamferParams) => void;
}

function ChamferDialogUI({
  open,
  selectedEdgeCount,
  edgeIds,
  onRemoveEdge,
  onClose,
  onConfirm,
}: ChamferDialogProps) {
  const dialog = useChamferDialogState(onConfirm);

  if (!open) return null;

  return (
    <DialogShell
      title="Chamfer"
      onClose={onClose}
      size="sm"
      overlayClassName="edge-pick-dialog"
      onConfirm={dialog.handleConfirm}
      confirmDisabled={selectedEdgeCount === 0}
    >
      <ChamferPickHeader selectedEdgeCount={selectedEdgeCount} />
      <EdgeSelectionList edgeIds={edgeIds} onRemoveEdge={onRemoveEdge} />
      <ChamferModeFields dialog={dialog} />
      <ChamferAdvancedOptions dialog={dialog} />
    </DialogShell>
  );
}

export function ChamferDialog({ onClose }: { onClose: () => void }) {
  const addFeature = useCADStore((s) => s.addFeature);
  const chamferEdgeIds = useCADStore((s) => s.chamferEdgeIds);
  const removeChamferEdge = useCADStore((s) => s.removeChamferEdge);
  const editingFeatureId = useCADStore((s) => s.editingFeatureId);
  const features = useCADStore((s) => s.features);
  const updateFeatureParams = useCADStore((s) => s.updateFeatureParams);
  const commitChamfer = useCADStore((s) => s.commitChamfer);
  const replayEdgeCutFeature = useCADStore((s) => s.replayEdgeCutFeature);

  const editing = editingFeatureId
    ? features.find((f) => f.id === editingFeatureId)
    : null;
  const p = editing?.params ?? {};
  const existingEdgeIds =
    typeof p.edgeIds === "string" ? p.edgeIds.split(",").filter(Boolean) : [];

  const handleConfirm = (params: ChamferParams) => {
    const edgeIds =
      chamferEdgeIds.length > 0 ? chamferEdgeIds : existingEdgeIds;
    const edgeIdsStr = edgeIds.join(",");
    if (editing) {
      updateFeatureParams(editing.id, { ...params, edgeIds: edgeIdsStr });
      replayEdgeCutFeature(editing.id);
    } else {
      const feature: Feature = {
        id: crypto.randomUUID(),
        name: `Chamfer (d=${params.distance})`,
        type: "chamfer",
        params: { ...params, edgeIds: edgeIdsStr },
        visible: true,
        suppressed: false,
        timestamp: Date.now(),
      };
      addFeature(feature);
      onClose();
      const [d1, d2] = resolveChamferDistances(params);
      setTimeout(
        () =>
          commitChamfer(
            d1,
            d2,
            feature.id,
            params as unknown as Record<string, unknown>,
          ),
        0,
      );
      return;
    }
    onClose();
  };

  return (
    <ChamferDialogUI
      open={true}
      selectedEdgeCount={chamferEdgeIds.length || existingEdgeIds.length}
      edgeIds={chamferEdgeIds}
      onRemoveEdge={removeChamferEdge}
      onClose={onClose}
      onConfirm={handleConfirm}
    />
  );
}
