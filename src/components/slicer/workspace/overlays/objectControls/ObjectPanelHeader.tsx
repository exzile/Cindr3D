import { Lock, Unlock } from 'lucide-react';
import type { PlateObject } from '../../../../../types/slicer';
import type { ObjectUpdate } from './types';

export function ObjectPanelHeader({
  obj,
  locked,
  onUpdate,
}: {
  obj: PlateObject;
  locked: boolean;
  onUpdate: ObjectUpdate;
}) {
  return (
    <div className="slicer-overlay-header">
      <div className="slicer-overlay-header-name">
        {obj.name}
      </div>
      <button
        title={locked ? 'Unlock model' : 'Lock model'}
        onClick={() => onUpdate({ locked: !locked })}
        className={`slicer-overlay-lock-button ${locked ? 'is-locked' : ''}`}
      >
        {locked ? <Lock size={13} /> : <Unlock size={13} />}
      </button>
    </div>
  );
}
