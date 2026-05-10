import { useEffect } from 'react';
import { usePrinterStore } from '../../../store/printerStore';

interface StepPickPrinterProps {
  selectedId: string;
  onChange: (id: string) => void;
}

export function StepPickPrinter({ selectedId, onChange }: StepPickPrinterProps) {
  const printers = usePrinterStore((state) => state.printers);
  const activePrinterId = usePrinterStore((state) => state.activePrinterId);

  useEffect(() => {
    if (!selectedId && activePrinterId) onChange(activePrinterId);
  }, [activePrinterId, onChange, selectedId]);

  return (
    <div className="calib-step">

      <p>Select the printer that will run this calibration.</p>
      <div className="calib-step__list">
        {printers.map((printer) => (
          <label key={printer.id} className="calib-step__radio">
            <input
              type="radio"
              name="calib-printer"
              checked={selectedId === printer.id}
              onChange={() => onChange(printer.id)}
            />
            <span>{printer.name}</span>
          </label>
        ))}
        {printers.length === 0 && (
          <span className="calib-step__muted">No printers are configured yet.</span>
        )}
      </div>
    </div>
  );
}
