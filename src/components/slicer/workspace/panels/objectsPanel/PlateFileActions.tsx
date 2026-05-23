import { FolderOpen, Save } from "lucide-react";
import type * as React from "react";

interface PlateFileActionsProps {
  loadInputRef: React.RefObject<HTMLInputElement | null>;
  onLoadPlate: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onOpenLoad: () => void;
  onSaveJson: () => void;
  onSaveThreeMf: () => void;
}

export function PlateFileActions({
  loadInputRef,
  onLoadPlate,
  onOpenLoad,
  onSaveJson,
  onSaveThreeMf,
}: PlateFileActionsProps) {
  return (
    <div className="slicer-workspace-objects-panel__plate-io">
      <button
        className="slicer-workspace-objects-panel__secondary-button"
        onClick={onSaveJson}
        title="Save plate to file"
      >
        <Save size={14} /> Save JSON
      </button>
      <button
        className="slicer-workspace-objects-panel__secondary-button"
        onClick={onSaveThreeMf}
        title="Save round-trippable 3MF plate"
      >
        <Save size={14} /> Save 3MF
      </button>
      <button
        className="slicer-workspace-objects-panel__secondary-button"
        onClick={onOpenLoad}
        title="Load plate from file"
      >
        <FolderOpen size={14} /> Load
      </button>
      <input
        ref={loadInputRef}
        type="file"
        accept=".json,.dzign-plate.json,.3mf"
        className="slicer-workspace-objects-panel__file-input"
        onChange={onLoadPlate}
      />
    </div>
  );
}
