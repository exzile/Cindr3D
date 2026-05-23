import { useMemo } from "react";
import { parseEdgeLabel } from "../../../../utils/geometry/edgeCutCore";

interface EdgeSelectionListProps {
  edgeIds: string[];
  onRemoveEdge: (id: string) => void;
}

export function EdgeSelectionList({
  edgeIds,
  onRemoveEdge,
}: EdgeSelectionListProps) {
  const edgeLabels = useMemo(
    () => edgeIds.map((id, i) => parseEdgeLabel(id, i)),
    [edgeIds],
  );

  if (edgeIds.length === 0) return null;

  return (
    <div
      style={{
        maxHeight: 110,
        overflowY: "auto",
        border: "1px solid #444",
        borderRadius: 4,
        marginBottom: 8,
      }}
    >
      {edgeIds.map((id, i) => (
        <div
          key={id}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "3px 6px",
            borderBottom: i < edgeIds.length - 1 ? "1px solid #333" : "none",
            fontSize: 11,
          }}
        >
          <span
            style={{
              fontFamily: "monospace",
              color: "#ccc",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              flex: 1,
              marginRight: 4,
            }}
          >
            {edgeLabels[i]}
          </span>
          <button
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "#cc4444",
              padding: "0 2px",
              fontSize: 14,
              lineHeight: 1,
            }}
            onClick={() => onRemoveEdge(id)}
            title="Remove edge"
          >
            x
          </button>
        </div>
      ))}
    </div>
  );
}
