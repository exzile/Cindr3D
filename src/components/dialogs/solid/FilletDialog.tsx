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
import { storedEdgeIds } from "../../../utils/occEdgeUtils";

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
  /** True when face-picker driven modes (full-round / rule-fillet) have picked enough faces. */
  facesReady: boolean;
  /** When editing an existing fillet, seed all fields from the stored params. */
  initialParams?: Record<string, unknown>;
}

function FilletDialogUI({
  open,
  selectedEdgeCount,
  edgeIds,
  onRemoveEdge,
  onClose,
  onConfirm,
  facesReady,
  initialParams,
}: FilletDialogProps) {
  const dialog = useFilletDialogState(onConfirm, initialParams, edgeIds);

  if (!open) return null;

  const isFacePickerMode = dialog.mode === 'full-round' ||
    (dialog.mode === 'rule-fillet');
  const confirmDisabled = isFacePickerMode
    ? !facesReady
    : selectedEdgeCount === 0;

  return (
    <DialogShell
      title="Fillet"
      onClose={onClose}
      size="sm"
      overlayClassName="edge-pick-dialog"
      onConfirm={dialog.handleConfirm}
      confirmDisabled={confirmDisabled}
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
  const replayEdgeModificationFeature = useCADStore((s) => s.replayEdgeModificationFeature);
  // Full-round face picker state
  const filletFullRoundCenterOccBodyId = useCADStore((s) => s.filletFullRoundCenterOccBodyId);
  const filletFullRoundCenterOccFaceId = useCADStore((s) => s.filletFullRoundCenterOccFaceId);
  const filletFullRoundSide1OccFaceId = useCADStore((s) => s.filletFullRoundSide1OccFaceId);
  const filletFullRoundSide2OccFaceId = useCADStore((s) => s.filletFullRoundSide2OccFaceId);

  const editing = editingFeatureId
    ? features.find((feature) => feature.id === editingFeatureId)
    : null;
  const params = editing?.params ?? {};
  const existingEdgeIds = storedEdgeIds(params.edgeIds);

  const handleConfirm = (nextParams: FilletParams) => {
    // Augment full-round + rule-fillet params with picked face IDs so they
    // get persisted for replay. Both modes use the same face-picker state.
    const isFullRound = nextParams.mode === 'full-round';
    const isRuleFillet = nextParams.mode === 'rule-fillet';
    const augmented: FilletParams = (isFullRound || isRuleFillet)
      ? {
          ...nextParams,
          centerOccBodyId: filletFullRoundCenterOccBodyId ?? undefined,
          centerOccFaceId: filletFullRoundCenterOccFaceId ?? undefined,
          side1OccFaceId: filletFullRoundSide1OccFaceId ?? undefined,
          side2OccFaceId: filletFullRoundSide2OccFaceId ?? undefined,
          // FILLET-7: rule-fillet AllEdges stores its target face(s) here.
          ruleFaceIds: isRuleFillet && nextParams.ruleType === 'all-edges' && filletFullRoundCenterOccFaceId !== null
            ? [filletFullRoundCenterOccFaceId]
            : nextParams.ruleFaceIds,
        }
      : nextParams;

    const edgeIds = filletEdgeIds.length > 0 ? filletEdgeIds : existingEdgeIds;
    const displayName = isFullRound
      ? 'Full-Round Fillet'
      : isRuleFillet
        ? `Rule Fillet (r=${nextParams.radius})`
        : `Fillet (r=${nextParams.radius})`;
    if (editing) {
      updateFeatureParams(editing.id, { ...augmented, edgeIds });
      renameFeature(editing.id, displayName);
      replayEdgeModificationFeature(editing.id);
    } else {
      const feature: Feature = {
        id: crypto.randomUUID(),
        name: displayName,
        type: "fillet",
        params: { ...augmented, edgeIds },
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
            augmented as unknown as Record<string, unknown>,
          ),
        0,
      );
      return;
    }
    onClose();
  };

  // Face-picker readiness:
  //  - full-round needs center + both sides (sides may be auto-inferred when null,
  //    so center alone is sufficient to enable confirm)
  //  - rule-fillet AllEdges needs center, BetweenFaces needs both sides
  const facesReady =
    filletFullRoundCenterOccFaceId !== null ||
    (filletFullRoundSide1OccFaceId !== null && filletFullRoundSide2OccFaceId !== null);

  return (
    <FilletDialogUI
      open
      selectedEdgeCount={filletEdgeIds.length || existingEdgeIds.length}
      edgeIds={filletEdgeIds.length > 0 ? filletEdgeIds : existingEdgeIds}
      onRemoveEdge={removeFilletEdge}
      onClose={onClose}
      onConfirm={handleConfirm}
      facesReady={facesReady}
      initialParams={editing ? params : undefined}
    />
  );
}
