import './SketchPalette.css';
import { useEffect, useState } from 'react';
import { SketchPaletteDisplaySection } from './sketchPalette/SketchPaletteDisplaySection';
import { SketchPaletteHeader } from './sketchPalette/SketchPaletteHeader';
import { SketchPaletteOptionsSection } from './sketchPalette/SketchPaletteOptionsSection';
import { useSketchPaletteState } from './sketchPalette/useSketchPaletteState';

export default function SketchPalette() {
  const state = useSketchPaletteState();
  const [dismissed, setDismissed] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [lineType, setLineType] = useState<'normal' | 'construction'>('normal');

  useEffect(() => {
    if (state.activeSketch) setDismissed(false);
  }, [state.activeSketch?.id]);

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
