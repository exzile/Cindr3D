interface ManualFieldsProps {
  testType: string;
  /** Controlled value for the pressure-advance field — used so AI auto-fill is reflected in the input. */
  paValue?: number | null;
  /** Controlled value for the first-layer Z-offset delta — used so AI auto-fill is reflected in the input. */
  firstLayerValue?: number | null;
  /** Controlled value for the temperature-tower field — populated from AI. */
  temperatureValue?: number | null;
  /** Controlled value for the retraction-distance field — populated from AI. */
  retractionValue?: number | null;
  /** Controlled value for the max-volumetric-speed field — populated from AI. */
  maxVolSpeedValue?: number | null;
  onMeasurement: (key: string, value: number) => void;
}

/**
 * Per-test manual measurement inputs. Each tower-style test that supports AI
 * auto-fill exposes a controlled value so the recommendation can populate the
 * input; non-tower tests are uncontrolled (only the final value is propagated
 * via onMeasurement).
 */
export function ManualFields({
  testType,
  paValue,
  firstLayerValue,
  temperatureValue,
  retractionValue,
  maxVolSpeedValue,
  onMeasurement,
}: ManualFieldsProps) {
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
        value={temperatureValue ?? ''}
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
        value={retractionValue ?? ''}
        onChange={(e) => onMeasurement('value', Number(e.target.value))}
      />
      <span className="calib-inspect-field__unit">mm</span>
    </div>
  );

  if (testType === 'max-volumetric-speed') return (
    <div className="calib-inspect-field">
      <span className="calib-inspect-field__label">Max volumetric flow</span>
      <input
        className="calib-inspect-field__input"
        type="number" step={0.1} min={0} placeholder="e.g. 11.5"
        value={maxVolSpeedValue ?? ''}
        onChange={(e) => onMeasurement('value', Number(e.target.value))}
      />
      <span className="calib-inspect-field__unit">mm³/s</span>
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

  // Generic fallback (e.g. dimensional-accuracy)
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
