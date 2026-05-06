import { useEffect, useState } from 'react';
import { useSpoolStore } from '../../../store/spoolStore';

interface StepPickFilamentProps {
  printerId: string;
  spoolId: string;
  onChange: (spoolId: string) => void;
}

export function StepPickFilament({ printerId, spoolId, onChange }: StepPickFilamentProps) {
  const [manualLabel, setManualLabel] = useState('');
  const spools = useSpoolStore((state) => state.spools);
  const loadedSpoolByPrinterId = useSpoolStore((state) => state.loadedSpoolByPrinterId);
  const activeSpoolId = useSpoolStore((state) => state.activeSpoolId);
  const loadedSpoolId = loadedSpoolByPrinterId[printerId] ?? activeSpoolId;

  useEffect(() => {
    if (!spoolId && loadedSpoolId) onChange(loadedSpoolId);
  }, [loadedSpoolId, onChange, spoolId]);

  const updateManualLabel = (value: string) => {
    setManualLabel(value);
    onChange(value.trim() ? `manual-${value.trim()}` : '');
  };

  return (
    <div className="calib-step">
      <h3>Pick filament</h3>
      <p>Choose the loaded spool or enter a manual material label for this calibration run.</p>
      {spools.length > 0 ? (
        <label>
          <span>Loaded spool</span>
          <select value={spoolId} onChange={(event) => onChange(event.target.value)}>
            <option value="">Select spool</option>
            {spools.map((spool) => (
              <option key={spool.id} value={spool.id}>
                {spool.brand} {spool.material} - {spool.colorName}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <label>
          <span>Spool label / material</span>
          <input
            value={manualLabel}
            placeholder="Generic PLA"
            onChange={(event) => updateManualLabel(event.target.value)}
          />
        </label>
      )}
    </div>
  );
}
