import { Paintbrush, RefreshCw, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';
import type { ModifierMeshRole } from '../../../../../types/slicer';
import type { PaintedZSeamHint } from '../../../../../types/slicer/profiles/print';
import { useSlicerStore } from '../../../../../store/slicerStore';
import type { ObjectPanelProps } from './types';

type ModifierPaintRole = Exclude<ModifierMeshRole, 'normal'>;
type ObjectSettingValue = number | boolean | string | PaintedZSeamHint[] | undefined;

const modifierPaintOptions: Array<{ value: ModifierPaintRole; label: string }> = [
  { value: 'support_mesh', label: 'Support enforcer' },
  { value: 'anti_overhang_mesh', label: 'Support blocker' },
  { value: 'infill_mesh', label: 'Infill override' },
  { value: 'cutting_mesh', label: 'Cutting region' },
];

export function ObjectSettingsPanel({
  obj,
  locked,
  onUpdate,
  header,
}: ObjectPanelProps) {
  const setViewportPickMode = useSlicerStore((s) => s.setViewportPickMode);
  const selectPlateObject = useSlicerStore((s) => s.selectPlateObject);
  const perObj = (obj as { perObjectSettings?: Record<string, ObjectSettingValue> }).perObjectSettings ?? {};
  const overrideCount = Object.values(perObj).filter((value) => value !== undefined).length;
  const seamHints = Array.isArray(perObj.zSeamPaintHints) ? perObj.zSeamPaintHints : [];
  const modifierPaintRole = modifierPaintOptions.some((option) => option.value === perObj.modifierPaintRole)
    ? perObj.modifierPaintRole as ModifierPaintRole
    : 'support_mesh';
  const setOverride = (key: string, value: ObjectSettingValue) => {
    const next = { ...perObj };
    if (value === undefined) delete next[key];
    else next[key] = value;
    onUpdate({ perObjectSettings: next });
  };
  const startSeamPaint = () => {
    selectPlateObject(obj.id);
    setOverride('zSeamPosition', 'painted');
    setViewportPickMode('seam-paint');
  };
  const clearSeamPaint = () => {
    const next = { ...perObj };
    delete next.zSeamPaintHints;
    if (next.zSeamPosition === 'painted') delete next.zSeamPosition;
    onUpdate({ perObjectSettings: next });
  };
  const startModifierPaint = () => {
    selectPlateObject(obj.id);
    setOverride('modifierPaintRole', modifierPaintRole);
    setViewportPickMode('modifier-paint');
  };

  const numericOverride = (
    key: string,
    label: string,
    unit: string,
    min: number,
    max: number,
    step?: number,
  ): ReactNode => {
    const val = perObj[key] as number | undefined;
    return (
      <div key={key} className="slicer-overlay-row">
        <span className="slicer-overlay-settings-label">{label}</span>
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          placeholder="(global)"
          disabled={locked}
          className="slicer-overlay-settings-input"
          value={val ?? ''}
          onChange={(event) => setOverride(key, event.target.value === '' ? undefined : parseFloat(event.target.value))}
        />
        {unit && <span className="slicer-overlay-settings-unit">{unit}</span>}
      </div>
    );
  };

  const triState = (key: string, label: string): ReactNode => {
    const val = perObj[key] as boolean | undefined;
    const state = val === undefined ? 'default' : val ? 'on' : 'off';
    const cycle = () => {
      const next = val === undefined ? true : val ? false : undefined;
      setOverride(key, next);
    };
    return (
      <div key={key} className="slicer-overlay-row slicer-overlay-row--tristate">
        <span className="slicer-overlay-settings-label">{label}</span>
        <button
          type="button"
          disabled={locked}
          onClick={cycle}
          className={`slicer-overlay-tristate slicer-overlay-tristate--${state}`}
          title="Click to cycle: inherit → on → off → inherit"
        >
          {state === 'default' ? 'inherit' : state === 'on' ? 'ON' : 'OFF'}
        </button>
      </div>
    );
  };

  return (
    <div className="slicer-overlay-panel">
      {header}
      <div className="slicer-overlay-settings-intro">
        Override global print settings for this object only.
        {overrideCount > 0 && (
          <span className="slicer-overlay-settings-pill">{overrideCount} active</span>
        )}
      </div>
      {numericOverride('infillDensity', 'Infill', '%', 0, 100, 5)}
      {numericOverride('wallCount', 'Walls', '', 1, 20, 1)}
      {numericOverride('topLayers', 'Top layers', '', 0, 50, 1)}
      {numericOverride('bottomLayers', 'Bottom layers', '', 0, 50, 1)}
      {numericOverride('layerHeight', 'Layer height', 'mm', 0.05, 1, 0.05)}
      {numericOverride('extruderIndex', 'Tool', '', 0, 15, 1)}
      {numericOverride('supportAngle', 'Overhang angle', '°', 0, 89, 1)}
      {triState('supportEnabled', 'Supports')}
      {triState('spiralizeContour', 'Vase mode')}
      <div className="slicer-overlay-row">
        <span className="slicer-overlay-settings-label">Modifier role</span>
        <select
          disabled={locked}
          className="slicer-overlay-settings-input"
          value={modifierPaintRole}
          onChange={(event) => setOverride('modifierPaintRole', event.target.value as ModifierPaintRole)}
        >
          {modifierPaintOptions.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </div>
      {numericOverride('modifierPaintRadius', 'Brush radius', 'mm', 0.5, 100, 0.5)}
      {numericOverride('modifierPaintHeight', 'Brush height', 'mm', 0.2, 500, 0.5)}
      {modifierPaintRole === 'infill_mesh' && (
        numericOverride('modifierPaintInfillDensity', 'Painted infill', '%', 0, 100, 5)
      )}
      <button
        type="button"
        disabled={locked}
        className="slicer-overlay-full-btn"
        onClick={startModifierPaint}
        title="Click the model to create modifier mesh brush volumes"
      >
        <Paintbrush size={11} /> Paint modifier region
      </button>
      <div className="slicer-overlay-row">
        <span className="slicer-overlay-settings-label">Z seam paint</span>
        <button
          type="button"
          disabled={locked}
          className="slicer-overlay-tristate"
          onClick={startSeamPaint}
          title="Click the model to add painted Z seam hints"
        >
          <Paintbrush size={11} /> Paint
        </button>
        <span className="slicer-overlay-settings-unit">{seamHints.length}</span>
      </div>
      {seamHints.length > 0 && (
        <button
          type="button"
          disabled={locked}
          className="slicer-overlay-full-btn"
          onClick={clearSeamPaint}
          title="Remove painted Z seam hints from this object"
        >
          <Trash2 size={11} /> Clear painted seam
        </button>
      )}
      {overrideCount > 0 && (
        <button
          type="button"
          disabled={locked}
          className="slicer-overlay-full-btn"
          onClick={() => onUpdate({ perObjectSettings: {} })}
          title="Revert all overrides back to the global profile"
        >
          <RefreshCw size={11} /> Reset to global
        </button>
      )}
    </div>
  );
}
