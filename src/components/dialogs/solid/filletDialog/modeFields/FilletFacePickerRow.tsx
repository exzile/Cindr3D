interface FilletFacePickerRowProps {
  label: string;
  faceId: string | null;
  isActive: boolean;
  onActivate: () => void;
  onClear: () => void;
}

export function FilletFacePickerRow({
  label,
  faceId,
  isActive,
  onActivate,
  onClear,
}: FilletFacePickerRowProps) {
  return (
    <div className="form-group" style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span style={{ flex: 1, fontSize: 12 }}>{label}</span>
      {faceId ? (
        <>
          <span style={{ fontSize: 11, color: "#4caf50" }}>Picked</span>
          <button
            type="button"
            className="tp-btn-secondary"
            style={{ padding: "2px 6px", fontSize: 11 }}
            onClick={onClear}
          >
            Clear
          </button>
        </>
      ) : (
        <button
          type="button"
          className={isActive ? "tp-btn-primary" : "tp-btn-secondary"}
          style={{ padding: "2px 8px", fontSize: 11 }}
          onClick={onActivate}
        >
          {isActive ? "Click a face..." : "Pick"}
        </button>
      )}
    </div>
  );
}
