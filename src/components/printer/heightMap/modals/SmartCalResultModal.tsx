import { CheckCircle, Crosshair, Home, Loader2, Ruler, ScanLine, TriangleAlert } from 'lucide-react';
import { Modal, ModalBody, ModalFooter } from '../../../ui/Modal';
import type { SmartCalQuality, SmartCalResult, SmartCalStepKind } from '../types';

const SMARTCAL_STEP_META: Record<SmartCalStepKind, { icon: React.ReactNode; color: string }> = {
  level:    { icon: <Home    size={13} />, color: '#22c55e' },
  probe:    { icon: <Crosshair size={13} />, color: '#3b82f6' },
  datum:    { icon: <ScanLine  size={13} />, color: '#a855f7' },
  decision: { icon: <TriangleAlert size={13} />, color: '#f59e0b' },
  done:     { icon: <CheckCircle  size={13} />, color: '#34d399' },
  info:     { icon: <Ruler        size={13} />, color: '#94a3b8' },
};

const SMARTCAL_QUALITY_COLOR: Record<SmartCalQuality, string> = {
  good: '#22c55e',
  warn: '#f59e0b',
  bad:  '#ef4444',
  info: '#94a3b8',
};

const STOP_LABELS: Record<SmartCalResult['stopReason'], string> = {
  converged:     'Converged — within targets',
  maxIterations: 'Max iterations reached',
  failed:        'Sequence failed',
};

const STOP_COLORS: Record<SmartCalResult['stopReason'], string> = {
  converged:     '#22c55e',
  maxIterations: '#f59e0b',
  failed:        '#ef4444',
};

export function SmartCalResultModal({
  result, onClose, onRunAgain,
}: {
  result:     SmartCalResult;
  onClose:    () => void;
  onRunAgain: () => void;
}) {
  return (
    <Modal onClose={onClose} title="Smart Cal Results" size="md">
      <ModalBody>
        {/* Stop reason banner */}
        <div
          className="hm-smartcal-stop-banner"
          style={{ '--scr-color': STOP_COLORS[result.stopReason] } as React.CSSProperties}
        >
          {result.stopReason === 'converged'
            ? <CheckCircle size={13} />
            : result.stopReason === 'failed'
            ? <TriangleAlert size={13} />
            : <Loader2 size={13} />}
          {STOP_LABELS[result.stopReason]}
        </div>

        {/* Final stats (if available) */}
        {result.finalStats && (
          <div className="hm-smartcal-final-stats">
            <div className="hm-smartcal-stat">
              <span className="hm-smartcal-stat__label">Final RMS</span>
              <span
                className="hm-smartcal-stat__val"
                style={{ color: result.finalStats.rms < 0.1 ? '#22c55e' : result.finalStats.rms < 0.2 ? '#f59e0b' : '#ef4444' }}
              >{result.finalStats.rms.toFixed(4)} mm</span>
            </div>
            <div className="hm-smartcal-stat">
              <span className="hm-smartcal-stat__label">Final Mean</span>
              <span
                className="hm-smartcal-stat__val"
                style={{ color: Math.abs(result.finalStats.mean) < 0.1 ? '#22c55e' : '#f59e0b' }}
              >{result.finalStats.mean >= 0 ? '+' : ''}{result.finalStats.mean.toFixed(3)} mm</span>
            </div>
            <div className="hm-smartcal-stat">
              <span className="hm-smartcal-stat__label">Range</span>
              <span className="hm-smartcal-stat__val">
                {(result.finalStats.max - result.finalStats.min).toFixed(3)} mm
              </span>
            </div>
          </div>
        )}

        {/* Step timeline */}
        <div className="hm-smartcal-timeline">
          {result.steps.map((step, i) => {
            const meta = SMARTCAL_STEP_META[step.kind];
            return (
              <div key={i} className="hm-smartcal-step">
                <div
                  className="hm-smartcal-step__icon"
                  style={{ color: meta.color, background: `color-mix(in srgb, ${meta.color} 12%, transparent)`, borderColor: `color-mix(in srgb, ${meta.color} 28%, transparent)` }}
                >
                  {meta.icon}
                </div>
                {i < result.steps.length - 1 && <div className="hm-smartcal-step__line" />}
                <div className="hm-smartcal-step__body">
                  <span
                    className="hm-smartcal-step__label"
                    style={{ color: SMARTCAL_QUALITY_COLOR[step.quality] }}
                  >{step.label}</span>
                  {step.detail && (
                    <span className="hm-smartcal-step__detail">{step.detail}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </ModalBody>

      <ModalFooter>
        <button className="bc-modal-btn bc-modal-btn--cancel" onClick={onRunAgain}>Run Again</button>
        <button className="bc-modal-btn bc-modal-btn--confirm" onClick={onClose}>Done</button>
      </ModalFooter>
    </Modal>
  );
}
