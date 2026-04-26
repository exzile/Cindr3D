import type { ReactNode } from 'react';
import { FlipHorizontal, Maximize2, Move, RotateCw, SlidersHorizontal } from 'lucide-react';
import type { TransformMode } from './types';

const toolbarItems: { id: TransformMode; icon: ReactNode; title: string }[] = [
  { id: 'move', icon: <Move size={18} />, title: 'Move' },
  { id: 'scale', icon: <Maximize2 size={18} />, title: 'Scale' },
  { id: 'rotate', icon: <RotateCw size={18} />, title: 'Rotate' },
  { id: 'mirror', icon: <FlipHorizontal size={18} />, title: 'Mirror' },
  { id: 'settings', icon: <SlidersHorizontal size={18} />, title: 'Per-object Settings' },
];

export function ObjectToolbar({
  mode,
  onModeChange,
}: {
  mode: TransformMode;
  onModeChange: (mode: TransformMode) => void;
}) {
  return (
    <div className="slicer-overlay-toolbar">
      {toolbarItems.map(({ id, icon, title }) => (
        <button
          key={id}
          title={title}
          onClick={() => onModeChange(id)}
          className={`slicer-overlay-toolbar-button ${mode === id ? 'is-active' : ''}`}
        >
          {icon}
        </button>
      ))}
    </div>
  );
}
