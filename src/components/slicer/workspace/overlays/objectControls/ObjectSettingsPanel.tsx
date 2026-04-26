import { RefreshCw } from 'lucide-react';
import type { ReactNode } from 'react';
import type { ObjectPanelProps } from './types';

export function ObjectSettingsPanel({
  obj,
  locked,
  onUpdate,
  header,
}: ObjectPanelProps) {
  const perObj = (obj as { perObjectSettings?: Record<string, number | boolean | undefined> }).perObjectSettings ?? {};
  const overrideCount = Object.values(perObj).filter((value) => value !== undefined).length;
  const setOverride = (key: string, value: number | boolean | undefined) => {
    const next = { ...perObj };
    if (value === undefined) delete next[key];
    else next[key] = value;
    onUpdate({ perObjectSettings: next });
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
      {numericOverride('supportAngle', 'Overhang angle', '°', 0, 89, 1)}
      {triState('supportEnabled', 'Supports')}
      {triState('spiralizeContour', 'Vase mode')}
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
