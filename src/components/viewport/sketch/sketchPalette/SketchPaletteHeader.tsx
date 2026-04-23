import { X } from 'lucide-react';
import type { Dispatch, SetStateAction } from 'react';
import type { SketchPaletteState } from './useSketchPaletteState';

interface SketchPaletteHeaderProps {
  state: SketchPaletteState;
  collapsed: boolean;
  dismissed: boolean;
  setCollapsed: Dispatch<SetStateAction<boolean>>;
  setDismissed: Dispatch<SetStateAction<boolean>>;
}

export function SketchPaletteHeader({
  state,
  collapsed,
  dismissed,
  setCollapsed,
  setDismissed,
}: SketchPaletteHeaderProps) {
  if (!state.activeSketch || dismissed) return null;

  return (
    <div className="sketch-palette-header">
      <span className="sketch-palette-dot" />
      <span className="sketch-palette-title">SKETCH PALETTE</span>
      {state.activeSketch.overConstrained && (
        <span className="sketch-palette-overcon-badge" title="Sketch is over-constrained - remove a conflicting constraint">
          Over-constrained
        </span>
      )}
      <button
        className="sketch-palette-collapse"
        onClick={() => setCollapsed(!collapsed)}
        title={collapsed ? 'Expand' : 'Collapse'}
      >
        {collapsed ? '\u25b6' : '\u25bc'}
      </button>
      <button
        className="sketch-palette-close"
        onClick={() => setDismissed(true)}
        title="Close Palette"
      >
        <X size={12} />
      </button>
    </div>
  );
}
