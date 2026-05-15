import type { TuningTowerRecommendation } from '../../../../services/vision/tuningWizards';
import { suggestNextTest } from './nextTestSuggestion';

interface RecommendationCardProps {
  recommendation: TuningTowerRecommendation;
  /** Format the best-value number for display + apply-button label. */
  formatBestValue: (value: number) => string;
  /** Human-readable label for the apply button ("PA value", "Z-offset delta", …). */
  valueLabel: string;
  /** Optional handler — when present the "Use … as best …" button is rendered. */
  onApply?: () => void;
  /**
   * Current calibration card `testType` — fed to `suggestNextTest` so we never
   * suggest the test the user is already on. Optional for back-compat; without
   * it the "Run X next" hint is skipped.
   */
  currentTestType?: string;
  /**
   * Optional jump-to handler. When present the next-test hint renders as a CTA
   * button; otherwise it renders as a tinted info row (the wizard hasn't wired
   * the navigation yet).
   */
  onJumpToTest?: (testType: string) => void;
}

/**
 * Reusable AI recommendation result card. Display formatting is delegated to
 * the caller via `formatBestValue` so each test can pick its own precision
 * (4 decimals for PA, 3 decimals for first-layer Z offset, etc.).
 */
export function RecommendationCard({
  recommendation,
  formatBestValue,
  valueLabel,
  onApply,
  currentTestType,
  onJumpToTest,
}: RecommendationCardProps) {
  const confidencePct = Math.round(Math.min(1, Math.max(0, recommendation.confidence)) * 100);
  const hasValue = recommendation.bestValue !== undefined && Number.isFinite(recommendation.bestValue);
  const formattedValue = hasValue ? formatBestValue(recommendation.bestValue!) : 'manual review';
  const nextSuggestion = currentTestType
    ? suggestNextTest({ recommendation, currentTestType })
    : null;

  return (
    <div className="calib-inspect__rec">
      <div className="calib-inspect__rec-head">
        <div className="calib-inspect__rec-value">
          <span className="calib-inspect__rec-label">Recommended</span>
          <span className="calib-inspect__rec-number">{formattedValue}</span>
        </div>
        <div className="calib-inspect__rec-confidence">
          <span className="calib-inspect__rec-label">Confidence</span>
          <div className="calib-inspect__rec-bar" aria-label={`Confidence ${confidencePct}%`}>
            <div className="calib-inspect__rec-bar-fill" style={{ width: `${confidencePct}%` }} />
          </div>
          <span className="calib-inspect__rec-pct">{confidencePct}%</span>
        </div>
      </div>
      {recommendation.summary && (
        <p className="calib-inspect__rec-summary">{recommendation.summary}</p>
      )}
      {recommendation.evidence.length > 0 && (
        <details className="calib-inspect__rec-details" open>
          <summary>Evidence ({recommendation.evidence.length})</summary>
          <ul>{recommendation.evidence.map((item, i) => <li key={`ev-${i}`}>{item}</li>)}</ul>
        </details>
      )}
      {recommendation.missingMeasurements && recommendation.missingMeasurements.length > 0 && (
        <details className="calib-inspect__rec-details calib-inspect__rec-details--warn">
          <summary>Missing measurements ({recommendation.missingMeasurements.length})</summary>
          <ul>{recommendation.missingMeasurements.map((item, i) => <li key={`mm-${i}`}>{item}</li>)}</ul>
        </details>
      )}
      {recommendation.suggestedActions.length > 0 && (
        <details className="calib-inspect__rec-details">
          <summary>Suggested actions ({recommendation.suggestedActions.length})</summary>
          <ul>{recommendation.suggestedActions.map((item, i) => <li key={`sa-${i}`}>{item}</li>)}</ul>
        </details>
      )}
      {nextSuggestion && (
        <div className="calib-inspect__rec-next" role="note">
          <span className="calib-inspect__rec-next-label">Run next</span>
          <p className="calib-inspect__rec-next-reason">{nextSuggestion.reason}</p>
          {onJumpToTest ? (
            <button
              type="button"
              className="calib-inspect__rec-next-cta"
              onClick={() => onJumpToTest(nextSuggestion.testType)}
            >
              Calibrate {nextSuggestion.testType} next →
            </button>
          ) : (
            <span className="calib-inspect__rec-next-target">
              Suggested next test: <strong>{nextSuggestion.testType}</strong>
            </span>
          )}
        </div>
      )}
      {hasValue && onApply && (
        <button type="button" className="calib-inspect__rec-apply" onClick={onApply}>
          Use {formattedValue} as {valueLabel}
        </button>
      )}
    </div>
  );
}
