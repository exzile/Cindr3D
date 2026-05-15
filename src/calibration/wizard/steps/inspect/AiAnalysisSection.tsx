import type { TuningWizardKind, TuningTowerRecommendation } from '../../../../services/vision/tuningWizards';
import { RecommendationCard } from './RecommendationCard';

interface AiAnalysisSectionProps {
  /** Null for tests that don't support AI analysis (the user sees a manual-only note). */
  tuningKind: TuningWizardKind | null;
  /**
   * Calibration card `testType` currently being inspected — forwarded to the
   * recommendation card so it can suggest a different test (e.g. "Calibrate
   * retraction next") when the AI evidence points at another problem.
   */
  currentTestType: string;
  providerReady: boolean;
  framesCount: number;
  loading: boolean;
  error: string | null;
  recommendation: TuningTowerRecommendation | null;
  /** Format the recommendation's bestValue for display. */
  formatBestValue: (value: number) => string;
  /** Label for the apply button ("best PA value", "Z-offset delta", …). */
  valueLabel: string;
  /** Apply handler — when provided, the result card renders the "Use … as …" button. */
  onApplyRecommendation?: () => void;
  onAnalyse: () => void;
  onConfigureProvider: () => void;
}

/**
 * AI analysis CTA + result panel. Shows the Analyse button, provider-readiness
 * hint, error message, and the recommendation card slot.
 */
export function AiAnalysisSection({
  tuningKind,
  currentTestType,
  providerReady,
  framesCount,
  loading,
  error,
  recommendation,
  formatBestValue,
  valueLabel,
  onApplyRecommendation,
  onAnalyse,
  onConfigureProvider,
}: AiAnalysisSectionProps) {
  return (
    <section className="calib-step__panel">
      <strong className="calib-inspect__section-title">AI analysis</strong>
      {tuningKind ? (
        <>
          <p className="calib-step__muted">
            {providerReady
              ? 'Attach at least one camera frame above, then click Analyse to get an AI recommendation.'
              : 'Set your AI provider API key in the AI Assistant panel to enable photo-based analysis.'}
          </p>
          <div className="calib-inspect__ai-actions">
            <button
              type="button"
              disabled={framesCount === 0 || loading || !providerReady}
              onClick={onAnalyse}
            >
              {loading ? 'Analysing…' : 'Analyse with AI'}
            </button>
            {!providerReady && (
              <button
                type="button"
                className="calib-inspect__ai-config-btn"
                onClick={onConfigureProvider}
              >
                Configure AI provider
              </button>
            )}
          </div>
          {recommendation && (
            <RecommendationCard
              recommendation={recommendation}
              formatBestValue={formatBestValue}
              valueLabel={valueLabel}
              onApply={onApplyRecommendation}
              currentTestType={currentTestType}
              /* onJumpToTest intentionally left undefined — the wizard hasn't
                 wired test navigation yet, so the next-test hint renders as a
                 tinted info row rather than a CTA button. */
            />
          )}
        </>
      ) : (
        <p className="calib-step__muted">
          This calibration type uses manual measurement only — AI analysis is not available.
        </p>
      )}
      {error && <span className="calib-step__error">{error}</span>}
    </section>
  );
}
