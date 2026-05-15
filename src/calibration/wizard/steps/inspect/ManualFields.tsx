interface ManualFieldsProps {
  testType: string;
  /** Controlled value for the pressure-advance field — used so AI auto-fill is reflected in the input. */
  paValue?: number | null;
  /** Controlled value for the first-layer Z-offset delta — used so AI auto-fill is reflected in the input. */
  firstLayerValue?: number | null;
  onMeasurement: (key: string, value: number) => void;
}

/**
 * Per-test manual measurement inputs. Most fields are uncontrolled (the wizard
 * only needs the final value reported via onMeasurement), but pressure-advance
 * and first-layer are controlled so the AI recommendation can populate them.
 */
export function ManualFields({ testType, paValue, firstLayerValue, onMeasurement }: ManualFieldsProps) {
  if (testType === 'pressure-advance') return (
    <div className="calib-inspect-field">
      <span className="calib-inspect-field__label">Best PA value</span>
      <input
        className="calib-inspect-field__input"
        type="number" step={0.0001} min={0} placeholder="e.g. 0.045"
        value={paValue ?? ''}
        onChange={(e) => onMeasurement('value', Number(e.target.value))}
      />
      <span className="calib-inspect-field__unit">PA</span>
    </div>
  );

  if (testType === 'first-layer') return (
    <div className="calib-inspect-field">
      <span className="calib-inspect-field__label">Z offset delta</span>
      <input
        className="calib-inspect-field__input"
        type="number" step={0.001} placeholder="e.g. −0.05"
        value={firstLayerValue ?? ''}
        onChange={(e) => onMeasurement('value', Number(e.target.value))}
      />
      <span className="calib-inspect-field__unit">mm</span>
    </div>
  );

  if (testType === 'temperature-tower') return (
    <div className="calib-inspect-field">
      <span className="calib-inspect-field__label">Best temperature</span>
      <input
        className="calib-inspect-field__input"
        type="number" step={1} min={150} max={320} placeholder="e.g. 215"
        onChange={(e) => onMeasurement('value', Number(e.target.value))}
      />
      <span className="calib-inspect-field__unit">°C</span>
    </div>
  );

  if (testType === 'retraction') return (
    <div className="calib-inspect-field">
      <span className="calib-inspect-field__label">Best retraction distance</span>
      <input
        className="calib-inspect-field__input"
        type="number" step={0.1} min={0} placeholder="e.g. 1.0"
        onChange={(e) => onMeasurement('value', Number(e.target.value))}
      />
      <span className="calib-inspect-field__unit">mm</span>
    </div>
  );

  if (testType === 'input-shaper') return (
    <>
      <div className="calib-inspect-field">
        <span className="calib-inspect-field__label">Resonance freq X</span>
        <input
          className="calib-inspect-field__input"
          type="number" step={0.1} min={0} placeholder="e.g. 48.2"
          onChange={(e) => onMeasurement('freqX', Number(e.target.value))}
        />
        <span className="calib-inspect-field__unit">Hz</span>
      </div>
      <div className="calib-inspect-field">
        <span className="calib-inspect-field__label">Resonance freq Y</span>
        <input
          className="calib-inspect-field__input"
          type="number" step={0.1} min={0} placeholder="e.g. 44.6"
          onChange={(e) => onMeasurement('freqY', Number(e.target.value))}
        />
        <span className="calib-inspect-field__unit">Hz</span>
      </div>
    </>
  );

  if (testType === 'flow-rate') return (
    <div className="calib-inspect-field">
      <span className="calib-inspect-field__label">Flow multiplier</span>
      <input
        className="calib-inspect-field__input"
        type="number" step={1} min={50} max={150} placeholder="e.g. 96"
        onChange={(e) => onMeasurement('value', Number(e.target.value))}
      />
      <span className="calib-inspect-field__unit">%</span>
    </div>
  );

  // Generic fallback (e.g. dimensional-accuracy, max-volumetric-speed)
  return (
    <div className="calib-inspect-field calib-inspect-field--full">
      <span className="calib-inspect-field__label">Observations / notes</span>
      <textarea
        className="calib-inspect-field__textarea"
        placeholder="Describe what you observed…"
        onChange={(e) => onMeasurement('value', e.target.value.length)}
      />
    </div>
  );
}
