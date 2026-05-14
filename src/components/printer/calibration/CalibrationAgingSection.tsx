/**
 * CalibrationAgingSection — collapsible per-calibration-item list with
 * the interval-in-days input + a "Mark run" button that records a
 * calibration event. Each row also shows the last-run timestamp and a
 * coloured status pill.
 */
import { ChevronDown, Gauge, Sparkles } from 'lucide-react';
import type { CalibrationItemId, CalibrationStatus } from '../../../store/calibrationStore';
import { formatDate, parseNonNegativeNumber, statusLabel } from './calibrationHelpers';

export interface CalibrationAgingSectionProps {
  isOpen: boolean;
  setIsOpen: (updater: (open: boolean) => boolean) => void;

  activePrinterId: string;
  calibrationStatuses: CalibrationStatus[];

  updateCalibrationInterval: (printerId: string, itemId: CalibrationItemId, intervalDays: number) => void;
  markCalibration: (itemId: CalibrationItemId) => void;
}

export function CalibrationAgingSection(props: CalibrationAgingSectionProps) {
  const {
    isOpen, setIsOpen,
    activePrinterId, calibrationStatuses,
    updateCalibrationInterval, markCalibration,
  } = props;

  return (
    <div className="printer-calibration-panel__section printer-calibration-panel__section--aging">
      <div className="printer-calibration-panel__section-head">
        <button
          type="button"
          className="printer-calibration-panel__section-toggle"
          aria-expanded={isOpen}
          aria-controls="calibration-aging-section"
          onClick={() => setIsOpen((open) => !open)}
        >
          <ChevronDown size={14} className={isOpen ? 'is-open' : ''} />
          <span className="printer-calibration-panel__section-title"><Gauge size={15} /> Calibration aging</span>
        </button>
      </div>
      {isOpen && (
        <div id="calibration-aging-section" className="printer-calibration-panel__rows">
          {calibrationStatuses.map((item) => (
            <div key={item.record.itemId} className={`printer-calibration-panel__life-row is-${item.status}`}>
              <div>
                <strong>{item.definition.label}</strong>
                <span>Last run: {formatDate(item.record.lastRunAt)}</span>
              </div>
              <label>
                <span>Interval</span>
                <input
                  type="number"
                  min={1}
                  value={item.record.intervalDays}
                  onChange={(event) => {
                    const intervalDays = parseNonNegativeNumber(event.target.value);
                    if (intervalDays !== null && intervalDays >= 1) {
                      updateCalibrationInterval(activePrinterId, item.record.itemId, intervalDays);
                    }
                  }}
                />
              </label>
              <span className="printer-calibration-panel__pill">{statusLabel(item.status, item.daysUntilDue)}</span>
              <button type="button" onClick={() => markCalibration(item.record.itemId)}>
                <Sparkles size={13} /> Mark run
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
