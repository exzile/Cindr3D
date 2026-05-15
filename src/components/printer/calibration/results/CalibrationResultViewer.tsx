import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Image as ImageIcon } from 'lucide-react';
import { Modal, ModalBody, ModalFooter } from '../../../ui/Modal';
import { getCalibrationPhotoObjectUrl } from '../../../../services/calibration/calibrationPhotoStore';
import type { CalibrationResult } from '../../../../store/calibrationStore';
import './CalibrationResultViewer.css';

interface CalibrationResultViewerProps {
  result: CalibrationResult;
  photoId: string;
  onClose: () => void;
  /** Optional prev/next handler. Caller cycles `photoId` across the result's photo list. */
  onNavigate?: (direction: -1 | 1) => void;
}

function formatTimestamp(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function formatAppliedValue(result: CalibrationResult): string {
  if (result.appliedValue == null) return '—';
  const v = result.appliedValue;
  return Math.abs(v) < 1 ? v.toFixed(4) : v.toFixed(2);
}

/**
 * Full-resolution lightbox for a single calibration photo + the saved AI
 * verdict that accompanied that capture. Composed on top of the shared
 * `Modal` primitive so it inherits Escape-to-close, overlay click-out, and
 * portal mounting.
 *
 * Photo blob is resolved from IDB on mount/`photoId` change and the resulting
 * object URL is revoked on unmount — same pattern used by
 * `CalibrationResultThumbnail`. Prev/next navigation is delegated to the
 * caller, which knows the surrounding `photoIds` ordering.
 */
export function CalibrationResultViewer({
  result,
  photoId,
  onClose,
  onNavigate,
}: CalibrationResultViewerProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  // Resolve the full-size photo blob whenever the requested ID changes.
  useEffect(() => {
    let cancelled = false;
    let createdUrl: string | null = null;
    setUrl(null);
    setFailed(false);
    void (async () => {
      try {
        const next = await getCalibrationPhotoObjectUrl(photoId);
        if (cancelled) {
          if (next) URL.revokeObjectURL(next);
          return;
        }
        if (next) {
          createdUrl = next;
          setUrl(next);
        } else {
          setFailed(true);
        }
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [photoId]);

  // Arrow-key navigation. `Modal` already handles Escape via `useModalKeys`.
  useEffect(() => {
    if (!onNavigate) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        onNavigate(-1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        onNavigate(1);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onNavigate]);

  const confidencePct = result.aiConfidence != null
    ? Math.round(Math.min(1, Math.max(0, result.aiConfidence)) * 100)
    : null;

  const photoCount = result.photoIds.length;
  const photoIndex = result.photoIds.indexOf(photoId);
  const hasMultiple = photoCount > 1;

  return (
    <Modal
      onClose={onClose}
      title="Calibration photo"
      titleIcon={<ImageIcon size={15} style={{ color: '#60a5fa', flexShrink: 0 }} />}
      trailingHeader={hasMultiple && photoIndex >= 0
        ? <span className="calib-viewer__pager-badge">{photoIndex + 1} / {photoCount}</span>
        : undefined}
      size="wide"
      className="calib-viewer"
      ariaLabelledBy="calib-viewer-title"
    >
      <ModalBody className="calib-viewer__body">
        <div className="calib-viewer__photo-wrap">
          {failed ? (
            <div className="calib-viewer__photo-fallback">Photo unavailable</div>
          ) : !url ? (
            <div className="calib-viewer__photo-loading" aria-hidden="true" />
          ) : (
            <img className="calib-viewer__photo" src={url} alt="Calibration capture full size" />
          )}
        </div>

        <aside className="calib-viewer__details">
          <dl className="calib-viewer__facts">
            <div className="calib-viewer__fact">
              <dt>Applied value</dt>
              <dd className="calib-viewer__fact-value">{formatAppliedValue(result)}</dd>
            </div>
            {confidencePct != null && (
              <div className="calib-viewer__fact">
                <dt>AI confidence</dt>
                <dd className="calib-viewer__fact-confidence">{confidencePct}%</dd>
              </div>
            )}
            <div className="calib-viewer__fact">
              <dt>Applied at</dt>
              <dd>{formatTimestamp(result.recordedAt)}</dd>
            </div>
            {result.spoolId && (
              <div className="calib-viewer__fact">
                <dt>Spool</dt>
                <dd className="calib-viewer__fact-mono">{result.spoolId}</dd>
              </div>
            )}
            {result.firmwareType && (
              <div className="calib-viewer__fact">
                <dt>Firmware</dt>
                <dd className="calib-viewer__fact-mono">
                  {result.firmwareType}{result.firmwareVersion ? ` ${result.firmwareVersion}` : ''}
                </dd>
              </div>
            )}
          </dl>

          {result.note && (
            <div className="calib-viewer__note">
              <span className="calib-viewer__note-label">AI verdict</span>
              <p className="calib-viewer__note-body">{result.note}</p>
            </div>
          )}
        </aside>
      </ModalBody>

      <ModalFooter>
        {hasMultiple && onNavigate && (
          <>
            <button
              type="button"
              className="bc-modal-btn bc-modal-btn--secondary"
              onClick={() => onNavigate(-1)}
              aria-label="Previous photo"
            >
              <ChevronLeft size={14} /> Prev
            </button>
            <button
              type="button"
              className="bc-modal-btn bc-modal-btn--secondary"
              onClick={() => onNavigate(1)}
              aria-label="Next photo"
            >
              Next <ChevronRight size={14} />
            </button>
            <span className="calib-viewer__footer-spacer" />
          </>
        )}
        <button type="button" className="bc-modal-btn bc-modal-btn--primary" onClick={onClose}>
          Close
        </button>
      </ModalFooter>
    </Modal>
  );
}
