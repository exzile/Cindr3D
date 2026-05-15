import { Eye, EyeOff, Pause, ShieldAlert } from 'lucide-react';
import { useLayerFailureSampler } from '../../../hooks/useLayerFailureSampler';
import { useVisionStore } from '../../../store/visionStore';
import './LiveFailureMonitorCard.css';

const SEVERITY_LABELS: Record<string, string> = {
  none: 'OK',
  watch: 'Watch',
  warning: 'Warning',
  critical: 'Critical',
};

const STATE_PRESENTATION: Record<string, { dotClass: string; label: string }> = {
  active: { dotClass: 'is-active', label: 'Active' },
  running: { dotClass: 'is-running', label: 'Sampling…' },
  idle: { dotClass: 'is-idle', label: 'Idle' },
  'disabled-no-key': { dotClass: 'is-disabled', label: 'Disabled (no API key)' },
  error: { dotClass: 'is-error', label: 'Error' },
};

/**
 * Dashboard card that surfaces the layer-by-layer failure sampler. Reads the
 * sampler status directly (the hook owns the sampling loop) and exposes a
 * single toggle: "auto-pause" — when on, the sampler is allowed to call
 * `pausePrint()` if the detector returns a high-confidence failure.
 *
 * Keeps presentation tight: state pill, latest check (category / severity /
 * confidence), last sampled layer, and the toggle. Anything more detailed
 * (history list, evidence quotes) lives in the failure-history panel.
 */
export function LiveFailureMonitorCard() {
  const status = useLayerFailureSampler({ layerStep: 5 });
  const failureSettings = useVisionStore((s) => s.failureSettings);
  const updateFailureSettings = useVisionStore((s) => s.updateFailureSettings);

  const presentation = STATE_PRESENTATION[status.state] ?? STATE_PRESENTATION.idle;
  const lastCheck = status.lastCheck;
  const lastResult = lastCheck?.result;

  return (
    <div className="live-failure-monitor">
      <div className="lfm-header">
        <span className="lfm-title">
          <ShieldAlert size={13} /> Layer failure monitor
        </span>
        <span className={`lfm-pill ${presentation.dotClass}`}>
          <span className="lfm-dot" />
          {presentation.label}
        </span>
      </div>

      {lastCheck ? (
        <div className="lfm-summary">
          <div className="lfm-summary-row">
            <span className="lfm-summary-label">Layer</span>
            <span className="lfm-summary-value">{lastCheck.layer}</span>
          </div>
          <div className="lfm-summary-row">
            <span className="lfm-summary-label">Category</span>
            <span className={`lfm-summary-value lfm-cat lfm-cat--${lastResult?.category ?? 'none'}`}>
              {lastResult?.category ?? 'none'}
            </span>
          </div>
          <div className="lfm-summary-row">
            <span className="lfm-summary-label">Severity</span>
            <span className={`lfm-summary-value lfm-sev lfm-sev--${lastResult?.severity ?? 'none'}`}>
              {SEVERITY_LABELS[lastResult?.severity ?? 'none'] ?? lastResult?.severity}
            </span>
          </div>
          <div className="lfm-summary-row">
            <span className="lfm-summary-label">Confidence</span>
            <span className="lfm-summary-value">
              {lastResult ? `${Math.round(lastResult.confidence * 100)}%` : '—'}
            </span>
          </div>
        </div>
      ) : (
        <p className="lfm-empty">
          {status.state === 'disabled-no-key'
            ? 'Set an AI provider + key in the AI Assistant panel to enable monitoring.'
            : status.state === 'idle'
            ? 'Sampler will activate when a print starts.'
            : 'Waiting for the first layer to sample…'}
        </p>
      )}

      {status.lastError && (
        <p className="lfm-error">Last error: {status.lastError}</p>
      )}

      <label className="lfm-toggle">
        <input
          type="checkbox"
          checked={failureSettings.autoPauseEnabled}
          onChange={(e) => updateFailureSettings({ autoPauseEnabled: e.target.checked })}
        />
        <span className="lfm-toggle-icon">
          {failureSettings.autoPauseEnabled ? <Pause size={11} /> : <Eye size={11} />}
        </span>
        <span>
          {failureSettings.autoPauseEnabled
            ? 'Auto-pause on high-confidence failure'
            : 'Watch-only (no auto-pause)'}
        </span>
        {!failureSettings.autoPauseEnabled && (
          <EyeOff size={11} className="lfm-toggle-hint" aria-hidden />
        )}
      </label>
    </div>
  );
}
