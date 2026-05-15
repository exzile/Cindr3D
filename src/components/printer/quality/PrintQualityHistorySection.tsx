/**
 * PrintQualityHistorySection — collapsible "Print quality history" block for
 * the maintenance / calibration panel. Lists recent automatic per-print
 * diagnoses for the active printer, sourced from `useVisionStore`.
 *
 * Wiring mirrors `CalibrationResultsSection`: `isOpen` / `setIsOpen` /
 * `activePrinterId` are owned by the host. The hook
 * `usePrintCompletionScore` (mounted in `DuetNotifications`) feeds records
 * into this list automatically — this component is purely render.
 */
import { ChevronDown, ScanLine } from 'lucide-react';
import { useVisionStore } from '../../../store/visionStore';
import { PrintQualityCard } from './PrintQualityCard';
import './PrintQualityCard.css';
import './PrintQualityHistorySection.css';

interface PrintQualityHistorySectionProps {
  isOpen: boolean;
  setIsOpen: (updater: (open: boolean) => boolean) => void;
  activePrinterId: string;
}

export function PrintQualityHistorySection({
  isOpen,
  setIsOpen,
  activePrinterId,
}: PrintQualityHistorySectionProps) {
  const records = useVisionStore((s) =>
    s.recentDiagnoses.filter((r) => r.printerId === activePrinterId),
  );

  return (
    <div className="printer-calibration-panel__section printer-quality-history">
      <div className="printer-calibration-panel__section-head">
        <button
          type="button"
          className="printer-calibration-panel__section-toggle"
          aria-expanded={isOpen}
          aria-controls="print-quality-history-section"
          onClick={() => setIsOpen((open) => !open)}
          disabled={records.length === 0}
        >
          <ChevronDown size={14} className={isOpen ? 'is-open' : ''} />
          <span className="printer-calibration-panel__section-title">
            <ScanLine size={15} /> Print quality history
            {records.length > 0 && (
              <span className="printer-calibration-panel__pill">{records.length}</span>
            )}
          </span>
        </button>
      </div>
      {isOpen && (
        <div id="print-quality-history-section" className="printer-calibration-panel__rows">
          {records.length === 0 ? (
            <span className="calib-step__muted">
              No automatic print diagnoses yet. Configure an AI provider and a camera, then run a
              print — Cindr3D will capture a frame and score it when the print completes.
            </span>
          ) : (
            <div className="print-quality-history__list">
              {records.map((record) => (
                <PrintQualityCard key={record.id} record={record} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
