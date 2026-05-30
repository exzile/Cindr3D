import { useCADStore } from "../../../store/cadStore";
import type { Feature } from "../../../types/cad";
import { DialogShell } from "../common/DialogShell";
import { ChamferAdvancedOptions } from "./chamferDialog/ChamferAdvancedOptions";
import { ChamferModeFields } from "./chamferDialog/ChamferModeFields";
import { ChamferPickHeader } from "./chamferDialog/ChamferPickHeader";
import type { ChamferParams } from "./chamferDialog/types";
import { useChamferDialogState } from "./chamferDialog/useChamferDialogState";
import { EdgeSelectionList } from "./edgeDialog/EdgeSelectionList";
import { storedEdgeIds } from "../../../utils/occEdgeUtils";

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

function resolveChamferDistance2(
  p: Pick<ChamferParams, "mode" | "distance" | "distance2" | "angle">,
): number {
  if (p.mode === "two-dist") return p.distance2 ?? p.distance;
  if (p.mode === "dist-angle") {
    const angle = Math.max(1, Math.min(89, p.angle ?? 45));
    return Math.max(0.01, p.distance * Math.tan((angle * Math.PI) / 180));
  }
  return p.distance;
}

function resolveChamferDistances(
  p: Pick<
    ChamferParams,
    "mode" | "distance" | "distance2" | "angle" | "isFlipped"
  >,
): [number, number] {
  const d1 = p.distance;
  const d2 = resolveChamferDistance2(p);
  return p.isFlipped ? [d2, d1] : [d1, d2];
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
  const replayEdgeModificationFeature = useCADStore((s) => s.replayEdgeModificationFeature);

  const editing = editingFeatureId
    ? features.find((feature) => feature.id === editingFeatureId)
    : null;
  const params = editing?.params ?? {};
  const existingEdgeIds = storedEdgeIds(params.edgeIds);

  const handleConfirm = (nextParams: ChamferParams) => {
    const edgeIds =
      chamferEdgeIds.length > 0 ? chamferEdgeIds : existingEdgeIds;
    const [d1, d2] = resolveChamferDistances(nextParams);
    if (editing) {
      updateFeatureParams(editing.id, { ...nextParams, edgeIds });
      renameFeature(editing.id, `Chamfer (d=${d1})`);
      replayEdgeModificationFeature(editing.id);
    } else {
      const feature: Feature = {
        id: crypto.randomUUID(),
        name: `Chamfer (d=${d1})`,
        type: "chamfer",
        params: { ...nextParams, edgeIds },
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
