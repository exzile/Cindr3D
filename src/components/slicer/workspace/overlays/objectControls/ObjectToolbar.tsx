import type { ReactNode } from 'react';
import {
  FlipHorizontal, Maximize2, Move, RotateCw, SlidersHorizontal,
  Copy, Trash2, AlignEndHorizontal, ArrowDownToLine, Compass,
  Image as ImageIcon,
} from 'lucide-react';
import { useSlicerStore } from '../../../../../store/slicerStore';
import type { TransformMode } from './types';

const toolbarItems: { id: TransformMode; icon: ReactNode; title: string }[] = [
  { id: 'move', icon: <Move size={18} />, title: 'Move (M)' },
  { id: 'scale', icon: <Maximize2 size={18} />, title: 'Scale (S)' },
  { id: 'rotate', icon: <RotateCw size={18} />, title: 'Rotate (R)' },
  { id: 'mirror', icon: <FlipHorizontal size={18} />, title: 'Mirror' },
  { id: 'texture', icon: <ImageIcon size={18} />, title: 'Texture' },
  { id: 'settings', icon: <SlidersHorizontal size={18} />, title: 'Per-object Settings' },
];

export function ObjectToolbar({
  mode,
  panelOpen,
  onModeChange,
}: {
  mode: TransformMode;
  panelOpen: boolean;
  onModeChange: (mode: TransformMode) => void;
}) {
  const selectedId = useSlicerStore((s) => s.selectedPlateObjectId);
  const additionalSelectedIds = useSlicerStore((s) => s.additionalSelectedIds);
  const duplicateSelected = useSlicerStore((s) => s.duplicateSelectedPlateObjects);
  const removeSelected = useSlicerStore((s) => s.removeSelectedPlateObjects);
  const layFlat = useSlicerStore((s) => s.layFlatPlateObject);
  const dropToBed = useSlicerStore((s) => s.dropToBedPlateObject);
  const autoOrient = useSlicerStore((s) => s.autoOrientPlateObject);

  const hasSelection = selectedId !== null;
  const allSelected = selectedId
    ? [selectedId, ...additionalSelectedIds]
    : [];

  return (
    <div className="slicer-overlay-toolbar">
      {toolbarItems.map(({ id, icon, title }) => (
        <button
          key={id}
          title={title}
          onClick={() => onModeChange(id)}
          className={`slicer-overlay-toolbar-button ${mode === id && panelOpen ? 'is-active' : ''}`}
        >
          {icon}
        </button>
      ))}
      {hasSelection && (
        <>
          <div className="slicer-overlay-toolbar-divider" />
          <button
            title="Lay flat — heuristic (F)"
            onClick={() => allSelected.forEach((id) => layFlat(id))}
            className="slicer-overlay-toolbar-button"
          >
            <AlignEndHorizontal size={18} />
          </button>
          <button
            title="Auto-orient (minimize supports)"
            onClick={() => allSelected.forEach((id) => autoOrient(id))}
            className="slicer-overlay-toolbar-button"
          >
            <Compass size={18} />
          </button>
          <button
            title="Drop to bed (B)"
            onClick={() => allSelected.forEach((id) => dropToBed(id))}
            className="slicer-overlay-toolbar-button"
          >
            <ArrowDownToLine size={18} />
          </button>
          <button
            title="Duplicate (Ctrl+D)"
            onClick={() => duplicateSelected()}
            className="slicer-overlay-toolbar-button"
          >
            <Copy size={18} />
          </button>
          <button
            title="Delete (Del)"
            onClick={() => removeSelected()}
            className="slicer-overlay-toolbar-button slicer-overlay-toolbar-button--danger"
          >
            <Trash2 size={18} />
          </button>
        </>
      )}
    </div>
  );
}
