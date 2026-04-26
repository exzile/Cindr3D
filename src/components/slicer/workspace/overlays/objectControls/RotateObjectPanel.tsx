import { ArrowDownToLine, RefreshCw } from 'lucide-react';
import { normalizeRotationRadians, normalizeScale } from '../../../../../utils/slicerTransforms';
import { NumberInput } from './formControls';
import { layFlatObject } from './layFlatObject';
import type { ObjectPanelProps } from './types';

export function RotateObjectPanel({
  obj,
  locked,
  onUpdate,
  header,
  divider,
}: ObjectPanelProps) {
  const pos = obj.position as { x: number; y: number; z: number };
  const rot = normalizeRotationRadians((obj as { rotation?: unknown }).rotation);
  const scale = normalizeScale((obj as { scale?: unknown }).scale);
  const axisClass = ['slicer-overlay-axis--x', 'slicer-overlay-axis--y', 'slicer-overlay-axis--z'] as const;

  return (
    <div className="slicer-overlay-panel">
      {header}
      {(['x', 'y', 'z'] as const).map((axis, index) => (
        <div key={axis} className="slicer-overlay-row">
          <span className={`slicer-overlay-axis ${axisClass[index]}`}>{axis.toUpperCase()}</span>
          <NumberInput
            val={((rot[axis] * 180) / Math.PI % 360).toFixed(1)}
            onChange={(value) => {
              if (!locked) onUpdate({ rotation: { ...rot, [axis]: (parseFloat(value) || 0) * Math.PI / 180 } });
            }}
            disabled={locked}
          />
          <span className="slicer-overlay-unit">°</span>
        </div>
      ))}
      {divider}
      <div className="slicer-overlay-btn-row">
        {(['x', 'y', 'z'] as const).map((axis, index) => (
          <button
            key={axis}
            disabled={locked}
            className="slicer-overlay-flex-btn"
            title={`Rotate 90° around ${axis.toUpperCase()}`}
            onClick={() => {
              const current = rot[axis];
              onUpdate({ rotation: { ...rot, [axis]: current + Math.PI / 2 } });
            }}
          >
            <span className={`slicer-overlay-rotate-axis-label ${axisClass[index]}`}>{axis.toUpperCase()}</span> +90°
          </button>
        ))}
      </div>
      <div className="slicer-overlay-btn-row slicer-overlay-btn-row--mt">
        <button
          className="slicer-overlay-flex-btn"
          disabled={locked}
          onClick={() => layFlatObject({ obj, locked, rotation: rot, scale, position: pos, onUpdate })}
          title="Rotate so the largest flat face rests on the build plate"
        >
          <ArrowDownToLine size={11} /> Lay Flat
        </button>
        <button
          className="slicer-overlay-flex-btn"
          disabled={locked}
          onClick={() => onUpdate({ rotation: { x: 0, y: 0, z: 0 } })}
        >
          <RefreshCw size={11} /> Reset
        </button>
      </div>
    </div>
  );
}
