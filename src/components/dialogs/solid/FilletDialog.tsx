import { useCADStore } from "../../../store/cadStore";
import type { Feature } from "../../../types/cad";
import { DialogShell } from "../common/DialogShell";
import { EdgeSelectionList } from "./edgeDialog/EdgeSelectionList";
import { FilletAdvancedOptions } from "./filletDialog/FilletAdvancedOptions";
import { FilletEdgeSets } from "./filletDialog/FilletEdgeSets";
import { FilletModeFields } from "./filletDialog/FilletModeFields";
import { FilletPickHeader } from "./filletDialog/FilletPickHeader";
import type { FilletParams } from "./filletDialog/types";
import { useFilletDialogState } from "./filletDialog/useFilletDialogState";

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
  /** When editing an existing fillet, seed all fields from the stored params. */
  initialParams?: Record<string, unknown>;
}

function storedEdgeIds(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((id): id is string => typeof id === "string");
  }
  if (typeof value !== "string") return [];
  if (value.includes("\u001f")) return value.split("\u001f").filter(Boolean);
  return value.split(",").filter(Boolean);
}

function FilletDialogUI({
  open,
  selectedEdgeCount,
  edgeIds,
  onRemoveEdge,
  onClose,
  onConfirm,
  initialParams,
}: FilletDialogProps) {
  const dialog = useFilletDialogState(onConfirm, initialParams);

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

// Store-connected wrapper (used via activeDialog='fillet')
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
    ? features.find((feature) => feature.id === editingFeatureId)
    : null;
  const params = editing?.params ?? {};
  const existingEdgeIds = storedEdgeIds(params.edgeIds);

  const handleConfirm = (nextParams: FilletParams) => {
    const edgeIds = filletEdgeIds.length > 0 ? filletEdgeIds : existingEdgeIds;
    if (editing) {
      updateFeatureParams(editing.id, { ...nextParams, edgeIds });
      renameFeature(editing.id, `Fillet (r=${nextParams.radius})`);
      replayEdgeCutFeature(editing.id);
    } else {
      const feature: Feature = {
        id: crypto.randomUUID(),
        name: `Fillet (r=${nextParams.radius})`,
        type: "fillet",
        params: { ...nextParams, edgeIds },
        visible: true,
        suppressed: false,
        timestamp: Date.now(),
      };
      addFeature(feature);
      onClose();
      setTimeout(
        () =>
          commitFillet(
            nextParams.radius,
            0,
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
    <FilletDialogUI
      open
      selectedEdgeCount={filletEdgeIds.length || existingEdgeIds.length}
      edgeIds={filletEdgeIds.length > 0 ? filletEdgeIds : existingEdgeIds}
      onRemoveEdge={removeFilletEdge}
      onClose={onClose}
      onConfirm={handleConfirm}
      initialParams={editing ? params : undefined}
    />
  );
}
