/**
 * CalibrationResultsSection — collapsible "Calibration history" section for
 * the maintenance panel. Loops over calibration item types and renders a
 * CalibrationResultsHistory block for each one that has at least one stored
 * result for the active printer.
 */
import { ChevronDown, History } from 'lucide-react';
import {
  CALIBRATION_ITEMS,
  useCalibrationStore,
  type CalibrationItemId,
} from '../../../../store/calibrationStore';
import { CalibrationResultsHistory } from './CalibrationResultsHistory';

interface CalibrationResultsSectionProps {
  isOpen: boolean;
  setIsOpen: (updater: (open: boolean) => boolean) => void;
  activePrinterId: string;
}

export function CalibrationResultsSection({
  isOpen,
  setIsOpen,
  activePrinterId,
}: CalibrationResultsSectionProps) {
  const records = useCalibrationStore((s) => s.calibrationByPrinterId[activePrinterId]);

  const itemsWithResults = CALIBRATION_ITEMS.filter((item) => {
    const itemRecord = records?.[item.id as CalibrationItemId];
    return (itemRecord?.results?.length ?? 0) > 0;
  });

  const totalResults = itemsWithResults.reduce((sum, item) => {
    return sum + (records?.[item.id as CalibrationItemId]?.results?.length ?? 0);
  }, 0);

  return (
    <div className="printer-calibration-panel__section printer-calibration-panel__section--results">
      <div className="printer-calibration-panel__section-head">
        <button
          type="button"
          className="printer-calibration-panel__section-toggle"
          aria-expanded={isOpen}
          aria-controls="calibration-results-section"
          onClick={() => setIsOpen((open) => !open)}
          disabled={itemsWithResults.length === 0}
        >
          <ChevronDown size={14} className={isOpen ? 'is-open' : ''} />
          <span className="printer-calibration-panel__section-title">
            <History size={15} /> Calibration history
            {totalResults > 0 && (
              <span className="printer-calibration-panel__pill">{totalResults}</span>
            )}
          </span>
        </button>
      </div>
      {isOpen && (
        <div id="calibration-results-section" className="printer-calibration-panel__rows">
          {itemsWithResults.length === 0 ? (
            <span className="calib-step__muted">
              No saved calibration results yet. Run a wizard and complete the Apply step to record one.
            </span>
          ) : (
            itemsWithResults.map((item) => (
              <CalibrationResultsHistory
                key={item.id}
                printerId={activePrinterId}
                itemId={item.id as CalibrationItemId}
                title={item.label}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}
