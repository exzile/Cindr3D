import { Box, Clock, Ruler, XCircle } from 'lucide-react';
import { useEffect } from 'react';
import type { PlateObject } from '../../../../types/slicer';

/**
 * DOM-overlay context menu for a print-preview object: stats + a
 * per-object cancel button. Closes on Escape or any click outside the menu.
 */
export function ObjectContextMenu({
  obj,
  position,
  isCancelled,
  isCurrent,
  onCancel,
  onClose,
}: {
  obj: PlateObject;
  position: { x: number; y: number };
  isCancelled: boolean;
  isCurrent: boolean;
  onCancel: () => void;
  onClose: () => void;
}) {
  const bb = obj.boundingBox;
  const dx = (bb.max.x - bb.min.x).toFixed(1);
  const dy = (bb.max.y - bb.min.y).toFixed(1);
  const dz = (bb.max.z - bb.min.z).toFixed(1);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-mesh-ctx-menu]')) onClose();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onClick);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onClick);
    };
  }, [onClose]);

  return (
    <div
      data-mesh-ctx-menu
      style={{
        position: 'absolute',
        left: position.x,
        top: position.y,
        background: 'var(--bg-secondary, #1a1a2e)',
        border: '1px solid var(--border, #2a2a4a)',
        borderRadius: 6,
        boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
        padding: 8,
        minWidth: 200,
        fontSize: 11,
        zIndex: 50,
        pointerEvents: 'auto',
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div style={{
        fontWeight: 600, fontSize: 12, marginBottom: 6, paddingBottom: 6,
        borderBottom: '1px solid var(--border, #2a2a4a)',
        display: 'flex', alignItems: 'center', gap: 6,
        color: isCancelled ? '#ef4444' : isCurrent ? '#44aaff' : 'var(--text-primary)',
      }}>
        <Box size={12} /> {obj.name || obj.id.slice(0, 8)}
        {isCurrent && <span style={{ fontSize: 9, color: '#44aaff', fontWeight: 400 }}>· printing</span>}
        {isCancelled && <span style={{ fontSize: 9, color: '#ef4444', fontWeight: 400 }}>· cancelled</span>}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, color: 'var(--text-muted, #aaa)' }}>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <Ruler size={10} /> {dx} × {dy} × {dz} mm
        </div>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <Clock size={10} /> Position {obj.position.x.toFixed(1)}, {obj.position.y.toFixed(1)}
        </div>
      </div>

      <button
        onClick={onCancel}
        disabled={isCancelled}
        style={{
          marginTop: 8, width: '100%',
          padding: '4px 8px',
          background: isCancelled ? 'transparent' : 'rgba(239, 68, 68, 0.12)',
          border: `1px solid ${isCancelled ? 'var(--border)' : '#ef4444'}`,
          color: isCancelled ? 'var(--text-muted)' : '#ef4444',
          borderRadius: 4,
          cursor: isCancelled ? 'not-allowed' : 'pointer',
          fontSize: 11,
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
        }}
      >
        <XCircle size={12} /> {isCancelled ? 'Already cancelled' : 'Cancel this object'}
      </button>
    </div>
  );
}
