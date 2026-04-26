import { ArrowDownToLine } from 'lucide-react';
import { useSlicerStore } from '../../../../../store/slicerStore';
import { colors } from '../../../../../utils/theme';
import { NumberInput, CheckRow } from './formControls';
import type { ObjectPanelProps } from './types';

export function MoveObjectPanel({
  obj,
  locked,
  onUpdate,
  header,
  divider,
}: ObjectPanelProps) {
  const pos = obj.position as { x: number; y: number; z: number };
  const scale = obj.scale as { x?: number; y?: number; z?: number } | undefined;
  const sclZ = scale?.z ?? 1;
  const axisClass = ['slicer-overlay-axis--x', 'slicer-overlay-axis--y', 'slicer-overlay-axis--z'] as const;

  return (
    <div className="slicer-overlay-panel">
      {header}
      {(['x', 'y', 'z'] as const).map((axis, index) => (
        <div key={axis} className="slicer-overlay-row">
          <span className={`slicer-overlay-axis ${axisClass[index]}`}>{axis.toUpperCase()}</span>
          <NumberInput
            val={pos[axis].toFixed(1)}
            onChange={(value) => { if (!locked) onUpdate({ position: { ...pos, [axis]: parseFloat(value) || 0 } }); }}
            disabled={locked}
          />
          <span className="slicer-overlay-unit">mm</span>
        </div>
      ))}
      {divider}
      <CheckRow label="Lock Model" checked={locked} onClick={() => onUpdate({ locked: !locked })} />
      <label
        className={`slicer-overlay-drop-row ${locked ? 'is-disabled' : ''}`}
        onClick={() => {
          if (locked) return;
          const minZ = isFinite(obj.boundingBox.min.z) ? obj.boundingBox.min.z * sclZ : 0;
          onUpdate({ position: { ...pos, z: -minZ } });
        }}
      >
        <ArrowDownToLine size={13} color={locked ? colors.textDim : colors.accent} />
        Drop Down <span className="slicer-overlay-drop-highlight">Model</span>
      </label>
      <button
        className="slicer-overlay-full-btn"
        disabled={locked}
        onClick={() => {
          const buildVolume = useSlicerStore.getState().getActivePrinterProfile()?.buildVolume ?? { x: 220, y: 220, z: 250 };
          const box = obj.boundingBox;
          const scl = {
            x: scale?.x ?? 1,
            y: scale?.y ?? 1,
            z: scale?.z ?? 1,
          };
          const width = (box.max.x - box.min.x) * scl.x;
          const depth = (box.max.y - box.min.y) * scl.y;
          const minZ = box.min.z * scl.z;
          onUpdate({
            position: {
              x: buildVolume.x / 2 - box.min.x * scl.x - width / 2,
              y: buildVolume.y / 2 - box.min.y * scl.y - depth / 2,
              z: isFinite(minZ) ? -minZ : pos.z,
            },
          });
        }}
      >
        Center on Plate
      </button>
    </div>
  );
}
