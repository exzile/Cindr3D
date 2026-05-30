import { AlertTriangle } from "lucide-react";
import type { validatePlate } from "../../../../../store/slicer/plateValidation";

interface ValidationSummaryProps {
  validation: ReturnType<typeof validatePlate>;
}

export function ValidationSummary({ validation }: ValidationSummaryProps) {
  if (!validation.hasIssues) return null;

  return (
    <div className="slicer-workspace-objects-panel__validation" role="alert">
      <AlertTriangle
        size={11}
        style={{ verticalAlign: "middle", marginRight: 4 }}
      />
      {validation.outOfBounds.length > 0 && (
        <div>
          {validation.outOfBounds.length} object
          {validation.outOfBounds.length === 1 ? "" : "s"} outside build volume
        </div>
      )}
      {validation.overlapping.length > 0 && (
        <div>
          {validation.overlapping.length} object overlap
          {validation.overlapping.length === 1 ? "" : "s"} detected
        </div>
      )}
    </div>
  );
}
