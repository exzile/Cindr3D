interface StepMonitorProps {
  onClose: () => void;
}

export function StepMonitor({ onClose }: StepMonitorProps) {
  return (
    <div className="calib-step">
      <div>Monitor your print from the Printer dashboard. Return here when complete.</div>
      <button type="button" onClick={onClose}>
        Open Printer Dashboard
      </button>
    </div>
  );
}
