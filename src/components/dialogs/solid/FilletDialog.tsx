import { useCADStore } from "../../../store/cadStore";
import { DialogShell } from "../common/DialogShell";
import type { Feature } from "../../../types/cad";
import type { FilletParams } from "./filletDialog/types";
import { useFilletDialogState } from "./filletDialog/useFilletDialogState";
import { FilletPickHeader } from "./filletDialog/FilletPickHeader";
import { FilletModeFields } from "./filletDialog/FilletModeFields";
import { FilletEdgeSets } from "./filletDialog/FilletEdgeSets";
import { FilletAdvancedOptions } from "./filletDialog/FilletAdvancedOptions";
import { EdgeSelectionList } from "./edgeDialog/EdgeSelectionList";

export type {
  FilletEdgeSet,
  FilletMode,
  FilletParams,
} from "./filletDialog/types";

interface FilletDialogProps {
  open: boolean;
  selectedEdgeCount: number;
  edgeIds: string[];
  onRemoveEdge: (id: string) => void;
  onClose: () => void;
  onConfirm: (params: FilletParams) => void;
}

function FilletDialogUI({
  open,
  selectedEdgeCount,
  edgeIds,
  onRemoveEdge,
  onClose,
  onConfirm,
}: FilletDialogProps) {
  const dialog = useFilletDialogState(onConfirm);

  if (!open) return null;

  return (
    <DialogShell
      title="Fillet"
      onClose={onClose}
      size="sm"
      overlayClassName="edge-pick-dialog"
      onConfirm={dialog.handleConfirm}
      confirmDisabled={selectedEdgeCount === 0}
    >
      <FilletPickHeader selectedEdgeCount={selectedEdgeCount} dialog={dialog} />
      <EdgeSelectionList edgeIds={edgeIds} onRemoveEdge={onRemoveEdge} />
      <FilletModeFields dialog={dialog} />
      <FilletEdgeSets dialog={dialog} />
      <FilletAdvancedOptions dialog={dialog} />
    </DialogShell>
  );
}
export function FilletDialog({ onClose }: { onClose: () => void }) {
  const addFeature = useCADStore((s) => s.addFeature);
  const filletEdgeIds = useCADStore((s) => s.filletEdgeIds);
  const removeFilletEdge = useCADStore((s) => s.removeFilletEdge);
  const editingFeatureId = useCADStore((s) => s.editingFeatureId);
  const features = useCADStore((s) => s.features);
  const updateFeatureParams = useCADStore((s) => s.updateFeatureParams);
  const renameFeature = useCADStore((s) => s.renameFeature);
  const commitFillet = useCADStore((s) => s.commitFillet);
  const replayEdgeCutFeature = useCADStore((s) => s.replayEdgeCutFeature);

  const editing = editingFeatureId
    ? features.find((f) => f.id === editingFeatureId)
    : null;
  const p = editing?.params ?? {};
  const existingEdgeIds =
    typeof p.edgeIds === "string" ? p.edgeIds.split(",").filter(Boolean) : [];

  const handleConfirm = (params: FilletParams) => {
    const edgeIds = filletEdgeIds.length > 0 ? filletEdgeIds : existingEdgeIds;
    const edgeIdsStr = edgeIds.join(",");
    if (editing) {
      updateFeatureParams(editing.id, { ...params, edgeIds: edgeIdsStr });
      renameFeature(editing.id, `Fillet (r=${params.radius})`);
      replayEdgeCutFeature(editing.id);
    } else {
      const feature: Feature = {
        id: crypto.randomUUID(),
        name: `Fillet (r=${params.radius})`,
        type: "fillet",
        params: { ...params, edgeIds: edgeIdsStr },
        visible: true,
        suppressed: false,
        timestamp: Date.now(),
      };
      addFeature(feature);
      onClose();
      setTimeout(
        () =>
          commitFillet(
            params.radius,
            0,
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
    <FilletDialogUI
      open={true}
      selectedEdgeCount={filletEdgeIds.length || existingEdgeIds.length}
      edgeIds={filletEdgeIds}
      onRemoveEdge={removeFilletEdge}
      onClose={onClose}
      onConfirm={handleConfirm}
    />
  );
}
