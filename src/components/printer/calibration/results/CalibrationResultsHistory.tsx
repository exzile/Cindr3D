import { useMemo, useState } from 'react';
import {
  useCalibrationStore,
  type CalibrationItemId,
  type CalibrationResult,
} from '../../../../store/calibrationStore';
import { CalibrationResultThumbnail } from './CalibrationResultThumbnail';
import { CalibrationDriftChart } from './CalibrationDriftChart';
import { CalibrationResultViewer } from './CalibrationResultViewer';
import './CalibrationResultsHistory.css';

/** Axis-style label for the drift sparkline per calibration item. */
function inferValueLabel(itemId: CalibrationItemId): string {
  switch (itemId) {
    case 'pressure-advance': return 'PA';
    case 'first-layer': return 'Z-offset (mm)';
    case 'input-shaper': return 'freq (Hz)';
    case 'z-offset': return 'Z-offset (mm)';
    case 'bed-mesh': return 'deviation (mm)';
    case 'firmware-health': return '';
    default: return '';
  }
}

interface CalibrationResultsHistoryProps {
  printerId: string;
  itemId: CalibrationItemId;
  /** Optional title override — defaults to "Recent results". */
  title?: string;
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function formatValue(result: CalibrationResult): string {
  if (result.appliedValue == null) return '—';
  const v = result.appliedValue;
  // PA and Z-offset both want 4 decimals; freqX wants 1. Use a heuristic: if
  // the value is below 1, show 4 decimals; otherwise 2.
  return Math.abs(v) < 1 ? v.toFixed(4) : v.toFixed(2);
}

/**
 * Drift-detection view: lists past calibration results for a given printer +
 * item combo with applied value, AI confidence, and clickable photo thumbnails.
 *
 * Returns null when no results exist, so it stays out of the way on a fresh
 * setup.
 */
export function CalibrationResultsHistory({
  printerId,
  itemId,
  title = 'Recent results',
}: CalibrationResultsHistoryProps) {
  const records = useCalibrationStore((s) => s.calibrationByPrinterId[printerId]);
  const results = useMemo(() => records?.[itemId]?.results ?? [], [records, itemId]);

  if (results.length === 0) return null;

  return (
    <section className="calib-results">
      <header className="calib-results__head">
        <strong className="calib-results__title">{title}</strong>
        <span className="calib-results__count">{results.length}</span>
      </header>
      <CalibrationDriftChart
        points={results
          .filter((r) => r.appliedValue !== null)
          .map((r) => ({ value: r.appliedValue!, recordedAt: r.recordedAt }))
          .reverse()}
        valueLabel={inferValueLabel(itemId)}
      />
      <ol className="calib-results__list">
        {results.map((result) => (
          <CalibrationResultRow key={result.id} result={result} />
        ))}
      </ol>
    </section>
  );
}

function CalibrationResultRow({ result }: { result: CalibrationResult }) {
  const confidencePct = result.aiConfidence != null
    ? Math.round(Math.min(1, Math.max(0, result.aiConfidence)) * 100)
    : null;
  const [openPhotoId, setOpenPhotoId] = useState<string | null>(null);

  // Cycle through the row's photos when the viewer asks for prev/next.
  const handleNavigate = (direction: -1 | 1) => {
    setOpenPhotoId((current) => {
      if (current == null || result.photoIds.length === 0) return current;
      const idx = result.photoIds.indexOf(current);
      if (idx < 0) return current;
      const len = result.photoIds.length;
      const nextIdx = (idx + direction + len) % len;
      return result.photoIds[nextIdx];
    });
  };

  return (
    <li className="calib-results__row">
      <div className="calib-results__meta">
        <span className="calib-results__date">{formatDate(result.recordedAt)}</span>
        <span className="calib-results__value">{formatValue(result)}</span>
        {confidencePct != null && (
          <span className="calib-results__confidence" title={`AI confidence ${confidencePct}%`}>
            {confidencePct}%
          </span>
        )}
        {result.spoolId && <span className="calib-results__spool">spool {result.spoolId}</span>}
      </div>
      {result.note && <p className="calib-results__note">{result.note}</p>}
      {result.photoIds.length > 0 && (
        <div className="calib-results__thumbs">
          {result.photoIds.map((id, i) => (
            <CalibrationResultThumbnail
              key={id}
              photoId={id}
              alt={`Calibration photo ${i + 1} from ${formatDate(result.recordedAt)}`}
              onClick={() => setOpenPhotoId(id)}
            />
          ))}
        </div>
      )}
      {openPhotoId && (
        <CalibrationResultViewer
          result={result}
          photoId={openPhotoId}
          onClose={() => setOpenPhotoId(null)}
          onNavigate={result.photoIds.length > 1 ? handleNavigate : undefined}
        />
      )}
    </li>
  );
}
