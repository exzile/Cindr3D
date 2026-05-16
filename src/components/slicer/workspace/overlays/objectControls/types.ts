import type { ReactNode } from 'react';
import type { PlateObject } from '../../../../../types/slicer';

export type TransformMode = 'move' | 'scale' | 'rotate' | 'mirror' | 'texture' | 'settings';
export type Axis = 'x' | 'y' | 'z';
export type ObjectUpdate = (changes: Partial<PlateObject>) => void;

export interface ObjectPanelProps {
  obj: PlateObject;
  locked: boolean;
  onUpdate: ObjectUpdate;
  header: ReactNode;
  divider: ReactNode;
}
