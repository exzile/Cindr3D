import { ArrowRight, ArrowUp, Eye, Maximize2, Rotate3D, Square } from 'lucide-react';
import type { PreviewViewPreset } from './helpers';

const VIEW_ENTRIES: Array<[PreviewViewPreset | 'sync', string, typeof Rotate3D]> = [
  ['iso', 'Isometric view', Rotate3D],
  ['top', 'Top view', Square],
  ['front', 'Front view', ArrowUp],
  ['side', 'Side view', ArrowRight],
  ['fit', 'Fit print', Maximize2],
  ['sync', 'Sync camera overlay', Eye],
];

export function PreviewViewControls({
  viewPreset,
  onSelectView,
  onSyncCameraOverlay,
}: {
  viewPreset: PreviewViewPreset;
  onSelectView: (view: PreviewViewPreset) => void;
  onSyncCameraOverlay: () => void;
}) {
  return (
    <div
      style={{
        position: 'absolute',
        top: 8,
        right: 8,
        display: 'flex',
        gap: 4,
        pointerEvents: 'auto',
      }}
    >
      {VIEW_ENTRIES.map(([view, title, Icon]) => (
        <button
          key={view}
          type="button"
          title={title}
          aria-label={title}
          onClick={() => view === 'sync' ? onSyncCameraOverlay() : onSelectView(view)}
          style={{
            width: 24,
            height: 24,
            border: `1px solid ${viewPreset === view ? '#44aaff' : 'var(--border, #2a2a4a)'}`,
            borderRadius: 4,
            background: viewPreset === view ? 'rgba(68, 170, 255, 0.18)' : 'rgba(10, 10, 20, 0.76)',
            color: viewPreset === view ? '#9bd7ff' : 'var(--text-muted, #aaa)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
          }}
        >
          <Icon size={13} />
        </button>
      ))}
    </div>
  );
}
