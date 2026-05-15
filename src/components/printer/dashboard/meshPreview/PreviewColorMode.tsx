import { Palette } from 'lucide-react';
import type { DashboardPreviewColorMode } from './helpers';

export function PreviewColorMode({
  colorMode,
  onChange,
}: {
  colorMode: DashboardPreviewColorMode;
  onChange: (next: DashboardPreviewColorMode) => void;
}) {
  return (
    <>
      <label
        style={{
          position: 'absolute',
          top: 8,
          left: 8,
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          padding: '3px 6px',
          border: '1px solid var(--border, #2a2a4a)',
          borderRadius: 6,
          background: 'rgba(10, 10, 20, 0.76)',
          color: 'var(--text-muted, #aaa)',
          fontSize: 10,
          pointerEvents: 'auto',
        }}
      >
        <Palette size={12} />
        <select
          value={colorMode}
          aria-label="Preview color mode"
          onChange={(event) => onChange(event.currentTarget.value as DashboardPreviewColorMode)}
          style={{
            background: 'transparent',
            border: 0,
            color: 'inherit',
            fontSize: 10,
            outline: 'none',
          }}
        >
          <option value="type">Type</option>
          <option value="speed">Speed</option>
          <option value="layer-time">Layer time</option>
          <option value="flow">Extrusion</option>
          <option value="width">Width</option>
          <option value="object">Object</option>
        </select>
      </label>

      {colorMode !== 'type' && colorMode !== 'object' && (
        <div
          style={{
            position: 'absolute',
            top: 42,
            left: 8,
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            padding: '3px 6px',
            border: '1px solid var(--border, #2a2a4a)',
            borderRadius: 6,
            background: 'rgba(10, 10, 20, 0.76)',
            color: 'var(--text-muted, #aaa)',
            fontSize: 9,
            pointerEvents: 'none',
          }}
        >
          <span style={{ width: 32, height: 5, borderRadius: 999, background: 'linear-gradient(90deg, #3b82f6, #22c55e, #f97316)' }} />
          <span>{colorMode === 'flow' ? 'low to high extrusion' : colorMode === 'layer-time' ? 'fast to slow layer' : colorMode === 'speed' ? 'slow to fast' : 'narrow to wide'}</span>
        </div>
      )}
    </>
  );
}
