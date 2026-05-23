import { Plus, Trash2 } from "lucide-react";
import type { FilletEdgeSet } from "./types";
import type { FilletDialogState } from "./useFilletDialogState";
import { NumberInput } from "../edgeDialog/NumberInput";

interface FilletEdgeSetsProps {
  dialog: FilletDialogState;
}

export function FilletEdgeSets({ dialog }: FilletEdgeSetsProps) {
  return (
    <div className="form-group">
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <label style={{ marginBottom: 0 }}>Edge Sets</label>
        <button
          className="btn btn-xs"
          style={{ padding: "2px 8px", fontSize: 11 }}
          onClick={dialog.addEdgeSet}
          title="Add an edge set with its own radius type (SDK FilletFeatureInput edge-set API)"
        >
          <Plus size={11} /> Add Set
        </button>
      </div>
      {dialog.edgeSets.length === 0 && (
        <p className="dialog-hint" style={{ marginTop: 4 }}>
          Optional: add per-edge radius sets to assign different types to
          subsets of selected edges.
        </p>
      )}
      {dialog.showEdgeSets &&
        dialog.edgeSets.map((set, i) => (
          <div
            key={i}
            style={{
              border: "1px solid #555",
              borderRadius: 4,
              padding: "6px 8px",
              marginTop: 6,
              position: "relative",
            }}
          >
            <button
              style={{
                position: "absolute",
                top: 4,
                right: 4,
                background: "none",
                border: "none",
                cursor: "pointer",
                color: "#cc4444",
                padding: 0,
              }}
              onClick={() => dialog.removeEdgeSet(i)}
              title="Remove this edge set"
            >
              <Trash2 size={12} />
            </button>
            <div
              className="settings-grid"
              style={{ gridTemplateColumns: "1fr 1fr", gap: "4px 8px" }}
            >
              <div className="form-group" style={{ marginBottom: 4 }}>
                <label style={{ fontSize: 11 }}>Type</label>
                <select
                  style={{ fontSize: 11 }}
                  value={set.type}
                  onChange={(e) =>
                    dialog.updateEdgeSet(i, {
                      type: e.target.value as FilletEdgeSet["type"],
                    })
                  }
                >
                  <option value="constant">Constant</option>
                  <option value="variable">Variable</option>
                  <option value="chord-length">Chord Length</option>
                </select>
              </div>
              {set.type === "constant" && (
                <NumberInput
                  label="Radius (mm)"
                  value={set.radius ?? 2}
                  onChange={(value) =>
                    dialog.updateEdgeSet(i, { radius: value })
                  }
                  min={0.01}
                  max={500}
                  step={0.5}
                  fallback={2}
                  style={{ marginBottom: 4 }}
                  labelStyle={{ fontSize: 11 }}
                  inputStyle={{ fontSize: 11 }}
                />
              )}
              {set.type === "variable" && (
                <>
                  <NumberInput
                    label="Start R (mm)"
                    value={set.radius ?? 1}
                    onChange={(value) =>
                      dialog.updateEdgeSet(i, { radius: value })
                    }
                    min={0.01}
                    max={500}
                    step={0.5}
                    fallback={1}
                    style={{ marginBottom: 4 }}
                    labelStyle={{ fontSize: 11 }}
                    inputStyle={{ fontSize: 11 }}
                  />
                  <NumberInput
                    label="End R (mm)"
                    value={set.endRadius ?? 4}
                    onChange={(value) =>
                      dialog.updateEdgeSet(i, { endRadius: value })
                    }
                    min={0.01}
                    max={500}
                    step={0.5}
                    fallback={4}
                    style={{ marginBottom: 4 }}
                    labelStyle={{ fontSize: 11 }}
                    inputStyle={{ fontSize: 11 }}
                  />
                </>
              )}
              {set.type === "chord-length" && (
                <NumberInput
                  label="Chord Len (mm)"
                  value={set.chordLength ?? 5}
                  onChange={(value) =>
                    dialog.updateEdgeSet(i, { chordLength: value })
                  }
                  min={0.01}
                  max={500}
                  step={0.5}
                  fallback={5}
                  style={{ marginBottom: 4 }}
                  labelStyle={{ fontSize: 11 }}
                  inputStyle={{ fontSize: 11 }}
                />
              )}
            </div>
            <p
              className="dialog-hint"
              style={{ margin: "4px 0 0", fontSize: 10 }}
            >
              Edge IDs assigned automatically from the current selection when
              this set is the only one, or via edge picker (deferred).
            </p>
          </div>
        ))}
    </div>
  );
}
