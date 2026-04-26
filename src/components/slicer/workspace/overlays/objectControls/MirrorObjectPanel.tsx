import { FlipHorizontal } from 'lucide-react';
import type { ObjectPanelProps } from './types';

export function MirrorObjectPanel({
  obj,
  locked,
  onUpdate,
  header,
  divider,
}: ObjectPanelProps) {
  const axisClass = ['slicer-overlay-axis--x', 'slicer-overlay-axis--y', 'slicer-overlay-axis--z'] as const;

  return (
    <div className="slicer-overlay-panel">
      {header}
      <div className="slicer-overlay-btn-row">
        {(['x', 'y', 'z'] as const).map((axis, index) => {
          const key = `mirror${axis.toUpperCase()}` as 'mirrorX' | 'mirrorY' | 'mirrorZ';
          const active = !!(obj as { mirrorX?: boolean; mirrorY?: boolean; mirrorZ?: boolean })[key];
          return (
            <button
              key={axis}
              disabled={locked}
              className={`slicer-overlay-mirror-btn${active ? ' is-active' : ''}`}
              onClick={() => onUpdate({ [key]: !active })}
            >
              <FlipHorizontal size={13} />
              <span className={`slicer-overlay-mirror-axis-label ${axisClass[index]}`}>{axis.toUpperCase()}</span>
            </button>
          );
        })}
      </div>
      {divider}
      <div className="slicer-overlay-hint">
        Click an axis to toggle mirroring
      </div>
    </div>
  );
}
