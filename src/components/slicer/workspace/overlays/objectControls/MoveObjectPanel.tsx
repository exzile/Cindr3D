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
  const sclX = Math.abs(scale?.x ?? 1);
  const sclY = Math.abs(scale?.y ?? 1);
  const sclZ = scale?.z ?? 1;
  const axisClass = ['slicer-overlay-axis--x', 'slicer-overlay-axis--y', 'slicer-overlay-axis--z'] as const;
  const bbox = obj.boundingBox;

  // Display the world left/front/bottom edge of the object so users see bed
  // coordinates (e.g. X=30 means the object's left edge sits 30mm from the
  // bed's left edge). Internally `position` is a translation offset applied
  // on top of the raw geometry, so for a design-workspace body whose bbox
  // spans [-60, -20] the internal pos.x is 90 even though the object is
  // centered — that confuses users who see "X: 90" on a 100mm bed.
  const worldX = pos.x + (bbox.min.x ?? 0) * sclX;
  const worldY = pos.y + (bbox.min.y ?? 0) * sclY;
  const worldZ = pos.z + (bbox.min.z ?? 0) * Math.abs(sclZ);

  const worldPos = { x: worldX, y: worldY, z: worldZ };

  const handleWorldChange = (axis: 'x' | 'y' | 'z', value: string) => {
    if (locked) return;
    const v = parseFloat(value) || 0;
    if (axis === 'x') onUpdate({ position: { ...pos, x: v - (bbox.min.x ?? 0) * sclX } });
    else if (axis === 'y') onUpdate({ position: { ...pos, y: v - (bbox.min.y ?? 0) * sclY } });
    else onUpdate({ position: { ...pos, z: v - (bbox.min.z ?? 0) * Math.abs(sclZ) } });
  };

  return (
    <div className="slicer-overlay-panel">
      {header}
      {(['x', 'y', 'z'] as const).map((axis, index) => (
        <div key={axis} className="slicer-overlay-row">
          <span className={`slicer-overlay-axis ${axisClass[index]}`}>{axis.toUpperCase()}</span>
          <NumberInput
            val={worldPos[axis].toFixed(1)}
            onChange={(value) => handleWorldChange(axis, value)}
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
