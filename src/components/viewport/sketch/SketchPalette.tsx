import './SketchPalette.css';
import { useState } from 'react';
import { SketchPaletteDisplaySection } from './sketchPalette/SketchPaletteDisplaySection';
import { SketchPaletteHeader } from './sketchPalette/SketchPaletteHeader';
import { SketchPaletteOptionsSection } from './sketchPalette/SketchPaletteOptionsSection';
import { useSketchPaletteState } from './sketchPalette/useSketchPaletteState';

export default function SketchPalette() {
  const state = useSketchPaletteState();
  const [dismissedSketchId, setDismissedSketchId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [lineType, setLineType] = useState<'normal' | 'construction'>('normal');
  const activeSketchId = state.activeSketch?.id ?? null;
  const dismissed = activeSketchId !== null && dismissedSketchId === activeSketchId;

  const setDismissed = (value: boolean | ((previous: boolean) => boolean)) => {
    const next = typeof value === 'function' ? value(dismissed) : value;
    setDismissedSketchId(next ? activeSketchId : null);
  };

  if (!state.activeSketch || dismissed) return null;

  return (
    <div className="sketch-palette">
      <SketchPaletteHeader
        state={state}
        collapsed={collapsed}
        dismissed={dismissed}
        setCollapsed={setCollapsed}
        setDismissed={setDismissed}
      />

      {!collapsed && (
        <div className="sketch-palette-body">
          <SketchPaletteOptionsSection
            state={state}
            lineType={lineType}
            setLineType={setLineType}
          />
          <SketchPaletteDisplaySection state={state} />
        </div>
      )}
    </div>
  );
}
