import { useCADStore } from "../../../store/cadStore";
import type { Feature } from "../../../types/cad";
import { resolveChamferDistances } from "../../../utils/geometry/chamferGeometry";
import { DialogShell } from "../common/DialogShell";
import { ChamferAdvancedOptions } from "./chamferDialog/ChamferAdvancedOptions";
import { ChamferModeFields } from "./chamferDialog/ChamferModeFields";
import { ChamferPickHeader } from "./chamferDialog/ChamferPickHeader";
import type { ChamferParams } from "./chamferDialog/types";
import { useChamferDialogState } from "./chamferDialog/useChamferDialogState";
import { EdgeSelectionList } from "./edgeDialog/EdgeSelectionList";

export type {
  ChamferCornerType,
  ChamferMode,
  ChamferParams,
} from "./chamferDialog/types";

interface ChamferDialogProps {
  open: boolean;
  selectedEdgeCount: number;
  edgeIds: string[];
  onRemoveEdge: (id: string) => void;
  onClose: () => void;
  onConfirm: (params: ChamferParams) => void;
  /** When editing an existing chamfer, seed all fields from the stored params. */
  initialParams?: Record<string, unknown>;
}

function ChamferDialogUI({
  open,
  selectedEdgeCount,
  edgeIds,
  onRemoveEdge,
  onClose,
  onConfirm,
  initialParams,
}: ChamferDialogProps) {
  const dialog = useChamferDialogState(onConfirm, initialParams);

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

// Store-connected wrapper (used via activeDialog='chamfer')
export function ChamferDialog({ onClose }: { onClose: () => void }) {
  const addFeature = useCADStore((s) => s.addFeature);
  const chamferEdgeIds = useCADStore((s) => s.chamferEdgeIds);
  const removeChamferEdge = useCADStore((s) => s.removeChamferEdge);
  const editingFeatureId = useCADStore((s) => s.editingFeatureId);
  const features = useCADStore((s) => s.features);
  const updateFeatureParams = useCADStore((s) => s.updateFeatureParams);
  const renameFeature = useCADStore((s) => s.renameFeature);
  const commitChamfer = useCADStore((s) => s.commitChamfer);
  const replayEdgeCutFeature = useCADStore((s) => s.replayEdgeCutFeature);

  const editing = editingFeatureId
    ? features.find((feature) => feature.id === editingFeatureId)
    : null;
  const params = editing?.params ?? {};
  const existingEdgeIds =
    typeof params.edgeIds === "string"
      ? params.edgeIds.split(",").filter(Boolean)
      : [];

  const handleConfirm = (nextParams: ChamferParams) => {
    const edgeIds =
      chamferEdgeIds.length > 0 ? chamferEdgeIds : existingEdgeIds;
    const edgeIdsStr = edgeIds.join(",");
    const [d1, d2] = resolveChamferDistances(nextParams);
    if (editing) {
      updateFeatureParams(editing.id, { ...nextParams, edgeIds: edgeIdsStr });
      renameFeature(editing.id, `Chamfer (d=${d1})`);
      replayEdgeCutFeature(editing.id);
    } else {
      const feature: Feature = {
        id: crypto.randomUUID(),
        name: `Chamfer (d=${d1})`,
        type: "chamfer",
        params: { ...nextParams, edgeIds: edgeIdsStr },
        visible: true,
        suppressed: false,
        timestamp: Date.now(),
      };
      addFeature(feature);
      onClose();
      setTimeout(
        () =>
          commitChamfer(
            d1,
            d2,
            feature.id,
            nextParams as unknown as Record<string, unknown>,
          ),
        0,
      );
      return;
    }
    onClose();
  };

  return (
    <ChamferDialogUI
      open
      selectedEdgeCount={chamferEdgeIds.length || existingEdgeIds.length}
      edgeIds={chamferEdgeIds.length > 0 ? chamferEdgeIds : existingEdgeIds}
      onRemoveEdge={removeChamferEdge}
      onClose={onClose}
      onConfirm={handleConfirm}
      initialParams={editing ? params : undefined}
    />
  );
}
