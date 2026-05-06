interface StepLoadModelProps {
  testType: string;
}

export function StepLoadModel({ testType }: StepLoadModelProps) {
  return (
    <div className="calib-step">
      <h3>Load model</h3>
      <div className="calib-step__panel">
        <strong>Calibration model: {testType} test print</strong>
        <p>
          The model will load from assets/calibration-models/ (Task B). Scale is calculated
          from your nozzle diameter and layer height.
        </p>
        <button type="button" disabled>
          Preview model (coming soon)
        </button>
      </div>
    </div>
  );
}
