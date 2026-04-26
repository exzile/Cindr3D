import type { CSSProperties } from 'react';
import { Html } from '@react-three/drei';
import type { MoveHoverInfo } from '../../../../types/slicer-preview.types';
import { MOVE_TYPE_LABELS } from '../preview/constants';

// Inline styles — the tooltip is a thin DOM overlay positioned via drei's
// <Html> projection; not worth a separate CSS file.
const TOOLTIP_STYLE: CSSProperties = {
  background: 'rgba(14, 16, 26, 0.92)',
  border: '1px solid rgba(120, 130, 200, 0.35)',
  borderRadius: 6,
  padding: '6px 10px',
  color: '#dde',
  fontSize: 11,
  whiteSpace: 'nowrap',
  pointerEvents: 'none',
  boxShadow: '0 4px 16px rgba(0,0,0,0.55)',
  userSelect: 'none',
  lineHeight: 1.7,
  transform: 'translate(10px, -50%)',
};

/**
 * Floating hover inspect tooltip — anchored to the hovered point in 3D space
 * via drei's <Html>. Shows g-code attributes of the hovered extrusion move.
 *
 * Flow% formula:  (actual_extrusion_mm × filamentArea) / (lineWidth × layerHeight × move_length) × 100
 *
 * `actual_extrusion_mm` already includes `currentLayerFlow × material.flowRate
 * × flowCompFactor` (computed by the slicer's `Emitter.calculateExtrusion`),
 * so dividing by the nominal volume per move yields the effective flow
 * multiplier as a percentage. The old display shoved `extrusion × 100`
 * into the slot which was raw mm×100 — coincidentally near 100 for
 * typical moves but not actually a flow %.
 */
export function HoverTooltip({
  info, filamentDiameter = 1.75, layerHeight,
}: {
  info: MoveHoverInfo;
  filamentDiameter?: number;
  layerHeight: number;
}) {
  const filamentArea = Math.PI * Math.pow(Math.max(filamentDiameter, 0.1) / 2, 2);
  const nominalVolume = info.lineWidth * Math.max(layerHeight, 0.02) * info.length;
  const flowPct = nominalVolume > 1e-9
    ? (info.extrusion * filamentArea / nominalVolume) * 100
    : 0;
  return (
    <Html position={info.worldPos} style={{ pointerEvents: 'none' }}>
      <div style={TOOLTIP_STYLE}>
        <div style={{ fontWeight: 600, color: '#fff', marginBottom: 2 }}>
          {MOVE_TYPE_LABELS[info.type as keyof typeof MOVE_TYPE_LABELS] ?? info.type}
        </div>
        <div>Speed: <b>{info.speed.toFixed(0)}</b> mm/s</div>
        <div>Flow:&nbsp;&nbsp;<b>{flowPct.toFixed(1)}</b>%</div>
        <div>Width: <b>{info.lineWidth.toFixed(2)}</b> mm</div>
        <div>Len:&nbsp;&nbsp;&nbsp;<b>{info.length.toFixed(1)}</b> mm</div>
        <div>E:&nbsp;&nbsp;&nbsp;&nbsp;<b>{info.extrusion.toFixed(3)}</b> mm</div>
      </div>
    </Html>
  );
}
