import { RefreshCw } from 'lucide-react';
import { normalizeScale } from '../../../../../utils/slicerTransforms';
import { NumberInput, CheckRow } from './formControls';
import type { ObjectPanelProps } from './types';

export function ScaleObjectPanel({
  obj,
  locked,
  onUpdate,
  header,
  divider,
  snapScale,
  uniformScale,
  onSnapScaleChange,
  onUniformScaleChange,
}: ObjectPanelProps & {
  snapScale: boolean;
  uniformScale: boolean;
  onSnapScaleChange: (value: boolean) => void;
  onUniformScaleChange: (value: boolean) => void;
}) {
  const scale = normalizeScale((obj as { scale?: unknown }).scale);
  const axisClass = ['slicer-overlay-axis--x', 'slicer-overlay-axis--y', 'slicer-overlay-axis--z'] as const;
  const bboxSize = {
    x: Math.abs(obj.boundingBox.max.x - obj.boundingBox.min.x),
    y: Math.abs(obj.boundingBox.max.y - obj.boundingBox.min.y),
    z: Math.abs(obj.boundingBox.max.z - obj.boundingBox.min.z),
  };

  const setScale = (axis: 'x' | 'y' | 'z', raw: string, fromMm: boolean) => {
    if (locked) return;
    const parsed = parseFloat(raw);
    if (!isFinite(parsed) || parsed <= 0) return;
    const baseMm = bboxSize[axis] || 1;
    const newFactor = fromMm ? parsed / baseMm : parsed / 100;
    const snapped = snapScale ? Math.round(newFactor * 20) / 20 : newFactor;

    if (uniformScale) {
      const ratio = snapped / (scale[axis] || 1);
      onUpdate({ scale: { x: scale.x * ratio, y: scale.y * ratio, z: scale.z * ratio } });
    } else {
      onUpdate({ scale: { ...scale, [axis]: snapped } });
    }
  };

  return (
    <div className="slicer-overlay-panel">
      {header}
      <div className="slicer-overlay-scale-header-row">
        <span className="slicer-overlay-scale-header-spacer" />
        <span className="slicer-overlay-scale-header-text">Size (mm)</span>
        <span className="slicer-overlay-scale-header-text">Scale (%)</span>
      </div>
      {(['x', 'y', 'z'] as const).map((axis, index) => {
        const sizeMm = (bboxSize[axis] * scale[axis]).toFixed(1);
        const pct = (scale[axis] * 100).toFixed(1);
        return (
          <div key={axis} className="slicer-overlay-row">
            <span className={`slicer-overlay-axis ${axisClass[index]}`}>{axis.toUpperCase()}</span>
            <NumberInput val={sizeMm} onChange={(value) => setScale(axis, value, true)} disabled={locked} />
            <span className="slicer-overlay-unit slicer-overlay-unit--wide">mm</span>
            <NumberInput val={pct} onChange={(value) => setScale(axis, value, false)} disabled={locked} narrow />
            <span className="slicer-overlay-unit">%</span>
          </div>
        );
      })}
      {divider}
      <CheckRow label="Snap Scaling" checked={snapScale} onClick={() => onSnapScaleChange(!snapScale)} />
      <CheckRow label="Uniform Scaling" checked={uniformScale} onClick={() => onUniformScaleChange(!uniformScale)} />
      <button
        className="slicer-overlay-full-btn"
        disabled={locked}
        onClick={() => onUpdate({ scale: { x: 1, y: 1, z: 1 } })}
      >
        <RefreshCw size={11} /> Reset Scale
      </button>
    </div>
  );
}
