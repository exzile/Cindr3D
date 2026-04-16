import { useState, useCallback } from 'react';
import { Gauge } from 'lucide-react';
import { usePrinterStore } from '../../../store/printerStore';
import { SliderRow } from './helpers';
import '../DuetJobStatus.css';

export function SpeedFlowOverride() {
  const model = usePrinterStore((s) => s.model);
  const setSpeedFactor = usePrinterStore((s) => s.setSpeedFactor);
  const setExtrusionFactor = usePrinterStore((s) => s.setExtrusionFactor);

  const speedFactor = (model.move?.speedFactor ?? 1) * 100;
  const extruders = model.move?.extruders ?? [];

  const [localSpeed, setLocalSpeed] = useState<number | null>(null);
  const [localFlow, setLocalFlow] = useState<number | null>(null);

  const displaySpeed = localSpeed ?? Math.round(speedFactor);
  const firstExtruderFactor = extruders.length > 0 ? (extruders[0].factor ?? 1) * 100 : 100;
  const displayFlow = localFlow ?? Math.round(firstExtruderFactor);

  const handleSpeedChange = useCallback((value: number) => {
    setLocalSpeed(value);
  }, []);

  const handleSpeedCommit = useCallback((value: number) => {
    setLocalSpeed(null);
    setSpeedFactor(value);
  }, [setSpeedFactor]);

  const handleFlowChange = useCallback((value: number) => {
    setLocalFlow(value);
  }, []);

  const handleFlowCommit = useCallback((value: number) => {
    setLocalFlow(null);
    setExtrusionFactor(0, value);
  }, [setExtrusionFactor]);

  return (
    <div className="job-section">
      <div className="job-section-title">
        <Gauge size={14} /> Speed / Flow Override
      </div>
      <div style={{ padding: '4px 0' }}>
        <SliderRow
          label="Speed"
          value={displaySpeed}
          min={10}
          max={300}
          unit="%"
          onChange={handleSpeedChange}
          onCommit={handleSpeedCommit}
        />
        <SliderRow
          label="Flow"
          value={displayFlow}
          min={50}
          max={200}
          unit="%"
          onChange={handleFlowChange}
          onCommit={handleFlowCommit}
        />
      </div>
    </div>
  );
}
