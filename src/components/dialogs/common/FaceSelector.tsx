import { MousePointer2, X } from 'lucide-react';

/**
 * Face selector control. Renders either a picker placeholder button or a
 * filled chip with × clear button. Uses tool-panel (tp-*) classes.
 * Selection itself happens in the viewport — this component is purely UI.
 */
export function FaceSelector({
  selected,
  pickActive,
  onClear,
  selectedLabel = '1 selected',
  emptyLabel = 'Select',
}: {
  selected: boolean;
  pickActive: boolean;
  onClear: () => void;
  selectedLabel?: string;
  emptyLabel?: string;
}) {
  if (selected) {
    return (
      <span className="tp-chip">
        <MousePointer2 size={11} />
        {selectedLabel}
        <button
          type="button"
          className="tp-chip__clear"
          onClick={onClear}
          aria-label="Clear selection"
          title="Clear selection"
        >
          <X size={11} />
        </button>
      </span>
    );
  }
  return (
    <button
      type="button"
      className={`tp-pick-btn${pickActive ? ' active' : ''}`}
      tabIndex={-1}
    >
      {emptyLabel}
    </button>
  );
}
